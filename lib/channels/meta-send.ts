/**
 * Messenger and Instagram replies that carry more than words — a brochure or a
 * video by its public address, or tappable quick replies — for the sales
 * suggestions a PERSON chooses to send (lib/wasales/executor.ts).
 *
 * The plain reply staff type keeps its own path (messenger.ts, instagram.ts).
 * This is the same Send API request with a richer `message`, in one place
 * because Messenger and Instagram share its shape: only the host differs
 * (graph.facebook.com, or graph.instagram.com for an account read through
 * Instagram login — CLAUDE.md rule 49), and Messenger alone wants
 * `messaging_type`.
 *
 * ONE message per call and nothing else: no message tags, no one-time
 * notifications, nothing that could reach a customer outside the 24-hour
 * window.
 */

export const FACEBOOK_GRAPH = "https://graph.facebook.com/v21.0";
export const INSTAGRAM_LOGIN_GRAPH = "https://graph.instagram.com/v21.0";

/** Meta's limits for quick replies. */
export const META_MAX_QUICK_REPLIES = 13;
export const META_QUICK_REPLY_TITLE = 20;

export type MetaSendResult =
  | { ok: true; externalMessageId: string | null }
  | { ok: false; problem: string; windowClosed: boolean };

export interface MetaChoice {
  title: string;
  payload: string;
}

/** A text message, with quick replies when there are choices. */
export function textMessage(text: string, choices: readonly MetaChoice[] = []): Record<string, unknown> {
  if (choices.length === 0) return { text };
  return {
    text,
    quick_replies: choices.slice(0, META_MAX_QUICK_REPLIES).map((c) => ({
      content_type: "text",
      title: c.title.slice(0, META_QUICK_REPLY_TITLE),
      payload: c.payload,
    })),
  };
}

/** A file or video Meta fetches from its public address. */
export function fileMessage(kind: "file" | "video", url: string): Record<string, unknown> {
  return { attachment: { type: kind, payload: { url } } };
}

/** Meta's refusal, in words staff can act on. */
export function metaSendProblem(
  payload: unknown,
  httpStatus: number
): { problem: string; windowClosed: boolean } {
  const e =
    payload && typeof payload === "object"
      ? ((payload as { error?: unknown }).error as Record<string, unknown> | undefined)
      : undefined;
  const code = typeof e?.code === "number" ? e.code : null;
  const sub = typeof e?.error_subcode === "number" ? e.error_subcode : null;
  const message = typeof e?.message === "string" ? e.message : "";
  if (sub === 2018278 || sub === 2534022 || /outside of (the )?allowed window/i.test(message)) {
    return {
      problem: "More than 24 hours since this customer wrote, so Meta will not deliver a reply.",
      windowClosed: true,
    };
  }
  if (code === 190) return { problem: "This account's sending key is invalid or has expired.", windowClosed: false };
  if (code === 10 || code === 200 || code === 230) {
    return { problem: "This account's key is not allowed to send that.", windowClosed: false };
  }
  if (httpStatus === 429 || code === 4 || code === 613) {
    return { problem: "Meta is limiting messages for a moment — try again shortly.", windowClosed: false };
  }
  return {
    problem: message ? `Meta said: ${message.slice(0, 200)}` : `Meta answered with an error (HTTP ${httpStatus}).`,
    windowClosed: false,
  };
}

/** `fetchFn` exists so the request's shape can be tested without a network. */
export async function postMetaMessage(
  input: {
    host: string;
    token: string;
    recipientId: string;
    message: Record<string, unknown>;
    /** Messenger requires `messaging_type`; RESPONSE = answering what they said. */
    messenger: boolean;
  },
  fetchFn: typeof fetch = fetch
): Promise<MetaSendResult> {
  if (input.host !== FACEBOOK_GRAPH && input.host !== INSTAGRAM_LOGIN_GRAPH) {
    return { ok: false, problem: "Not a Meta address.", windowClosed: false };
  }
  if (!/^[0-9A-Za-z_-]{3,64}$/.test(input.recipientId)) {
    return { ok: false, problem: "Could not tell who the customer is in this conversation.", windowClosed: false };
  }
  try {
    const res = await fetchFn(`${input.host}/me/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${input.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: input.recipientId },
        message: input.message,
        ...(input.messenger ? { messaging_type: "RESPONSE" } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const json: unknown = await res.json().catch(() => null);
    if (res.ok) {
      const id = json && typeof json === "object" ? (json as { message_id?: unknown }).message_id : null;
      return { ok: true, externalMessageId: typeof id === "string" && id !== "" ? id : null };
    }
    return { ok: false, ...metaSendProblem(json, res.status) };
  } catch {
    // Unknown, not failed: it may or may not have gone. Say so.
    return {
      ok: false,
      problem: "Could not reach Meta just now — nothing was confirmed as sent. Check the chat before sending again.",
      windowClosed: false,
    };
  }
}
