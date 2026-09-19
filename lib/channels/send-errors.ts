/**
 * WHY META REFUSED A REPLY — in words a salesperson can act on, with Meta's own code kept.
 *
 * Samer, 2026-09-19: "we have a problem in Instagram and Facebook — I can't reply from Monza AI".
 * Until now a refused send showed Meta's raw sentence and threw away the code, and the code is the
 * only thing that separates the causes — which need OPPOSITE fixes:
 *
 *   the 24-hour window shut        → nothing to fix; answer in the Instagram / Messenger app
 *   the app may not message people → Meta App Review (Advanced Access), done once, by Samer
 *   the key expired                → a new key in Vercel (Instagram-login keys live 60 days)
 *   the customer is unreachable    → they blocked the account or deleted theirs
 *   Meta is rate-limiting          → wait a minute and press Send again
 *
 * Pure: a payload in, a sentence out. Never contains a token (Meta does not echo keys in errors),
 * never the customer's words, and the raw code is always appended so it can be read back to support.
 */

export type SendRefusalKind = "window" | "permission" | "token" | "unreachable" | "rate_limit" | "bad_request" | "meta_down" | "unknown";

export interface SendRefusal {
  kind: SendRefusalKind;
  /** What staff read under the reply box. */
  message: string;
  /** "code 10, subcode 2018278" — for the log and for whoever fixes it. */
  codes: string;
  /** Worth pressing Send again as it is. */
  retryable: boolean;
}

type Channel = "instagram" | "facebook";

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

const APP_NAME: Record<Channel, string> = { instagram: "Instagram", facebook: "Messenger" };
const PERMISSION: Record<Channel, string> = { instagram: "instagram_manage_messages", facebook: "pages_messaging" };

export function explainSendRefusal(payload: unknown, httpStatus: number, channel: Channel): SendRefusal {
  const e = obj(obj(payload)?.error) ?? {};
  const code = typeof e.code === "number" ? e.code : null;
  const sub = typeof e.error_subcode === "number" ? e.error_subcode : null;
  const raw = typeof e.message === "string" ? e.message : "";
  const codes = [code !== null ? `code ${code}` : null, sub !== null ? `subcode ${sub}` : null, `HTTP ${httpStatus}`].filter(Boolean).join(", ");
  const app = APP_NAME[channel];
  const make = (kind: SendRefusalKind, message: string, retryable = false): SendRefusal => ({ kind, message: `${message} (Meta: ${codes})`, codes, retryable });

  // The reply window. Meta says it three ways.
  if (sub === 2018278 || sub === 2534022 || /outside (of )?(the )?allowed window|outside the 24/i.test(raw)) {
    return make("window", `Meta only allows a reply within 24 hours of the customer's last message, and that time has passed. Answer this one in the ${app} app — when they write again, you can reply from here.`);
  }
  // The key.
  if (code === 190 || code === 102 || /access token|session has (expired|been invalidated)/i.test(raw)) {
    return make("token", `Monza AI's key for this ${app} account has expired or was replaced, so Meta refused it. It needs a new key in Vercel — tell Samer. Nothing was sent.`);
  }
  // The customer cannot be reached.
  if (code === 551 || sub === 1545041 || sub === 2018001 || sub === 2534014 || /isn'?t available|no matching user|cannot message this user/i.test(raw)) {
    return make("unreachable", `${app} says this person cannot be messaged right now — they may have blocked the account, deleted theirs, or never written to this account. Nothing was sent.`);
  }
  // Rate limits.
  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80006 || httpStatus === 429) {
    return make("rate_limit", `Meta is limiting how fast this account can send. Wait a minute and press Send again.`, true);
  }
  // The app is not allowed to message this person: permission, capability, or App Review.
  if (code === 3 || code === 10 || code === 200 || code === 230 || (code !== null && code >= 200 && code <= 299) || /permission|capability|does not have access|app review|advanced access/i.test(raw)) {
    return make(
      "permission",
      `Meta has not allowed Monza AI to SEND on this ${app} account (the "${PERMISSION[channel]}" permission). Reading works with a lower level than sending: until Meta approves it in App Review (Advanced Access), only people with a role on the app can be answered from here. Answer in the ${app} app for now — this is a one-time approval for Samer to request.`
    );
  }
  if (httpStatus >= 500 || code === 1 || code === 2 || code === -1 || code === -2) {
    return make("meta_down", `Meta did not answer properly. Nothing was sent — press Send again in a moment.`, true);
  }
  if (code === 100) {
    return make("bad_request", `Meta did not accept this message as written${raw ? `: “${raw.slice(0, 160)}”` : ""}. Nothing was sent.`);
  }
  return make("unknown", `Meta did not accept it${raw ? `: “${raw.slice(0, 200)}”` : ""}. Nothing was sent.`, httpStatus >= 500);
}
