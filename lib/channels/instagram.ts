/**
 * INSTAGRAM DIRECT MESSAGES.
 *
 * First channel, for two reasons that are facts rather than preferences:
 * Instagram is where this business's audience actually is (3,565 + 3,175 +
 * 1,364 followers against 696 and 238 on the Facebook Pages), and
 * `instagram_manage_messages` is already granted on the working tokens, so it
 * needs no App Review to begin.
 *
 * ── The payload shape ───────────────────────────────────────────────────────
 * Instagram messaging arrives through the Messenger-style envelope:
 *
 *   { object: "instagram",
 *     entry: [ { id: <IG account id>, time,
 *                messaging: [ { sender:{id}, recipient:{id}, timestamp,
 *                               message: { mid, text?, attachments?, is_echo? } } ] } ] }
 *
 * `entry[].id` is the ACCOUNT the message arrived at, which is how one endpoint
 * serves three Instagram accounts across three business portfolios.
 *
 * ── What is deliberately dropped ────────────────────────────────────────────
 * Echoes (`is_echo`) are our own outgoing messages played back; storing them
 * would duplicate every reply staff send. Read receipts and delivery receipts
 * carry no message. Reactions are not messages. Each returns nothing, which is
 * a normal outcome — most deliveries are not new customer messages.
 */

import type {
  ChannelAccount,
  ChannelAdapter,
  InboundAttachment,
  InboundEvent,
  InboundReferral,
  OutboundMessage,
  SendResult,
} from "@/lib/channels/types";

const GRAPH = "https://graph.facebook.com/v21.0";

/* ── Reading the payload ─────────────────────────────────────────────────── */

/** Narrow an unknown to a record without asserting it has any given key. */
function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function attachmentsOf(message: Record<string, unknown>): InboundAttachment[] {
  const raw = message.attachments;
  if (!Array.isArray(raw)) return [];

  return raw.map((entry): InboundAttachment => {
    const a = obj(entry);
    const type = str(a?.type) ?? "";
    const payload = obj(a?.payload);
    const url = str(payload?.url);
    const kind: InboundAttachment["kind"] =
      type === "image" || type === "video" || type === "audio"
        ? type
        : type === "file"
          ? "file"
          : type === "story_mention" || type === "story_reply"
            ? "story"
            : "unknown";
    return { kind, url };
  });
}

/**
 * The referral, if this message carried one.
 *
 * Meta puts it in one of three places depending on how the person arrived, and
 * all three must be read or the attribution is lost permanently:
 *
 *   event.referral          a NEW thread opened from an ad or an m.me link
 *   event.message.referral  a referral on a thread that already existed
 *   message.reply_to.story  a reply to one of our stories
 *
 * `ads_context_data` is where the ad's title lives when the source is ADS.
 *
 * Structure only — what it MEANS is lib/leads/attribution.ts's decision.
 */
function referralOf(
  event: Record<string, unknown>,
  message: Record<string, unknown>
): InboundReferral | null {
  const direct = obj(event.referral) ?? obj(message.referral);

  if (direct) {
    const ads = obj(direct.ads_context_data);
    return {
      source: str(direct.source),
      type: str(direct.type),
      // `ref` is the developer-defined payload on an m.me link; the ad's own
      // id arrives as ad_id, and the post's as post_id. Whichever exists is
      // the thing that identifies the spend.
      ref: str(direct.ref) ?? str(direct.ad_id) ?? str(ads?.post_id),
      headline: str(ads?.ad_title),
      sourceUrl: str(direct.source_url),
      ctwaClid: null, // WhatsApp only
      storyId: null,
      raw: direct,
    };
  }

  // A story reply. Not a referral in Meta's vocabulary, but it answers the
  // same question — this person is here because of something we posted — and
  // losing that distinction would file every story reply as "came from
  // nowhere", which is both false and the most common way Monza gets DMs.
  const replyTo = obj(message.reply_to);
  const story = obj(replyTo?.story);
  if (story) {
    return {
      source: "story_reply",
      type: null,
      ref: str(story.id),
      headline: null,
      sourceUrl: str(story.url),
      ctwaClid: null,
      storyId: str(story.id),
      raw: story,
    };
  }

  return null;
}

/**
 * Meta sends epoch MILLISECONDS. Taking the receiving clock instead would
 * misdate every redelivered message, and Meta redelivers for up to 7 days when
 * an endpoint has been failing — exactly when the ordering matters most.
 */
