/**
 * WHATSAPP — +961 70 708 585, the Monza SAL number. It runs on the WhatsApp
 * Business app AND the Business Platform at once (Coexistence, connected in
 * Meta Business Suite; its Inbox WhatsApp tab was live on 2026-09-15).
 *
 * ── Why WhatsApp is STORED when Instagram and Facebook are not ─────────────
 * Instagram and Facebook are read live from Meta every time the inbox opens,
 * and MONZA AI keeps none of their words (Samer, 2026-09-10). WhatsApp has no
 * such read: the Cloud API cannot list past conversations or return old
 * messages, so a WhatsApp message exists for us only as it arrives by webhook.
 * Showing WhatsApp in the inbox therefore means keeping it — which Samer chose
 * explicitly on 2026-09-15, with a 12-month limit (lib/channels/retention.ts,
 * run daily by /api/channels/retention). Nothing from before the connection
 * exists here.
 *
 * ── The payload ─────────────────────────────────────────────────────────────
 *   { object: "whatsapp_business_account",
 *     entry: [ { id: <WABA id>,
 *                changes: [ { field: "messages" | "smb_message_echoes",
 *                             value: { metadata: { phone_number_id },
 *                                      contacts: [ { wa_id, profile: { name } } ],
 *                                      messages: [...], statuses: [...],
 *                                      message_echoes: [...] } } ] } ] }
 *
 * The ACCOUNT is `metadata.phone_number_id`: the WhatsApp number the message
 * reached (rule 1). `entry[].id` is the business account (WABA), which can hold
 * several numbers, so it cannot route on its own.
 *
 * ── Echoes ARE kept here, unlike on Instagram ───────────────────────────────
 * Rule 19 drops Instagram and Messenger echoes because they are copies of what
 * MONZA AI itself sent, and storing them doubles every reply. WhatsApp's
 * `smb_message_echoes` are something else: the replies staff type in the
 * WhatsApp Business app (or Business Suite) — the only record of those, so
 * without them every conversation would read as the customer talking alone.
 * A reply sent FROM MONZA AI produces no echo at all, so sendOnThread records
 * it itself at the moment WhatsApp accepts it (whatsappSentRow).
 *
 * ── Dropped ─────────────────────────────────────────────────────────────────
 * Delivery and read statuses, reactions, edits, revokes and system notices
 * carry no new message.
 *
 * PURE: body in, events out. The network and the database are elsewhere.
 */

import type {
  ChannelAccount,
  ChannelAdapter,
  InboundAttachment,
  InboundEvent,
  InboundReferral,
  SendResult,
} from "@/lib/channels/types";
import type { Conversation, ConversationStatus, InboxMessage } from "@/lib/inbox/types";
import { encodeThreadId } from "@/lib/channels/live-map";

/* ── Small readers ───────────────────────────────────────────────────────── */

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * WhatsApp sends epoch SECONDS, as a string. From the payload, never the
 * receiving clock: a redelivered message must land at the time it was sent.
 */
export function waTime(timestamp: unknown, fallback: string): string {
  const seconds =
    typeof timestamp === "number" ? timestamp : typeof timestamp === "string" ? Number(timestamp) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
  const d = new Date(seconds * 1000);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}

