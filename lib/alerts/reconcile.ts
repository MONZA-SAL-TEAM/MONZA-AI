/**
 * WHAT IS EACH OPEN ALERT, REALLY? (Samer, 2026-11-25: "every alert must represent a real issue that
 * someone can take action on today".)
 *
 * Audited that day: 537 alerts were open and most were not real.
 *   - 81 were second alerts in a chat that already had one: "one open alert per chat" only looked
 *     back 24 hours (sales-ops.ts), so a chat left open for a day grew another.
 *   - 114 WhatsApp chats had been answered: alerts close when a person replies, but that check ran
 *     only when somebody opened the list, and only over its newest 100 rows.
 *   - 182 were Instagram / Facebook, where a reply typed in the Instagram app is invisible to us.
 *   - 115 were customers silent for over a month.
 *
 * This file is the ONE meaning of an alert's state, used by the nightly job, the review screen and
 * the morning brief's feed. Pure: facts in, verdicts out; no database, no clock of its own.
 *
 * A verdict needs EVIDENCE. "Answered" means a person's message we can see is later than the alert
 * (never the bot's own). Where we cannot see our side of the chat, the verdict is `unverified` —
 * never "answered", and never "waiting" either.
 */

import { MANUAL_CLOSE } from "@/lib/wasales/alerts";
import type { AlertKind } from "@/lib/wasales/actions";

export type Verdict =
  /** The customer wrote last and nobody has answered. Actionable today. */
  | "waiting"
  /** A person answered, but the work (a drive to arrange, a call, a sale) still needs its outcome. */
  | "follow_up"
  /** A person answered after the alert; nothing more to do. Closes by itself. */
  | "answered"
  /** A newer alert is open in the same chat; its reasons are kept on that one. Closes by itself. */
  | "duplicate"
  /** We cannot see our side of this chat (Instagram / Facebook), so nobody knows. */
  | "unverified"
  /** The customer has been silent longer than `historicalDays` and was never answered. */
  | "historical";

export interface AlertFact {
  id: string;
  conversationId: string;
  kind: AlertKind;
  tags: readonly AlertKind[];
  createdAt: string;
}

export interface ChatFact {
  conversationId: string;
  /** True for WhatsApp: both sides of the chat are stored here. */
  stored: boolean;
  /** The customer's latest message. */
  lastCustomerAt: string | null;
  /** The latest message a PERSON at Monza sent (never the bot), from stored messages or Meta's history. */
  lastPersonAt: string | null;
  /** The customer's first message that no person has answered yet; null when we spoke last. */
  waitingSince: string | null;
  /** Has a person EVER written in this chat? False = a customer nobody has spoken to. */
  everAnswered: boolean;
}

export const RECONCILE_RULES = {
  /** A customer silent this long, never answered, is history — reviewed, not chased. */
  historicalDays: 30,
} as const;

export interface AlertVerdict {
  alertId: string;
  conversationId: string;
  verdict: Verdict;
  /** A closed vocabulary: why. Never a customer's word. */
  evidence: "newer_alert_open" | "person_replied_after" | "person_replied_outcome_open" | "customer_wrote_last" | "our_side_not_visible" | "silent_over_limit";
  /** For a duplicate: the alert that stays open. */
  survivorId?: string;
}

const ms = (iso: string | null): number => (iso ? Date.parse(iso) : NaN);
const kindsOf = (a: AlertFact): AlertKind[] => [a.kind, ...a.tags];

export function isManualClose(a: AlertFact): boolean {
  return kindsOf(a).some((k) => MANUAL_CLOSE.includes(k));
}

