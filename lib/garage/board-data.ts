/**
 * Invented dataset for the Garage & Vehicles board — served ONLY while
 * MONZA AI is not connected to the live systems. Every name, VIN, plate and
 * count is fake; the screen must always carry the note
 * "Example data — not connected to the Monza systems yet."
 *
 * Everything here is FIXED — no Date, no random — so server and client can
 * never disagree (hydration-safe by design). daysInGarage is part of the
 * dataset, not computed from a clock.
 *
 * The numbers agree EXACTLY with the chat's demo stories
 * (lib/connectors/demo-data.ts + lib/chat/demo-answers.ts):
 *   - open jobs: 3 waiting to start, 4 in progress, 2 waiting for parts = 9
 *   - GJ-2026-0142 is Rami Kanaan's Voyah Free waiting on a control-arm
 *     bushing; GJ-2026-0151 is George Sassine's MHero 917 waiting on an
 *     infotainment display
 *   - the fleet is 36 cars (24 Voyah, 12 MHero); one Voyah Dream is on the
 *     showroom floor and free to sell
 *   - the three low parts and their part numbers match the chat's list
 * People and VINs reuse lib/tracker/demo-month.ts, so the whole demo tells
 * one story.
 */

export type GarageJobStatus =
  | "waiting"
  | "working"
  | "waiting_parts"
  | "ready"
  | "delivered";

export interface GarageJob {
  /** "GJ-2026-XXXX" — the number staff quote on the phone. */
  jobNumber: string;
  clientName: string;
  carLabel: string;
  vin: string;
  status: GarageJobStatus;
  /** One warm sentence — the last thing that happened on the job. */
  latestUpdate: string;
  /** Only meaningful while status is "waiting_parts". */
  neededPart?: string;
  /** Fixed number in the dataset — never computed from the clock. */
  daysInGarage: number;
}

export interface StockModel {
  /** Plain model label, e.g. "Voyah Dream". */
  model: string;
  /** Cars on the books for this model — all statuses, sold included. */
  count: number;
  /** One line answering the question people actually ask about this model. */
  note: string;
}

export interface LowPart {
  name: string;
  partNumber: string;
  inStock: number;
  minLevel: number;
}

export interface GarageBoard {
  /** Fixed label for the example period — mirrors the tracker's month chip. */
  periodLabel: string;
  jobs: GarageJob[];
  stock: StockModel[];
  lowParts: LowPart[];
}

/* ── Jobs: 3 waiting + 4 working + 2 waiting_parts = 9 open, 1 delivered ─── */

const JOBS: GarageJob[] = [
  {
    // The chat's flagship job story, verbatim: high-priority Voyah Free,
    // in since 18 August, blocked on a control-arm bushing.
    jobNumber: "GJ-2026-0142",
    clientName: "Rami Kanaan",
    carLabel: "Voyah Free 2025",
    vin: "LDNVYAFR8SD210457",
    status: "waiting_parts",
    latestUpdate: "Part still on its way — Rami knows, and we'll call him the moment it lands.",
    neededPart: "Control-arm bushing",
    daysInGarage: 14,
  },
  {
    // The second waiting-parts job the chat lists.
    jobNumber: "GJ-2026-0151",
    clientName: "George Sassine",
    carLabel: "MHero 917 2025",
    vin: "LDNMHER9XSD771205",
    status: "waiting_parts",
    latestUpdate: "Screen flicker confirmed on the lift — a replacement display unit is on order.",
    neededPart: "Infotainment display unit",
    daysInGarage: 8,
  },
  {
    jobNumber: "GJ-2026-0148",
    clientName: "Nour Haddad",
    carLabel: "Voyah Dream 2026",
    vin: "LDNVYADR2TD418306",
    status: "working",
    latestUpdate: "Sliding-door rattle traced to a loose rail — tightening and road-testing today.",
    daysInGarage: 6,
  },
  {
    jobNumber: "GJ-2026-0153",
    clientName: "Maya Chidiac",
    carLabel: "Voyah Dream 2026",
    vin: "LDNVYADR5TD473552",
    status: "working",
    latestUpdate: "10,000 km service under way — battery health check came back excellent.",
    daysInGarage: 3,
  },
  {
    jobNumber: "GJ-2026-0155",
    clientName: "Layal Barakat",
    carLabel: "Voyah Courage 2026",
    vin: "LDNVYACG3TD305128",
    status: "working",
    latestUpdate: "Software update installing now — about an hour to go, then a final check.",
    daysInGarage: 2,
  },
  {
    jobNumber: "GJ-2026-0157",
    clientName: "Tony Gemayel",
    carLabel: "MHero 917 2025",
    vin: "LDNMHER7XSD668914",
    status: "working",
    latestUpdate: "Underbody inspection after an off-road trip — nothing alarming so far.",
    daysInGarage: 1,
  },
  {
    jobNumber: "GJ-2026-0158",
    clientName: "Hala Nassar",
    carLabel: "Voyah Passion 2026",
    vin: "LDNVYAPS4TD520037",
    status: "waiting",
    latestUpdate: "Booked in for a slow-charging complaint — first on the lift tomorrow morning.",
    daysInGarage: 1,
  },
  {
    jobNumber: "GJ-2026-0159",
    clientName: "Karim Azar",
    carLabel: "Voyah Free 2025",
    vin: "LDNVYAFR6SD152219",
    status: "waiting",
    latestUpdate: "Dropped off this morning for a squeaking brake — waiting for a free bay.",
    daysInGarage: 1,
  },
  {
    jobNumber: "GJ-2026-0160",
    clientName: "Ziad Fares",
    carLabel: "Voyah Free 2024",
    vin: "LDNVYAFR2RD098431",
    status: "waiting",
    latestUpdate: "Walk-in for a windscreen chip — car parked and keys logged, not started yet.",
    daysInGarage: 1,
  },
  {
    jobNumber: "GJ-2026-0137",
    clientName: "Rita Khoury",
    carLabel: "Voyah Passion 2026",
    vin: "LDNVYAPS8TD331642",
    status: "delivered",
    latestUpdate: "Aircon regassed and delivered back — Rita picked the car up happy.",
    daysInGarage: 2,
  },
];

/* ── Cars on the books: 24 Voyah + 12 MHero = 36, as the chat quotes ──────── */

const STOCK: StockModel[] = [
  {
    model: "Voyah Free",
    count: 11,
    note: "Our best seller — most are delivered, 3 ready to sell today.",
  },
  {
    model: "Voyah Dream",
    count: 6,
    note: "1 available now — a 2026 on the showroom floor, no plate yet, free to sell.",
  },
  {
    model: "Voyah Passion",
    count: 7,
    note: "2 on the way to us — good time to take deposits.",
  },
  {
    model: "MHERO",
    count: 12,
    note: "Two 917s are in the garage right now; the rest are with their owners.",
  },
];

/* ── Parts below minimum — same numbers the chat quotes ───────────────────── */

const LOW_PARTS: LowPart[] = [
  { name: "Front brake pad set (MHero 917)", partNumber: "MH-BRK-107", inStock: 0, minLevel: 2 },
  { name: "Cabin air filter (Voyah Free)", partNumber: "VF-CAF-021", inStock: 1, minLevel: 4 },
  { name: "Wiper blade pair", partNumber: "GN-WPR-003", inStock: 2, minLevel: 6 },
];

export const DEMO_GARAGE_BOARD: GarageBoard = {
  periodLabel: "August 2026",
  jobs: JOBS,
  stock: STOCK,
  lowParts: LOW_PARTS,
};
