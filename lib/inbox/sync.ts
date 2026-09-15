/**
 * THE INBOX'S SAVED COPY — the pure rules behind it.
 *
 * Samer, 2026-09-14: "every time it is loading 2000 chats on every reload …
 * one time load, the newest take the first load time, and the past to be one
 * time loading and saved." So the inbox keeps what it has read in the staff
 * member's own browser (lib/inbox/cache.ts), shows it instantly, and asks Meta
 * only for what is NEWER than what it already holds. History is paged in once,
 * in the background, and its progress is saved so a reload resumes it rather
 * than starting again.
 *
 * WHERE THE COPY LIVES. In the staff member's browser, under their own
 * sign-in — never on MONZA AI's servers, whose "keep no copy" rule
 * (lib/channels/live-map.ts, 2026-09-10) still holds. Clearing it is one
 * button on the inbox.
 *
 * PURE: no clock, no storage, no network. Every rule is a function of its
 * arguments, so every one of them is tested.
 */

import { searchConversations } from "@/lib/inbox/filters";
import type { Conversation } from "@/lib/inbox/types";
import { longDate, shiftDays } from "@/lib/format";

/** A connected account, as the inbox screen needs it. */
export interface InboxAccount {
  /** Ours: "ig-mhero". */
  id: string;
  brand: string;
  channel: string;
  /** "@mherolebanon (Instagram)". */
  label: string;
  /** "@mherolebanon", "M HERO Lebanon". */
  handle: string;
}

/* ── Brands ──────────────────────────────────────────────────────────────── */

const BRAND_LABEL: Readonly<Record<string, string>> = {
  voyah: "VOYAH",
  mhero: "MHERO",
  monza: "MONZA SAL",
};

/** The order brand tabs appear in. Unknown brands follow, alphabetically. */
const BRAND_ORDER = ["voyah", "mhero", "monza"];

export function brandLabel(brand: string | null): string {
  if (!brand) return "Monza";
  return BRAND_LABEL[brand] ?? brand.toUpperCase();
}

export function orderBrands(brands: Iterable<string>): string[] {
  const unique = [...new Set(brands)];
  return unique.sort((a, b) => {
    const ia = BRAND_ORDER.indexOf(a);
    const ib = BRAND_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b);
  });
}

/** "fb-mhero~t_1" → "fb-mhero". The account half of a live thread id. */
export function accountIdOf(conversationId: string): string | null {
  const at = conversationId.indexOf("~");
  return at > 0 ? conversationId.slice(0, at) : null;
}

/**
 * Which brand a conversation belongs to: the brand of the ACCOUNT it arrived
 * at (rule 1), never anything read from the text. Rows saved before the field
 * existed fall back to the account half of their id.
 */
export function brandOf(c: Conversation, accounts: readonly InboxAccount[]): string | null {
  if (c.brand) return c.brand;
  const id = c.accountId ?? accountIdOf(c.id);
  return accounts.find((a) => a.id === id)?.brand ?? null;
}

/* ── Merging what Meta sends into what is saved ──────────────────────────── */

/** The names live-map.ts falls back to when Meta sends a bare list. */
const PLACEHOLDER_NAMES = new Set(["Instagram user", "Facebook user"]);

/**
 * One saved row and one fresh row of the same conversation → the row to keep.
 *
 *   - An OLDER fresh row never replaces a newer saved one (a slow page can
 *     arrive after a quicker one).
 *   - A lighter list (no previews, no names — Meta's answer when an account is
 *     slow) never erases a preview or a real name we already have.
 */
export function mergeOne(old: Conversation | undefined, fresh: Conversation): Conversation {
  if (!old) return fresh;
  if (fresh.lastMessage.at < old.lastMessage.at) return old;
  const keepName =
    PLACEHOLDER_NAMES.has(fresh.customerName) && !PLACEHOLDER_NAMES.has(old.customerName);
  const keepPreview =
    fresh.lastMessage.at === old.lastMessage.at &&
    fresh.lastMessage.text === "" &&
    old.lastMessage.text !== "";
  if (!keepName && !keepPreview) return fresh;
  return {
    ...fresh,
    ...(keepName ? { customerName: old.customerName, channelAddress: old.channelAddress } : {}),
    ...(keepPreview ? { lastMessage: old.lastMessage, status: old.status } : {}),
  };
}

