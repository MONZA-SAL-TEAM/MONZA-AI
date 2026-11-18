/**
 * How often an open screen asks the server again — PURE (the Vercel bill, 2026-10-21).
 *
 * Every refresh is a function invocation on Vercel, and most of them also wait seconds on Meta. Before this,
 * the inbox asked on fixed timers whether anyone was looking or not: a thread every 15 s, the alerts every
 * 30 s, the owners and every account's newest page every minute — in a tab left behind another window all
 * night, the same as in front of a salesperson. That is most of the invocations and memory the team was
 * billed for.
 *
 * Now each refresh has three speeds: the screen is in front of someone who is using it (ACTIVE), it is in
 * front but nobody has touched it for IDLE_AFTER_MS (IDLE), or it is behind another tab or app (HIDDEN).
 * `null` means "do not ask at all": the screen catches up the moment it is looked at again.
 */

export interface PollRule {
  /** In front and in use. */
  active: number;
  /** In front, untouched for IDLE_AFTER_MS. */
  idle: number;
  /** Behind another tab or app; null = not at all until it is in front again. */
  hidden: number | null;
}

/** Five minutes with no click, key, scroll or touch is "left open", not "in use". */
export const IDLE_AFTER_MS = 5 * 60_000;

export const POLL = {
  /** The newest page of each account's conversations. Hidden keeps a slow check so a desktop notification still comes. */
  inboxList: { active: 60_000, idle: 3 * 60_000, hidden: 5 * 60_000 },
  /** The open conversation, live from Meta. Nobody reads it while hidden; it reloads on return. */
  thread: { active: 15_000, idle: 2 * 60_000, hidden: null },
  /** "Client needs a salesperson". Hidden keeps a slow check so the desktop notification still comes. */
  salesAlerts: { active: 30_000, idle: 2 * 60_000, hidden: 5 * 60_000 },
  /** Who owns which lead — changes when someone takes one, which is rare. */
  owners: { active: 2 * 60_000, idle: 5 * 60_000, hidden: null },
  /** Which car each chat is about. */
  cars: { active: 5 * 60_000, idle: 10 * 60_000, hidden: null },
  /** The test-drive calendar. */
  testDrives: { active: 60_000, idle: 5 * 60_000, hidden: null },
} as const satisfies Record<string, PollRule>;

/** The wait before the next ask, or null for none until the screen is in front again. */
export function pollDelay(rule: PollRule, visible: boolean, lastInputAt: number, now: number): number | null {
  if (!visible) return rule.hidden;
  return now - lastInputAt >= IDLE_AFTER_MS ? rule.idle : rule.active;
}

/**
 * Coming back into view: ask at once only if the last answer is older than an ACTIVE wait — a quick glance at
 * another tab does not cost a request.
 */
export function staleOnReturn(rule: PollRule, lastRunAt: number, now: number): boolean {
  return now - lastRunAt >= rule.active;
}
