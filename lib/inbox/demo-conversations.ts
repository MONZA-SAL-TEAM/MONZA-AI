/**
 * The demo inbox — invented threads, built on the SAME people, cars, plans and
 * job numbers as every other demo surface (lib/domain/demo-source.ts, itself
 * derived from the reconciled canon).
 *
 * Fixed and pure: no clock, no randomness. Timestamps are literal strings so
 * the server and the browser render the same order, and a test can assert it.
 *
 * These are demo CONVERSATIONS, not demo customer data — the messages are the
 * invented part. Every name, phone, plate and job reference in them is the
 * canon's.
 */

import { DEMO_DATASET, DEMO_TODAY } from "@/lib/domain/demo-source";
import { eventsForInstallment } from "@/lib/automations/events";
import { renderTemplate } from "@/lib/automations/templates";
import type { Customer } from "@/lib/domain/types";
import type {
  Conversation,
  ConversationStatus,
  InboxMessage,
  MessageAuthor,
} from "@/lib/inbox/types";

/** The demo's staff members, so assignment has something to point at. */
export const DEMO_STAFF = [
  { id: "staff-lara", name: "Lara" },
  { id: "staff-kareem", name: "Kareem" },
] as const;

/** Who the demo signs you in as, for "My conversations". */
export const DEMO_VIEWER = { staffId: "staff-lara" };

/**
 * The exact text an automation WOULD send about one installment, rendered from
 * the real template and the real (demo) installment.
 *
 * Hand-writing these once produced a thread that said "due 2026-06-18" beside a
 * context card that said 18 July — the drift the derived demo dataset exists to
 * prevent. Deriving them means the thread, the follow-up board and the
 * automation preview cannot disagree.
 */
function automatedText(
  customerId: string,
  installmentNumber: number,
  templateId: string,
  /** The day the message went out — a message reflects the state on ITS day,
   *  not on today. */
  asOf: string = DEMO_TODAY
): string {
  const installment = DEMO_DATASET.installments.find(
    (i) => i.customerId === customerId && i.number === installmentNumber
  );
  const person = DEMO_DATASET.customers.find((c) => c.id === customerId);
  if (!installment || !person) {
    throw new Error(
      `demo conversation references an installment that does not exist: ${customerId} #${installmentNumber}`
    );
  }
  const event = eventsForInstallment(installment, asOf)[0];
  const text = event
    ? renderTemplate(templateId, { customerName: person.name, event })
    : null;
  if (!text) {
    throw new Error(
      `demo conversation cannot render ${templateId} for ${customerId} #${installmentNumber}`
    );
  }
  return text;
}

function customer(id: string): Customer {
  const c = DEMO_DATASET.customers.find((x) => x.id === id);
  if (!c) throw new Error(`demo conversation references unknown customer: ${id}`);
  return c;
}

/** The address to use for a customer on a channel, straight from the canon. */
function addressOn(c: Customer, channel: Conversation["channel"]): string {
  const handle = c.handles.find((h) => h.channel === channel);
  if (!handle) {
    throw new Error(`${c.name} has no ${channel} handle in the demo dataset`);
  }
  return handle.address;
}

interface ThreadSpec {
  id: string;
  customerId: string;
  channel: Conversation["channel"];
  status: ConversationStatus;
  assignedTo: string | null;
  unreadCount: number;
  messages: {
    at: string;
    direction: "in" | "out";
    author: MessageAuthor;
    text: string;
    automationId?: string;
    staffName?: string;
    status?: InboxMessage["status"];
  }[];
}

/* Six threads across all three channels, covering every inbox filter: one
   unassigned, one assigned to the viewer, one waiting on the customer, one
   needing follow-up, one carrying an automated message, one closed. */