function sameRow(a: Conversation, b: Conversation): boolean {
  return (
    a.customerName === b.customerName &&
    a.channelAddress === b.channelAddress &&
    a.status === b.status &&
    a.brand === b.brand &&
    a.accountId === b.accountId &&
    a.lastMessage.at === b.lastMessage.at &&
    a.lastMessage.text === b.lastMessage.text &&
    a.lastMessage.direction === b.lastMessage.direction
  );
}

/**
 * Fold a page from Meta into the saved set. `changed` is only what actually
 * differs, so a reload that finds nothing new writes nothing to storage.
 */
export function mergeConversations(
  existing: ReadonlyMap<string, Conversation>,
  fresh: readonly Conversation[]
): { merged: Map<string, Conversation>; changed: Conversation[] } {
  const merged = new Map(existing);
  const changed: Conversation[] = [];
  for (const f of fresh) {
    const old = merged.get(f.id);
    const next = mergeOne(old, f);
    if (old && sameRow(old, next)) continue;
    merged.set(f.id, next);
    changed.push(next);
  }
  return { merged, changed };
}

/**
 * THE STOP RULE. Meta lists conversations newest-activity first, so once a
 * page contains a conversation we already hold, unchanged, everything after
 * it is older and already saved. This is what turns a reload from 2,000
 * conversations into one page per account.
 */
export function reachedKnown(
  existing: ReadonlyMap<string, Conversation>,
  page: readonly Conversation[]
): boolean {
  return page.some((c) => {
    const old = existing.get(c.id);
    return old !== undefined && old.lastMessage.at >= c.lastMessage.at;
  });
}

/* ── Unread and alerts ───────────────────────────────────────────────────── */

/**
 * Unread = the customer wrote after this person last opened the conversation.
 *
 * Meta's list says nothing about what we have read, so it is kept per person
 * in their browser. `baselineAt` is the moment the saved copy was first
 * created: without it, years of history would arrive as 2,000 unread.
 * A row with no preview (a lighter list) cannot say who wrote last, so it is
 * never counted — better one missed dot than a wall of false ones.
 */
export function isUnread(
  c: Conversation,
  seenAt: string | undefined,
  baselineAt: string
): boolean {
  if (c.lastMessage.direction !== "in" || c.lastMessage.text === "") return false;
  const since = seenAt !== undefined && seenAt > baselineAt ? seenAt : baselineAt;
  return c.lastMessage.at > since;
}

/**
 * Conversations in a fresh page whose customer has written something NEW
 * since the saved copy — what an alert is raised for. Nothing older than
 * `after` counts, so the first check of the day does not ring for everything
 * that arrived overnight (those are simply unread).
 */
export function arrivals(
  existing: ReadonlyMap<string, Conversation>,
  fresh: readonly Conversation[],
  after: string
): Conversation[] {
  return fresh.filter((c) => {
    if (c.lastMessage.direction !== "in" || c.lastMessage.text === "") return false;
    if (c.lastMessage.at <= after) return false;
    const before = existing.get(c.id)?.lastMessage.at ?? "";
    return before < c.lastMessage.at;
  });
}

/* ── What the list shows ─────────────────────────────────────────────────── */

export type ShowFilter = "all" | "unread" | "needs_reply" | "waiting";

export const SHOW_FILTERS: readonly ShowFilter[] = ["all", "unread", "needs_reply", "waiting"];

export const SHOW_LABEL: Readonly<Record<ShowFilter, string>> = {
  all: "Everything",
  unread: "Unread",
  needs_reply: "Needs a reply",
  waiting: "Waiting on customer",
};

export interface ViewFilter {
  /** A brand id, or "all". */
  brand: string;
  /** A channel, or "all". */
  channel: string;
  show: ShowFilter;
  /** Inclusive local days, "YYYY-MM-DD", or "" for open-ended. */
  from: string;
  to: string;
  search: string;
}

export const EMPTY_VIEW: ViewFilter = {
  brand: "all",
  channel: "all",
  show: "all",
  from: "",
  to: "",
  search: "",
};

