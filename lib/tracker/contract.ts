/**
 * THE payment-tracker contract — the single source of truth for what the
 * tracker API serves and what the Installments & Payments screen renders.
 * Both sides import THESE types and helpers; neither side invents its own
 * field names (same discipline as lib/chat/contract.ts, for the same reason).
 *
 * Everything here is pure and deterministic: no Date, no randomness, no
 * imports from server-only modules. Message builders are placeholder voice —
 * warm, short, never shaming — final wording comes later.
 */

/** One customer's payment plan as the tracker shows it for one month. */
export interface TrackedPlan {
  /** Opaque plan reference, e.g. "PP-0301". Shown as a small tag, never explained. */
  planId: string;
  clientName: string;
  /** E.164 without the plus, e.g. "9613100001" — ready for a wa.me link. */
  clientPhone: string;
  vin: string;
  /** Plain-words car description, e.g. "Voyah Free 2025". */
  carLabel: string;
  monthlyAmountUsd: number;
  /** Installments paid so far across the whole plan. */
  paidCount: number;
  /** Total installments in the plan. */
  totalCount: number;
  /** Day of the month the installment falls due. */
  dueDay: number;
  /**
   * Exact dollars received so far across the whole plan, when known.
   * Optional: most plans derive it as paidCount × monthlyAmountUsd, but a
   * hand-entered plan can carry the precise figure (e.g. a part-payment).
   */
  paidUsd?: number;
  /** This month's installment for the plan. */
  thisMonth: {
    installmentNumber: number;
    /** Human-readable, e.g. "August 5, 2026" — render as-is. */
    dueDate: string;
    amountUsd: number;
    status: "paid" | "due" | "overdue";
  };
}

/** One month of tracked plans, e.g. monthLabel "August 2026". */
export interface TrackerMonth {
  monthLabel: string;
  plans: TrackedPlan[];
}

/**
 * Dollars received so far on the plan: the exact figure when the plan carries
 * one, otherwise installments paid × the monthly amount. Pure arithmetic.
 */
export function paidAmountUsd(p: TrackedPlan): number {
  return p.paidUsd ?? p.paidCount * p.monthlyAmountUsd;
}

/** The plan's full value: total installments × the monthly amount. */
export function totalAmountUsd(p: TrackedPlan): number {
  return p.totalCount * p.monthlyAmountUsd;
}