const THREADS: ThreadSpec[] = [
  {
    id: "conv-rami-whatsapp",
    customerId: "rami-kanaan",
    channel: "whatsapp",
    status: "open",
    assignedTo: null,
    unreadCount: 2,
    messages: [
      {
        at: "2026-08-19T08:12:00Z",
        direction: "in",
        author: "customer",
        text: "Good morning, any news on my Free? It has been in the garage a while.",
      },
      {
        at: "2026-08-19T09:03:00Z",
        direction: "out",
        author: "staff",
        staffName: "Kareem",
        text: "Morning Rami — the control-arm bushing is on order, job GJ-2026-0142. I will confirm as soon as it lands.",
      },
      {
        at: "2026-08-20T07:41:00Z",
        direction: "in",
        author: "customer",
        text: "Thanks. Any idea of the date?",
      },
      {
        at: "2026-08-20T07:42:00Z",
        direction: "in",
        author: "customer",
        text: "Also I want to sort out the payments I am behind on.",
      },
    ],
  },
  {
    id: "conv-rami-instagram",
    customerId: "rami-kanaan",
    channel: "instagram",
    status: "closed",
    assignedTo: "staff-lara",
    unreadCount: 0,
    messages: [
      {
        at: "2026-08-12T17:20:00Z",
        direction: "in",
        author: "customer",
        text: "More information about the Voyah Free please",
      },
      {
        at: "2026-08-12T17:22:00Z",
        direction: "out",
        author: "staff",
        staffName: "Lara",
        text: "Of course — sending the walkaround and the brochure now. Happy to arrange a test drive.",
      },
    ],
  },
  {
    id: "conv-george-facebook",
    customerId: "george-sassine",
    channel: "facebook",
    status: "waiting_reply",
    assignedTo: "staff-lara",
    unreadCount: 0,
    messages: [
      {
        at: "2026-08-18T11:05:00Z",
        direction: "in",
        author: "customer",
        text: "A friend sent me here about the MHero. Is it available?",
      },
      {
        at: "2026-08-18T11:31:00Z",
        direction: "out",
        author: "staff",
        staffName: "Lara",
        text: "Hello George — yes. When would suit you for a look at the showroom?",
      },
    ],
  },
  {
    id: "conv-karim-instagram",
    customerId: "karim-azar",
    channel: "instagram",
    status: "follow_up",
    assignedTo: null,
    unreadCount: 0,
    messages: [
      {
        at: "2026-08-05T14:02:00Z",
        direction: "in",
        author: "customer",
        text: "Interested in the Free — what are the colours?",
      },
      {
        at: "2026-08-05T14:40:00Z",
        direction: "out",
        author: "staff",
        staffName: "Kareem",
        text: "Hi Karim — five colours available. Shall I send the brochure?",
      },
    ],
  },
  {
    id: "conv-layal-whatsapp",
    customerId: "layal-barakat",
    channel: "whatsapp",
    status: "waiting_reply",
    assignedTo: "staff-lara",
    unreadCount: 0,
    messages: [
      {
        // Sent on the day the payment landed, which is what makes a
        // confirmation a confirmation.
        at: "2026-08-05T10:00:00Z",
        direction: "out",
        author: "automation",
        automationId: "payment-confirmation",
        text: automatedText(
          "layal-barakat",
          7,
          "installment.confirmation.paid",
          "2026-08-05"
        ),
      },
      {
        at: "2026-08-17T09:00:00Z",
        direction: "in",
        author: "customer",
        text: "Hello, when will the Courage be ready?",
      },
      {
        at: "2026-08-17T09:15:00Z",
        direction: "out",
        author: "staff",
        staffName: "Lara",
        text: "Hi Layal — it is in progress on job GJ-2026-0155. I will message you the moment it is ready to collect.",
      },
    ],
  },
  {
    id: "conv-nour-whatsapp",
    customerId: "nour-haddad",
    channel: "whatsapp",
    status: "open",
    assignedTo: "staff-kareem",
    unreadCount: 1,
    messages: [
      {
        at: "2026-08-20T05:30:00Z",
        direction: "out",
        author: "automation",
        automationId: "installment-overdue-followup",
        text: automatedText("nour-haddad", 4, "installment.followup.overdue"),
      },
      {
        at: "2026-08-20T08:15:00Z",
        direction: "in",
        author: "customer",
        text: "Sorry, travelling. Can I pay two together next week?",
      },
    ],
  },
];

/* ── Building the model ──────────────────────────────────────────────────── */

function staffName(id: string | null): string | null {
  return DEMO_STAFF.find((s) => s.id === id)?.name ?? null;
}

export const DEMO_MESSAGES: InboxMessage[] = THREADS.flatMap((thread) =>
  thread.messages.map((m, index) => ({
    id: `${thread.id}-m${index + 1}`,
    conversationId: thread.id,
    direction: m.direction,
    author: m.author,
    text: m.text,
    at: m.at,
    status: m.status ?? (m.direction === "in" ? "received" : "delivered"),
    ...(m.automationId ? { automationId: m.automationId } : {}),
    ...(m.staffName ? { staffName: m.staffName } : {}),
  }))
);

export const DEMO_CONVERSATIONS: Conversation[] = THREADS.map((thread) => {
  const c = customer(thread.customerId);
  const mine = DEMO_MESSAGES.filter((m) => m.conversationId === thread.id);
  const last = mine[mine.length - 1];

  return {
    id: thread.id,
    customerId: c.id,
    customerName: c.name,
    channel: thread.channel,
    channelAddress: addressOn(c, thread.channel),
    assignedTo: thread.assignedTo,
    assignedToName: staffName(thread.assignedTo),
    status: thread.status,
    unreadCount: thread.unreadCount,
    lastMessage: {
      text: last.text,
      at: last.at,
      direction: last.direction,
      author: last.author,
    },
    hasAutomatedMessage: mine.some((m) => m.author === "automation"),
  };
});

export function demoMessagesFor(conversationId: string): InboxMessage[] {
  return DEMO_MESSAGES.filter((m) => m.conversationId === conversationId);
}

/** The demo inbox, with the period label the other demo boards use. */
export const DEMO_INBOX = {
  today: DEMO_TODAY,
  viewer: DEMO_VIEWER,
  staff: DEMO_STAFF,
  conversations: DEMO_CONVERSATIONS,
  messages: DEMO_MESSAGES,
};
