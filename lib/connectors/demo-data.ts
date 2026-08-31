/**
 * Demo data for MONZA AI — used ONLY when the CRM is not configured or the
 * signed-in user is the demo identity (crmAccessToken === 'demo').
 *
 * Every payload carries a `sample_data` note so the model (and therefore the
 * staff member) always knows this is invented, Monza-flavoured data. All names
 * are fake; no real customer PII appears here.
 */

import type { ToolResult } from "@/lib/connectors/types";

export const DEMO_NOTE =
  "Sample data — Monza AI is not connected to the live system yet. Names and figures are invented for demonstration.";

function demoResult(data: Record<string, unknown>, rowCount?: number): ToolResult {
  return { ok: true, data: { sample_data: DEMO_NOTE, ...data }, rowCount };
}

/* ── Invented people (never real customers) ─────────────────────────────── */

const CUSTOMERS = [
  { id: "d1", first_name: "Rami", last_name: "Kanaan", phone_primary: "+961 3 100 001", email: "rami.kanaan@example.com", lead_source: "Instagram", created_at: "2026-08-12" },
  { id: "d2", first_name: "Layal", last_name: "Barakat", phone_primary: "+961 3 100 002", email: "layal.barakat@example.com", lead_source: "Showroom walk-in", created_at: "2026-08-20" },
  { id: "d3", first_name: "George", last_name: "Sassine", phone_primary: "+961 3 100 003", email: "george.sassine@example.com", lead_source: "Referral", created_at: "2026-08-25" },
  { id: "d4", first_name: "Nour", last_name: "Haddad", phone_primary: "+961 3 100 004", email: "nour.haddad@example.com", lead_source: "Website", created_at: "2026-07-30" },
  { id: "d5", first_name: "Karim", last_name: "Azar", phone_primary: "+961 3 100 005", email: "karim.azar@example.com", lead_source: "Instagram", created_at: "2026-08-05" },
];

/* ── CRM connector ──────────────────────────────────────────────────────── */

export function demoSearchCustomers(query: string): ToolResult {
  const q = query.trim().toLowerCase();
  const matches = q
    ? CUSTOMERS.filter(
        (c) =>
          c.first_name.toLowerCase().includes(q) ||
          c.last_name.toLowerCase().includes(q) ||
          c.phone_primary.replace(/\s/g, "").includes(q.replace(/\s/g, ""))
      )
    : CUSTOMERS;
  return demoResult({ customers: matches }, matches.length);
}

export function demoCustomerSummary(customerId: string): ToolResult {
  const c = CUSTOMERS.find((x) => x.id === customerId) ?? CUSTOMERS[0];
  return demoResult({
    customer: c,
    cars: [
      { brand: "Voyah", model: "Free", model_year: 2025, vin: "DEMO0000000000001", plate_number: "B 123456", order_status: "delivered", selling_price: 62500, currency: "USD" },
    ],
    active_payment_plans: 1,
  });
}

export function demoRecentLeads(days: number): ToolResult {
  return demoResult({
    period_days: days,
    total_new_customers: 5,
    by_lead_source: { Instagram: 2, "Showroom walk-in": 1, Referral: 1, Website: 1 },
    recent: CUSTOMERS.map((c) => ({
      name: `${c.first_name} ${c.last_name}`,
      lead_source: c.lead_source,
      created_at: c.created_at,
    })),
  }, 5);
}

/* ── Installments connector ─────────────────────────────────────────────── */

const OVERDUE = [
  {
    customer: "Rami Kanaan", phone: "+961 3 100 001",
    overdue_installments: 3, total_overdue_usd: 4650,
    oldest_due_date: "2026-06-05",
    details: [
      { installment_no: 6, due_date: "2026-06-05", amount_due: 1550, paid: 0, remaining: 1550 },
      { installment_no: 7, due_date: "2026-07-05", amount_due: 1550, paid: 0, remaining: 1550 },
      { installment_no: 8, due_date: "2026-08-05", amount_due: 1550, paid: 0, remaining: 1550 },
    ],
  },
  {
    customer: "Nour Haddad", phone: "+961 3 100 004",
    overdue_installments: 2, total_overdue_usd: 2400,
    oldest_due_date: "2026-07-10",
    details: [
      { installment_no: 4, due_date: "2026-07-10", amount_due: 1200, paid: 0, remaining: 1200 },
      { installment_no: 5, due_date: "2026-08-10", amount_due: 1200, paid: 0, remaining: 1200 },
    ],
  },
  {
    customer: "Karim Azar", phone: "+961 3 100 005",
    overdue_installments: 1, total_overdue_usd: 850,
    oldest_due_date: "2026-08-15",
    details: [
      { installment_no: 11, due_date: "2026-08-15", amount_due: 1700, paid: 850, remaining: 850 },
    ],
  },
];

