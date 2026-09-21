/**
 * NOTIFICATIONS WHEN THE APP IS CLOSED — the Web Push request, and the rules around it.
 *
 * Samer, 2026-09-21: "I'm not receiving notifications outside the app." Until now an alert existed only
 * while the inbox was open in a tab: a closed app has no page to run. A closed app CAN be woken by the
 * phone's own push service (Apple's for iPhone, Google's for Android and Chrome, Mozilla's, Microsoft's):
 * the device gives us an address, and we knock on it.
 *
 * THE KNOCK CARRIES NOTHING. A push may carry an encrypted payload; ours carries none. The service
 * worker that wakes up asks MONZA AI what happened (`/api/push/latest`, behind the staff sign-in) and
 * shows that. So no customer's name and no topic ever travels through Apple or Google, there is no
 * payload encryption to get subtly wrong, and a phone whose sign-in has lapsed shows only "New activity
 * in Monza AI". What is proven to the push service is only WHO is knocking: a VAPID token, signed with
 * our private key (RFC 8292).
 *
 * Pure where it can be: building the token and the request is separated from sending it, so both are
 * tested without a network (tests/push.test.ts). No dependency: node:crypto does ES256.
 */

import { createPrivateKey, sign as cryptoSign } from "node:crypto";

/** The only hosts a subscription may point at. A subscription is typed by a BROWSER, so its address is
 *  untrusted input, and the server POSTs to it: without this list it would be a way to make MONZA AI's
 *  server call any URL (SSRF). */
const PUSH_HOSTS: readonly RegExp[] = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge, Android, Samsung Internet
  /^[a-z0-9-]+\.push\.apple\.com$/, // Safari, iPhone and iPad home-screen apps (web.push.apple.com)
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^[a-z0-9-]+\.notify\.windows\.com$/, // Edge on Windows (legacy WNS)
];

export function isPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 1000) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.username === "" && url.password === "" && (url.port === "" || url.port === "443") && PUSH_HOSTS.some((h) => h.test(url.hostname));
}

