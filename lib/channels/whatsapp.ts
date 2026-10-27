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
 * ── Files are kept too (Samer, 2026-09-15) ──────────────────────────────────
 * "Send and receive voice notes, photos, videos, PDF files and more." A photo,
 * video, voice note or document arrives as a media id that Meta keeps for 7
 * days, so its id and type are kept here and the file itself is copied into
 * our private bucket (lib/channels/wa-media.ts, lib/channels/wa-media-store.ts),
 * for the same 12 months as the words.
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
 * ── Statuses move OUR ticks, and create nothing ─────────────────────────────
 * Delivery and read receipts (`statuses`) are not messages (rule 19): they
 * only move the ✓ / ✓✓ / blue ✓✓ of a message we already hold, and never
 * backwards (parseWhatsAppStatuses, statusesBefore).
 *
 * ── Dropped ─────────────────────────────────────────────────────────────────
 * Reactions and system notices carry no new message. Edits and revokes carry
 * no new message EITHER — they change one already here (parseWhatsAppRevisions,
 * 2026-10-20): Meta's API cannot delete or edit a sent message, but the
 * WhatsApp Business app can (edit 15 min, delete 2 days), and on a
 * Coexistence number Meta reports it, for the team's messages and the
 * customer's. The inbox mirrors it: "This message was deleted", or the new words.
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
import type { Conversation, ConversationStatus, InboxAttachment, InboxMessage, MessageStatus, QuotedMessage } from "@/lib/inbox/types";
import { encodeThreadId } from "@/lib/channels/live-map";
import { mediaLabel } from "@/lib/inbox/media";
import {
  MAX_CAPTION,
  META_MEDIA_DAYS,
  isMediaKind,
  readAttachments,
  toInboxAttachment,
  type OutboundKind,
  type StoredAttachment,
} from "@/lib/channels/wa-media";

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

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
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
  sticker: "sticker",
};

/** A photo, video, voice note, document or sticker: its id on Meta and what it is — never a URL. */
function mediaOf(type: string, media: Record<string, unknown> | null): InboundAttachment {
  const a: InboundAttachment = { kind: MEDIA_KIND[type] ?? "unknown", url: null };
  const mediaId = str(media?.id);
  const mime = str(media?.mime_type);
  const sha256 = str(media?.sha256);
  const filename = str(media?.filename);
  if (mediaId) a.mediaId = mediaId;
  if (mime) a.mime = mime;
  if (sha256) a.sha256 = sha256;
  if (filename) a.filename = filename.slice(0, 200);
  if (type === "audio" && media?.voice === true) a.voice = true;
  return a;
}

/** The cards of a shared contact: the name and the first number on each. */
function contactsOf(m: Record<string, unknown>): InboundAttachment[] {
  return list(m.contacts)
    .slice(0, 10)
    .map((raw): InboundAttachment => {
      const c = obj(raw);
      const n = obj(c?.name);
      const phone = obj(list(c?.phones)[0]);
      const a: InboundAttachment = { kind: "contact", url: null };
      const name = str(n?.formatted_name) ?? str(n?.first_name);
      const number = str(phone?.phone) ?? str(phone?.wa_id);
      if (name) a.name = name.slice(0, 200);
      if (number) a.phone = number.slice(0, 40);
      return a;
    });
}

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
    case "sticker": {
      const media = obj(m[type]);
      return { text: str(media?.caption) ?? "", attachments: [mediaOf(type, media)] };
    }
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
      const lat = num(l?.latitude);
      const lng = num(l?.longitude);
      const place: InboundAttachment = { kind: "location", url: null };
      if (lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        place.lat = lat;
        place.lng = lng;
      }
      if (label) place.label = label.slice(0, 200);
      return {
        text: label ? `Shared a location: ${label}` : "Shared a location",
        attachments: place.lat !== undefined ? [place] : [],
      };
    }
    case "contacts":
      return { text: "Shared a contact card", attachments: contactsOf(m) };
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

