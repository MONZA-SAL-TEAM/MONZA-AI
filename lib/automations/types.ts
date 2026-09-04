/**
 * The automation vocabulary: WHEN something happens, THEN say something.
 *
 * Design constraints, all of them deliberate:
 *
 *  - An automation is DATA, not code. A trigger and a list of actions, both
 *    from closed sets. There is no scripting surface and no free-form model
 *    output in the loop: an automation can only send a TEMPLATE. Uncontrolled
 *    autonomous customer AI is explicitly out of scope, and this shape is what
 *    keeps it out.
 *
 *  - Every automation can be switched off, and the off switch is checked
 *    before anything else.
 *
 *  - Every planned action carries an IDEMPOTENCY KEY derived from the event
 *    and the automation, never from a clock. Processing the same event twice
 *    plans the same key twice, and the second one is skipped. Sending a
 *    customer the same reminder twice is the failure mode this whole file is
 *    arranged to prevent.
 *
 *  - Every attempt is recorded, successes and failures alike, so "did we
 *    message this person, and what happened" always has an answer.
 */

import type { ChannelKey } from "@/lib/domain/types";

/* ── Triggers ────────────────────────────────────────────────────────────── */

/**
 * The closed set of things that can start an automation. Each one is a fact
 * the SOURCE system reported — never something MONZA AI decided.
 */
export type TriggerKind =
  | "installment.due_soon"
  | "installment.due_today"
  | "installment.overdue"
  | "installment.overdue_extended"
  | "installment.paid"
  | "vehicle.ready_for_pickup"
  | "customer.requested_material"
  | "conversation.no_reply";

export const TRIGGER_LABEL: Readonly<Record<TriggerKind, string>> = {
  "installment.due_soon": "An installment is coming up",
  "installment.due_today": "An installment is due today",
  "installment.overdue": "An installment became overdue",
  "installment.overdue_extended": "An installment is long overdue",
  "installment.paid": "A payment was received",
  "vehicle.ready_for_pickup": "A vehicle is ready for pickup",
  "customer.requested_material": "A customer asked about one car",
  "conversation.no_reply": "A conversation went quiet",
};

/**
 * One thing that happened, as reported by a source system.
 *
 * `id` is the identity of the OCCURRENCE and must be derived from stable facts
 * (which installment, which job) — never from the time it was noticed. Deriving
 * it that way is what makes re-processing safe: the same real-world occurrence
 * always produces the same id, so the same message is never sent twice.
 */
export interface DomainEvent {
  id: string;
  kind: TriggerKind;
  /** ISO date the event refers to. */
  occurredOn: string;
  customerId: string;
  /** Installment id, vehicle id or conversation id, depending on the kind. */
  subjectId: string;
  /** Everything a template needs to render. Flat and printable on purpose. */
  data: Readonly<Record<string, string | number | null>>;
}

/* ── Actions ─────────────────────────────────────────────────────────────── */

/**
 * What an automation may do. Three things, and none of them changes business
 * data: MONZA AI communicates, it does not record payments or move vehicles.
 */
export type ActionKind = "send_message" | "notify_staff" | "create_followup";

export const ACTION_LABEL: Readonly<Record<ActionKind, string>> = {
  send_message: "Message the customer",
  notify_staff: "Tell the team",
  create_followup: "Add a follow-up",
};

export interface AutomationAction {
  kind: ActionKind;
  /** Required for send_message — the template to render. No free text. */
  templateId?: string;
  /** "preferred" uses the customer's own preferred channel. */
  channel?: ChannelKey | "preferred";
  /** Plain words for the team, on notify_staff / create_followup. */
  note?: string;
}

/* ── Automations ─────────────────────────────────────────────────────────── */

export interface AutomationTrigger {
  kind: TriggerKind;
  /** For due_soon: how many days ahead. Part of the event id, so 7-day and
   *  3-day reminders are distinct occurrences and both can fire. */
  daysBefore?: number;
  /** For overdue_extended: how far past due before the team is told. */
  daysAfter?: number;
}

export interface Automation {
  id: string;
  /** Plain words, as they appear on the Automations screen. */
  name: string;
  description: string;
  /** The kill switch. Checked before anything else. */
  enabled: boolean;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
}

/* ── Planning and execution ──────────────────────────────────────────────── */

/** One action the engine decided should happen, not yet performed. */
export interface PlannedAction {
  /** Stable across re-processing. The whole duplicate defence rests on this. */
  idempotencyKey: string;
  automationId: string;
  eventId: string;
  customerId: string;
  action: AutomationAction;
  /** Carried through so the executor can render without another lookup. */
  event: DomainEvent;
}

export type SkipReason =
  | "automation_disabled"
  | "trigger_mismatch"
  | "already_done"
  | "no_template"
  | "unknown_template";

export const SKIP_LABEL: Readonly<Record<SkipReason, string>> = {
  automation_disabled: "This automation is switched off.",
  trigger_mismatch: "This automation does not react to that.",
  already_done: "Already done for this — not repeated.",
  no_template: "This message action has no template set.",
  unknown_template: "The message template no longer exists.",
};

export interface SkippedAction {
  automationId: string;
  eventId: string;
  reason: SkipReason;
}

export interface EvaluationResult {
  planned: PlannedAction[];
  skipped: SkippedAction[];
}

export type ExecutionOutcome = "sent" | "failed" | "skipped";

/**
 * One attempt at one planned action. This is the execution history — written
 * whatever the outcome, because "we tried and it failed" is exactly the thing
 * a person needs to see.
 */
export interface ExecutionRecord {
  idempotencyKey: string;
  automationId: string;
  eventId: string;
  customerId: string;
  actionKind: ActionKind;
  outcome: ExecutionOutcome;
  /** Plain words: what was sent, or what went wrong. Never a stack trace. */
  detail: string;
  /** 1 for the first try. */
  attempt: number;
  /** ISO timestamp, supplied by the caller — this module never reads a clock. */
  at: string;
}
