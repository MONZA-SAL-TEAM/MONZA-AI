import type { AnswerTable, RecommendedChat } from "@/lib/chat/contract";
import type { ToolTraceEntry } from "@/lib/ai/loop";

/**
 * The demo conversation engine — pure data, pure functions, importable from
 * "use client" components. No server-only imports (ToolTraceEntry comes in as
 * a type only, so nothing from lib/ai/loop reaches the client bundle).
 *
 * CUSTOMER-FACING: the demo pretends the signed-in customer is Rami Kanaan
 * (invented — mirrors lib/connectors/demo-data.ts exactly: a 2025 Voyah Free,
 * a $1,550/month payment plan that is 3 installments behind, and a garage job
 * waiting for one part). Every answer is either HIS OWN data, addressed as
 * "your", or public information about Monza and its cars. Nothing here ever
 * aggregates or mentions another customer.
 *
 * Safety rails: the assistant never diagnoses, never says a car is safe or
 * unsafe to drive, never estimates repair cost or time, and never promises
 * prices, discounts or trade-in values — those always hand off to the team.
 *
 * Trace entries use REAL qualified tool names ("<connector>__<tool>") from the
 * closed registry — nothing invented. Handoff answers that need no lookup
 * carry an empty trace: chips only ever show real checks.
 */

export interface DemoAnswer {
  text: string;
  tables: AnswerTable[];
  followups: string[];
  trace: ToolTraceEntry[];
}

/* ── The questions (12 recommended + the followups they chain into) ─────── */

const Q = {
  // My car at Monza
  carReady: "Is my car ready yet?",
  repairUpdate: "What's happening with my repair?",
  bookService: "How do I book a service visit?",
  // My payments
  nextPayment: "When is my next payment due?",
  planBalance: "How much is left on my plan?",
  howToPay: "How do I make a payment?",
  // Our cars
  dream: "Tell me about the Voyah Dream",
  freeVsDream: "What's the difference between the Voyah Free and the Dream?",
  mhero: "Tell me about MHERO",
  free: "Tell me about the Voyah Free",
  lineup: "What cars does Monza sell?",
  // Visit us
  testDrive: "Can I book a test drive?",
  showroom: "Where is the showroom and when are you open?",
  talkToPerson: "How do I talk to a person?",
} as const;

export const RECOMMENDED_CHATS: RecommendedChat[] = [
  {
    key: "garage",
    label: "My car at Monza",
    blurb: "Check on your car in our garage and arrange your next service visit.",
    questions: [Q.carReady, Q.repairUpdate, Q.bookService],
  },
  {
    key: "installments",
    label: "My payments",
    blurb: "See where your plan stands, what's coming up, and how to pay.",
    questions: [Q.nextPayment, Q.planBalance, Q.howToPay],
  },
  {
    key: "inventory",
    label: "Our cars",
    blurb: "Get to know the Voyah range and MHERO before you visit.",
    questions: [Q.dream, Q.freeVsDream, Q.mhero],
  },
  {
    key: "crm",
    label: "Visit us",
    blurb: "Book a test drive, find the showroom, or reach a real person.",
    questions: [Q.testDrive, Q.showroom, Q.talkToPerson],
  },
];

/* ── Small helpers ──────────────────────────────────────────────────────── */

function trace(
  qualifiedName: string,
  input: Record<string, unknown>,
  rowCount: number | null,
  durationMs: number
): ToolTraceEntry {
  return { qualifiedName, input, rowCount, denied: false, durationMs };
}

/* ── My car at Monza ────────────────────────────────────────────────────── */

const ANSWER_CAR_STATUS: DemoAnswer = {
  text:
    "Your Voyah Free is with our garage team right now, so it's not ready just yet. The good news: the team found the cause and ordered the part it needs. The moment that part arrives, work continues — and we'll call you the moment your car is ready to collect. You don't need to do a thing. Here's the story so far.",
  tables: [
    {
      title: "Your Voyah Free — repair updates",
      columns: ["Date", "Update"],
      rows: [
        ["18 Aug 2026", "Your car arrived and was checked in"],
        ["20 Aug 2026", "The team found the cause and ordered the part"],
        ["Today", "Waiting for the part — work continues as soon as it arrives"],
      ],
    },
  ],
  followups: [Q.bookService, Q.talkToPerson, Q.nextPayment],
  trace: [trace("garage__job_lookup", { job_number: "GJ-2026-0142" }, 3, 148)],
};

const ANSWER_BOOK_SERVICE: DemoAnswer = {
  text:
    "Happy to arrange that. Monza handles service bookings personally — I'll pass your request to the team, and a team member will call you to confirm a day and time that suits you. If there's anything you'd like them to look at, just mention it when they call.",
  tables: [],
  followups: [Q.carReady, Q.showroom, Q.talkToPerson],
  trace: [],
};

