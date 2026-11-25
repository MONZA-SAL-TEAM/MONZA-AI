/**
 * WHO IS GENUINELY WAITING FOR A REPLY, AND FOR HOW LONG (Samer, 2026-11-25).
 *
 * Built from the verdicts of reconcile.ts — only `waiting` chats: the customer wrote last, in a
 * chat whose both sides we can see. Pure.
 *
 * WhatsApp answers a free reply only within 24 hours of the customer's last message; after that
 * the only way to write is a paid template. So "inside the window" is who can still be answered
 * for free — the ones to do first.
 */

import { isHighIntent, type ConversationClass } from "@/lib/alerts/intent";

export const WINDOW_HOURS = 24;

export interface WaitingInput {
  conversationId: string;
  /** The customer's first unanswered message. */
  waitingSince: string;
  /** The customer's latest message (the 24-hour window counts from here). */
  lastCustomerAt: string;
  /** Nobody at Monza has ever written in this chat. */
  neverAnswered: boolean;
  class: ConversationClass;
  ownerId: string | null;
  ownerName: string | null;
}

export interface WaitingRow extends WaitingInput {
  waitingHours: number;
  inWindow: boolean;
  /** Hours left before the free-reply window shuts; 0 once it has. */
  windowHoursLeft: number;
  highIntent: boolean;
}

const HOUR = 3_600_000;

export function waitingRows(inputs: readonly WaitingInput[], nowMs: number): WaitingRow[] {
  const rows = inputs.map((i): WaitingRow => {
    const sinceLast = (nowMs - Date.parse(i.lastCustomerAt)) / HOUR;
    return {
      ...i,
      waitingHours: Math.max(0, Math.floor((nowMs - Date.parse(i.waitingSince)) / HOUR)),
      inWindow: sinceLast < WINDOW_HOURS,
      windowHoursLeft: Math.max(0, Math.ceil(WINDOW_HOURS - sinceLast)),
      highIntent: isHighIntent(i.class),
    };
  });
  // First: who can still be answered for free, the most valuable of them, the one about to lose
  // the window. Then the rest, longest wait first.
  return rows.sort(
    (a, b) =>
      Number(b.inWindow) - Number(a.inWindow) ||
      Number(b.highIntent) - Number(a.highIntent) ||
      (a.inWindow ? a.windowHoursLeft - b.windowHoursLeft : b.waitingHours - a.waitingHours)
  );
}

export interface WaitingSummary {
  total: number;
  inWindow: number;
  outsideWindow: number;
  highIntent: number;
  highIntentInWindow: number;
  /** Customers nobody has ever spoken to. */
  newCustomers: number;
  existingConversations: number;
  unowned: number;
  oldestHours: number;
  /** Waiting `RECENT_WAIT_DAYS` or less: who can still reasonably be answered. */
  recent: number;
  /** Waiting longer: to be reviewed and closed with a reason, not put on a phone every morning. */
  older: number;
  byClass: Partial<Record<ConversationClass, number>>;
}

/**
 * A wait longer than this is a backlog to review, not a morning's work (Samer, 2026-11-25: 74
 * "buyers awaiting a reply" on a lock screen, 47 of them over a week old, "will stop meaning
 * anything"). The morning brief counts the recent ones.
 */
export const RECENT_WAIT_DAYS = 7;

/** Counts only — what the morning brief's feed gives the Monza app: no name, no chat. */
export function summariseWaiting(rows: readonly WaitingRow[]): WaitingSummary {
  const byClass: Partial<Record<ConversationClass, number>> = {};
  for (const r of rows) byClass[r.class] = (byClass[r.class] ?? 0) + 1;
  const recent = rows.filter((r) => r.waitingHours <= RECENT_WAIT_DAYS * 24).length;
  return {
    total: rows.length,
    recent,
    older: rows.length - recent,
    inWindow: rows.filter((r) => r.inWindow).length,
    outsideWindow: rows.filter((r) => !r.inWindow).length,
    highIntent: rows.filter((r) => r.highIntent).length,
    highIntentInWindow: rows.filter((r) => r.highIntent && r.inWindow).length,
    newCustomers: rows.filter((r) => r.neverAnswered).length,
    existingConversations: rows.filter((r) => !r.neverAnswered).length,
    unowned: rows.filter((r) => !r.ownerId).length,
    oldestHours: rows.reduce((m, r) => Math.max(m, r.waitingHours), 0),
    byClass,
  };
}

export interface OwnerLoad {
  ownerId: string | null;
  ownerName: string;
  waiting: number;
  highIntentWaiting: number;
  /** Waiting longer than `overdueHours`. */
  overdue: number;
  oldestHours: number;
}

export const OVERDUE_HOURS = 24;

/** Per salesperson: who is behind. "Nobody" is a row of its own — unowned work stays visible. */
export function loadByOwner(rows: readonly WaitingRow[], overdueHours: number = OVERDUE_HOURS): OwnerLoad[] {
  const by = new Map<string, OwnerLoad>();
  for (const r of rows) {
    const key = r.ownerId ?? "";
    const cur = by.get(key) ?? { ownerId: r.ownerId, ownerName: r.ownerId ? (r.ownerName ?? "Unnamed") : "Nobody", waiting: 0, highIntentWaiting: 0, overdue: 0, oldestHours: 0 };
    cur.waiting += 1;
    if (r.highIntent) cur.highIntentWaiting += 1;
    if (r.waitingHours >= overdueHours) cur.overdue += 1;
    cur.oldestHours = Math.max(cur.oldestHours, r.waitingHours);
    by.set(key, cur);
  }
  return [...by.values()].sort((a, b) => b.highIntentWaiting - a.highIntentWaiting || b.overdue - a.overdue || b.waiting - a.waiting);
}
