/**
 * Turning what the source systems report into events the engine understands.
 *
 * This is the ONLY place business facts become automation triggers, and the
 * only place event ids are minted. Both matter:
 *
 *  - Every id is derived from stable facts (which installment, which job,
 *    which reminder window) and NEVER from the time it was noticed. Run this
 *    every hour for a week and the same real-world occurrence keeps the same
 *    id, so the engine recognises it and the customer is messaged once.
 *
 *  - Nothing here decides anything. "Overdue" is the source system's word, not
 *    a comparison MONZA AI invented; the date arithmetic below only works out
 *    WHICH REMINDER WINDOW an already-known due date falls in.
 *
 * Pure: `today` is a parameter, never a clock read.
 */

import type { Installment, Vehicle } from "@/lib/domain/types";
import type { DomainEvent } from "@/lib/automations/types";

/** Whole days from `from` to `to`, both ISO "YYYY-MM-DD". Negative if before. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** The reminder windows, in days before the due date. */
export const REMINDER_DAYS_BEFORE = [7, 3] as const;

/** How many days past due before the team is told, not just the customer. */
export const EXTENDED_OVERDUE_DAYS = 14;

/**
 * How recently a payment must have been received for a confirmation to be
 * worth sending.
 *
 * Without this, every historical payment on every plan produces a "payment
 * received" event on every run. The idempotency key would stop the SECOND
 * message — but not the first, so the day somebody switched the confirmation
 * automation on, every customer would receive a thank-you for a payment they
 * made months ago. A confirmation is only a confirmation while it is news.
 */
export const PAID_CONFIRMATION_WINDOW_DAYS = 7;

function installmentData(i: Installment): Record<string, string | number | null> {
  return {
    planId: i.planId,
    number: i.number,
    totalCount: i.totalCount,
    amountUsd: i.amountUsd,
    dueDate: i.dueDate,
    vehicleId: i.vehicleId,
    receiptRef: i.receiptRef,
  };
}

/**
 * Events for one installment on a given day.
 *
 * An installment produces at most one event per run:
 *   paid                        -> installment.paid (once, ever)
 *   due in 7 or 3 days          -> installment.due_soon, tagged with which
 *   due today                   -> installment.due_today
 *   past due                    -> installment.overdue, and additionally
 *                                  installment.overdue_extended once it has
 *                                  been unpaid long enough
 */
export function eventsForInstallment(
  i: Installment,
  today: string
): DomainEvent[] {
  const base = {
    occurredOn: today,
    customerId: i.customerId,
    subjectId: i.id,
  };

  if (i.status === "paid") {
    // Only recent payments are news. See PAID_CONFIRMATION_WINDOW_DAYS.
    if (!i.paidDate) return [];
    const age = daysBetween(i.paidDate, today);
    if (age < 0 || age > PAID_CONFIRMATION_WINDOW_DAYS) return [];
    return [
      {
        ...base,
        // Tied to the installment, not to today — a payment is confirmed once.
        id: `inst:${i.id}:paid`,
        kind: "installment.paid",
        occurredOn: i.paidDate,
        data: installmentData(i),
      },
    ];
  }

  const daysUntilDue = daysBetween(today, i.dueDate);

  if (daysUntilDue > 0) {
    const window = REMINDER_DAYS_BEFORE.find((d) => d === daysUntilDue);
    if (window === undefined) return [];
    return [
      {
        ...base,
        // The window is in the id, so the 7-day and 3-day reminders are
        // different occurrences and both are allowed to fire.
        id: `inst:${i.id}:due_soon:${window}`,
        kind: "installment.due_soon",
        data: { ...installmentData(i), daysBefore: window },
      },
    ];
  }

  if (daysUntilDue === 0) {
    return [
      {
        ...base,
        id: `inst:${i.id}:due_today`,
        kind: "installment.due_today",
        data: { ...installmentData(i), daysBefore: 0 },
      },
    ];
  }

  const daysOverdue = -daysUntilDue;
  const events: DomainEvent[] = [
    {
      ...base,
      // NOT tagged with the day count: an installment becomes overdue once,
      // and the customer is chased once — not every morning forever.
      id: `inst:${i.id}:overdue`,
      kind: "installment.overdue",
      data: { ...installmentData(i), daysOverdue },
    },
  ];

  if (daysOverdue >= EXTENDED_OVERDUE_DAYS) {
    events.push({
      ...base,
      id: `inst:${i.id}:overdue_extended`,
      kind: "installment.overdue_extended",
      data: { ...installmentData(i), daysOverdue },
    });
  }

  return events;
}

export function eventsForInstallments(
  installments: readonly Installment[],
  today: string
): DomainEvent[] {
  return installments.flatMap((i) => eventsForInstallment(i, today));
}

/**
 * Events for a vehicle.
 *
 * Only one transition matters to communication: arriving at "ready for
 * pickup". The id is keyed on the JOB reference, so the same visit is
 * announced once — and a later visit that also ends in "ready" is a different
 * job, a different id, and rightly a second message.
 *
 * A vehicle that is ready with no job reference produces no event: without a
 * stable id there is no way to promise we would not message the customer every
 * time this runs, and sending nothing is the safe failure.
 */
export function eventsForVehicle(v: Vehicle, today: string): DomainEvent[] {
  if (v.status !== "ready_for_pickup") return [];
  if (!v.customerId || !v.jobReference) return [];
  return [
    {
      id: `veh:${v.id}:ready:${v.jobReference}`,
      kind: "vehicle.ready_for_pickup",
      occurredOn: today,
      customerId: v.customerId,
      subjectId: v.id,
      data: {
        vehicleLabel: v.label,
        plate: v.plate,
        vin: v.vin,
        jobReference: v.jobReference,
      },
    },
  ];
}

export function eventsForVehicles(
  vehicles: readonly Vehicle[],
  today: string
): DomainEvent[] {
  return vehicles.flatMap((v) => eventsForVehicle(v, today));
}

/** Everything the source systems have to say today. */
export function collectEvents(
  input: {
    installments?: readonly Installment[];
    vehicles?: readonly Vehicle[];
  },
  today: string
): DomainEvent[] {
  return [
    ...eventsForInstallments(input.installments ?? [], today),
    ...eventsForVehicles(input.vehicles ?? [], today),
  ];
}