/* ── My payments ────────────────────────────────────────────────────────── */

const ANSWER_NEXT_PAYMENT: DemoAnswer = {
  text:
    "Your plan is $1,550 a month. The next one waiting is installment 6, which was due on 5 June 2026 — so right now there are 3 payments to catch up on, $4,650 in total. That happens, and it's easy to sort out: the team can help you arrange a way to catch up that works for you. Just say the word and someone will call.",
  tables: [
    {
      title: "Payments to catch up on",
      columns: ["Payment", "Was due", "Amount"],
      rows: [
        ["Installment 6", "5 Jun 2026", "$1,550"],
        ["Installment 7", "5 Jul 2026", "$1,550"],
        ["Installment 8", "5 Aug 2026", "$1,550"],
      ],
    },
  ],
  followups: [Q.howToPay, Q.planBalance, Q.talkToPerson],
  trace: [trace("installments__plan_status_summary", {}, 3, 176)],
};

const ANSWER_PLAN_BALANCE: DemoAnswer = {
  text:
    "You're well into your plan. You've paid 5 monthly installments so far — $7,750. What's left is $29,450: the 3 payments to catch up on ($4,650) plus 16 more monthly payments of $1,550 after that. If you'd like to go over the plan or adjust how you catch up, the team is glad to help.",
  tables: [
    {
      title: "Your payment plan at a glance",
      columns: ["Part of the plan", "Payments", "Amount"],
      rows: [
        ["Paid so far", 5, "$7,750"],
        ["To catch up on", 3, "$4,650"],
        ["Still to come", 16, "$24,800"],
      ],
    },
  ],
  followups: [Q.nextPayment, Q.howToPay, Q.talkToPerson],
  trace: [trace("installments__plan_status_summary", {}, 3, 191)],
};

const ANSWER_HOW_TO_PAY: DemoAnswer = {
  text:
    "Two easy ways. You can pay at the Monza showroom in Beirut — we're open Monday to Saturday — or the team can arrange it with you directly over the phone. If you'd like, I can ask someone from Monza to call you and set it up.",
  tables: [],
  followups: [Q.nextPayment, Q.showroom, Q.talkToPerson],
  trace: [],
};

/* ── Our cars ───────────────────────────────────────────────────────────── */

const ANSWER_DREAM: DemoAnswer = {
  text:
    "The Voyah Dream is our flagship MPV — seven seats, first-class comfort, and made for travelling together in real style. Families love it, and it's just as at home as an executive shuttle. The team will happily walk you through options and pricing at the showroom or on a call — and there's nothing like sitting in one.",
  tables: [
    {
      title: "Voyah Dream at a glance",
      columns: ["Model", "Type", "In short"],
      rows: [["Voyah Dream", "Flagship MPV, 7 seats", "First-class comfort for the whole family"]],
    },
  ],
  followups: [Q.freeVsDream, Q.testDrive, Q.mhero],
  trace: [trace("inventory__car_lookup", { query: "Dream" }, 1, 162)],
};

const ANSWER_FREE: DemoAnswer = {
  text:
    "The Voyah Free is an electric range-extended SUV — smooth, quiet, and a comfortable size for family life, with the range extender taking away any charging worry on longer drives. It's the car many of our customers fall for first. For options and pricing, the team will walk you through everything at the showroom or on a call.",
  tables: [
    {
      title: "Voyah Free at a glance",
      columns: ["Model", "Type", "In short"],
      rows: [["Voyah Free", "Electric range-extended SUV", "Comfortable family size, no range worry"]],
    },
  ],
  followups: [Q.freeVsDream, Q.dream, Q.testDrive],
  trace: [trace("inventory__car_lookup", { query: "Free" }, 1, 155)],
};

const ANSWER_FREE_VS_DREAM: DemoAnswer = {
  text:
    "They suit different lives. The Free is an electric range-extended SUV — a comfortable family size, easy to live with every day. The Dream is our flagship MPV: seven seats and a lounge-like cabin, built for travelling together in style. The best way to choose is to sit in both — the team will walk you through options and pricing at the showroom or on a call.",
  tables: [
    {
      title: "Voyah Free vs Voyah Dream",
      columns: ["Model", "Body style", "Seats", "Best for"],
      rows: [
        ["Voyah Free", "Range-extended electric SUV", "5", "Everyday family driving"],
        ["Voyah Dream", "Flagship MPV", "7", "Travelling together in comfort"],
      ],
    },
  ],
  followups: [Q.testDrive, Q.free, Q.mhero],
  trace: [trace("inventory__car_lookup", { query: "Voyah" }, 2, 173)],
};

