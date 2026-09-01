import type { AnswerTable, RecommendedChat } from "@/lib/chat/contract";
import type { ToolTraceEntry } from "@/lib/ai/loop";

/**
 * The demo conversation engine — pure data, pure functions, importable from
 * "use client" components. No server-only imports (ToolTraceEntry comes in as
 * a type only, so nothing from lib/ai/loop reaches the client bundle).
 *
 * Every figure and name here is invented and mirrors lib/connectors/demo-data.ts
 * exactly, so a demo conversation and a real demo-mode tool call never
 * contradict each other. Trace entries use REAL qualified tool names
 * ("<connector>__<tool>") from the closed registry — nothing invented.
 */

export interface DemoAnswer {
  text: string;
  tables: AnswerTable[];
  followups: string[];
  trace: ToolTraceEntry[];
}

/* ── The 15 recommended questions (3 per department) ────────────────────── */

const Q = {
  // Customers & Sales
  newLeads: "Which new customers came in this month?",
  leadSources: "Where are our new customers coming from?",
  ramiSummary: "Give me a summary of Rami Kanaan's account.",
  // Installments & Payments (two of Samer's flagship questions live here)
  overdue: "Which customers have overdue installments over $2,000?",
  collections: "How much did we collect this month?",
  planHealth: "How are our payment plans doing overall?",
  // Garage & Service (flagship: cars waiting for repair + parts)
  waitingParts: "Which cars are waiting for repair or parts?",
  openJobs: "How many jobs are open in the garage right now?",
  jobStatus: "What's the status of job GJ-2026-0142?",
  // Vehicles & Parts
  carsInStock: "How many cars do we have in stock?",
  lowParts: "Which parts are running low?",
  dream: "Do we have a Voyah Dream available?",
  // Money & Reports
  sales: "How were sales this month?",
  costs: "What did we spend this month?",
  owed: "How much money is still owed to us on payment plans?",
} as const;

