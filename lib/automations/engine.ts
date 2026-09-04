/**
 * The automation engine: given what happened and what is switched on, decide
 * what should be said.
 *
 * PURE. No clock, no randomness, no I/O. The same events and the same
 * automations always produce the same plan — which is what makes it testable,
 * and what lets the Automations screen show a person exactly what WOULD happen
 * before anything is connected.
 *
 * The engine never sends. It produces a plan; a separate executor performs it
 * and writes the history. Keeping those apart means a bug in sending can never
 * corrupt the decision, and a dry run is the same code path as the real one.
 *
 * ORDER OF CHECKS (each one can only skip, never send):
 *   1. Is the automation switched on?          -> automation_disabled
 *   2. Does it react to this trigger?          -> trigger_mismatch
 *   3. Does the message action have a template -> no_template / unknown_template
 *      that exists?
 *   4. Has this exact thing already been done? -> already_done
 */

import type {
  Automation,
  DomainEvent,
  EvaluationResult,
  ExecutionOutcome,
  ExecutionRecord,
  PlannedAction,
  SkippedAction,
} from "@/lib/automations/types";

/**
 * The identity of "this automation doing this action for this occurrence".
 *
 * Derived only from stable facts. Two runs over the same event produce the same
 * key, so the second is recognised as already done. The action INDEX is part of
 * it so an automation with two actions (message the customer AND tell the team)
 * tracks each separately — a failed staff notification must not block a retry
 * without re-sending the customer message.
 */
export function idempotencyKeyFor(
  automationId: string,
  eventId: string,
  actionIndex: number
): string {
  return `${automationId}|${eventId}|${actionIndex}`;
}

/** Does this automation react to this event? */
export function triggerMatches(a: Automation, e: DomainEvent): boolean {
  if (a.trigger.kind !== e.kind) return false;

  // A due-soon automation set to 7 days must not fire on the 3-day event. The
  // window is carried on the event's data by the event builder.
  if (a.trigger.kind === "installment.due_soon") {
    const eventDays = e.data.daysBefore;
    if (typeof eventDays === "number" && a.trigger.daysBefore !== undefined) {
      return eventDays === a.trigger.daysBefore;
    }
  }
  if (a.trigger.kind === "installment.overdue_extended") {
    const eventDays = e.data.daysOverdue;
    if (typeof eventDays === "number" && a.trigger.daysAfter !== undefined) {
      return eventDays >= a.trigger.daysAfter;
    }
  }
  return true;
}

export interface EvaluateOptions {
  /**
   * Idempotency keys already carried out. Anything in here is skipped —
   * this is the duplicate defence, and it is the caller's job to supply the
   * real set from the execution history.
   */
  alreadyDone?: ReadonlySet<string>;
  /** Template ids that actually exist. Omit to skip the existence check. */
  knownTemplates?: ReadonlySet<string>;
}

/**
 * Decide what should happen for a batch of events.
 *
 * Every automation is considered against every event; the result separates
 * what would happen from what was skipped and why, because "nothing happened"
 * with no explanation is the thing that makes automation untrustworthy.
 */
export function evaluate(
  events: readonly DomainEvent[],
  automations: readonly Automation[],
  options: EvaluateOptions = {}
): EvaluationResult {
  const alreadyDone = options.alreadyDone ?? new Set<string>();
  const knownTemplates = options.knownTemplates;

  const planned: PlannedAction[] = [];
  const skipped: SkippedAction[] = [];
  // Guards against duplicates WITHIN one batch too — the same occurrence
  // appearing twice in the input must still only be planned once.
  const plannedKeys = new Set<string>();

  for (const event of events) {
    for (const automation of automations) {
      if (!automation.enabled) {
        // Only report a disabled automation against events it would otherwise
        // have handled, or every screen fills with irrelevant skips.
        if (automation.trigger.kind === event.kind) {
          skipped.push({
            automationId: automation.id,
            eventId: event.id,
            reason: "automation_disabled",
          });
        }
        continue;
      }

      if (!triggerMatches(automation, event)) continue;

      automation.actions.forEach((action, index) => {
        const idempotencyKey = idempotencyKeyFor(
          automation.id,
          event.id,
          index
        );

        if (action.kind === "send_message") {
          if (!action.templateId) {
            skipped.push({
              automationId: automation.id,
              eventId: event.id,
              reason: "no_template",
            });
            return;
          }
          if (knownTemplates && !knownTemplates.has(action.templateId)) {
            skipped.push({
              automationId: automation.id,
              eventId: event.id,
              reason: "unknown_template",
            });
            return;
          }
        }

        if (alreadyDone.has(idempotencyKey) || plannedKeys.has(idempotencyKey)) {
          skipped.push({
            automationId: automation.id,
            eventId: event.id,
            reason: "already_done",
          });
          return;
        }

        plannedKeys.add(idempotencyKey);
        planned.push({
          idempotencyKey,
          automationId: automation.id,
          eventId: event.id,
          customerId: event.customerId,
          action,
          event,
        });
      });
    }
  }

  return { planned, skipped };
}