export interface VapidKeys {
  /** base64url of the 65-byte uncompressed P-256 point — public by design; the browser needs it to subscribe. */
  publicKey: string;
  /** base64url of the 32-byte private scalar — a SECRET: Vercel environment only, never the repository. */
  privateKey: string;
  /** "mailto:…" or an https URL: whom a push service contacts if we misbehave. */
  subject: string;
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const fromB64u = (s: string) => Buffer.from(s, "base64url");

/** The keys from the environment — or null. Unconfigured must REFUSE, never half-work. */
export function vapidFromEnv(env: Record<string, string | undefined> = process.env): VapidKeys | null {
  const publicKey = (env.WEB_PUSH_VAPID_PUBLIC_KEY ?? "").trim();
  const privateKey = (env.WEB_PUSH_VAPID_PRIVATE_KEY ?? "").trim();
  const subject = (env.WEB_PUSH_SUBJECT ?? "").trim();
  if (!publicKey || !privateKey || !subject) return null;
  if (fromB64u(publicKey).length !== 65 || fromB64u(publicKey)[0] !== 0x04) return null;
  if (fromB64u(privateKey).length !== 32) return null;
  if (!/^(mailto:[^@\s]+@[^@\s]+|https:\/\/\S+)$/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

/** A VAPID token for one push service: who we are, for whom, until when. At most 24 hours (we use 12). */
export function vapidToken(keys: VapidKeys, audience: string, nowMs: number): string {
  const pub = fromB64u(keys.publicKey);
  const key = createPrivateKey({
    format: "jwk",
    key: { kty: "EC", crv: "P-256", d: keys.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
  });
  const header = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64u(JSON.stringify({ aud: audience, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: keys.subject }));
  const signature = cryptoSign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `${header}.${claims}.${b64u(signature)}`;
}

export interface PushRequest {
  url: string;
  headers: Record<string, string>;
}

/** The whole request: an empty body, and the token. Null for an address that is not a push service's. */
export function pushRequest(endpoint: string, keys: VapidKeys, nowMs: number, topic?: string): PushRequest | null {
  if (!isPushEndpoint(endpoint)) return null;
  const audience = new URL(endpoint).origin;
  return {
    url: endpoint,
    headers: {
      Authorization: `vapid t=${vapidToken(keys, audience, nowMs)}, k=${keys.publicKey}`,
      // Kept by the push service for an hour if the phone is off; a chat notification older than that is noise.
      TTL: "3600",
      Urgency: "high",
      "Content-Length": "0",
      // Several knocks about the same chat while the phone is asleep collapse into one.
      ...(topic ? { Topic: topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) } : {}),
    },
  };
}

export type PushOutcome =
  /** Accepted by the push service. */
  | "sent"
  /** The subscription is dead (uninstalled, permission withdrawn): delete it. */
  | "gone"
  /** Our keys do not match the ones the device subscribed with: delete it; the device subscribes again. */
  | "rejected"
  /** Anything else: keep the subscription, try again on the next event. */
  | "failed";

export function outcomeOf(status: number): PushOutcome {
  if (status >= 200 && status < 300) return "sent";
  if (status === 404 || status === 410) return "gone";
  if (status === 400 || status === 401 || status === 403) return "rejected";
  return "failed";
}

export async function sendPush(endpoint: string, keys: VapidKeys, topic: string | undefined, fetchFn: typeof fetch = fetch): Promise<PushOutcome> {
  const req = pushRequest(endpoint, keys, Date.now(), topic);
  if (!req) return "gone";
  try {
    const res = await fetchFn(req.url, { method: "POST", headers: req.headers, signal: AbortSignal.timeout(6_000) });
    return outcomeOf(res.status);
  } catch {
    return "failed";
  }
}

/* ── What a notification says ────────────────────────────────────────────── */

export interface PushNote {
  title: string;
  body: string;
  /** Where a tap goes. Always a path inside MONZA AI. */
  url: string;
  /** Same tag = the newer one replaces the older one on the phone, instead of stacking. */
  tag: string;
}

/** Shown when the worker cannot ask what happened (no connection, the sign-in lapsed). Says nothing. */
export const GENERIC_NOTE: PushNote = { title: "Monza AI", body: "New activity — open Monza AI to see it.", url: "/inbox", tag: "monza-ai" };

const CHANNEL_WORD: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Messenger" };

/** A new customer message: WHO and WHERE — never what they wrote. */
export function messageNote(m: { threadId: string | null; channel: string; who: string | null; brand: string | null }): PushNote {
  const where = CHANNEL_WORD[m.channel] ?? "chat";
  const brand = m.brand ? m.brand.toUpperCase() : null;
  return {
    title: `New ${where} message`,
    body: [m.who ?? "A customer", brand].filter(Boolean).join(" · "),
    // Instagram and Facebook chats are read live from Meta: their thread id is not known at the webhook.
    url: m.threadId ? `/inbox?open=${encodeURIComponent(m.threadId)}` : "/inbox",
    tag: (m.threadId ? `chat-${m.threadId}` : `chat-${m.channel}`).slice(0, 64),
  };
}

/** A sales alert: the engine's own words (kind, car), never the customer's. */
export function alertNote(a: { threadId: string; label: string; cars: readonly string[]; who: string | null; urgency: string }): PushNote {
  const lead = a.urgency === "overdue" ? "Kept waiting — reply now" : a.urgency === "hot" ? "Ready to buy" : "Client needs a salesperson";
  return {
    title: lead,
    body: [a.label, a.cars.join(", "), a.who].filter(Boolean).join(" · "),
    url: `/inbox?open=${encodeURIComponent(a.threadId)}`,
    tag: `alert-${a.threadId}`.slice(0, 64),
  };
}

/** A tap may only ever open MONZA AI itself. */
export function safeNoteUrl(url: unknown): string {
  return typeof url === "string" && /^\/(?!\/)[A-Za-z0-9/_?=&%.~-]*$/.test(url) ? url : "/inbox";
}