/** Each change on a WhatsApp delivery, with the number it reached (or null). */
function changesOf(
  body: unknown,
  accounts: readonly ChannelAccount[]
): { field: string; value: Record<string, unknown>; account: ChannelAccount | null }[] {
  const root = obj(body);
  // Instagram ("instagram") and Messenger ("page") have their own adapters.
  if (!root || str(root.object) !== "whatsapp_business_account") return [];
  const out: { field: string; value: Record<string, unknown>; account: ChannelAccount | null }[] = [];
  for (const rawEntry of list(root.entry)) {
    for (const rawChange of list(obj(rawEntry)?.changes)) {
      const change = obj(rawChange);
      const field = str(change?.field);
      const value = obj(change?.value);
      if (!field || !value) continue;
      // Which of OUR numbers it reached. An unknown number is not guessed at.
      const phoneNumberId = str(obj(value.metadata)?.phone_number_id);
      const account = phoneNumberId
        ? (accounts.find((a) => a.channel === "whatsapp" && a.externalId === phoneNumberId) ?? null)
        : null;
      out.push({ field, value, account });
    }
  }
  return out;
}

export function parseWhatsApp(
  body: unknown,
  accounts: readonly ChannelAccount[],
  receivedAt = new Date().toISOString()
): InboundEvent[] {
  const out: InboundEvent[] = [];

  for (const { field, value, account } of changesOf(body, accounts)) {
    if (field !== "messages" && field !== "smb_message_echoes") continue;

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
        // Unmatched stays null: counted, never filed under a brand (rule 1).
        accountId: account?.id ?? null,
        fromExternalId: peer,
        fromDisplay: names.get(peer) ?? null,
        externalMessageId: id,
        text: content.text,
        at: waTime(m.timestamp, receivedAt),
        attachments: content.attachments,
        referral: incoming ? referralOf(m) : null,
        direction: incoming ? "in" : "out",
        replyTo: str(obj(m.context)?.id) ?? null,
      });
    }
  }

  return out;
}

/* ── Ticks: delivery and read receipts ───────────────────────────────────── */

export interface WhatsAppStatusUpdate {
  accountId: string;
  externalMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  /** WhatsApp's reason, for a message that failed. */
  error: string | null;
}

/**
 * The receipts on a delivery, for OUR connected numbers only. "played" (a
 * voice note was listened to) counts as read.
 */
export function parseWhatsAppStatuses(body: unknown, accounts: readonly ChannelAccount[]): WhatsAppStatusUpdate[] {
  const out: WhatsAppStatusUpdate[] = [];
  for (const { field, value, account } of changesOf(body, accounts)) {
    if (field !== "messages" || !account) continue;
    for (const raw of list(value.statuses)) {
      const s = obj(raw);
      const id = str(s?.id);
      const said = str(s?.status);
      const status =
        said === "sent" || said === "delivered" || said === "read" || said === "failed"
          ? said
          : said === "played"
            ? "read"
            : null;
      if (!id || !status) continue;
      const e = obj(list(s?.errors)[0]);
      const reason = str(obj(e?.error_data)?.details) ?? str(e?.message) ?? str(e?.title);
      out.push({
        accountId: account.id,
        externalMessageId: id,
        status,
        error: status === "failed" ? (reason ?? "WhatsApp could not deliver it.").slice(0, 300) : null,
      });
    }
  }
  return out;
}

/* ── Edits and deletions made in the WhatsApp Business app ───────────────── */

export interface WhatsAppRevision {
  accountId: string;
  /** WhatsApp's id of the message that was edited or deleted. */
  originalMessageId: string;
  kind: "edit" | "revoke";
  /** "in" = the customer did it (messages); "out" = the team did it on the phone (smb_message_echoes). */
  direction: "in" | "out";
  at: string;
  /** The new words (or caption) of an edit; null for a deletion. */
  text: string | null;
}

/**
 * Messages edited or deleted after they were sent, on OUR numbers only. A customer's edit or deletion
 * arrives under `messages`; the team's own, done on the phone, under `smb_message_echoes`. Neither is a
 * new message (parseWhatsApp still returns nothing for them): each names the original by id.
 */
