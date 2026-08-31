/**
 * Invented August 2026 dataset for the payment tracker — served ONLY while
 * MONZA AI is not connected to the live installment system. Every name,
 * phone, VIN and amount is fake; the screen must always carry the note
 * "Example data — not connected to the Monza systems yet."
 *
 * The month is the FIXED string "August 2026" — never the real clock — so
 * server and client always render the same thing (hydration-safe by design).
 * The implied demo "today" sits mid-month: due days 5 and 10 have slipped
 * (overdue), days 15–28 are still ahead (due), and two plans already paid.
 *
 * Names reuse the invented people in lib/connectors/demo-data.ts so the
 * tracker and the chat tell one story — Rami Kanaan is the same $1,550/month
 * plan, 3 installments behind, that the chat's demo answers describe.
 * Phones follow the obviously-synthetic +9613100xxx pattern (stored without
 * the plus, ready for wa.me). VINs are fake but plausible 17-character codes.
 */

import type { TrackedPlan, TrackerMonth } from "@/lib/tracker/contract";

const PLANS: TrackedPlan[] = [
  {
    // Matches the chat demo story: $1,550/month, installments 6–8 unpaid,
    // oldest back to June 5 — August's #8 shows here as overdue.
    planId: "PP-0301",
    clientName: "Rami Kanaan",
    clientPhone: "9613100001",
    vin: "LDNVYAFR8SD210457",
    carLabel: "Voyah Free 2025",
    monthlyAmountUsd: 1550,
    paidCount: 5,
    totalCount: 20,
    dueDay: 5,
    thisMonth: { installmentNumber: 8, dueDate: "August 5, 2026", amountUsd: 1550, status: "overdue" },
  },
  {
    planId: "PP-0302",
    clientName: "Layal Barakat",
    clientPhone: "9613100002",
    vin: "LDNVYACG3TD305128",
    carLabel: "Voyah Courage 2026",
    monthlyAmountUsd: 980,
    paidCount: 7,
    totalCount: 12,
    dueDay: 8,
    thisMonth: { installmentNumber: 7, dueDate: "August 8, 2026", amountUsd: 980, status: "paid" },
  },
  {
    // Matches the chat demo story: $1,200/month, installments 4 and 5 missed.
    planId: "PP-0303",
    clientName: "Nour Haddad",
    clientPhone: "9613100004",
    vin: "LDNVYADR2TD418306",
    carLabel: "Voyah Dream 2026",
    monthlyAmountUsd: 1200,
    paidCount: 3,
    totalCount: 12,
    dueDay: 10,
    thisMonth: { installmentNumber: 5, dueDate: "August 10, 2026", amountUsd: 1200, status: "overdue" },
  },
  {
    planId: "PP-0304",
    clientName: "George Sassine",
    clientPhone: "9613100003",
    vin: "LDNMHER9XSD771205",
    carLabel: "MHero 917 2025",
    monthlyAmountUsd: 2400,
    paidCount: 3,
    totalCount: 10,
    dueDay: 12,
    thisMonth: { installmentNumber: 3, dueDate: "August 12, 2026", amountUsd: 2400, status: "paid" },
  },
  {
    // Matches the chat demo: Karim half-paid installment #11 — $850 of the
    // $1,700 is still owing past the 15th, so he counts as overdue here too.
    planId: "PP-0305",
    clientName: "Karim Azar",
    clientPhone: "9613100005",
    vin: "LDNVYAFR6SD152219",
    carLabel: "Voyah Free 2025",
    monthlyAmountUsd: 1700,
    paidCount: 10,
    totalCount: 18,
    dueDay: 15,
    thisMonth: { installmentNumber: 11, dueDate: "August 15, 2026", amountUsd: 850, status: "overdue" },
  },
  {
    planId: "PP-0306",
    clientName: "Hala Nassar",
    clientPhone: "9613100006",
    vin: "LDNVYAPS4TD520037",
    carLabel: "Voyah Passion 2026",
    monthlyAmountUsd: 1150,
    paidCount: 1,
    totalCount: 24,
    dueDay: 18,
    thisMonth: { installmentNumber: 2, dueDate: "August 18, 2026", amountUsd: 1150, status: "due" },
  },
  {
    planId: "PP-0307",
    clientName: "Tony Gemayel",
    clientPhone: "9613100007",
    vin: "LDNMHER7XSD668914",
    carLabel: "MHero 917 2025",
    monthlyAmountUsd: 2900,
    paidCount: 8,
    totalCount: 16,
    dueDay: 25,
    thisMonth: { installmentNumber: 9, dueDate: "August 25, 2026", amountUsd: 2900, status: "due" },
  },
  {
    planId: "PP-0308",
    clientName: "Maya Chidiac",
    clientPhone: "9613100008",
    vin: "LDNVYADR5TD473552",
    carLabel: "Voyah Dream 2026",
    monthlyAmountUsd: 1750,
    paidCount: 4,
    totalCount: 15,
    dueDay: 28,
    thisMonth: { installmentNumber: 5, dueDate: "August 28, 2026", amountUsd: 1750, status: "due" },
  },
];

export const DEMO_TRACKER_MONTH: TrackerMonth = {
  monthLabel: "August 2026",
  plans: PLANS,
};