export function isFiltered(v: ViewFilter): boolean {
  return (
    v.brand !== EMPTY_VIEW.brand ||
    v.channel !== EMPTY_VIEW.channel ||
    v.show !== EMPTY_VIEW.show ||
    v.from !== "" ||
    v.to !== "" ||
    v.search.trim() !== ""
  );
}

export interface ViewContext {
  accounts: readonly InboxAccount[];
  seen: Readonly<Record<string, string>>;
  baselineAt: string;
  /** The local day an ISO instant falls on — injected, so this file never reads a clock. */
  dayOf: (iso: string) => string;
}

export function matchesView(c: Conversation, v: ViewFilter, ctx: ViewContext): boolean {
  if (v.brand !== "all" && brandOf(c, ctx.accounts) !== v.brand) return false;
  if (v.channel !== "all" && c.channel !== v.channel) return false;
  if (v.show === "unread" && !isUnread(c, ctx.seen[c.id], ctx.baselineAt)) return false;
  if (v.show === "needs_reply" && !(c.lastMessage.direction === "in" && c.lastMessage.text !== "")) {
    return false;
  }
  if (v.show === "waiting" && c.lastMessage.direction !== "out") return false;
  if (v.from !== "" || v.to !== "") {
    // A range typed backwards is still a range.
    const [lo, hi] = v.from !== "" && v.to !== "" && v.from > v.to ? [v.to, v.from] : [v.from, v.to];
    const day = ctx.dayOf(c.lastMessage.at);
    if (lo !== "" && day < lo) return false;
    if (hi !== "" && day > hi) return false;
  }
  return true;
}

/** Newest activity first; ties break on id so the order never reshuffles. */
export function sortNewest(list: readonly Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    if (a.lastMessage.at !== b.lastMessage.at) return a.lastMessage.at < b.lastMessage.at ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Filter, search and sort — what the list renders. */
export function filterView(
  list: readonly Conversation[],
  v: ViewFilter,
  ctx: ViewContext
): Conversation[] {
  const kept = list.filter((c) => matchesView(c, v, ctx));
  return sortNewest(v.search.trim() === "" ? kept : searchConversations(kept, v.search));
}

/* ── Dates ───────────────────────────────────────────────────────────────── */

export type DatePreset = "today" | "7d" | "30d" | "90d";

export const DATE_PRESETS: readonly { id: DatePreset; label: string; back: number }[] = [
  { id: "today", label: "Today", back: 0 },
  { id: "7d", label: "Last 7 days", back: 6 },
  { id: "30d", label: "Last 30 days", back: 29 },
  { id: "90d", label: "Last 3 months", back: 89 },
];

export function presetRange(preset: DatePreset, today: string): { from: string; to: string } {
  const p = DATE_PRESETS.find((x) => x.id === preset) ?? DATE_PRESETS[0];
  return { from: shiftDays(today, -p.back), to: today };
}

/** "Today", "Yesterday", or "12 September 2026". */
export function dayLabel(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === shiftDays(today, -1)) return "Yesterday";
  return longDate(day);
}

export interface DayGroup<T> {
  day: string;
  label: string;
  items: T[];
}

/**
 * Consecutive items that fall on the same local day, under one heading. The
 * input is already in order (the list newest first, a thread oldest first),
 * so a day's items are contiguous.
 */
export function groupByDay<T>(
  items: readonly T[],
  atOf: (item: T) => string,
  dayOf: (iso: string) => string,
  today: string
): DayGroup<T>[] {
  const out: DayGroup<T>[] = [];
  for (const item of items) {
    const day = dayOf(atOf(item));
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(item);
    else out.push({ day, label: dayLabel(day, today), items: [item] });
  }
  return out;
}

/* ── Small display helpers ───────────────────────────────────────────────── */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** The browser's local day for an instant. Client-side only — it reads the time zone. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "14:05", local. Client-side only. */
export function localClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "RK" for "Rami Kanaan", "RA" for "@rami.k". */
export function initialsOf(name: string): string {
  const parts = name
    .replace(/^@/, "")
    .replace(/[._\-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((p) => p !== "");
  if (parts.length === 0) return "?";
  const first = parts[0];
  const second = parts.length > 1 ? parts[parts.length - 1][0] : first[1];
  return `${first[0] ?? ""}${second ?? ""}`.toUpperCase();
}

/** "2,134". */
export function count(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