export function parseWhatsAppRevisions(body: unknown, accounts: readonly ChannelAccount[], receivedAt = new Date().toISOString()): WhatsAppRevision[] {
  const out: WhatsAppRevision[] = [];
  for (const { field, value, account } of changesOf(body, accounts)) {
    if (!account) continue;
    const incoming = field === "messages";
    if (!incoming && field !== "smb_message_echoes") continue;
    for (const raw of incoming ? list(value.messages) : list(value.message_echoes)) {
      const m = obj(raw);
      const type = str(m?.type);
      if (!m || (type !== "edit" && type !== "revoke")) continue;
      const original = str(obj(m[type])?.original_message_id);
      if (!original) continue;
      // The edited content has a message's own shape (text, or a file with a caption): read it as one.
      const edited = type === "edit" ? contentOf(obj(obj(m.edit)?.message) ?? {}) : null;
      out.push({
        accountId: account.id,
        originalMessageId: original,
        kind: type,
        direction: incoming ? "in" : "out",
        at: waTime(m.timestamp, receivedAt),
        text: type === "edit" ? (edited?.text ?? "") : null,
      });
    }
  }
  return out;
}

const TICK_ORDER = ["queued", "sent", "delivered", "read"] as const;

/**
 * The statuses a message may move FROM to reach `next` — never backwards, so
 * a late "delivered" cannot undo a "read". A failure only replaces a message
 * that was not yet delivered.
 */
export function statusesBefore(next: WhatsAppStatusUpdate["status"]): string[] {
  if (next === "failed") return ["queued", "sent"];
  return TICK_ORDER.slice(0, TICK_ORDER.indexOf(next));
}

/* ── What is kept ────────────────────────────────────────────────────────── */

/** Who wrote our side of a WhatsApp thread: somebody on the app or in Business Suite. */
export const WHATSAPP_STAFF_NAME = "Monza · WhatsApp app";

/**
 * One received attachment as it is stored. A file starts "pending": the
 * webhook, the thread and the daily job copy it out of Meta within its 7 days.
 */
export function storedFromInbound(a: InboundAttachment): StoredAttachment {
  const s: StoredAttachment = { kind: a.kind };
  if (a.mediaId) s.mediaId = a.mediaId;
  if (a.mime) s.mime = a.mime;
  if (a.sha256) s.sha256 = a.sha256;
  if (a.filename) s.filename = a.filename;
  if (a.voice) s.voice = true;
  if (a.lat !== undefined && a.lng !== undefined) {
    s.lat = a.lat;
    s.lng = a.lng;
  }
  if (a.label) s.label = a.label;
  if (a.name) s.name = a.name;
  if (a.phone) s.phone = a.phone;
  if (isMediaKind(a.kind)) s.state = a.mediaId ? "pending" : "unavailable";
  return s;
}

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
    // The media id and type, so the file can be copied out of Meta (7 days);
    // never Meta's download URL, which dies in 5 minutes.
    attachments: input.event.attachments.map(storedFromInbound),
    external_message_id: input.event.externalMessageId,
    status: out ? "sent" : "received",
    staff_name: out ? WHATSAPP_STAFF_NAME : null,
    sent_at: input.event.at,
    // Which message it answers (migration 030), so the inbox can quote it.
    ...(input.event.replyTo ? { reply_to: input.event.replyTo.slice(0, 200) } : {}),
  };
}

/* ── Reading it back for the inbox ───────────────────────────────────────── */

/** One row of channel_whatsapp_page2() (migration 010) — or of 009's page, whose
 *  `last_attachments` is a count rather than the list. */
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
  last_attachments: unknown;
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
  external_message_id?: string | null;
  error?: string | null;
  /** Set on a message sent from a sales suggestion ("sales-suggestion:…"). */
  automation_id?: string | null;
  /** WhatsApp's id of the message this one answers (migration 030). */
  reply_to?: string | null;
  /** Deleted for everyone in the WhatsApp app (032): words and files are gone from our copy. */
  deleted_at?: string | null;
  /** Edited in the WhatsApp app (032): `body` holds the new words. */
  edited_at?: string | null;
}

/**
 * Each reply gets the message it answers, quoted (Samer, 2026-10-20: "see the image a client is referring to").
 * Looked up among the thread's own messages, then among `older` (read separately); a message that is in neither
 * is marked missing — never guessed. PURE.
 */
