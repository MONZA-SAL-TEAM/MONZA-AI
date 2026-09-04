/**
 * Invented dataset for the Customers & Sales directory — served ONLY while
 * MONZA AI is not connected to the live CRM. Every name, phone, VIN, plate
 * and amount is fake; the screen must always carry the note
 * "Example data — not connected to the Monza systems yet."
 *
 * Everything here is FIXED — no Date, no random — so server and client can
 * never disagree (hydration-safe by design). First-contact dates are plain
 * strings from the story, never computed from a clock.
 *
 * The directory agrees EXACTLY with the rest of the demo universe:
 *   - the 5 recent enquiries and their sources/dates mirror the chat's
 *     ANSWER_NEW_LEADS and ANSWER_LEAD_SOURCES (lib/chat/demo-answers.ts):
 *     George Sassine (referral, 25 Aug) is the freshest, then Layal (walk-in,
 *     20 Aug), Rami (Instagram, 12 Aug), Karim (Instagram, 5 Aug) and Nour
 *     (website, 30 Jul). Instagram 2 / walk-in 1 / referral 1 / website 1.
 *   - 4 of the 5 arrived in August, so "New this month" is 4 (Nour is
 *     recent but July, exactly as the chat says).
 *   - names, phones, VINs, plan numbers, job numbers and statuses are the
 *     canon the rest of the demo derives from. Rami's plate
 *     "B 123456" and George's "G 778899" are the very plates the chat's
 *     tables already show. Every other plate is invented and unique.
 */

/** Where a customer first came from — the four enquiry channels the chat
 *  counts, plus the honest label for people who predate this month's push. */
export type CustomerSource =
  | "Instagram"
  | "Showroom walk-in"
  | "Referral"
  | "Website"
  | "Longtime customer";

export const CUSTOMER_SOURCES: CustomerSource[] = [
  "Instagram",
  "Showroom walk-in",
  "Referral",
  "Website",
  "Longtime customer",
];

/** Snapshot of the customer's payment plan. lib/domain/demo-source.ts expands
 *  this into individual installments, so this is the single source for them.
 *  paidUsd is only present when it differs from paidCount × monthly (Karim's
 *  banked half-payment). */
export interface PlanSnapshot {
  paidCount: number;
  totalCount: number;
  monthlyUsd: number;
  /** Dollars actually banked — defaults to paidCount × monthlyUsd. */
  paidUsd?: number;
  behind?: boolean;
  /** How many installments behind — only when behind. */
  behindCount?: number;
}

/** Snapshot of the customer's open garage job — mirrors
 *  the garage's own words. lib/domain/demo-source.ts maps these to the
 *  communication-relevant vehicle statuses. */
export interface GarageSnapshot {
  jobNumber: string;
  /** Plain words: "Waiting for parts", "In progress", "Waiting to start". */
  status: string;
  neededPart?: string;
}

export interface DirectoryCustomer {
  name: string;
  /** Obviously-synthetic digits, no plus — "9613100001". */
  phone: string;
  carLabel: string;
  vin: string;
  /** Clearly-fake Lebanese-style plate, unique across the directory. */
  plate: string;
  source: CustomerSource;
  /** Plain string from the story — "25 Aug 2026". Never a computed date. */
  firstContact: string;
  /** True only for the four August enquiries the chat counts. */
  isNewThisMonth: boolean;
  plan?: PlanSnapshot;
  garage?: GarageSnapshot;
}

export interface CustomerDirectory {
  /** Fixed label for the example period — mirrors the other boards' chip. */
  periodLabel: string;
  customers: DirectoryCustomer[];
}

/* ── One row per person, stories merged. Listed newest-enquiry-first, then
     the longtime customers — the client renders this order as-is, so the
     "New this month" rail needs no date parsing. ─────────────────────────── */

