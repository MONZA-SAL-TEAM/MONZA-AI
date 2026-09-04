/**
 * The BRIEF handed to the local sales coach.
 *
 * This module decides what the model is allowed to know, and it is pure — no
 * fetching, no clock — so what goes into a draft can be asserted in a test
 * rather than discovered from a bad suggestion in front of a customer.
 *
 * Two rules shape everything here:
 *
 * 1. FACTS ARE QUOTED, NEVER SUMMARISED. Every business fact in the brief is
 *    printed as a labelled line straight from the source system. A model that
 *    is handed "3 installments behind, oldest due 18 July 2026" can repeat it;
 *    a model handed "the customer is quite behind" will invent the specifics.
 *
 * 2. WHAT IS ABSENT IS SAID TO BE ABSENT. If we do not know the price, the
 *    brief says "price: not available to you" rather than omitting the line.
 *    An omitted field reads as an invitation to guess; an explicit "you do not
 *    have this" is a fact the model can pass on honestly.
 *
 * The brief is deliberately small. gpt-oss:20b is competent but not frontier:
 * every token of background competes with the instruction not to invent things.
 */

import type {
  Customer,
  Installment,
  Vehicle,
} from "@/lib/domain/types";
import { CHANNEL_LABEL, VEHICLE_STATUS_LABEL } from "@/lib/domain/types";
import type { Conversation, InboxMessage } from "@/lib/inbox/types";
import { longDate, usd } from "@/lib/format";

/** How many prior messages the coach sees. */
export const HISTORY_LIMIT = 12;

/** Longer than this and a single message is trimmed — one customer essay must
 *  not push the actual question out of the window. */
export const MESSAGE_CHAR_LIMIT = 600;

export interface BriefInput {
  conversation: Conversation;
  /** Oldest first. Only the last HISTORY_LIMIT are used. */
  messages: readonly InboxMessage[];
  customer: Customer | null;
  vehicles: readonly Vehicle[];
  /** Unpaid installments only — a paid one is not something to raise. */
  installments: readonly Installment[];
}

export interface Brief {
  /** The rendered user turn. */
  text: string;
  /** The message being replied to, or null when the last word was ours. */
  lastCustomerMessage: InboxMessage | null;
  /** True when WE spoke last — the coach should suggest a nudge, not a reply. */
  awaitingCustomer: boolean;
  /**
   * Every fact line the model was shown, verbatim.
   *
   * The verifier compares the draft against exactly this: a number in the reply
   * that appears in none of these lines came from nowhere. Returning the same
   * strings that went into the prompt is what makes that check trustworthy —
   * a second, reconstructed list would drift.
   */
  factStrings: string[];
  /** What the customer themselves wrote. Their own words are fair to repeat. */
  customerText: string[];
  /**
   * The message this draft answers. Staleness is "a newer message arrived than
   * this one" — an id, not a count, because a count is the same after a delete
   * and an insert.
   */
  anchorMessageId: string | null;
}

function trim(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > MESSAGE_CHAR_LIMIT
    ? `${clean.slice(0, MESSAGE_CHAR_LIMIT)}…`
    : clean;
}

/** First name only — the only form a reply ever uses. */
function firstNameOf(full: string): string {
  return full.trim().split(/\s+/)[0] || full;
}

/**
 * Who said it, as its own ALL-CAPS token.
 *
 * MONZA-AUTO is deliberately distinct from MONZA: an automated reminder reads
 * like ordinary customer-facing prose, and a model that cannot tell it apart
 * from a customer's message drafts a reply TO it.
 */
function speaker(m: InboxMessage, customerName: string): string {
  if (m.direction === "in") return `CUSTOMER (${firstNameOf(customerName)})`;
  return m.author === "automation" ? "MONZA-AUTO" : "MONZA";
}

/**
 * The facts about this customer, each on its own line.
 *
 * Only what a salesperson would genuinely use mid-conversation. No lifetime
 * value, no lead score, no history of every past thread — those would be a CRM
 * talking, and they push the real question out of the model's attention.
 */