const ANSWER_MHERO: DemoAnswer = {
  text:
    "MHERO is the wild one of the family — a rugged off-road icon built on serious 4x4 engineering, with presence you can spot from a street away. It's for people who want capability and character in the same car. Come see it in person — the team will walk you through options and pricing at the showroom or on a call.",
  tables: [
    {
      title: "MHERO at a glance",
      columns: ["Model", "Type", "In short"],
      rows: [["MHERO", "Rugged off-road 4x4", "An icon built for serious terrain"]],
    },
  ],
  followups: [Q.testDrive, Q.lineup, Q.showroom],
  trace: [trace("inventory__car_lookup", { query: "MHero" }, 1, 167)],
};

const ANSWER_LINEUP: DemoAnswer = {
  text:
    "Monza is Lebanon's exclusive home of Voyah and MHERO. The Voyah side has three characters: the Free, an electric range-extended SUV that's a comfortable family size; the Dream, our flagship seven-seat MPV; and the Passion, an elegant sedan. Then there's MHERO — a rugged off-road icon. The team will walk you through options and pricing at the showroom or on a call.",
  tables: [
    {
      title: "The Monza range",
      columns: ["Model", "Type", "In short"],
      rows: [
        ["Voyah Free", "Range-extended electric SUV", "Comfortable family size"],
        ["Voyah Dream", "Flagship MPV, 7 seats", "First-class travel together"],
        ["Voyah Passion", "Sedan", "Elegant and refined"],
        ["MHERO", "Off-road 4x4", "The rugged icon"],
      ],
    },
  ],
  followups: [Q.dream, Q.mhero, Q.testDrive],
  trace: [],
};

const ANSWER_PRICING: DemoAnswer = {
  text:
    "Pricing, offers and trade-ins are things the Monza team handles personally — every car and every situation is a little different, so I never want to promise you a number here and be wrong. What I can do is have a team member call you, or you can drop by the showroom and they'll go through everything openly with you.",
  tables: [],
  followups: [Q.testDrive, Q.showroom, Q.talkToPerson],
  trace: [],
};

/* ── Visit us ───────────────────────────────────────────────────────────── */

const ANSWER_TEST_DRIVE: DemoAnswer = {
  text:
    "Absolutely — and honestly, it's the best way to get to know these cars. I'll pass your request to the Monza team, and a team member will call you to arrange a day and time that works for you. If you already know which model you'd like to try, mention it when they call and it'll be ready for you.",
  tables: [],
  followups: [Q.showroom, Q.freeVsDream, Q.mhero],
  trace: [],
};

const ANSWER_SHOWROOM: DemoAnswer = {
  text:
    "You'll find us at the Monza SAL showroom in Beirut, Lebanon — we're open Monday to Saturday, and you're welcome any time. If you'd like, the team will send exact directions straight to your phone so you don't have to hunt for us. Come by, have a coffee, and see the cars up close.",
  tables: [],
  followups: [Q.testDrive, Q.lineup, Q.talkToPerson],
  trace: [],
};

const ANSWER_TALK_TO_PERSON: DemoAnswer = {
  text:
    "Of course — sometimes you just want a real voice. I'll ask the Monza team to give you a call, and someone will be in touch shortly. If it's about your car, your payments, or anything else, they'll have the full picture ready when they call.",
  tables: [],
  followups: [Q.carReady, Q.nextPayment, Q.showroom],
  trace: [],
};

/* ── Safety ─────────────────────────────────────────────────────────────── */

const ANSWER_SAFETY: DemoAnswer = {
  text:
    "Thank you for telling me — let's take this seriously, gently. Please stop driving and park somewhere safe. Anything involving brakes, steering, smoke, an unusual smell, or a warning light deserves real attention straight away, and I can't judge over chat whether a car is safe to drive — the Monza team can. Contact them right away, and I can ask someone to call you immediately.",
  tables: [],
  followups: [Q.talkToPerson, Q.bookService],
  trace: [],
};

/* ── Tour and fallback ──────────────────────────────────────────────────── */

const ANSWER_TOUR: DemoAnswer = {
  text:
    "I'm your Monza assistant, and I can help with four things. My car at Monza — how your car is doing in our garage and booking a service visit. My payments — where your plan stands and how to pay. Our cars — the Voyah Free, Dream and Passion, and MHERO. Visit us — test drives, the showroom, or reaching a real person. I only ever see your own Monza information — never anyone else's. Try one of these to start.",
  tables: [],
  followups: [Q.carReady, Q.nextPayment, Q.freeVsDream, Q.testDrive],
  trace: [],
};

