/**
 * A TEST-DRIVE REQUEST, FROM THE ASK TO ITS OUTCOME (Samer, 2026-11-25).
 *
 * Audited that day: 89 "test drive" alerts were open and 86 of them had already been answered by a
 * person — they stayed open because nothing recorded what happened next. Neither test-drive table
 * could: the CRM's logs a car physically out on a drive, and MONZA AI's `test_drive_bookings` holds
 * slots the BOT booked, which Samer switched off on 2026-09-18. A request had nowhere to go.
 *
 * So a request is its own record with a status a person moves. Pure rules here; the table is
 * migration 033 (`test_drive_requests`), the writes are lifecycle-server.ts.
 */

export const TEST_DRIVE_STATUSES = [
  "requested",
  "contacted",
  "awaiting_confirmation",
  "booked",
  "completed",
  "declined",
  "cancelled",
  "no_show",
  "not_interested",
  "duplicate",
] as const;
export type TestDriveStatus = (typeof TEST_DRIVE_STATUSES)[number];

export const STATUS_LABEL: Readonly<Record<TestDriveStatus, string>> = {
  requested: "Requested",
  contacted: "Customer contacted",
  awaiting_confirmation: "Awaiting confirmation",
  booked: "Booked",
  completed: "Completed",
  declined: "Declined",
  cancelled: "Cancelled",
  no_show: "No-show",
  not_interested: "No longer interested",
  duplicate: "Duplicate request",
};

export const isTestDriveStatus = (v: unknown): v is TestDriveStatus => typeof v === "string" && (TEST_DRIVE_STATUSES as readonly string[]).includes(v);

/** Still somebody's job. Everything else is an outcome. */
export const OPEN_STATUSES: readonly TestDriveStatus[] = ["requested", "contacted", "awaiting_confirmation", "booked"];
export const isOpenStatus = (s: TestDriveStatus): boolean => OPEN_STATUSES.includes(s);

/**
 * What the morning brief counts: a request nobody has acted on (`requested`), and a booked drive
 * whose time has passed with no outcome recorded. A customer we are waiting on is not our delay.
 */
export function needsAction(r: { status: TestDriveStatus; slotAt: string | null }, nowMs: number): "not_contacted" | "outcome_missing" | null {
  if (r.status === "requested") return "not_contacted";
  if (r.status === "booked" && r.slotAt && Date.parse(r.slotAt) < nowMs) return "outcome_missing";
  return null;
}

export interface StatusChange {
  to: TestDriveStatus;
  /** Booking needs these three. */
  slotAt?: string | null;
  vehicle?: string | null;
  salespersonId?: string | null;
  /** What happens next, for a completed drive — a closed list, never free text about a customer. */
  nextAction?: NextAction | null;
}

export const NEXT_ACTIONS = ["send_proposal", "follow_up_call", "second_drive", "customer_deciding", "none"] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];
export const NEXT_ACTION_LABEL: Readonly<Record<NextAction, string>> = {
  send_proposal: "Send a proposal",
  follow_up_call: "Follow-up call",
  second_drive: "Another drive",
  customer_deciding: "Customer is deciding",
  none: "Nothing further",
};
export const isNextAction = (v: unknown): v is NextAction => typeof v === "string" && (NEXT_ACTIONS as readonly string[]).includes(v);

/** May this request move there, and is the change complete? `null` = yes. */
export function changeProblem(from: TestDriveStatus, change: StatusChange, nowMs: number): string | null {
  if (change.to === from && change.to !== "booked") return "It is already in that state.";
  // An outcome is final, except that a person may reopen it (a "declined" customer who comes back).
  if (!isOpenStatus(from) && change.to !== "requested") return "This request has an outcome. Reopen it first.";
  if (change.to === "booked") {
    if (!change.slotAt || !Number.isFinite(Date.parse(change.slotAt))) return "A booking needs a date and time.";
    if (!change.vehicle) return "A booking needs the car.";
    if (!change.salespersonId) return "A booking needs the salesperson.";
  }
  if (change.to === "completed" || change.to === "no_show") {
    if (from !== "booked") return "Only a booked drive can be completed or missed.";
  }
  if (change.to === "completed" && !change.nextAction) return "Say what happens next.";
  void nowMs;
  return null;
}

/**
 * What an existing test-drive alert becomes when requests are first created from the backlog
 * (the one-time reconciliation, and the same rule for every new alert afterwards): a person has
 * answered → "contacted"; nobody has → "requested". Never "booked": no record says so.
 */
export function statusFromAlert(personRepliedAfter: boolean): TestDriveStatus {
  return personRepliedAfter ? "contacted" : "requested";
}