/** "$1,550" (or "$1,550.30" when cents matter) — no locale calls. */
function usd(n: number): string {
  const cents = Math.round(n * 100);
  const whole = Math.trunc(cents / 100);
  const frac = Math.abs(cents % 100);
  const grouped = String(Math.abs(whole)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = cents < 0 ? "-" : "";
  return frac === 0
    ? `${sign}$${grouped}`
    : `${sign}$${grouped}.${String(frac).padStart(2, "0")}`;
}

function firstName(p: TrackedPlan): string {
  return p.clientName.trim().split(/\s+/)[0] || p.clientName;
}

/**
 * The message a client receives BEFORE paying — a kind nudge, never a
 * scolding. Includes the car, "X of Y", the amount and the due date.
 */
export function reminderMessage(p: TrackedPlan): string {
  return (
    `Hello ${firstName(p)}, this is Monza. A kind reminder that installment ` +
    `${p.thisMonth.installmentNumber} of ${p.totalCount} on your ${p.carLabel} — ` +
    `${usd(p.thisMonth.amountUsd)} — is due on ${p.thisMonth.dueDate}. ` +
    `Reply here if you have any questions; we are always happy to help.`
  );
}

/**
 * The message after marking a payment received — confirms "payment X of Y
 * received" and how many remain.
 */
export function thankYouMessage(p: TrackedPlan): string {
  const n = p.thisMonth.installmentNumber;
  const remaining = Math.max(0, p.totalCount - n);
  const opening =
    `Thank you, ${firstName(p)}! Payment ${n} of ${p.totalCount} on your ` +
    `${p.carLabel} — ${usd(p.thisMonth.amountUsd)} — is received. `;
  if (remaining === 0) {
    return opening + `That was the final one: your plan is complete. Congratulations, and thank you for choosing Monza.`;
  }
  const tail = remaining === 1 ? `Just 1 payment to go.` : `${remaining} payments to go.`;
  return opening + tail + ` We appreciate your trust — reply here if you need anything.`;
}

/**
 * One confirmed recording made on the tracker screen — the exact months and
 * dollars the operator confirmed in the "Record a payment" dialog, plus where
 * the plan stands right after. Pure data; the screen keeps it in memory only.
 */
export interface PaymentRecord {
  /** Whole installments this recording covered (0 for a part-payment). */
  monthsRecorded: number;
  /** Exact dollars received in this recording. */
  amountUsd: number;
  /** Installments paid across the whole plan AFTER this recording. */
  newPaidCount: number;
  /** True when this recording cleared the plan's remaining balance. */
  complete: boolean;
  /** Dollars banked toward the next installment AFTER this recording,
   *  cumulative across the whole plan (a prior half-payment counts).
   *  When absent, the message falls back to per-recording arithmetic. */
  bankedUsd?: number;
}

/**
 * The message after CONFIRMING a recording in the payment dialog — covers a
 * single month, several months at once, a custom amount that leaves a
 * remainder, and the full payoff. Same warm placeholder voice as the builders
 * above; deterministic — everything derives from the plan and the record.
 */
export function paymentReceivedMessage(p: TrackedPlan, r: PaymentRecord): string {
  const name = firstName(p);
  const money = usd(r.amountUsd);
  if (r.complete) {
    return (
      `Thank you, ${name}! We received ${money} on your ${p.carLabel} — ` +
      `your plan is fully paid — congratulations from all of us at Monza.`
    );
  }
  const remaining = Math.max(0, p.totalCount - r.newPaidCount);
  const tail = remaining === 1 ? `Just 1 payment to go.` : `${remaining} payments to go.`;
  const close = ` ${tail} We appreciate your trust — reply here if you need anything.`;
  const firstNo = r.newPaidCount - r.monthsRecorded + 1;
  // Cents-safe: a custom amount can be fractional, so compare in whole cents.
  // Prefer the cumulative banked figure when the caller supplies it — a prior
  // half-payment on the plan makes per-recording arithmetic wrong.
  const remainder =
    r.bankedUsd !== undefined
      ? Math.round(r.bankedUsd * 100) / 100
      : Math.round((r.amountUsd - r.monthsRecorded * p.monthlyAmountUsd) * 100) / 100;
  if (remainder >= 0.01) {
    const nextNo = r.newPaidCount + 1;
    if (r.monthsRecorded === 0) {
      return (
        `Thank you, ${name}! We received ${money} on your ${p.carLabel} — ` +
        `that goes toward installment #${nextNo}.` + close
      );
    }
    const covered =
      r.monthsRecorded === 1
        ? `installment #${r.newPaidCount}`
        : `installments #${firstNo}–#${r.newPaidCount}`;
    return (
      `Thank you, ${name}! We received ${money} on your ${p.carLabel} — ` +
      `that covers ${covered} with ${usd(remainder)} toward #${nextNo}.` + close
    );
  }
  if (r.monthsRecorded === 1) {
    return (
      `Thank you, ${name}! Payment ${r.newPaidCount} of ${p.totalCount} on your ` +
      `${p.carLabel} — ${money} — is received.` + close
    );
  }
  return (
    `Thank you, ${name}! Payments ${firstNo}–${r.newPaidCount} of ${p.totalCount} ` +
    `on your ${p.carLabel} — ${money} — are received.` + close
  );
}

/**
 * A WhatsApp deep link that opens a chat with the client and the given text
 * prefilled. Nothing is sent until a person taps send — buttons built on this
 * must say "Send on WhatsApp", never imply automation.
 */
export function waLink(p: TrackedPlan, text: string): string {
  const digits = p.clientPhone.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