const ANSWER_FALLBACK: DemoAnswer = {
  text:
    "I couldn't quite match that one — this is a preview, so I'm working with a small set of example answers rather than the live Monza systems. I can still show you how it feels: try one of the questions below, or pick a topic from the welcome screen.",
  tables: [],
  followups: [Q.carReady, Q.nextPayment, Q.testDrive],
  // No lookup happened, so no chips: the trace only ever shows real checks.
  trace: [],
};

/* ── Matching ───────────────────────────────────────────────────────────── */

type Matcher = { matches: (q: string) => boolean; answer: DemoAnswer };

function any(q: string, needles: string[]): boolean {
  return needles.some((n) => q.includes(n));
}

/** Ordered — first match wins. SAFETY IS ALWAYS FIRST — a danger word wins
 *  over every other reading of the question, including the tour ("what is
 *  this smoke?" must never get the friendly tour). */
const MATCHERS: Matcher[] = [
  {
    // Danger words: urge stopping and contacting Monza — never diagnose.
    matches: (q) =>
      any(q, [
        "brake",
        "steering",
        "smoke",
        "smell",
        "burning",
        "warning",
        "accident",
        "crash",
        "safe to drive",
        "is it safe",
        "leak",
        "fire",
        "danger",
      ]),
    answer: ANSWER_SAFETY,
  },
  {
    matches: (q) =>
      any(q, [
        "what can i ask",
        "what can you do",
        "where do i start",
        "how does this work",
        "what is this",
        "who are you",
        "help me get started",
      ]),
    answer: ANSWER_TOUR,
  },
  {
    matches: (q) =>
      any(q, ["book a service", "service visit", "service appointment", "schedule a service", "schedule an appointment", "maintenance", "service"]),
    answer: ANSWER_BOOK_SERVICE,
  },
  {
    matches: (q) =>
      any(q, ["my car", "ready yet", "ready", "my repair", "repair", "garage", "gj-", "fixed", "being worked on"]),
    answer: ANSWER_CAR_STATUS,
  },
  {
    matches: (q) => any(q, ["how do i make a payment", "how do i pay", "how can i pay", "make a payment", "where do i pay", "ways to pay"]),
    answer: ANSWER_HOW_TO_PAY,
  },
  {
    matches: (q) => any(q, ["left on my plan", "how much is left", "remaining", "balance", "still owe", "i owe", "owed", "paid off"]),
    answer: ANSWER_PLAN_BALANCE,
  },
  {
    matches: (q) =>
      any(q, [
        "next payment",
        "payment due",
        "behind",
        "overdue",
        "catch up",
        "late",
        "missed",
        "installment",
        "my payments",
        "payment plan",
        "payment",
        "due",
      ]),
    answer: ANSWER_NEXT_PAYMENT,
  },
  {
    // Money questions about cars — always a personal conversation, never a promise.
    matches: (q) =>
      any(q, ["price", "pricing", "how much is", "how much does", "cost", "discount", "trade-in", "trade in", "offer", "deal", "finance"]),
    answer: ANSWER_PRICING,
  },
  {
    matches: (q) => any(q, ["difference", "compare", "versus", " vs "]) || (q.includes("free") && q.includes("dream")),
    answer: ANSWER_FREE_VS_DREAM,
  },
  { matches: (q) => any(q, ["dream"]), answer: ANSWER_DREAM },
  { matches: (q) => any(q, ["voyah free", "the free", "free"]), answer: ANSWER_FREE },
  { matches: (q) => any(q, ["mhero", "m hero", "917", "off-road", "offroad", "off road"]), answer: ANSWER_MHERO },
  {
    matches: (q) => any(q, ["passion", "what cars", "which cars", "models", "model", "lineup", "line-up", "range", "sell", "voyah"]),
    answer: ANSWER_LINEUP,
  },
  { matches: (q) => any(q, ["test drive", "test-drive", "try the", "try one", "drive one"]), answer: ANSWER_TEST_DRIVE },
  {
    matches: (q) =>
      any(q, ["showroom", "where are you", "when are you open", "open", "hours", "location", "address", "directions", "visit you", "come in", "come by"]),
    answer: ANSWER_SHOWROOM,
  },
  {
    matches: (q) =>
      any(q, ["person", "human", "someone", "speak", "talk to", "call me", "call", "contact", "phone", "whatsapp", "agent", "complain"]),
    answer: ANSWER_TALK_TO_PERSON,
  },
];

/** Loose, case-insensitive routing from a question to a scripted answer.
 *  Every question in RECOMMENDED_CHATS and every followup emitted by any
 *  answer resolves here — chains never dead-end. */
export function demoAnswer(question: string): DemoAnswer {
  const q = question.toLowerCase().replace(/\s+/g, " ").trim();
  for (const m of MATCHERS) {
    if (m.matches(q)) return m.answer;
  }
  return ANSWER_FALLBACK;
}
