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

/** "$1,550" — whole US dollars with thousands separators, no locale calls. */
function usd(n: number): string {
  return "$" + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
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
 * A WhatsApp deep link that opens a chat with the client and the given text
 * prefilled. Nothing is sent until a person taps send — buttons built on this
 * must say "Send on WhatsApp", never imply automation.
 */
export function waLink(p: TrackedPlan, text: string): string {
  const digits = p.clientPhone.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
