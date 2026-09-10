/**
 * Proving a webhook really came from Meta.
 *
 * The webhook endpoint is PUBLIC — it has to be, Meta calls it — and everything
 * behind it writes to the inbox that staff read and that a local model drafts
 * replies from. Without this check, anyone who learns the URL can invent
 * customers, put words in their mouths, and feed text to the drafting model.
 * This is the only thing standing between that and the product.
 *
 * Meta signs each delivery with `X-Hub-Signature-256: sha256=<hmac>`, an HMAC
 * of the RAW request body keyed by the app secret.
 *
 * ── Two things that quietly break this ──────────────────────────────────────
 *
 * 1. RAW BODY, not re-serialised JSON. `JSON.stringify(await req.json())` is a
 *    different byte string from what Meta signed — key order, whitespace and
 *    unicode escaping all differ — so it verifies nothing and fails 100% of the
 *    time, or worse, is "fixed" by disabling the check. Read the body as text
 *    once, verify that exact text, and parse it afterwards.
 *
 * 2. TIMING-SAFE COMPARISON. `a === b` on strings returns as soon as two bytes
 *    differ, and the time it took is a measurement of how many leading bytes
 *    were right. Compared enough times, that recovers a valid signature one
 *    byte at a time. timingSafeEqual takes the same time whatever the input.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: "no_secret" | "no_header" | "malformed" | "mismatch" };

/**
 * Verify a raw body against the `X-Hub-Signature-256` header.
 *
 * FAILS CLOSED. A missing app secret returns `no_secret` rather than skipping
 * the check — an unconfigured deployment must reject deliveries, not accept
 * unsigned ones. That is the difference between "not set up yet" and "wide
 * open", and it has to be the first of the two.
 */
export function verifyMetaSignature(
  rawBody: string,
  header: string | null,
  appSecret: string | null
): SignatureCheck {
  if (!appSecret) return { ok: false, reason: "no_secret" };
  if (!header) return { ok: false, reason: "no_header" };

  const prefix = "sha256=";
  if (!header.startsWith(prefix)) return { ok: false, reason: "malformed" };

  const provided = header.slice(prefix.length).trim().toLowerCase();
  // 32 bytes of SHA-256 as hex. Anything else cannot be a signature, and
  // checking here keeps Buffer.from from silently producing a short buffer.
  if (!/^[0-9a-f]{64}$/.test(provided)) return { ok: false, reason: "malformed" };

  const expected = createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");

  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return { ok: false, reason: "mismatch" };

  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: "mismatch" };
}

/**
 * The subscription handshake: Meta GETs the endpoint once with a token you
 * chose and a challenge to echo.
 *
 * Returns the challenge to echo, or null to refuse. The token comparison is
 * timing-safe for the same reason as above — it is a shared secret, and this
 * endpoint answers to anyone.
 */
export function verifySubscription(
  params: URLSearchParams,
  expectedToken: string | null
): string | null {
  if (!expectedToken) return null;
  if (params.get("hub.mode") !== "subscribe") return null;

  const given = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  if (given === null || challenge === null) return null;

  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expectedToken, "utf8");
  // Length is not secret — it leaks through the request anyway — but
  // timingSafeEqual throws on a mismatch, so it has to be checked first.
  if (a.length !== b.length) return null;

  return timingSafeEqual(a, b) ? challenge : null;
}


/* ── One secret per Meta app ─────────────────────────────────────────────── */

/**
 * WHY THIS EXISTS. Monza's three brands live in three Meta business portfolios,
 * each with its own app, and every app signs deliveries with its OWN secret. A
 * single configured secret therefore verifies exactly one brand's traffic and
 * refuses the other two with a 403 that looks like an attack.
 *
 * WHY A MAP AND NOT A LIST. A flat list of secrets would work, and would mean
 * anyone holding ANY brand's secret could forge messages for EVERY brand. So
 * each secret is bound to its app id, and a delivery verified with app X's
 * secret may only speak for accounts whose `channel_accounts.app_id` is X (see
 * accountsForApp). Rule 4 — keep brands isolated — applied to signatures.
 */
export interface MetaAppSecret {
  /** Meta's numeric app id. Null only for the legacy single secret, which is
   *  unbound and keeps today's behaviour of speaking for every account. */
  appId: string | null;
  secret: string;
}

/**
 * Read the configuration. PURE, so every shape is tested without an env.
 *
 *   mapRaw     META_APP_SECRETS  {"<app id>":"<secret>", ...}
 *   singleRaw  META_APP_SECRET   the legacy single secret
 *
 * The map WINS when present. An unbound secret mixed in beside bound ones would
 * quietly undo the binding, so the single secret is ignored then.
 *
 * FAILS CLOSED. A map that does not parse, or parses to nothing usable, yields
 * no secrets, and no secrets refuses every delivery. It deliberately does NOT
 * fall back to the single secret: a typo in the dashboard must never turn into
 * "accept whatever the old setting accepts" without anybody noticing.
 */
export function parseMetaAppSecrets(
  mapRaw: string | null,
  singleRaw: string | null
): MetaAppSecret[] {
  if (mapRaw !== null && mapRaw.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(mapRaw);
    } catch {
      return [];
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];

    const out: MetaAppSecret[] = [];
    for (const [appId, secret] of Object.entries(parsed as Record<string, unknown>)) {
      // App ids are numeric. Anything else is a paste error, not an app.
      if (!/^\d+$/.test(appId)) continue;
      if (typeof secret !== "string" || secret.trim() === "") continue;
      out.push({ appId, secret: secret.trim() });
    }
    return out;
  }

  const single = singleRaw?.trim();
  return single ? [{ appId: null, secret: single }] : [];
}

export type AppSignatureCheck =
  | { ok: true; appId: string | null }
  | { ok: false; reason: "no_secret" | "no_header" | "malformed" | "mismatch" };

/**
 * Verify against every configured app, and say WHICH one signed.
 *
 * Every secret is tried even after a match, so the time taken does not reveal
 * which app a forged signature came closest to. Header problems return at once:
 * they do not depend on any secret.
 */
export function verifyMetaSignatureForApps(
  rawBody: string,
  header: string | null,
  secrets: readonly MetaAppSecret[]
): AppSignatureCheck {
  if (secrets.length === 0) return { ok: false, reason: "no_secret" };

  let matched: { appId: string | null } | null = null;
  for (const s of secrets) {
    const r = verifyMetaSignature(rawBody, header, s.secret);
    if (r.ok) {
      if (matched === null) matched = { appId: s.appId };
    } else if (r.reason === "no_header" || r.reason === "malformed") {
      return r;
    }
  }
  return matched ? { ok: true, appId: matched.appId } : { ok: false, reason: "mismatch" };
}

/**
 * Which connected accounts a verified delivery may speak for.
 *
 * Bound (a map secret matched): only accounts of that same app. An account with
 * no app_id recorded is EXCLUDED: unassigned is not the same as allowed, and
 * guessing is the cross-brand mistake this exists to prevent. Its events arrive
 * "unmatched" and are dropped, never mis-filed.
 *
 * Unbound (the legacy single secret): every account, exactly as before.
 */
export function accountsForApp<T extends { appId: string | null }>(
  accounts: readonly T[],
  appId: string | null
): T[] {
  if (appId === null) return [...accounts];
  return accounts.filter((a) => a.appId === appId);
}