export function demoOverdueInstallments(minAmountUsd: number): ToolResult {
  const rows = OVERDUE.filter((r) => r.total_overdue_usd >= minAmountUsd);
  return demoResult(
    {
      min_amount_usd: minAmountUsd,
      customers_with_overdue: rows,
      grand_total_overdue_usd: rows.reduce((s, r) => s + r.total_overdue_usd, 0),
    },
    rows.length
  );
}

export function demoCollectionsThisMonth(): ToolResult {
  return demoResult({
    month: "2026-08",
    payments_received: 14,
    total_collected_usd: 21350,
  });
}

export function demoPlanStatusSummary(): ToolResult {
  return demoResult({
    plans_by_status: { active: 11, completed: 6, defaulted: 1, cancelled: 1 },
    total_outstanding_usd: 187400,
  });
}

/* ── Garage connector ───────────────────────────────────────────────────── */

const WAITING_PARTS_JOBS = [
  { job_number: "GJ-2026-0142", car: "Voyah Free — B 123456", customer: "Rami Kanaan", priority: "high", complaint: "Front left suspension knock; awaiting control-arm bushing.", created_at: "2026-08-18" },
  { job_number: "GJ-2026-0151", car: "MHero 917 — G 778899", customer: "George Sassine", priority: "normal", complaint: "Infotainment screen flicker; awaiting replacement display unit.", created_at: "2026-08-24" },
];

export function demoJobsWaitingParts(): ToolResult {
  return demoResult({ jobs_waiting_parts: WAITING_PARTS_JOBS }, WAITING_PARTS_JOBS.length);
}

export function demoOpenJobsSummary(): ToolResult {
  return demoResult({
    open_jobs_by_status: { pending: 3, in_progress: 4, waiting_parts: 2 },
    open_jobs_by_priority: { high: 2, normal: 6, low: 1 },
    total_open: 9,
  });
}

export function demoJobLookup(jobNumber: string): ToolResult {
  const job = WAITING_PARTS_JOBS.find((j) => j.job_number.toLowerCase() === jobNumber.trim().toLowerCase());
  if (!job) {
    return demoResult({ found: false, message: `No garage job matches "${jobNumber}" in the sample data.` }, 0);
  }
  return demoResult({ found: true, job: { ...job, status: "waiting_parts" } }, 1);
}

/* ── Inventory connector ────────────────────────────────────────────────── */

export function demoCarsInStockSummary(): ToolResult {
  return demoResult({
    cars_by_status: { in_stock: 7, showroom: 3, reserved: 2, inbound: 4, sold: 5, delivered: 12, service: 2, demo: 1 },
    cars_by_brand: { Voyah: 24, MHero: 12 },
    total_cars: 36,
  });
}

export function demoLowStockParts(): ToolResult {
  const parts = [
    { name: "Cabin air filter (Voyah Free)", part_number: "VF-CAF-021", quantity: 1, min_quantity: 4 },
    { name: "Front brake pad set (MHero 917)", part_number: "MH-BRK-107", quantity: 0, min_quantity: 2 },
    { name: "Wiper blade pair", part_number: "GN-WPR-003", quantity: 2, min_quantity: 6 },
  ];
  return demoResult({ low_stock_parts: parts }, parts.length);
}

export function demoCarLookup(query: string): ToolResult {
  const cars = [
    { brand: "Voyah", model: "Free", model_year: 2025, vin: "DEMO0000000000001", plate_number: "B 123456", status: "delivered" },
    { brand: "Voyah", model: "Dream", model_year: 2026, vin: "DEMO0000000000002", plate_number: null, status: "showroom" },
    { brand: "MHero", model: "917", model_year: 2025, vin: "DEMO0000000000003", plate_number: "G 778899", status: "service" },
  ];
  const q = query.trim().toLowerCase();
  const matches = q
    ? cars.filter(
        (c) =>
          c.vin.toLowerCase().includes(q) ||
          (c.plate_number ?? "").toLowerCase().includes(q) ||
          c.model.toLowerCase().includes(q) ||
          c.brand.toLowerCase().includes(q)
      )
    : cars;
  return demoResult({ cars: matches }, matches.length);
}

/* ── Finance connector ──────────────────────────────────────────────────── */

export function demoSalesThisMonth(): ToolResult {
  return demoResult({
    month: "2026-08",
    orders: 4,
    by_status: { confirmed: 1, paid: 1, delivered: 2 },
    total_by_currency: { USD: 241800 },
  });
}

export function demoMonthlyCostsSummary(): ToolResult {
  return demoResult({
    month: "2026-08",
    cost_entries: 9,
    total_by_currency: { USD: 18420 },
    largest_categories: [
      { category: "Shipping & customs", total_usd: 9200 },
      { category: "Showroom utilities", total_usd: 3150 },
      { category: "Marketing", total_usd: 2800 },
    ],
  });
}