export const RECOMMENDED_CHATS: RecommendedChat[] = [
  {
    key: "crm",
    label: "Customers & Sales",
    blurb: "Look up any customer and see where new enquiries are coming from.",
    questions: [Q.newLeads, Q.leadSources, Q.ramiSummary],
  },
  {
    key: "installments",
    label: "Installments & Payments",
    blurb: "Who is behind on payments, what came in, and how the plans are doing.",
    questions: [Q.overdue, Q.collections, Q.planHealth],
  },
  {
    // Garage & Service and Vehicles & Parts merged into ONE card: jobs, cars
    // and parts live together on /departments/garage-vehicles. All six
    // original questions stay verbatim so every matcher still fires.
    key: "garage",
    label: "Garage & Vehicles",
    blurb:
      "Open jobs, cars stuck waiting for parts, cars on hand, and parts running low.",
    questions: [Q.waitingParts, Q.openJobs, Q.jobStatus, Q.carsInStock, Q.lowParts, Q.dream],
  },
  {
    key: "finance",
    label: "Money & Reports",
    blurb: "Sales orders, company costs, and what payment plans are still owed — each answer says which records it used.",
    questions: [Q.sales, Q.costs, Q.owed],
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

/* ── The scripted answers ───────────────────────────────────────────────── */

const ANSWER_OVERDUE: DemoAnswer = {
  text:
    "2 customers owe more than $2,000 — $7,050 in total. Rami Kanaan is the one to chase first: 3 unpaid installments of $1,550 going back to early June, $4,650 altogether. Nour Haddad has 2 missed payments for $2,400. Karim Azar is also late, but at $850 he's under your threshold.",
  tables: [
    {
      title: "Overdue installments over $2,000",
      columns: ["Customer", "Installment", "Due date", "Amount due"],
      rows: [
        ["Rami Kanaan", "#6", "5 Jun 2026", "$1,550"],
        ["Rami Kanaan", "#7", "5 Jul 2026", "$1,550"],
        ["Rami Kanaan", "#8", "5 Aug 2026", "$1,550"],
        ["Nour Haddad", "#4", "10 Jul 2026", "$1,200"],
        ["Nour Haddad", "#5", "10 Aug 2026", "$1,200"],
      ],
    },
  ],
  followups: [Q.collections, Q.planHealth, Q.ramiSummary],
  trace: [trace("installments__overdue_installments", { min_amount_usd: 2000 }, 5, 236)],
};

const ANSWER_COLLECTIONS: DemoAnswer = {
  text:
    "August has been steady: $21,350 collected across 14 installment payments so far. The pace has held at roughly $5,000 a week, so if the last days of the month behave we should land around $23,000. Here's how it came in week by week.",
  tables: [
    {
      title: "Collections in August 2026",
      columns: ["Week", "Payments received", "Amount collected"],
      rows: [
        ["1 – 7 Aug", 4, "$6,100"],
        ["8 – 14 Aug", 3, "$4,350"],
        ["15 – 21 Aug", 4, "$5,900"],
        ["22 – 28 Aug", 3, "$5,000"],
      ],
    },
  ],
  followups: [Q.overdue, Q.planHealth, Q.sales],
  trace: [trace("installments__collections_this_month", {}, 4, 158)],
};

const ANSWER_PLAN_HEALTH: DemoAnswer = {
  text:
    "Overall the book looks healthy. We have 19 payment plans in total: 11 running, 6 fully paid off, and only 1 defaulted plus 1 cancelled. The money still owed to us across all active plans is $187,400 — worth keeping an eye on the 3 customers who are currently behind.",
  tables: [
    {
      title: "Payment plans by status",
      columns: ["Status", "Plans", "What it means"],
      rows: [
        ["Active", 11, "Still paying — $187,400 outstanding"],
        ["Completed", 6, "Fully paid off"],
        ["Defaulted", 1, "Stopped paying — needs follow-up"],
        ["Cancelled", 1, "Plan closed early"],
      ],
    },
  ],
  followups: [Q.overdue, Q.collections],
  trace: [trace("installments__plan_status_summary", {}, 4, 191)],
};

const ANSWER_WAITING_PARTS: DemoAnswer = {
  text:
    "2 cars are stuck in the garage waiting for parts right now. Rami Kanaan's Voyah Free has been waiting the longest — since 18 August — for a control-arm bushing to fix a front suspension knock, and it's marked high priority. George Sassine's MHero 917 needs a replacement infotainment display.",
  tables: [
    {
      title: "Garage jobs waiting for parts",
      columns: ["Job", "Car", "Customer", "Waiting for", "Since"],
      rows: [
        ["GJ-2026-0142", "Voyah Free — B 123456", "Rami Kanaan", "Control-arm bushing", "18 Aug 2026"],
        ["GJ-2026-0151", "MHero 917 — G 778899", "George Sassine", "Infotainment display unit", "24 Aug 2026"],
      ],
    },
  ],
  followups: [Q.lowParts, Q.openJobs, Q.jobStatus],
  trace: [trace("garage__jobs_waiting_parts", {}, 2, 205)],
};

const ANSWER_OPEN_JOBS: DemoAnswer = {
  text:
    "The garage has 9 open jobs at the moment: 3 booked and waiting to start, 4 being worked on, and 2 blocked on parts. Two of the nine are marked high priority, so those are the ones to watch if a customer calls.",
  tables: [
    {
      title: "Open garage jobs",
      columns: ["Stage", "Jobs", "Notes"],
      rows: [
        ["Waiting to start", 3, "Booked in, not yet on a lift"],
        ["In progress", 4, "Technicians working on them now"],
        ["Waiting for parts", 2, "Blocked until parts arrive"],
      ],
    },
  ],
  followups: [Q.waitingParts, Q.jobStatus],
  trace: [trace("garage__open_jobs_summary", {}, 3, 173)],
};

const ANSWER_JOB_STATUS: DemoAnswer = {
  text:
    "Job GJ-2026-0142 is Rami Kanaan's Voyah Free (plate B 123456). It came in on 18 August with a knock from the front-left suspension, it's marked high priority, and it's currently waiting on a control-arm bushing before work can continue. Here's the story so far.",
  tables: [
    {
      title: "Job GJ-2026-0142 — timeline",
      columns: ["Date", "Update", "Status after"],
      rows: [
        ["18 Aug 2026", "Car received — front-left suspension knock reported", "Open"],
        ["19 Aug 2026", "Inspected on the lift — worn control-arm bushing found", "Diagnosed"],
        ["20 Aug 2026", "Replacement bushing ordered", "Waiting for parts"],
        ["Today", "Part still on its way — customer aware", "Waiting for parts"],
      ],
    },
  ],
  followups: [Q.waitingParts, Q.ramiSummary, Q.lowParts],
  trace: [trace("garage__job_lookup", { job_number: "GJ-2026-0142" }, 4, 142)],
};

const ANSWER_NEW_LEADS: DemoAnswer = {
  text:
    "5 new customer enquiries came in recently — 4 during August plus one from the very end of July. Instagram is doing the heaviest lifting with 2 of the 5. George Sassine is the freshest enquiry (25 August, a referral), so he's the one to call first.",
  tables: [
    {
      title: "New customer enquiries",
      columns: ["Customer", "Came from", "First contact"],
      rows: [
        ["George Sassine", "Referral", "25 Aug 2026"],
        ["Layal Barakat", "Showroom walk-in", "20 Aug 2026"],
        ["Rami Kanaan", "Instagram", "12 Aug 2026"],
        ["Karim Azar", "Instagram", "5 Aug 2026"],
        ["Nour Haddad", "Website", "30 Jul 2026"],
      ],
    },
  ],
  followups: [Q.leadSources, Q.sales, Q.ramiSummary],
  trace: [trace("crm__recent_leads", { days: 30 }, 5, 227)],
};

const ANSWER_LEAD_SOURCES: DemoAnswer = {
  text:
    "Instagram is our strongest channel right now — 2 of the last 5 enquiries started there. The rest came one each from a showroom walk-in, a referral, and the website. If you're deciding where to put marketing effort, Instagram is earning its keep.",
  tables: [
    {
      title: "Where new customers came from",
      columns: ["Source", "New customers", "Share"],
      rows: [
        ["Instagram", 2, "40%"],
        ["Showroom walk-in", 1, "20%"],
        ["Referral", 1, "20%"],
        ["Website", 1, "20%"],
      ],
    },
  ],
  followups: [Q.newLeads, Q.sales],
  trace: [trace("crm__recent_leads", { days: 30 }, 4, 214)],
};

const ANSWER_RAMI: DemoAnswer = {
  text:
    "Rami Kanaan came in through Instagram on 12 August and took delivery of a 2025 Voyah Free (plate B 123456) at $62,500. He's on one payment plan of $1,550 a month — and he's currently 3 installments behind, owing $4,650 with the oldest going back to 5 June. His car is also in the garage waiting for a suspension part, so a single call could cover both topics.",
  tables: [
    {
      title: "Rami Kanaan at a glance",
      columns: ["Item", "Detail", "Status"],
      rows: [
        ["Vehicle", "Voyah Free 2025 — plate B 123456", "Delivered"],
        ["Payment plan", "$1,550 per month", "3 installments overdue"],
        ["Overdue balance", "$4,650", "Oldest due 5 Jun 2026"],
        ["Contact", "+961 3 100 001", "Instagram lead"],
      ],
    },
  ],
  followups: [Q.overdue, Q.jobStatus, Q.collections],
  trace: [
    trace("crm__search_customers", { query: "Rami Kanaan" }, 1, 121),
    trace("crm__customer_summary", { customer_id: "d1" }, 4, 189),
  ],
};

const ANSWER_CARS_IN_STOCK: DemoAnswer = {
  text:
    "We have 36 cars on the books — 24 Voyah and 12 MHero. Of those, 19 are still in our hands: 7 in stock, 3 on the showroom floor, 2 reserved for customers, 4 on the way to us, 2 in the garage, and 1 demo car. The other 17 are sold or already delivered.",
  tables: [
    {
      title: "Cars currently in our hands",
      columns: ["Status", "Cars", "What it means"],
      rows: [
        ["In stock", 7, "Ready to sell"],
        ["Showroom", 3, "On the showroom floor"],
        ["Reserved", 2, "Held for a customer"],
        ["Inbound", 4, "On the way to us"],
        ["In service", 2, "In the garage"],
        ["Demo", 1, "Test-drive car"],
      ],
    },
  ],
  followups: [Q.lowParts, Q.dream, Q.sales],
  trace: [trace("inventory__cars_in_stock_summary", {}, 6, 248)],
};

const ANSWER_LOW_PARTS: DemoAnswer = {
  text:
    "3 parts are below their minimum levels, and one is completely out: the MHero 917 front brake pad set has zero on the shelf against a minimum of 2 — that's the urgent one. Voyah Free cabin air filters and wiper blades are also running thin.",
  tables: [
    {
      title: "Parts below minimum stock",
      columns: ["Part", "Part number", "In stock", "Minimum"],
      rows: [
        ["Front brake pad set (MHero 917)", "MH-BRK-107", 0, 2],
        ["Cabin air filter (Voyah Free)", "VF-CAF-021", 1, 4],
        ["Wiper blade pair", "GN-WPR-003", 2, 6],
      ],
    },
  ],
  followups: [Q.waitingParts, Q.carsInStock],
  trace: [trace("inventory__low_stock_parts", {}, 3, 182)],
};

const ANSWER_DREAM: DemoAnswer = {
  text:
    "Yes — there's one Voyah Dream, a 2026 model, sitting on the showroom floor right now with no plate yet, so it's free to sell. For context, here's everything the lookup found: the Dream, a delivered Voyah Free, and an MHero 917 that's currently in the garage.",
  tables: [
    {
      title: "Vehicle lookup results",
      columns: ["Brand", "Model", "Year", "Plate", "Status"],
      rows: [
        ["Voyah", "Dream", 2026, null, "Showroom — available"],
        ["Voyah", "Free", 2025, "B 123456", "Delivered"],
        ["MHero", "917", 2025, "G 778899", "In service"],
      ],
    },
  ],
  followups: [Q.carsInStock, Q.sales],
  trace: [trace("inventory__car_lookup", { query: "Dream" }, 3, 168)],
};

const ANSWER_SALES: DemoAnswer = {
  text:
    "A good August: 4 orders worth $241,800 in total. Two cars were delivered ($119,900 between them), one order is paid and awaiting handover, and one more is confirmed and working through paperwork. That's a healthy pipeline going into September.",
  tables: [
    {
      title: "Sales in August 2026",
      columns: ["Order status", "Orders", "Value"],
      rows: [
        ["Delivered", 2, "$119,900"],
        ["Paid", 1, "$58,900"],
        ["Confirmed", 1, "$63,000"],
      ],
    },
  ],
  followups: [Q.costs, Q.collections, Q.carsInStock],
  trace: [trace("finance__sales_this_month", {}, 3, 263)],
};

const ANSWER_COSTS: DemoAnswer = {
  text:
    "We've spent $18,420 in August across 9 cost entries. Half of it is shipping and customs at $9,200 — normal when cars are inbound. Showroom utilities and marketing are the next biggest lines. Against $241,800 in sales, the month looks comfortable.",
  tables: [
    {
      title: "Spending in August 2026",
      columns: ["Category", "Amount", "Share of month"],
      rows: [
        ["Shipping & customs", "$9,200", "50%"],
        ["Showroom utilities", "$3,150", "17%"],
        ["Marketing", "$2,800", "15%"],
        ["Everything else", "$3,270", "18%"],
      ],
    },
  ],
  followups: [Q.sales, Q.collections],
  trace: [trace("finance__monthly_costs_summary", {}, 4, 220)],
};

const ANSWER_TOUR: DemoAnswer = {
  text:
    "You can ask me about four areas of the business, in plain language. Customers & Sales — find any customer and see where new enquiries come from. Installments & Payments — who's behind, what we collected, and plan health. Garage & Vehicles — open jobs, cars stuck waiting for parts, cars in stock, and parts running low. Money & Reports — monthly sales, spending, and what's still owed to us. Try one of these to start.",
  tables: [],
  followups: [Q.overdue, Q.waitingParts, Q.collections, Q.carsInStock],
  trace: [],
};

function fallbackAnswer(question: string): DemoAnswer {
  return {
    text:
      "I couldn't match that one — this is the demo, so I'm working with a small set of example data rather than the live systems. I can still show you how a real answer looks: try one of the questions below, or pick a topic from the welcome screen.",
    tables: [],
    followups: [Q.overdue, Q.waitingParts, Q.collections],
    // No lookup happened, so no chips: the trace only ever shows real checks.
    trace: [],
  };
}

/* ── Matching ───────────────────────────────────────────────────────────── */

type Matcher = { matches: (q: string) => boolean; answer: DemoAnswer };

function any(q: string, needles: string[]): boolean {
  return needles.some((n) => q.includes(n));
}

/** Ordered — first match wins. Specific phrases before broad keywords. */
const MATCHERS: Matcher[] = [
  {
    matches: (q) =>
      any(q, ["what can i ask", "what can you do", "where do i start", "what do you know", "help me get started"]),
    answer: ANSWER_TOUR,
  },
  { matches: (q) => any(q, ["overdue", "behind on", "late on", "who owes", "missed payment"]), answer: ANSWER_OVERDUE },
  { matches: (q) => any(q, ["collect"]), answer: ANSWER_COLLECTIONS },
  {
    matches: (q) => any(q, ["payment plan", "plans doing", "owed", "outstanding", "plan health", "plans"]),
    answer: ANSWER_PLAN_HEALTH,
  },
  { matches: (q) => any(q, ["gj-", "status of job", "job number"]), answer: ANSWER_JOB_STATUS },
  { matches: (q) => any(q, ["waiting"]), answer: ANSWER_WAITING_PARTS },
  {
    matches: (q) => any(q, ["running low", "low stock", "reorder"]) || (q.includes("low") && q.includes("part")),
    answer: ANSWER_LOW_PARTS,
  },
  { matches: (q) => any(q, ["jobs", "garage", "workshop", "service bay"]), answer: ANSWER_OPEN_JOBS },
  { matches: (q) => any(q, ["coming from", "lead source", "which channel", "marketing channel"]), answer: ANSWER_LEAD_SOURCES },
  { matches: (q) => any(q, ["lead", "new customer", "new enquir", "new inquir"]), answer: ANSWER_NEW_LEADS },
  { matches: (q) => any(q, ["rami", "kanaan", "summary of"]), answer: ANSWER_RAMI },
  { matches: (q) => any(q, ["dream", "available"]), answer: ANSWER_DREAM },
  { matches: (q) => any(q, ["stock", "how many cars", "cars do we have", "inventory"]), answer: ANSWER_CARS_IN_STOCK },
  { matches: (q) => any(q, ["sales", "sold", "orders"]), answer: ANSWER_SALES },
  { matches: (q) => any(q, ["spend", "cost", "expense"]), answer: ANSWER_COSTS },
];

/** Loose, case-insensitive routing from a question to a scripted answer.
 *  Every question in RECOMMENDED_CHATS and every followup emitted by any
 *  answer resolves here — chains never dead-end. */
export function demoAnswer(question: string): DemoAnswer {
  const q = question.toLowerCase().replace(/\s+/g, " ").trim();
  for (const m of MATCHERS) {
    if (m.matches(q)) return m.answer;
  }
  return fallbackAnswer(question);
}
