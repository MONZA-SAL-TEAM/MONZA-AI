/**
 * The message templates an automation may send.
 *
 * A CLOSED SET, on purpose. An automation names a template id; it cannot
 * compose free text, and no model output reaches a customer through this path.
 * That is the boundary between "the system sends known messages on known
 * triggers" and "the system talks to customers on its own" — the second is out
 * of scope, and this file is where that stays true.
 *
 * Voice: warm, short, never shaming, never claiming anything MONZA AI does not
 * know. Placeholder wording — the final copy is Monza's to write.
 *
 * Pure: every template renders from the event's own data. No clock, no lookups.
 */

import type { DomainEvent } from "@/lib/automations/types";
import { firstName, longDate, usd } from "@/lib/format";

function str(e: DomainEvent, key: string, fallback = ""): string {
  const v = e.data[key];
  return typeof v === "string" ? v : fallback;
}

/** A date the way a customer reads one: "18 July 2026", never "2026-07-18". */
function dateStr(e: DomainEvent, key: string, fallback: string): string {
  const v = e.data[key];
  return typeof v === "string" ? longDate(v) : fallback;
}

function num(e: DomainEvent, key: string): number | null {
  const v = e.data[key];
  return typeof v === "number" ? v : null;
}

export interface TemplateContext {
  /** The customer's name, from the source system. */
  customerName: string;
  event: DomainEvent;
}

export interface MessageTemplate {
  id: string;
  /** Plain words for the Automations screen. */
  label: string;
  /** Who reads it — a customer message and a staff note are not the same. */
  audience: "customer" | "staff";
  render(ctx: TemplateContext): string;
}

/** Money + installment line shared by the payment templates. */
function installmentLine(e: DomainEvent): string {
  const number = num(e, "number");
  const total = num(e, "totalCount");
  const amount = num(e, "amountUsd");
  const money = amount === null ? "" : ` — ${usd(amount)}`;
  if (number === null || total === null) return `your installment${money}`;
  return `installment ${number} of ${total}${money}`;
}

const TEMPLATES: MessageTemplate[] = [
  {
    id: "installment.reminder.upcoming",
    label: "Friendly reminder before the due date",
    audience: "customer",
    render: ({ customerName, event }) =>
      `Hello ${firstName(customerName)}, this is Monza. A kind reminder that ` +
      `${installmentLine(event)} is due on ${dateStr(event, "dueDate", "the due date")}. ` +
      `Reply here if you have any questions — we are always happy to help.`,
  },
  {
    id: "installment.reminder.due_today",
    label: "Reminder on the due date",
    audience: "customer",
    render: ({ customerName, event }) =>
      `Hello ${firstName(customerName)}, this is Monza. ${
        installmentLine(event).charAt(0).toUpperCase() +
        installmentLine(event).slice(1)
      } is due today. If you have already paid, please ignore this message — ` +
      `and thank you.`,
  },
  {
    id: "installment.followup.overdue",
    label: "Gentle follow-up once an installment is past its date",
    audience: "customer",
    render: ({ customerName, event }) =>
      `Hello ${firstName(customerName)}, this is Monza. We have not yet seen ` +
      `${installmentLine(event)}, which was due on ` +
      `${dateStr(event, "dueDate", "its due date")}. If anything is making this ` +
      `difficult, please tell us — we would rather help than chase.`,
  },
  {
    id: "installment.confirmation.paid",
    label: "Confirmation that a payment was received",
    audience: "customer",
    render: ({ customerName, event }) => {
      const receipt = str(event, "receiptRef");
      const tail = receipt ? ` Your receipt reference is ${receipt}.` : "";
      return (
        `Thank you, ${firstName(customerName)}! We have received ` +
        `${installmentLine(event)}.${tail} We appreciate your trust — reply ` +
        `here if you need anything.`
      );
    },
  },
  {
    id: "vehicle.ready_for_pickup",
    label: "The car is ready to collect",
    audience: "customer",
    render: ({ customerName, event }) => {
      const plate = str(event, "plate");
      const which = plate
        ? `${str(event, "vehicleLabel", "your car")} (${plate})`
        : str(event, "vehicleLabel", "your car");
      return (
        `Hello ${firstName(customerName)}, this is Monza. Good news — ` +
        `${which} is ready for pickup. Reply here and we will arrange a time ` +
        `that suits you.`
      );
    },
  },
  {
    id: "staff.overdue_escalation",
    label: "Tell the team an installment has gone unpaid for a while",
    audience: "staff",
    render: ({ customerName, event }) => {
      const days = num(event, "daysOverdue");
      const howLong = days === null ? "some time" : `${days} days`;
      return (
        `${customerName}: ${installmentLine(event)} has been unpaid for ` +
        `${howLong} (due ${dateStr(event, "dueDate", "—")}). Reminders have gone ` +
        `out; this one needs a person.`
      );
    },
  },
  {
    id: "staff.followup_needed",
    label: "Add a follow-up for a quiet conversation",
    audience: "staff",
    render: ({ customerName }) =>
      `${customerName} has not replied since our last message. Worth a check-in.`,
  },
];

const BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

export function allTemplates(): readonly MessageTemplate[] {
  return TEMPLATES;
}

export function templateIds(): ReadonlySet<string> {
  return new Set(BY_ID.keys());
}

export function findTemplate(id: string): MessageTemplate | null {
  return BY_ID.get(id) ?? null;
}

/**
 * Render a template, or return null when the id is unknown. Null rather than a
 * throw, and never a fallback sentence: a message we cannot compose correctly
 * must not be sent at all.
 */
export function renderTemplate(
  id: string,
  ctx: TemplateContext
): string | null {
  const template = BY_ID.get(id);
  return template ? template.render(ctx) : null;
}
