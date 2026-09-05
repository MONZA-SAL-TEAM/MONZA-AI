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
