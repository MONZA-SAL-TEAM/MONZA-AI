/**
 * The rules of the Instagram / Facebook history read — PURE, tested in tests/insights-backfill.test.ts.
 * The job is lib/insights/meta-backfill.ts.
 */

import type { InboxMessage } from "@/lib/inbox/types";
import { NO_TEXT } from "@/lib/channels/live-map";
import type { Turn } from "@/lib/wasales/reader";

/** Above this share of Meta's rate limit the read stops for the day: the inbox shares that limit. */
export const USAGE_STOP_PERCENT = 75;
/** Graph calls one run may make. */
export const MAX_CALLS_PER_RUN = 60;

/** Meta's answers that mean "stop and come back later", never "try again now". */
const STOP_CODES = new Set(["meta_4", "meta_17", "meta_32", "meta_613", "meta_-2_2534084"]);

export type StopReason = { stop: true; state: "blocked"; code: string } | { stop: false };

/** Why a run should stop, given what it has seen so far. */
export function shouldStop(input: { calls: number; usage: number | null; errorCode: string | null; elapsedMs: number; budgetMs: number }): StopReason {
  if (input.errorCode) return { stop: true, state: "blocked", code: STOP_CODES.has(input.errorCode) ? input.errorCode : input.errorCode.slice(0, 60) };
  if (input.usage !== null && input.usage > USAGE_STOP_PERCENT) return { stop: true, state: "blocked", code: "usage_over_75" };
  if (input.calls >= MAX_CALLS_PER_RUN) return { stop: true, state: "blocked", code: "call_budget" };
  return { stop: false };
}

/** A thread is skipped when Meta says it has not changed since it was last read. */
export function unchanged(known: { meta_updated_at: string | null } | null, updatedAt: string | null): boolean {
  return Boolean(known && updatedAt && known.meta_updated_at && Date.parse(known.meta_updated_at) === Date.parse(updatedAt));
}

/** Meta's messages as reader turns: the customer's are read, ours are context. Words stay in memory. */
export function turnsOf(messages: readonly InboxMessage[]): Turn[] {
  return messages.map((m) => {
    const placeholder = m.text === NO_TEXT;
    return {
      author: m.direction === "in" ? "customer" : "staff",
      text: placeholder ? "" : m.text,
      hasMedia: placeholder || (m.attachments?.length ?? 0) > 0,
      at: m.at,
      externalMessageId: m.id,
    };
  });
}

/**
 * Rule 21: a 200 with nothing in it is NOT "this account has no chats". On the very first page of a read
 * it is reported as unknown, so nobody reads a permission gap as an empty inbox.
 */
export function emptyFirstPage(isFirstPage: boolean, threads: number, next: string | null): boolean {
  return isFirstPage && threads === 0 && next === null;
}