function isoFrom(timestamp: unknown, fallback: string): string {
  const ms =
    typeof timestamp === "number"
      ? timestamp
      : typeof timestamp === "string"
        ? Number(timestamp)
        : NaN;
  if (!Number.isFinite(ms) || ms <= 0) return fallback;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}

export function parseInstagram(
  body: unknown,
  accounts: readonly ChannelAccount[],
  receivedAt = new Date().toISOString()
): InboundEvent[] {
  const root = obj(body);
  if (!root) return [];
  // Facebook Page messages use the same envelope with object:"page"; that is
  // the Messenger adapter's delivery, not this one.
  if (str(root.object) !== "instagram") return [];

  const entries = Array.isArray(root.entry) ? root.entry : [];
  const out: InboundEvent[] = [];

  for (const rawEntry of entries) {
    const entry = obj(rawEntry);
    if (!entry) continue;

    const accountExternalId = str(entry.id);
    const account = accountExternalId
      ? (accounts.find(
          (a) => a.channel === "instagram" && a.externalId === accountExternalId
        ) ?? null)
      : null;

    const events = Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const rawEvent of events) {
      const event = obj(rawEvent);
      if (!event) continue;

      const message = obj(event.message);
      if (!message) continue; // a receipt or a reaction, not a message

      // Our own outgoing message, echoed back. Storing it would double every
      // staff reply in the thread.
      if (message.is_echo === true) continue;

      const mid = str(message.mid);
      if (!mid) continue; // without an id there is no idempotency key

      const sender = obj(event.sender);
      const from = str(sender?.id);
      if (!from) continue;

      // A message from the account to itself is not a customer conversation.
      if (accountExternalId && from === accountExternalId) continue;

      const attachments = attachmentsOf(message);
      const text = str(message.text) ?? "";
      // A story reply or a bare photo has no text. It is still a message and
      // must reach staff — dropping it loses a real customer contact.
      if (text === "" && attachments.length === 0) continue;

      out.push({
        accountId: account?.id ?? null,
        fromExternalId: from,
        fromDisplay: null, // IG does not include the handle; fetched separately
        externalMessageId: mid,
        text,
        at: isoFrom(event.timestamp, receivedAt),
        attachments,
        referral: referralOf(event, message),
      });
    }
  }

  return out;
}

/* ── Sending ─────────────────────────────────────────────────────────────── */

/** Instagram's own host — the "Instagram API with Instagram login" route. */
const IG_LOGIN_GRAPH = "https://graph.instagram.com/v21.0";

async function sendInstagram(message: OutboundMessage, token: string): Promise<SendResult> {
  return sendVia(GRAPH, message, token);
}

/**
 * The reply for an account read through Instagram login: the same request, to
 * graph.instagram.com with that route's own key. A thread opened on one route
 * is always answered on the same route — its token and customer id belong to it.
 */
export async function sendInstagramLogin(message: OutboundMessage, token: string): Promise<SendResult> {
  return sendVia(IG_LOGIN_GRAPH, message, token);
}

async function sendVia(host: string, message: OutboundMessage, token: string): Promise<SendResult> {
  const account = message.accountId;
  if (!account) return { ok: false, error: "No account.", retryable: false };

  try {
    const res = await fetch(`${host}/me/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: { id: message.toExternalId },
        message: { text: message.text },
      }),
    });

    const payload = (await res.json().catch(() => null)) as {
      message_id?: unknown;
      error?: { message?: unknown; code?: unknown };
    } | null;

    if (res.ok) {
      const id = str(payload?.message_id);
      // Meta answered 200 with no id: treat as sent but unidentifiable rather
      // than as failure, or a retry would send the message twice.
      return { ok: true, externalMessageId: id ?? `ig-unknown-${Date.now()}` };
    }

    const detail = str(payload?.error?.message) ?? `HTTP ${res.status}`;
    // 5xx and 429 are worth retrying; a 4xx is a refusal that will refuse
    // again — most often the 24-hour window having closed.
    const retryable = res.status >= 500 || res.status === 429;
    return { ok: false, error: detail, retryable };
  } catch (e) {
    // A network failure is genuinely unknown: the message may or may not have
    // gone. Retryable, and the caller must key on our own idempotency id.
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Network error.",
      retryable: true,
    };
  }
}

export const instagramAdapter: ChannelAdapter = {
  channel: "instagram",
  parse: (body, accounts) => parseInstagram(body, accounts),
  send: sendInstagram,
};