const CUSTOMERS: DirectoryCustomer[] = [
  {
    // The freshest enquiry in the chat — the one to call first.
    name: "George Sassine",
    phone: "9613100003",
    carLabel: "MHero 917 2025",
    vin: "LDNMHER9XSD771205",
    plate: "G 778899", // the chat's garage table shows this exact plate
    source: "Referral",
    firstContact: "25 Aug 2026",
    isNewThisMonth: true,
    plan: { paidCount: 3, totalCount: 10, monthlyUsd: 2400 },
    garage: {
      jobNumber: "GJ-2026-0151",
      status: "Waiting for parts",
      neededPart: "Infotainment display unit",
    },
  },
  {
    name: "Layal Barakat",
    phone: "9613100002",
    carLabel: "Voyah Courage 2026",
    vin: "LDNVYACG3TD305128",
    plate: "M 452310",
    source: "Showroom walk-in",
    firstContact: "20 Aug 2026",
    isNewThisMonth: true,
    plan: { paidCount: 7, totalCount: 12, monthlyUsd: 980 },
    garage: { jobNumber: "GJ-2026-0155", status: "In progress" },
  },
  {
    // The chat's flagship customer: Instagram lead, $1,550/month plan
    // 3 installments behind, and his Voyah Free stuck on a suspension part.
    name: "Rami Kanaan",
    phone: "9613100001",
    carLabel: "Voyah Free 2025",
    vin: "LDNVYAFR8SD210457",
    plate: "B 123456", // the chat quotes this plate for Rami's Free
    source: "Instagram",
    firstContact: "12 Aug 2026",
    isNewThisMonth: true,
    plan: { paidCount: 5, totalCount: 20, monthlyUsd: 1550, behind: true, behindCount: 3 },
    garage: {
      jobNumber: "GJ-2026-0142",
      status: "Waiting for parts",
      neededPart: "Control-arm bushing",
    },
  },
  {
    name: "Karim Azar",
    phone: "9613100005",
    carLabel: "Voyah Free 2025",
    vin: "LDNVYAFR6SD152219",
    plate: "B 654321",
    source: "Instagram",
    firstContact: "5 Aug 2026",
    isNewThisMonth: true,
    // 10 full installments plus the $850 half-payment banked toward #11 —
    // the same story the tracker and the chat tell.
    plan: {
      paidCount: 10,
      totalCount: 18,
      monthlyUsd: 1700,
      paidUsd: 17850,
      behind: true,
      behindCount: 1,
    },
    garage: { jobNumber: "GJ-2026-0159", status: "Waiting to start" },
  },
  {
    // Recent, but end of July — she is NOT counted in "New this month",
    // exactly as the chat's answer says (4 in August + Nour from 30 July).
    name: "Nour Haddad",
    phone: "9613100004",
    carLabel: "Voyah Dream 2026",
    vin: "LDNVYADR2TD418306",
    plate: "T 908172",
    source: "Website",
    firstContact: "30 Jul 2026",
    isNewThisMonth: false,
    plan: { paidCount: 3, totalCount: 12, monthlyUsd: 1200, behind: true, behindCount: 2 },
    garage: { jobNumber: "GJ-2026-0148", status: "In progress" },
  },
  {
    name: "Hala Nassar",
    phone: "9613100006",
    carLabel: "Voyah Passion 2026",
    vin: "LDNVYAPS4TD520037",
    plate: "N 227384",
    source: "Longtime customer",
    firstContact: "3 Jul 2026",
    isNewThisMonth: false,
    plan: { paidCount: 1, totalCount: 24, monthlyUsd: 1150 },
    garage: { jobNumber: "GJ-2026-0158", status: "Waiting to start" },
  },
  {
    name: "Maya Chidiac",
    phone: "9613100008",
    carLabel: "Voyah Dream 2026",
    vin: "LDNVYADR5TD473552",
    plate: "S 118409",
    source: "Longtime customer",
    firstContact: "2 Feb 2026",
    isNewThisMonth: false,
    plan: { paidCount: 4, totalCount: 15, monthlyUsd: 1750 },
    garage: { jobNumber: "GJ-2026-0153", status: "In progress" },
  },
  {
    name: "Tony Gemayel",
    phone: "9613100007",
    carLabel: "MHero 917 2025",
    vin: "LDNMHER7XSD668914",
    plate: "G 331245",
    source: "Longtime customer",
    firstContact: "14 Mar 2025",
    isNewThisMonth: false,
    plan: { paidCount: 8, totalCount: 16, monthlyUsd: 2900 },
    garage: { jobNumber: "GJ-2026-0157", status: "In progress" },
  },
  {
    // Garage walk-in with no payment plan — his job card GJ-2026-0160 is
    // waiting for a free bay on the garage board.
    name: "Ziad Fares",
    phone: "9613100009",
    carLabel: "Voyah Free 2024",
    vin: "LDNVYAFR2RD098431",
    plate: "B 240586",
    source: "Longtime customer",
    firstContact: "18 Nov 2024",
    isNewThisMonth: false,
    garage: { jobNumber: "GJ-2026-0160", status: "Waiting to start" },
  },
  {
    // Her aircon job GJ-2026-0137 was delivered back — so no open garage
    // snapshot here; she simply isn't "in the garage" any more.
    name: "Rita Khoury",
    phone: "9613100010",
    carLabel: "Voyah Passion 2026",
    vin: "LDNVYAPS8TD331642",
    plate: "M 776201",
    source: "Longtime customer",
    firstContact: "9 Sep 2025",
    isNewThisMonth: false,
  },
];

export const DEMO_CUSTOMER_DIRECTORY: CustomerDirectory = {
  periodLabel: "August 2026",
  customers: CUSTOMERS,
};