export function quoteReplies(messages: readonly InboxMessage[], older: readonly InboxMessage[] = []): InboxMessage[] {
  const byId = new Map<string, InboxMessage>();
  for (const m of [...older, ...messages]) if (m.externalId) byId.set(m.externalId, m);
  return messages.map((m) => {
    if (!m.replyToId) return m;
    const target = byId.get(m.replyToId);
    if (!target) return { ...m, replyTo: { author: m.direction === "in" ? "staff" : "customer", text: "", missing: true } };
    if (target.deleted) return { ...m, replyTo: { author: target.author, text: "This message was deleted" } };
    const first = target.attachments?.[0];
    const words = target.text === WA_ATTACHMENT_ONLY ? "" : target.text.replace(/\s+/g, " ").trim();
    const quote: QuotedMessage = {
      author: target.author,
      text: words.length > 140 ? `${words.slice(0, 139)}…` : words,
      ...(first ? { kind: first.kind } : {}),
      ...(first && (first.kind === "image" || first.kind === "sticker") && first.state === "ready" && first.url ? { thumbUrl: first.url } : {}),
    };
    return { ...m, replyTo: quote };
  });
}

/** Shown for a message whose only content cannot be shown here. */
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

/** The list row's line for a message with no words. */
function attachmentsPreview(value: unknown): string {
  if (typeof value === "number") return value > 0 ? WA_ATTACHMENT_ONLY : "";
  for (const a of readAttachments(value)) {
    const shown = toInboxAttachment(a);
    if (shown) return mediaLabel(shown.kind, shown.filename);
  }
  return Array.isArray(value) && value.length > 0 ? WA_ATTACHMENT_ONLY : "";
}

export function mapWhatsAppConversation(
  row: WhatsAppConversationRow,
  account: { id: string; brand: string; displayName: string }
): Conversation {
  const phone = displayPhone(row.peer_external_id);
  const name = row.peer_display?.trim() || phone || "WhatsApp contact";
  const direction: "in" | "out" = row.last_direction === "out" ? "out" : "in";
  const text = row.last_body && row.last_body !== "" ? row.last_body : attachmentsPreview(row.last_attachments);
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

const OUT_STATUSES: ReadonlySet<string> = new Set(["queued", "sent", "delivered", "read", "failed"]);
const DAY_MS = 86_400_000;

/**
 * One stored message for the screen. `links` are the signed URLs of the files
 * kept for this thread; a file still "pending" after Meta's 7 days is gone.
 */
export function mapWhatsAppMessage(
  row: WhatsAppMessageRow,
  threadId: string,
  links?: ReadonlyMap<string, { url: string; expiresAt: string }>,
  nowMs: number = Date.now()
): InboxMessage {
  const out = row.direction === "out";
  const at = iso(row.sent_at);
  const expired = nowMs - Date.parse(at) > META_MEDIA_DAYS * DAY_MS;

  const attachments: InboxAttachment[] = [];
  for (const a of readAttachments(row.attachments)) {
    const shown = toInboxAttachment(a, a.path ? links?.get(a.path) : undefined);
    if (!shown) continue;
    attachments.push(shown.state === "pending" && expired ? { ...shown, state: "unavailable" } : shown);
  }

  const deleted = Boolean(row.deleted_at);
  const body = deleted ? "" : (row.body ?? "");
  const text =
    body !== "" ? body : !deleted && attachments.length === 0 && Array.isArray(row.attachments) && row.attachments.length > 0 ? WA_ATTACHMENT_ONLY : "";
  const status: MessageStatus = out
    ? OUT_STATUSES.has(row.status ?? "")
      ? (row.status as MessageStatus)
      : "sent"
    : "received";

  return {
    id: row.id,
    ...(row.external_message_id ? { externalId: row.external_message_id } : {}),
    ...(row.reply_to ? { replyToId: row.reply_to } : {}),
    conversationId: threadId,
    direction: out ? "out" : "in",
    author: row.author === "automation" ? "automation" : out ? "staff" : "customer",
    text,
    at,
    status,
    ...(out ? { staffName: row.staff_name ?? WHATSAPP_STAFF_NAME } : {}),
    ...(out && row.automation_id ? { automationId: row.automation_id } : {}),
    ...(attachments.length > 0 && !deleted ? { attachments } : {}),
    ...(status === "failed" && row.error ? { error: row.error } : {}),
    ...(deleted ? { deleted: true } : {}),
    ...(row.edited_at && !deleted ? { edited: true } : {}),
  };
}

/* ── Sending — a person pressed Send (Samer, 2026-09-15) ─────────────────── */

const GRAPH = "https://graph.facebook.com/v21.0";

/** WhatsApp's own limit for one text message. */
export const WHATSAPP_MAX_TEXT = 4096;
/** …and for the caption under a photo, video or document. */
export const WHATSAPP_MAX_CAPTION = MAX_CAPTION;

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
  if (code === 131053) {
    return { problem: "WhatsApp could not use that file — check its type and size.", windowClosed: false };
  }
  if (code === 130429 || code === 131056 || code === 80007 || httpStatus === 429) {
    return { problem: "WhatsApp is limiting messages for a moment — try again shortly.", windowClosed: false };
  }
  // Meta's actionable sentence is in error_data.details ("Unsupported video format…"); message is the generic
  // "(#100) Invalid parameter". Both are shown, details first, so a refused video says WHY.
  const message = str(e?.message);
  const details = str(obj(e?.error_data)?.details);
  const said = details && message ? `${details} (${message})` : (details ?? message);
  return {
    problem: said ? `WhatsApp said: ${said.slice(0, 300)}` : `WhatsApp answered with an error (HTTP ${httpStatus}).`,
    windowClosed: false,
  };
}