function factLines(input: BriefInput): string[] {
  const lines: string[] = [];
  const { customer, vehicles, installments } = input;

  if (!customer) {
    lines.push("We have no record of this person yet — this is a new contact.");
    return lines;
  }

  lines.push(`Customer: ${customer.name}`);
  lines.push(`Reached on: ${CHANNEL_LABEL[input.conversation.channel]}`);
  lines.push(`First contacted us: ${customer.firstContact} (via ${customer.origin})`);

  if (vehicles.length === 0) {
    lines.push("Vehicle: none on record.");
  } else {
    for (const v of vehicles) {
      const bits = [v.label];
      if (v.plate) bits.push(`plate ${v.plate}`);
      bits.push(VEHICLE_STATUS_LABEL[v.status].toLowerCase());
      if (v.awaitingPart) bits.push(`waiting on: ${v.awaitingPart}`);
      if (v.jobReference) bits.push(`job ${v.jobReference}`);
      lines.push(`Vehicle: ${bits.join(" — ")}`);
    }
  }

  const overdue = installments.filter((i) => i.status === "overdue");
  const due = installments.filter((i) => i.status === "due");

  if (overdue.length === 0 && due.length === 0) {
    lines.push("Payments: nothing outstanding.");
  } else {
    if (overdue.length > 0) {
      const oldest = [...overdue].sort((a, b) =>
        a.dueDate < b.dueDate ? -1 : 1
      )[0];
      lines.push(
        `Payments: ${overdue.length} installment${overdue.length === 1 ? "" : "s"} overdue, ` +
          `oldest was due ${longDate(oldest.dueDate)} (${usd(oldest.amountUsd)}).`
      );
    }
    if (due.length > 0) {
      const next = due[0];
      lines.push(
        `Payments: installment ${next.number} of ${next.totalCount} — ` +
          `${usd(next.amountUsd)} — due ${longDate(next.dueDate)}.`
      );
    }
  }

  // The absences, said out loud. See rule 2 at the top of this file.
  lines.push(
    "Not available to you: prices, discounts, stock, delivery dates, " +
      "trade-in values, technical specifications, repair estimates, and any " +
      "date a car will be ready."
  );

  return lines;
}

/**
 * Build the brief.
 *
 * The conversation is rendered last, closest to where the model starts writing,
 * because that is the part it must actually respond to.
 */
export function buildBrief(input: BriefInput): Brief {
  const name = input.customer?.name ?? input.conversation.customerName;
  const recent = input.messages.slice(-HISTORY_LIMIT);

  const lastCustomerMessage =
    [...recent].reverse().find((m) => m.direction === "in") ?? null;
  const last = recent[recent.length - 1];
  const awaitingCustomer = last !== undefined && last.direction === "out";

  const transcript = recent
    .map((m) => `${speaker(m, name)}: ${trim(m.text)}`)
    .join("\n");

  const task = awaitingCustomer
    ? `WE spoke last and ${firstNameOf(name)} has not replied. Write a short, ` +
      `low-pressure follow-up — not an answer — and do not repeat what we said.`
    : `WRITE THE NEXT MESSAGE FROM MONZA TO ${firstNameOf(name).toUpperCase()}.`;

  const facts = factLines(input);

  // Labelled ALL-CAPS blocks rather than prose: a 20B parses "KEY: value" far
  // more reliably than a sentence, and prose in the context is prose it
  // imitates. The role assignment and the number rule come LAST, closest to
  // where it starts writing — recency is the strongest lever on a model this
  // size, and it is the structural defence against writing as the customer.
  const text = [
    `CHANNEL: ${CHANNEL_LABEL[input.conversation.channel]}`,
    `CUSTOMER: ${firstNameOf(name)}`,
    "",
    "FACTS — this is everything known. Nothing outside this block exists.",
    ...facts.map((f) => `  ${f}`),
    "",
    "THREAD — oldest first:",
    transcript || "  (nothing yet)",
    "",
    task,
    "Numbers only from FACTS. Everything else is [[a slot]].",
  ].join("\n");

  return {
    text,
    lastCustomerMessage,
    awaitingCustomer,
    factStrings: facts,
    customerText: recent.filter((m) => m.direction === "in").map((m) => m.text),
    anchorMessageId: awaitingCustomer ? null : (lastCustomerMessage?.id ?? null),
  };
}

/**
 * A stable fingerprint of what the brief was built from.
 *
 * The screen uses it to notice that a draft has gone STALE — a new message
 * arrived after it was generated — so a salesperson never sends a reply to a
 * conversation that has since moved on.
 */
export function briefFingerprint(input: BriefInput): string {
  const last = input.messages[input.messages.length - 1];
  return [
    input.conversation.id,
    String(input.messages.length),
    last?.id ?? "none",
  ].join("|");
}
