/**
 * The leads, as the Monza S.A.L. app shows them (Samer, 2026-11-28: "are the numbers from MONZA AI
 * saving the customers texting us and placing them under leads?" — they were, 1,784 of them, and
 * none appeared in the CRM where Sales works). His choice: show them in the CRM READ-ONLY. Nothing
 * is copied there and MONZA AI still never writes into the CRM.
 *
 * Pure: `Person` (lib/leads/people.ts) in, the feed row out. A row carries who and where — never a
 * word a customer wrote, and never an Instagram / Facebook id as a phone (Person.phone is already
 * null for those). No owner / assignee: inquiries are shared among the Sales Team for now.
 */
import type { Person, PersonChannel } from "@/lib/leads/people";

export const LEADS_FEED_CAP = 2000;

export interface LeadFeedRow {
  id: string;
  name: string;
  /** Digits only; null on Instagram and Facebook, which never give one. */
  phone: string | null;
  channels: PersonChannel[];
  brands: string[];
  /** Cars named in the chat. */
  cars: string[];
  /** "Ad click", "Story reply", … or "Not tracked" — never "organic". */
  source: string;
  sourceDetail: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  /** The customer wrote last in at least one of their chats. */
  waiting: boolean;
  /** The kind of their newest open alert ("PRICE", "TEST_DRIVE", …), when there is one. */
  alert: string | null;
  /** The chat to open in MONZA AI's inbox: the one with the newest activity. */
  threadId: string | null;
}

const ms = (iso: string | null): number => (iso ? Date.parse(iso) || 0 : 0);

export function leadFeedRow(p: Person): LeadFeedRow {
  const threads = [...p.threads].sort((a, b) => ms(b.lastMessageAt) - ms(a.lastMessageAt));
  const newestAlert = [...p.alerts].sort((a, b) => ms(b.createdAt) - ms(a.createdAt))[0] ?? null;
  return {
    id: p.id,
    name: p.name,
    phone: p.phone,
    channels: [...new Set(threads.map((t) => t.channel))],
    brands: [...new Set(threads.map((t) => t.brand))],
    cars: p.interests.slice(0, 6),
    source: p.source,
    sourceDetail: p.sourceDetail,
    firstSeenAt: p.firstSeenAt,
    lastSeenAt: p.lastSeenAt,
    // Their last message is the newest thing in the chat: nobody has written back since.
    waiting: threads.some((t) => t.lastInboundAt !== null && ms(t.lastInboundAt) >= ms(t.lastMessageAt)),
    alert: newestAlert?.kind ?? null,
    threadId: newestAlert?.threadId ?? threads[0]?.threadId ?? null,
  };
}

/**
 * Newest activity first, at most LEADS_FEED_CAP. `total` is everybody, so a cut list says so
 * instead of passing for the whole.
 */
export function leadsFeed(people: readonly Person[]): { total: number; leads: LeadFeedRow[] } {
  const sorted = [...people].sort((a, b) => ms(b.lastSeenAt) - ms(a.lastSeenAt));
  return { total: people.length, leads: sorted.slice(0, LEADS_FEED_CAP).map(leadFeedRow) };
}
