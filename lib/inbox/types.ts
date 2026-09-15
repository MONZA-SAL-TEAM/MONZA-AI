/**
 * THE UNIFIED INBOX — one conversation model for every channel.
 *
 * WhatsApp, Instagram and Facebook are not three products. They are three
 * transports for the same thing: a conversation with a customer. Everything in
 * this file is channel-agnostic, and `channel` is a field rather than a
 * different shape, so a screen, a filter or an automation written once works
 * for all three — and for whatever channel is added next.
 *
 * This IS data MONZA AI owns. Conversations, messages, who they are assigned
 * to, what state they are in and what was sent are the product's own records —
 * unlike customers, vehicles and installments, which are read from the source
 * systems and never owned here.
 */

import type { ChannelKey } from "@/lib/domain/types";

/**
 * Where a conversation stands, from the team's point of view.
 *
 *   open          the customer wrote last, or nothing needs doing
 *   waiting_reply we answered and are waiting on them
 *   follow_up     it went quiet and somebody should chase it
 *   closed        finished; nothing outstanding
 */
export type ConversationStatus =
  | "open"
  | "waiting_reply"
  | "follow_up"
  | "closed";

export const STATUS_LABEL: Readonly<Record<ConversationStatus, string>> = {
  open: "Needs a reply",
  waiting_reply: "Waiting for the customer",
  follow_up: "Follow-up needed",
  closed: "Closed",
};

/** Who put a message into the thread. */
export type MessageAuthor = "customer" | "staff" | "automation";

/** What happened to an outgoing message. Incoming messages are always "received". */
export type MessageStatus =
  | "received"
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

/** What a message carries besides words. */
export type AttachmentKind =
  | "image"
  | "video"
  | "voice"
  | "audio"
  | "file"
  | "sticker"
  | "location"
  | "contact"
  /** A post, reel or story shared in an Instagram or Facebook chat. */
  | "share";

/**
 * A photo, video, voice note, file, location or contact card in a message.
 *
 *   ready        kept by MONZA AI; `url` is a short-lived link to it
 *   pending      arrived, not kept yet (normally a few seconds)
 *   too_large    bigger than MONZA AI keeps — it is on the phone
 *   unavailable  never kept: from before files were kept, or Meta's 7 days ran out
 */
export interface InboxAttachment {
  kind: AttachmentKind;
  state: "ready" | "pending" | "too_large" | "unavailable";
  url?: string;
  /** When `url` stops working (ISO). Links are never saved in the browser's copy. */
  urlExpiresAt?: string;
  mime?: string;
  filename?: string;
  size?: number;
  lat?: number;
  lng?: number;
  label?: string;
  name?: string;
  phone?: string;
}

export interface InboxMessage {
  id: string;
  conversationId: string;
  direction: "in" | "out";
  author: MessageAuthor;
  text: string;
  /** ISO timestamp. */
  at: string;
  status: MessageStatus;
  /** Set when an automation produced this message — never invented text. */
  automationId?: string;
  /** The staff member who sent it, when a person did. */
  staffName?: string;
  /** Photos, videos, voice notes, files, locations, contact cards. */
  attachments?: InboxAttachment[];
  /** Why an outgoing message was not delivered, in WhatsApp's words. */
  error?: string;
}

/**
 * One thread with one customer on one channel.
 *
 * A person may have several conversations — a WhatsApp thread and an Instagram
 * thread are genuinely separate places, and pretending otherwise loses replies.
 * They share a `customerId`, so the customer view can show all of them
 * together, which is where "one view of the person" belongs.
 */
export interface Conversation {
  id: string;
  customerId: string;
  /** Denormalised for list rendering; the source system stays authoritative. */
  customerName: string;
  channel: ChannelKey;
  /** The address on that channel — a phone number or an account handle. */
  channelAddress: string;
  /** Staff user id, or null when nobody has picked it up. */
  assignedTo: string | null;
  assignedToName: string | null;
  status: ConversationStatus;
  unreadCount: number;
  lastMessage: {
    text: string;
    at: string;
    direction: "in" | "out";
    author: MessageAuthor;
  };
  /** True when anything in this thread was sent by an automation. */
  hasAutomatedMessage: boolean;
  /**
   * Live threads only: OUR account it arrived at ("ig-mhero") and that
   * account's brand. The brand is decided by the account (rule 1), never by
   * the text, and is what the inbox's brand tabs filter on.
   */
  accountId?: string;
  brand?: string;
  /** WhatsApp only: the customer's number, for the prefilled wa.me link. */
  peerPhone?: string;
}

/**
 * What Meta lets MONZA AI see about the person in an Instagram or Facebook
 * conversation (Samer, 2026-09-15: "their profile picture, their name and
 * everything I can see"). Read live from Meta and never stored: the picture
 * link expires within days. WhatsApp has none of this — Meta shares only the
 * profile name and the number, which the conversation already carries.
 */
export interface CustomerProfile {
  name: string | null;
  username: string | null;
  /** Meta's own short-lived picture link. */
  pictureUrl: string | null;
  followers: number | null;
  /** They follow our account. */
  followsYou: boolean | null;
  /** Our account follows them. */
  youFollow: boolean | null;
  verified: boolean | null;
}

/* ── Filters ─────────────────────────────────────────────────────────────── */

/**
 * The filters the inbox offers. Three groups in one list, because that is how
 * they read in the sidebar: everything, then per channel, then per state.
 */
export type InboxFilter =
  | "all"
  | "whatsapp"
  | "instagram"
  | "facebook"
  | "unassigned"
  | "mine"
  | "waiting_reply"
  | "follow_up"
  | "automated";

export const INBOX_FILTERS: readonly InboxFilter[] = [
  "all",
  "whatsapp",
  "instagram",
  "facebook",
  "unassigned",
  "mine",
  "waiting_reply",
  "follow_up",
  "automated",
];

export const FILTER_LABEL: Readonly<Record<InboxFilter, string>> = {
  all: "All",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  unassigned: "Unassigned",
  mine: "My conversations",
  waiting_reply: "Waiting for reply",
  follow_up: "Follow-up required",
  automated: "Automated",
};

/** The filters that are channels, so a screen can group them without a list. */
export const CHANNEL_FILTERS: Readonly<Partial<Record<InboxFilter, ChannelKey>>> =
  {
    whatsapp: "whatsapp",
    instagram: "instagram",
    facebook: "facebook",
  };