/** One verdict per open alert. Alerts whose chat is unknown are left out (nothing can be said). */
export function reconcileAlerts(
  alerts: readonly AlertFact[],
  chats: ReadonlyMap<string, ChatFact>,
  nowMs: number,
  rules: { historicalDays: number } = RECONCILE_RULES
): AlertVerdict[] {
  const byChat = new Map<string, AlertFact[]>();
  for (const a of alerts) {
    const list = byChat.get(a.conversationId);
    if (list) list.push(a);
    else byChat.set(a.conversationId, [a]);
  }
  const out: AlertVerdict[] = [];
  for (const [conversationId, list] of byChat) {
    const chat = chats.get(conversationId);
    if (!chat) continue;
    const newestFirst = [...list].sort((x, y) => ms(y.createdAt) - ms(x.createdAt));
    const survivor = newestFirst[0];
    for (const dup of newestFirst.slice(1)) {
      out.push({ alertId: dup.id, conversationId, verdict: "duplicate", evidence: "newer_alert_open", survivorId: survivor.id });
    }
    // The chat's one alert carries every open reason of the chat, so a hand-closed kind on an older
    // duplicate is not lost when that duplicate goes.
    const merged: AlertFact = { ...survivor, tags: [...new Set(newestFirst.flatMap(kindsOf))] };
    out.push({ alertId: survivor.id, conversationId, ...verdictOf(merged, chat, ms(newestFirst[newestFirst.length - 1].createdAt), nowMs, rules.historicalDays) });
  }
  return out;
}

function verdictOf(
  alert: AlertFact,
  chat: ChatFact,
  firstRaisedMs: number,
  nowMs: number,
  historicalDays: number
): Pick<AlertVerdict, "verdict" | "evidence"> {
  const person = ms(chat.lastPersonAt);
  const customer = ms(chat.lastCustomerAt);
  const repliedAfterAlert = Number.isFinite(person) && person > firstRaisedMs;
  const weSpokeLast = Number.isFinite(person) && (!Number.isFinite(customer) || person >= customer);

  if (repliedAfterAlert && weSpokeLast) {
    return isManualClose(alert)
      ? { verdict: "follow_up", evidence: "person_replied_outcome_open" }
      : { verdict: "answered", evidence: "person_replied_after" };
  }
  // The customer wrote last (or we never wrote). Where our side is not stored, a reply typed in
  // the Instagram / Facebook app would look exactly like this — so it is not "waiting".
  if (!chat.stored) return { verdict: "unverified", evidence: "our_side_not_visible" };
  const silentDays = Number.isFinite(customer) ? (nowMs - customer) / 86_400_000 : Infinity;
  if (silentDays > historicalDays) return { verdict: "historical", evidence: "silent_over_limit" };
  return { verdict: "waiting", evidence: "customer_wrote_last" };
}

export type VerdictCounts = Record<Verdict, number> & { total: number; chats: number };

export function countVerdicts(verdicts: readonly AlertVerdict[]): VerdictCounts {
  const c: VerdictCounts = { waiting: 0, follow_up: 0, answered: 0, duplicate: 0, unverified: 0, historical: 0, total: verdicts.length, chats: 0 };
  for (const v of verdicts) c[v.verdict] += 1;
  c.chats = new Set(verdicts.map((v) => v.conversationId)).size;
  return c;
}

/** What the job closes by itself, each with the reason stored on the alert. Everything else stays for a person. */
export const AUTO_CLOSE: Readonly<Partial<Record<Verdict, string>>> = {
  answered: "auto: a person replied in the chat",
  duplicate: "auto: a newer alert is open in the same chat",
};

/** The reasons a person may give when closing alerts in bulk (a closed list, kept with the alert). */
export const CLOSE_REASONS = {
  handled: "Handled",
  answered_elsewhere: "Answered in the Instagram / Facebook app or by phone",
  no_longer_relevant: "No longer relevant",
  not_a_customer: "Not a customer (supplier, spam, wrong number)",
  duplicate: "Duplicate",
} as const;
export type CloseReason = keyof typeof CLOSE_REASONS;
export const isCloseReason = (v: unknown): v is CloseReason => typeof v === "string" && Object.prototype.hasOwnProperty.call(CLOSE_REASONS, v);
