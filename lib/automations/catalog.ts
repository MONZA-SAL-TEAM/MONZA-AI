/**
 * The automations Monza runs, as data.
 *
 * This is the default set the Automations screen shows. Each one is switched
 * OFF by default: nothing may start messaging real customers because a
 * deployment happened. Turning one on is a decision a person makes, and until
 * outbound messaging is actually connected the screen says so plainly.
 *
 * The installment ladder is deliberately gentle and bounded:
 *
 *     7 days before  -> remind the customer
 *     3 days before  -> remind the customer
 *     on the day     -> remind the customer
 *     past due       -> follow up ONCE (not every morning)
 *     14 days past   -> tell the team; a person takes over
 *
 * The customer is messaged at most four times about one installment, and the
 * last word belongs to a human being.
 */

import type { Automation } from "@/lib/automations/types";
import { EXTENDED_OVERDUE_DAYS } from "@/lib/automations/events";

export const DEFAULT_AUTOMATIONS: Automation[] = [
  {
    id: "installment-reminder-7",
    name: "Remind a week before an installment",
    description:
      "Seven days before an installment is due, send the customer a friendly reminder.",
    enabled: false,
    trigger: { kind: "installment.due_soon", daysBefore: 7 },
    actions: [
      {
        kind: "send_message",
        templateId: "installment.reminder.upcoming",
        channel: "preferred",
      },
    ],
  },
  {
    id: "installment-reminder-3",
    name: "Remind three days before an installment",
    description:
      "A second, closer reminder three days before the due date.",
    enabled: false,
    trigger: { kind: "installment.due_soon", daysBefore: 3 },
    actions: [
      {
        kind: "send_message",
        templateId: "installment.reminder.upcoming",
        channel: "preferred",
      },
    ],
  },
  {
    id: "installment-reminder-due",
    name: "Remind on the due date",
    description: "On the day itself, a short note that the installment is due.",
    enabled: false,
    trigger: { kind: "installment.due_today" },
    actions: [
      {
        kind: "send_message",
        templateId: "installment.reminder.due_today",
        channel: "preferred",
      },
    ],
  },
  {
    id: "installment-overdue-followup",
    name: "Follow up once an installment is late",
    description:
      "One gentle follow-up after the due date passes — not a message every day.",
    enabled: false,
    trigger: { kind: "installment.overdue" },
    actions: [
      {
        kind: "send_message",
        templateId: "installment.followup.overdue",
        channel: "preferred",
      },
    ],
  },
  {
    id: "installment-overdue-escalation",
    name: "Tell the team when an installment stays unpaid",
    description: `After ${EXTENDED_OVERDUE_DAYS} days unpaid, stop messaging the customer and hand it to a person.`,
    enabled: false,
    trigger: {
      kind: "installment.overdue_extended",
      daysAfter: EXTENDED_OVERDUE_DAYS,
    },
    actions: [
      {
        kind: "notify_staff",
        templateId: "staff.overdue_escalation",
        note: "Needs a person — reminders have already gone out.",
      },
      {
        kind: "create_followup",
        note: "Call about the overdue installment.",
      },
    ],
  },
  {
    id: "payment-confirmation",
    name: "Confirm a payment when it is received",
    description:
      "As soon as the source system records a payment, thank the customer and give the receipt reference.",
    enabled: false,
    trigger: { kind: "installment.paid" },
    actions: [
      {
        kind: "send_message",
        templateId: "installment.confirmation.paid",
        channel: "preferred",
      },
    ],
  },
  {
    id: "vehicle-ready",
    name: "Tell the customer their car is ready",
    description:
      "When the garage marks a vehicle ready for pickup, message the customer once for that job.",
    enabled: false,
    trigger: { kind: "vehicle.ready_for_pickup" },
    actions: [
      {
        kind: "send_message",
        templateId: "vehicle.ready_for_pickup",
        channel: "preferred",
      },
    ],
  },
  {
    id: "quiet-conversation-followup",
    name: "Flag a conversation that went quiet",
    description:
      "When a customer has not replied for a while, add a follow-up for the team — no automatic message.",
    enabled: false,
    trigger: { kind: "conversation.no_reply" },
    actions: [
      {
        kind: "create_followup",
        note: "No reply since our last message — worth a check-in.",
      },
    ],
  },
];

export function findAutomation(id: string): Automation | null {
  return DEFAULT_AUTOMATIONS.find((a) => a.id === id) ?? null;
}
