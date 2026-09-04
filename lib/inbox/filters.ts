/**
 * Inbox filtering, sorting and counting — pure functions.
 *
 * Kept out of the screen so the same rules can be tested, reused by a future
 * API route, and relied on by the counts in the sidebar. A filter whose count
 * disagrees with the list it opens is the classic inbox bug; here both come
 * from this one place.
 */

import type { ChannelKey } from "@/lib/domain/types";
import { numberContains, searchIntent, textContains } from "@/lib/search";
import {
  CHANNEL_FILTERS,
  INBOX_FILTERS,
  type Conversation,
  type InboxFilter,
} from "@/lib/inbox/types";

/** Who is looking — needed by "My conversations". */
export interface Viewer {
  staffId: string;
}

/**
 * Does this conversation belong in this filter?
 *
 * Closed conversations are excluded everywhere except "All", so a tidy inbox
 * is actually tidy — but nothing is ever hidden outright.
 */
export function matchesFilter(
  c: Conversation,
  filter: InboxFilter,
  viewer: Viewer
): boolean {
  if (filter === "all") return true;
  if (c.status === "closed") return false;

  const channel: ChannelKey | undefined = CHANNEL_FILTERS[filter];
  if (channel) return c.channel === channel;

  switch (filter) {
    case "unassigned":
      return c.assignedTo === null;
    case "mine":
      return c.assignedTo === viewer.staffId;
    case "waiting_reply":
      return c.status === "waiting_reply";
    case "follow_up":
      return c.status === "follow_up";
    case "automated":
      return c.hasAutomatedMessage;
    default:
      return true;
  }
}

/**
 * Newest activity first — an inbox is read from the top. Ties break on
 * conversation id so the order is total and stable (two messages can share a
 * timestamp, and a list that reshuffles on every render is unusable).
 */
export function sortConversations(
  conversations: readonly Conversation[]
): Conversation[] {
  return [...conversations].sort((a, b) => {
    if (a.lastMessage.at !== b.lastMessage.at) {
      return a.lastMessage.at < b.lastMessage.at ? 1 : -1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Filter and sort in one step — what a list view actually wants. */
export function applyFilter(
  conversations: readonly Conversation[],
  filter: InboxFilter,
  viewer: Viewer
): Conversation[] {
  return sortConversations(
    conversations.filter((c) => matchesFilter(c, filter, viewer))
  );
}

/** How many conversations each filter would show. Drives the sidebar badges. */
export function countsByFilter(
  conversations: readonly Conversation[],
  viewer: Viewer
): Record<InboxFilter, number> {
  const counts = {} as Record<InboxFilter, number>;
  for (const filter of INBOX_FILTERS) {
    counts[filter] = conversations.filter((c) =>
      matchesFilter(c, filter, viewer)
    ).length;
  }
  return counts;
}

/** Unread messages across the conversations a filter would show. */
export function unreadIn(
  conversations: readonly Conversation[],
  filter: InboxFilter,
  viewer: Viewer
): number {
  return conversations
    .filter((c) => matchesFilter(c, filter, viewer))
    .reduce((sum, c) => sum + c.unreadCount, 0);
}

/**
 * Free-text search across the customer's name and their address on the
 * channel. Digits are compared with separators stripped, so "+961 3 100 001"
 * finds a thread stored as "9613100001".
 */
export function searchConversations(
  conversations: readonly Conversation[],
  search: string
): Conversation[] {
  const intent = searchIntent(search);
  if (intent.kind === "empty") return [...conversations];
  if (intent.kind === "number_too_short") return [];

  return conversations.filter((c) => {
    if (intent.kind === "number") {
      return numberContains(c.channelAddress, intent.digits);
    }
    return (
      textContains(c.customerName, intent.text) ||
      textContains(c.channelAddress, intent.text) ||
      textContains(c.lastMessage.text, intent.text)
    );
  });
}

/** All conversations with one person, across every channel. */
export function conversationsForCustomer(
  conversations: readonly Conversation[],
  customerId: string
): Conversation[] {
  return sortConversations(
    conversations.filter((c) => c.customerId === customerId)
  );
}
