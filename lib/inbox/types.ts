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