/** Any timestamp Postgres or Meta hands back, as the one ISO shape the inbox sorts on. */
function iso(value: string | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

/* ── What one message says ───────────────────────────────────────────────── */

const MEDIA_KIND: Readonly<Record<string, InboundAttachment["kind"]>> = {
  image: "image",
  video: "video",
  audio: "audio",
  document: "file",
  sticker: "image",
};

/**
 * A message's words and parts, whatever its type — or null for a type that is
 * not a message at all (reaction, edit, revoke, system, unsupported).
 *
 * The words are the customer's, carried verbatim. The few labels written here
 * ("Shared a location") describe what arrived; they never stand in for text.
 */
export function contentOf(
  m: Record<string, unknown>
): { text: string; attachments: InboundAttachment[] } | null {
  const type = str(m.type) ?? "";
  switch (type) {
    case "text":
      return { text: str(obj(m.text)?.body) ?? "", attachments: [] };
    case "image":
    case "video":
    case "audio":
    case "document":
    case "sticker":
      return {
        text: str(obj(m[type])?.caption) ?? "",
        attachments: [{ kind: MEDIA_KIND[type] ?? "unknown", url: null }],
      };
    case "interactive": {
      const i = obj(m.interactive);
      return {
        text: str(obj(i?.button_reply)?.title) ?? str(obj(i?.list_reply)?.title) ?? "",
        attachments: [],
      };
    }
    case "button":
      return { text: str(obj(m.button)?.text) ?? "", attachments: [] };
    case "location": {
      const l = obj(m.location);
      const label = str(l?.name) ?? str(l?.address);
      return { text: label ? `Shared a location: ${label}` : "Shared a location", attachments: [] };
    }
    case "contacts":
      return { text: "Shared a contact card", attachments: [] };
    case "order":
      return { text: "Sent an order from the catalogue", attachments: [] };
    default:
      return null;
  }
}

/**
 * The click-to-WhatsApp referral, when the first message came from an ad or a
 * post. `ctwa_clid` ties the conversation to one ad click, as fact.
 * Structure only — what it MEANS is lib/leads/attribution.ts's decision.
 */
function referralOf(m: Record<string, unknown>): InboundReferral | null {
  const r = obj(m.referral);
  if (!r) return null;
  return {
    source: str(r.source_type),
    type: str(r.media_type),
    ref: str(r.source_id),
    headline: str(r.headline),
    sourceUrl: str(r.source_url),
    ctwaClid: str(r.ctwa_clid),
    storyId: null,
    raw: r,
  };
}

/* ── Parsing a delivery ──────────────────────────────────────────────────── */

export function parseWhatsApp(
  body: unknown,
  accounts: readonly ChannelAccount[],
  receivedAt = new Date().toISOString()
): InboundEvent[] {
  const root = obj(body);
  // Instagram ("instagram") and Messenger ("page") have their own adapters.
  if (!root || str(root.object) !== "whatsapp_business_account") return [];

  const out: InboundEvent[] = [];

  for (const rawEntry of list(root.entry)) {
    for (const rawChange of list(obj(rawEntry)?.changes)) {
      const change = obj(rawChange);
      const field = str(change?.field);
      if (field !== "messages" && field !== "smb_message_echoes") continue;
      const value = obj(change?.value);
      if (!value) continue;

      // Which of OUR numbers it reached. An unknown number is not guessed at:
      // the event stays unmatched and is counted, never filed under a brand.
      const phoneNumberId = str(obj(value.metadata)?.phone_number_id);
      const account = phoneNumberId
        ? (accounts.find((a) => a.channel === "whatsapp" && a.externalId === phoneNumberId) ?? null)
        : null;

      // The customer's own profile name, as WhatsApp shares it.
      const names = new Map<string, string>();
      for (const rawContact of list(value.contacts)) {
        const c = obj(rawContact);
        const waId = str(c?.wa_id);
        const name = str(obj(c?.profile)?.name);
        if (waId && name) names.set(waId, name);
      }

      const incoming = field === "messages";
      const rows = incoming ? list(value.messages) : list(value.message_echoes);

      for (const raw of rows) {
        const m = obj(raw);
        if (!m) continue;
        const id = str(m.id);
        // The customer is the sender of an incoming message and the recipient
        // of an echo. Without an id there is no idempotency key; without a
        // customer there is no thread to put it in.
        const peer = incoming ? str(m.from) : str(m.to);
        if (!id || !peer) continue;

        const content = contentOf(m);
        if (!content) continue;
        if (content.text === "" && content.attachments.length === 0) continue;

        out.push({
          accountId: account?.id ?? null,
          fromExternalId: peer,
          fromDisplay: names.get(peer) ?? null,
          externalMessageId: id,
          text: content.text,
          at: waTime(m.timestamp, receivedAt),
          attachments: content.attachments,
          referral: incoming ? referralOf(m) : null,
          direction: incoming ? "in" : "out",
        });
      }
    }
  }

  return out;
}

/* ── What is kept ────────────────────────────────────────────────────────── */

/** Who wrote our side of a WhatsApp thread: somebody on the app or in Business Suite. */
export const WHATSAPP_STAFF_NAME = "Monza · WhatsApp app";

/**
 * The stored row for one WhatsApp message — WITH its words, deliberately
 * (see the header). Instagram and Facebook keep using inboundIndexRow, which
 * cannot store text because it is never handed any.
 */
export function whatsappMessageRow(input: {
  conversationId: string;
  brand: string;
  accountId: string;
  event: InboundEvent;
}): Record<string, unknown> {
  const out = input.event.direction === "out";
  return {
    conversation_id: input.conversationId,
    brand: input.brand,
    account_id: input.accountId,
    direction: out ? "out" : "in",
    author: out ? "staff" : "customer",
    body: input.event.text,
    // Kinds only. Media ids need a token to fetch and URLs expire; the app on
    // the phone is where a photo is looked at.
    attachments: input.event.attachments.map((a) => ({ kind: a.kind })),
    external_message_id: input.event.externalMessageId,
    status: out ? "sent" : "received",
    staff_name: out ? WHATSAPP_STAFF_NAME : null,
    sent_at: input.event.at,
  };
}

/* ── Reading it back for the inbox ───────────────────────────────────────── */

/** One row of channel_whatsapp_page() (migration 009). */
export interface WhatsAppConversationRow {
  id: string;
  peer_external_id: string;
  peer_display: string | null;
  customer_id: string | null;
  status: string | null;
  last_inbound_at: string | null;
  last_message_at: string | null;
  last_body: string | null;
  last_direction: string | null;
  last_author: string | null;
  last_sent_at: string | null;
  last_attachments: number | null;
}

/** One stored WhatsApp message, as the thread view reads it. */
export interface WhatsAppMessageRow {
  id: string;
  direction: string;
  author: string;
  body: string | null;
  attachments: unknown;
  status: string | null;
  staff_name: string | null;
  sent_at: string;
}

/** Shown for a message that is only a photo, video, voice note or file. */
export const WA_ATTACHMENT_ONLY = "Photo, video, voice note or file — open WhatsApp to see it.";

/** "96170708585" → "+961 70 708 585"; other numbers keep their digits. */
export function displayPhone(waId: string): string {
  const d = waId.replace(/\D/g, "");
  if (d === "") return "";
  if (d.startsWith("961") && d.length === 11) return `+961 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  if (d.startsWith("961") && d.length === 10) return `+961 ${d.slice(3, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  return `+${d}`;
}

const STATUSES: readonly ConversationStatus[] = ["open", "waiting_reply", "follow_up", "closed"];

function attachmentCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

export function mapWhatsAppConversation(
  row: WhatsAppConversationRow,
  account: { id: string; brand: string; displayName: string }
): Conversation {
  const phone = displayPhone(row.peer_external_id);
  const name = row.peer_display?.trim() || phone || "WhatsApp contact";
  const direction: "in" | "out" = row.last_direction === "out" ? "out" : "in";
  const text =
    row.last_body && row.last_body !== ""
      ? row.last_body
      : (row.last_attachments ?? 0) > 0
        ? WA_ATTACHMENT_ONLY
        : "";
  const status = STATUSES.find((s) => s === row.status) ?? (direction === "out" ? "waiting_reply" : "open");

  return {
    id: encodeThreadId(account.id, row.id),
    customerId: row.customer_id ?? "",
    customerName: name,
    channel: "whatsapp",
    channelAddress: `${name} → ${account.displayName}`,
    peerPhone: phone,
    assignedTo: null,
    assignedToName: null,
    status,
    unreadCount: 0,
    lastMessage: {
      text,
      at: iso(row.last_sent_at ?? row.last_message_at ?? row.last_inbound_at),
      direction,
      author: direction === "out" ? "staff" : "customer",
    },
    hasAutomatedMessage: false,
    accountId: account.id,
    brand: account.brand,
  };
}

export function mapWhatsAppMessage(row: WhatsAppMessageRow, threadId: string): InboxMessage {
  const out = row.direction === "out";
  const text =
    row.body && row.body !== "" ? row.body : attachmentCount(row.attachments) > 0 ? WA_ATTACHMENT_ONLY : "";
  return {
    id: row.id,
    conversationId: threadId,
    direction: out ? "out" : "in",
    author: row.author === "automation" ? "automation" : out ? "staff" : "customer",
    text,
    at: iso(row.sent_at),
    status: out ? "sent" : "received",
    ...(out ? { staffName: row.staff_name ?? WHATSAPP_STAFF_NAME } : {}),
  };
}

/* ── Sending — a person pressed Send (Samer, 2026-09-15) ─────────────────── */

const GRAPH = "https://graph.facebook.com/v21.0";

/** WhatsApp's own limit for one text message. */
export const WHATSAPP_MAX_TEXT = 4096;

export type WhatsAppSendResult =
  | { ok: true; externalMessageId: string }
  | { ok: false; problem: string; windowClosed: boolean };

/** Meta's WhatsApp error, in words staff can act on. */
export function whatsappSendProblem(
  payload: unknown,
  httpStatus: number
): { problem: string; windowClosed: boolean } {
  const e = obj(obj(payload)?.error);
  const code = typeof e?.code === "number" ? e.code : null;
  if (code === 131047) {
    return {
      problem:
        "More than 24 hours since this customer wrote, so WhatsApp only allows a paid, pre-approved template — not a free reply.",
      windowClosed: true,
    };
  }
  if (code === 190) {
    return { problem: "The WhatsApp sending key is invalid or has expired.", windowClosed: false };
  }
  if (code === 3 || code === 10 || (code !== null && code >= 200 && code < 300)) {
    return { problem: "The WhatsApp sending key is not allowed to send for this number.", windowClosed: false };
  }
  if (code === 131026) {
    return { problem: "WhatsApp could not deliver it to this number.", windowClosed: false };
  }
  if (code === 130429 || code === 131056 || code === 80007 || httpStatus === 429) {
    return { problem: "WhatsApp is limiting messages for a moment — try again shortly.", windowClosed: false };
  }
  const message = str(e?.message);
  return {
    problem: message
      ? `WhatsApp said: ${message.slice(0, 200)}`
      : `WhatsApp answered with an error (HTTP ${httpStatus}).`,
    windowClosed: false,
  };
}

/**
 * Send one text through the Cloud API, as the WhatsApp number `phoneNumberId`.
 * With Coexistence the message also appears in the WhatsApp Business app on
 * the phone. This call sends a MESSAGE and nothing else: it never touches the
 * number's registration (register / deregister / codes are other endpoints,
 * and nothing in this codebase calls them).
 *
 * `fetchFn` exists so the request's shape can be tested without a network.
 */
export async function sendWhatsAppText(
  input: { phoneNumberId: string; to: string; text: string },
  token: string,
  fetchFn: typeof fetch = fetch
): Promise<WhatsAppSendResult> {
  const to = input.to.replace(/\D/g, "");
  // The number id goes into the URL path, so it must be digits and nothing else.
  if (!/^\d{5,20}$/.test(input.phoneNumberId) || to === "") {
    return { ok: false, problem: "This conversation has no WhatsApp number to reply to.", windowClosed: false };
  }
  try {
    const res = await fetchFn(`${GRAPH}/${input.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: input.text },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const json: unknown = await res.json().catch(() => null);
    const id = str(obj(list(obj(json)?.messages)[0])?.id);
    if (res.ok && id) return { ok: true, externalMessageId: id };
    if (res.ok) {
      return {
        ok: false,
        problem: "WhatsApp accepted the request but returned no message id — check the phone before sending it again.",
        windowClosed: false,
      };
    }
    return { ok: false, ...whatsappSendProblem(json, res.status) };
  } catch {
    // Unknown, not failed: it may or may not have gone. Say so.
    return {
      ok: false,
      problem: "Could not reach WhatsApp just now — nothing was confirmed as sent. Check the phone before sending it again.",
      windowClosed: false,
    };
  }
}

/** The stored row for a reply sent from MONZA AI — WhatsApp sends no echo for it. */
export function whatsappSentRow(input: {
  conversationId: string;
  brand: string;
  accountId: string;
  externalMessageId: string;
  text: string;
  at: string;
  staffName: string;
}): Record<string, unknown> {
  return {
    conversation_id: input.conversationId,
    brand: input.brand,
    account_id: input.accountId,
    direction: "out",
    author: "staff",
    body: input.text,
    attachments: [],
    external_message_id: input.externalMessageId,
    status: "sent",
    staff_name: input.staffName,
    sent_at: input.at,
  };
}

/* ── The adapter ─────────────────────────────────────────────────────────── */

/**
 * The generic adapter's send cannot know the WhatsApp number id (it is the
 * ACCOUNT's external id, not the message's), so WhatsApp replies go through
 * sendOnThread → sendWhatsAppText in lib/channels/live.ts instead.
 */
async function sendWhatsApp(): Promise<SendResult> {
  return {
    ok: false,
    error: "WhatsApp replies are sent through the inbox's conversation route.",
    retryable: false,
  };
}

export const whatsappAdapter: ChannelAdapter = {
  channel: "whatsapp",
  parse: (body, accounts) => parseWhatsApp(body, accounts),
  send: sendWhatsApp,
};
