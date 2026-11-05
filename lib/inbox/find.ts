/**
 * Finding a person from the inbox's search box — the PURE half (the read is find-server.ts).
 *
 * Samer, 2026-11-05: "search the customers from his phone number or his name from the inbox, not just the
 * customer page". The inbox's list is the browser's saved copy, and its names are what the channel showed
 * (a WhatsApp profile name, an Instagram display name). The Customers page knows more: the lead's name and
 * number from the webhook, and the CRM's customer AS THE VIEWER may see them, joined by the same Lebanese
 * mobile. This answers the search box from THAT knowledge, so a person found by their CRM name or their
 * number opens straight into their chat.
 *
 * What goes to the browser: a name, a number, the chats' ids and channels. Never a message's words.
 */

import type { Person } from "@/lib/leads/people";
import { phoneMatches, searchIntent, textContains } from "@/lib/search";

export interface FoundThread {
  threadId: string;
  channel: string;
  brand: string;
  lastMessageAt: string | null;
}

export interface FoundPerson {
  id: string;
  name: string;
  /** Digits only, or null (Instagram and Facebook never give one). */
  phone: string | null;
  /** The name is the CRM's, so the chat may be listed under another one. */
  crmName: string | null;
  threads: FoundThread[];
}

export const MAX_FOUND = 20;

/** The people a search matches, by name (theirs, the lead's or the CRM's) or by number. Chats first. */
export function findPeople(people: readonly Person[], query: string): FoundPerson[] {
  const intent = searchIntent(query);
  if (intent.kind === "empty" || intent.kind === "number_too_short") return [];
  const hits: FoundPerson[] = [];
  for (const p of people) {
    const crmName = p.crm?.name?.trim() || null;
    const matched =
      intent.kind === "number"
        ? phoneMatches(p.phone, intent.digits) || phoneMatches(p.crm?.phone ?? null, intent.digits)
        : textContains(p.name, intent.text) || textContains(crmName, intent.text);
    if (!matched) continue;
    hits.push({
      id: p.id,
      name: p.name,
      phone: p.phone,
      crmName: crmName && crmName.toLowerCase() !== p.name.toLowerCase() ? crmName : null,
      threads: [...p.threads]
        .sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""))
        .map((t) => ({ threadId: t.threadId, channel: t.channel, brand: t.brand, lastMessageAt: t.lastMessageAt })),
    });
  }
  // People with a chat to open first, then the newest chat first; CRM-only people last.
  hits.sort((a, b) => {
    if ((a.threads.length > 0) !== (b.threads.length > 0)) return a.threads.length > 0 ? -1 : 1;
    return (b.threads[0]?.lastMessageAt ?? "").localeCompare(a.threads[0]?.lastMessageAt ?? "");
  });
  return hits.slice(0, MAX_FOUND);
}