/* ── Execution history ───────────────────────────────────────────────────── */

/** Record one attempt. `at` is supplied by the caller; this module has no clock. */
export function recordAttempt(
  planned: PlannedAction,
  outcome: ExecutionOutcome,
  detail: string,
  at: string,
  attempt = 1
): ExecutionRecord {
  return {
    idempotencyKey: planned.idempotencyKey,
    automationId: planned.automationId,
    eventId: planned.eventId,
    customerId: planned.customerId,
    actionKind: planned.action.kind,
    outcome,
    detail,
    attempt,
    at,
  };
}

/** How many times a failed action may be retried before a person is needed. */
export const MAX_ATTEMPTS = 3;

/**
 * Which keys count as done, from a history.
 *
 * ONLY a successful send counts. A failure must remain retryable, and a skip
 * was never carried out — treating either as done would silently drop a
 * customer's reminder.
 */
export function completedKeys(
  history: readonly ExecutionRecord[]
): Set<string> {
  const done = new Set<string>();
  for (const r of history) {
    if (r.outcome === "sent") done.add(r.idempotencyKey);
  }
  return done;
}

/**
 * Should a failed action be tried again?
 *
 * No, if it ever succeeded — that would double-send. No, once it has failed
 * MAX_ATTEMPTS times — at that point it is a person's problem, not a loop's.
 */
export function shouldRetry(
  idempotencyKey: string,
  history: readonly ExecutionRecord[],
  maxAttempts = MAX_ATTEMPTS
): boolean {
  const mine = history.filter((r) => r.idempotencyKey === idempotencyKey);
  if (mine.length === 0) return false;
  if (mine.some((r) => r.outcome === "sent")) return false;
  const failures = mine.filter((r) => r.outcome === "failed");
  return failures.length > 0 && failures.length < maxAttempts;
}

/** The attempt number a retry should carry. */
export function nextAttemptNumber(
  idempotencyKey: string,
  history: readonly ExecutionRecord[]
): number {
  const mine = history.filter((r) => r.idempotencyKey === idempotencyKey);
  return mine.reduce((max, r) => Math.max(max, r.attempt), 0) + 1;
}

/** A plain-words summary of a history, for the Automations screen. */
export interface HistorySummary {
  sent: number;
  failed: number;
  skipped: number;
  /** Keys that failed and have run out of attempts — these need a person. */
  needsAttention: string[];
}

export function summarise(
  history: readonly ExecutionRecord[],
  maxAttempts = MAX_ATTEMPTS
): HistorySummary {
  const byKey = new Map<string, ExecutionRecord[]>();
  for (const r of history) {
    const list = byKey.get(r.idempotencyKey) ?? [];
    list.push(r);
    byKey.set(r.idempotencyKey, list);
  }

  const needsAttention: string[] = [];
  for (const [key, records] of byKey) {
    if (records.some((r) => r.outcome === "sent")) continue;
    if (records.filter((r) => r.outcome === "failed").length >= maxAttempts) {
      needsAttention.push(key);
    }
  }

  return {
    sent: history.filter((r) => r.outcome === "sent").length,
    failed: history.filter((r) => r.outcome === "failed").length,
    skipped: history.filter((r) => r.outcome === "skipped").length,
    needsAttention: needsAttention.sort(),
  };
}