/**
 * One message through the Cloud API, as the WhatsApp number `phoneNumberId`.
 * With Coexistence it also appears in the WhatsApp Business app on the phone.
 * This sends a MESSAGE and nothing else: it never touches the number's
 * registration (register / deregister / codes are other endpoints, and nothing
 * in this codebase calls them).
 */
async function postWhatsAppMessage(
  phoneNumberId: string,
  recipient: string,
  payload: Record<string, unknown>,
  token: string,
  fetchFn: typeof fetch
): Promise<WhatsAppSendResult> {
  const to = recipient.replace(/\D/g, "");
  // The number id goes into the URL path, so it must be digits and nothing else.
  if (!/^\d{5,20}$/.test(phoneNumberId) || to === "") {
    return { ok: false, problem: "This conversation has no WhatsApp number to reply to.", windowClosed: false };
  }
  try {
    const res = await fetchFn(`${GRAPH}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...payload }),
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

/** `fetchFn` exists so the request's shape can be tested without a network. */
export async function sendWhatsAppText(
  input: { phoneNumberId: string; to: string; text: string },
  token: string,
  fetchFn: typeof fetch = fetch
): Promise<WhatsAppSendResult> {
  return postWhatsAppMessage(
    input.phoneNumberId,
    input.to,
    { type: "text", text: { preview_url: false, body: input.text } },
    token,
    fetchFn
  );
}

/**
 * An approved TEMPLATE message — the only kind WhatsApp delivers to a number that
 * has not written to the business in the last 24 hours. Used for the sales team
 * alert (lib/wasales/sales-ops.ts), and — since 2026-10-20 — for a customer when a
 * PERSON picks a listed template and presses Send (live.ts sendTemplateOnThread). Each body parameter is
 * one line: WhatsApp refuses new lines, tabs and long runs of spaces in them.
 */
export async function sendWhatsAppTemplate(
  input: { phoneNumberId: string; to: string; template: string; language: string; bodyParams: string[] },
  token: string,
  fetchFn: typeof fetch = fetch
): Promise<WhatsAppSendResult> {
  if (!/^[a-z0-9_]{1,512}$/.test(input.template)) {
    return { ok: false, problem: "The template name is not valid.", windowClosed: false };
  }
  const params = input.bodyParams.map((p) => ({
    type: "text",
    text: p.replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").slice(0, 900) || "-",
  }));
  return postWhatsAppMessage(
    input.phoneNumberId,
    input.to,
    {
      type: "template",
      template: {
        name: input.template,
        language: { code: input.language },
        ...(params.length > 0 ? { components: [{ type: "body", parameters: params }] } : {}),
      },
    },
    token,
    fetchFn
  );
}

/**
 * Hand WhatsApp a file to send (POST /{phone-number-id}/media). It answers with
 * an id, valid 30 days, that a message then names. Uploading is not sending:
 * nothing reaches the customer until sendWhatsAppMedia.
 */
export async function uploadWhatsAppMedia(
  input: { phoneNumberId: string; bytes: Uint8Array; mime: string; filename: string },
  token: string,
  fetchFn: typeof fetch = fetch
): Promise<{ ok: true; mediaId: string } | { ok: false; problem: string }> {
  if (!/^\d{5,20}$/.test(input.phoneNumberId)) {
    return { ok: false, problem: "This conversation has no WhatsApp number to send from." };
  }
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", input.mime);
  form.append("file", new Blob([new Uint8Array(input.bytes)], { type: input.mime }), input.filename);
  try {
    const res = await fetchFn(`${GRAPH}/${input.phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    const json: unknown = await res.json().catch(() => null);
    const id = str(obj(json)?.id);
    if (res.ok && id) return { ok: true, mediaId: id };
    return { ok: false, problem: whatsappSendProblem(json, res.status).problem };
  } catch {
    return { ok: false, problem: "Could not reach WhatsApp to upload the file — nothing was sent." };
  }
}

/**
 * Send an uploaded file. A voice note is audio with `voice: true` — WhatsApp
 * then shows it with a waveform, and only accepts it as Ogg/Opus, which the
 * caller has checked. Audio carries no caption; documents keep their name.
 */
export async function sendWhatsAppMedia(
  input: {
    phoneNumberId: string;
    to: string;
    kind: OutboundKind;
    mediaId: string;
    caption?: string;
    filename?: string;
    voice?: boolean;
  },
  token: string,
  fetchFn: typeof fetch = fetch
): Promise<WhatsAppSendResult> {
  const part: Record<string, unknown> = { id: input.mediaId };
  if (input.caption && input.kind !== "audio") part.caption = input.caption.slice(0, WHATSAPP_MAX_CAPTION);
  if (input.kind === "document" && input.filename) part.filename = input.filename;
  if (input.kind === "audio" && input.voice) part.voice = true;
  return postWhatsAppMessage(input.phoneNumberId, input.to, { type: input.kind, [input.kind]: part }, token, fetchFn);
}

/**
 * A brochure or video sent by its public address (the sales library's), for a
 * sales suggestion a person chose to send. WhatsApp fetches the file itself;
 * nothing is uploaded from here. Only an https address is ever sent.
 */
export async function sendWhatsAppLink(
  input: {
    phoneNumberId: string;
    to: string;
    kind: "document" | "video";
    link: string;
    filename?: string;
    caption?: string;
  },
  token: string,
  fetchFn: typeof fetch = fetch
): Promise<WhatsAppSendResult> {
  if (!/^https:\/\/\S+$/.test(input.link)) {
    return { ok: false, problem: "That file's address is not a secure web link.", windowClosed: false };
  }
  const part: Record<string, unknown> = { link: input.link };
  if (input.kind === "document" && input.filename) part.filename = input.filename.slice(0, 240);
  if (input.caption) part.caption = input.caption.slice(0, WHATSAPP_MAX_CAPTION);
  return postWhatsAppMessage(input.phoneNumberId, input.to, { type: input.kind, [input.kind]: part }, token, fetchFn);
}

/* ── Meta's account lock (Samer, 2026-10-23: "WhatsApp Business is locked") ─────────────────── */

/**
 * The words WhatsApp attaches to a send it accepted and then failed because Meta
 * locked the business account — error 131031, "Business account has been
 * locked." Meta's policy-enforcement page: "an account lock, which is an
 * indefinite block on sending any messages; can only be removed via an appeal."
 */
export function isAccountLockError(error: string | null | undefined): boolean {
  return typeof error === "string" && /account has been locked|\b131031\b/i.test(error);
}

export interface SendLock {
  /** When the first send failed with the lock's words. */
  since: string;
  /** The newest such failure. */
  latest: string;
  reason: string;
  failed: number;
}

/** A lock failure older than this, with no send since, proves nothing about now: Meta may have lifted it. */
export const SEND_LOCK_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/**
 * Whether Meta has locked the business account, read from our OWN record of
 * the ACCOUNT's recent sends (never one thread's — the lock is account-wide,
 * and a chat touched during a lock would otherwise say "locked" for months):
 * the NEWEST send failed with the lock's words, nothing of ours went out after
 * it, and it is recent (SEND_LOCK_MAX_AGE_MS). Null as soon as any later send
 * exists — one Meta accepted without failing it is the lock lifted.
 */
export function sendLockFrom(
  rows: readonly { direction: string; status: string | null; error?: string | null; at: string }[],
  now: number = Date.now(),
  maxAgeMs: number = SEND_LOCK_MAX_AGE_MS
): SendLock | null {
  let since: string | null = null;
  let latest: string | null = null;
  let newestOut: string | null = null;
  let reason = "";
  let failed = 0;
  for (const m of rows) {
    if (m.direction !== "out") continue;
    if (newestOut === null || m.at > newestOut) newestOut = m.at;
    if (m.status === "failed" && isAccountLockError(m.error)) {
      failed++;
      reason = m.error ?? reason;
      if (since === null || m.at < since) since = m.at;
      if (latest === null || m.at > latest) latest = m.at;
    }
  }
  if (since === null || latest === null) return null;
  if (newestOut !== null && newestOut > latest) return null; // something of ours went out after the last failure
  if (now - Date.parse(latest) > maxAgeMs) return null; // too old to say anything about now
  return { since, latest, reason, failed };
}

/** The red line under a WhatsApp chat while the lock holds. */
export function sendLockWords(lock: SendLock): string {
  const at = new Date(lock.since).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Beirut" });
  return `Meta has locked the WhatsApp business account — every send since ${at} (Beirut) failed (${lock.failed} so far; WhatsApp says "${lock.reason}"). Only Meta's review lifts it: Meta Business Suite → Business Support Home → the WhatsApp account → Request Review. Not a Monza AI fault.`;
}

/** One line per entity of Meta's Health Status API (GET /{phone-number-id}?fields=health_status). */
export interface HealthSummary {
  /** AVAILABLE, LIMITED or BLOCKED across every entity; null when the answer had no health_status. */
  overall: string | null;
  lines: string[];
}

/** Meta's health_status answer, in lines a person can act on — codes and Meta's own sentences, never a key. */
export function summariseHealth(json: unknown): HealthSummary {
  const h = obj(obj(json)?.health_status);
  if (!h) return { overall: null, lines: [] };
  const lines: string[] = [];
  for (const raw of list(h.entities)) {
    const e = obj(raw);
    if (!e) continue;
    const head = `${str(e.entity_type) ?? "?"} ${str(e.can_send_message) ?? "?"}`;
    const errors = list(e.errors).map((x) => {
      const err = obj(x);
      const code = typeof err?.error_code === "number" ? `${err.error_code}: ` : "";
      const fix = str(err?.possible_solution);
      return `${code}${str(err?.error_description) ?? "no description"}${fix ? ` — ${fix}` : ""}`;
    });
    const info = list(e.additional_info).map((x) => str(x)).filter((x): x is string => x !== null);
    lines.push([head, ...errors, ...info].join(" · "));
  }
  return { overall: str(h.can_send_message), lines };
}

/** A business phone number's own node (GET /{phone-number-id}?fields=…), in one line — never a key. */
export function phoneNumberSummary(json: unknown): { status: string | null; onBusinessApp: boolean | null; words: string } {
  const o = obj(json);
  if (!o) return { status: null, onBusinessApp: null, words: "Meta answered without the number's fields." };
  const status = str(o.status);
  const onBusinessApp = typeof o.is_on_biz_app === "boolean" ? o.is_on_biz_app : null;
  const parts: string[] = [];
  const say = (label: string, v: unknown) => {
    const s = str(v) ?? (typeof v === "boolean" ? String(v) : null);
    if (s !== null) parts.push(`${label} ${s}`);
  };
  say("number", o.display_phone_number);
  say("name", o.verified_name);
  say("status", o.status);
  say("platform", o.platform_type);
  say("verification", o.code_verification_status);
  say("quality", o.quality_rating);
  say("limit tier", o.messaging_limit_tier);
  say("name status", o.name_status);
  say("official business account", o.is_official_business_account);
  say("on the WhatsApp Business app (Coexistence)", o.is_on_biz_app);
  if (typeof o.last_onboarded_time === "number") parts.push(`last onboarded ${new Date(o.last_onboarded_time * 1000).toISOString()}`);
  const hook = obj(o.webhook_configuration);
  if (hook) parts.push(`own webhook override: ${str(hook.application) ? "set (application-level)" : "set"}`);
  return { status, onBusinessApp, words: parts.join(" · ") || "Meta answered with none of the number's fields." };
}

/** The app ids a WhatsApp Business Account sends its webhooks to (GET /{waba-id}/subscribed_apps). */
export function subscribedAppIds(json: unknown): string[] {
  const out: string[] = [];
  for (const raw of list(obj(json)?.data)) {
    const app = obj(obj(raw)?.whatsapp_business_api_data);
    const id = str(app?.id);
    if (id) out.push(id);
  }
  return out;
}

/** WhatsApp's limits for tappable choices. */
export const WHATSAPP_MAX_BUTTONS = 3;
export const WHATSAPP_MAX_LIST_ROWS = 10;
export const WHATSAPP_BUTTON_TITLE = 20;
export const WHATSAPP_ROW_TITLE = 24;
export const WHATSAPP_MAX_INTERACTIVE_BODY = 1024;

/**
 * A question with tappable answers: up to three reply buttons, or a list of up
 * to ten rows. Each answer carries its payload as the id ("MODEL:COURAGE"); a
 * tap comes back as a message the engine reads. Anything over WhatsApp's
 * limits is refused here rather than by Meta after it looked sent.
 */
export async function sendWhatsAppChoices(
  input: {
    phoneNumberId: string;
    to: string;
    body: string;
    style: "buttons" | "list";
    choices: readonly { id: string; title: string }[];
  },
  token: string,
  fetchFn: typeof fetch = fetch
): Promise<WhatsAppSendResult> {
  const max = input.style === "buttons" ? WHATSAPP_MAX_BUTTONS : WHATSAPP_MAX_LIST_ROWS;
  const titleMax = input.style === "buttons" ? WHATSAPP_BUTTON_TITLE : WHATSAPP_ROW_TITLE;
  const body = input.body.trim();
  if (
    input.choices.length === 0 ||
    input.choices.length > max ||
    input.choices.some((c) => c.title.trim() === "" || c.title.length > titleMax || c.id.length > 200) ||
    body === "" ||
    body.length > WHATSAPP_MAX_INTERACTIVE_BODY
  ) {
    return { ok: false, problem: "Those choices do not fit WhatsApp's buttons or list.", windowClosed: false };
  }
  const interactive =
    input.style === "buttons"
      ? {
          type: "button",
          body: { text: body },
          action: { buttons: input.choices.map((c) => ({ type: "reply", reply: { id: c.id, title: c.title } })) },
        }
      : {
          type: "list",
          body: { text: body },
          action: {
            button: "Choose",
            sections: [{ title: "Options", rows: input.choices.map((c) => ({ id: c.id, title: c.title })) }],
          },
        };
  return postWhatsAppMessage(input.phoneNumberId, input.to, { type: "interactive", interactive }, token, fetchFn);
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
  /** Who pressed Send (the CRM staff id), for response times per person. */
  staffId?: string | null;
  attachment?: StoredAttachment;
  /** Sent from the sales engine: "sales-suggestion:…" (a person pressed Send) or "sales-autoreply:…". */
  automationId?: string;
  /** "automation" only for the sales autoreply pilot, which no person pressed. */
  author?: "staff" | "automation";
}): Record<string, unknown> {
  return {
    conversation_id: input.conversationId,
    brand: input.brand,
    account_id: input.accountId,
    direction: "out",
    author: input.author ?? "staff",
    body: input.text,
    attachments: input.attachment ? [input.attachment] : [],
    external_message_id: input.externalMessageId,
    status: "sent",
    staff_name: input.staffName,
    ...(input.staffId && /^[0-9a-f-]{36}$/i.test(input.staffId) ? { staff_id: input.staffId } : {}),
    sent_at: input.at,
    ...(input.automationId ? { automation_id: input.automationId } : {}),
  };
}

/* ── The adapter ─────────────────────────────────────────────────────────── */

/**
 * The generic adapter's send cannot know the WhatsApp number id (it is the
 * ACCOUNT's external id, not the message's), so WhatsApp replies go through
 * sendOnThread → sendWhatsAppText / sendWhatsAppMedia in lib/channels/live.ts.
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
