/**
 * The CRM's cars, as Insights sees them — PURE (the read is lib/insights/crm-server.ts).
 *
 * Samer, 2026-10-12: "connected to the client is the car". A client's car comes from the CRM's sales
 * orders, linked to a chat ONLY by the same Lebanese MOBILE number (isAutoLinkable), never by a name.
 * Stock is the CRM's cars in a selling status, so demand (what people ask for) can stand beside supply.
 * No price is ever read.
 */

import type { ModelCode } from "@/lib/wasales/knowledge";
import { COLOUR_FAMILIES } from "@/lib/wasales/observe-lexicon";

/** The CRM writes models in its own words ("m hero 2", "free"). */
export function crmModelCode(model: string | null | undefined): ModelCode | null {
  const m = (model ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!m) return null;
  if (/^m ?hero ?1\b/.test(m) || m === "mhero 1") return "MHERO_1";
  if (/^m ?hero ?2\b/.test(m)) return "MHERO_2";
  if (/^passion l\b/.test(m)) return "PASSION_L";
  if (/^passion\b/.test(m)) return "PASSION";
  if (/^free\b/.test(m)) return "FREE_318";
  if (/^courage\b/.test(m)) return "COURAGE";
  if (/^dream\b/.test(m)) return "DREAM";
  if (/^taishan\b/.test(m)) return "TAISHAN";
  return null;
}

/** A CRM colour as a family key ("Pearl Black" / "black" → black); null when it names none. */
export function colourFamily(colour: string | null | undefined): string | null {
  const words = (colour ?? "").toLowerCase().split(/[^a-z؀-ۿ]+/).filter(Boolean);
  for (const [family, list] of Object.entries(COLOUR_FAMILIES)) if (words.some((w) => list.includes(w))) return family;
  return null;
}

export interface CrmPurchase {
  customerName: string;
  model: ModelCode | null;
  /** The CRM's own words for the car ("Voyah courage 2025"). */
  carLabel: string;
  exterior: string | null;
  interior: string | null;
  orderStatus: string | null;
  carStatus: string | null;
  /** The sale, or the order when no sale date is recorded. */
  at: string | null;
  deliveredAt: string | null;
}

export type CrmResult<T> = { state: "ok"; data: T } | { state: "not_connected" } | { state: "unavailable" };

/**
 * The CRM's car statuses (enum car_status) as Insights counts them. "inventory" is what the CRM actually
 * uses for a car in stock — 50 cars on 2026-10-13 — and was missing, so "stock now" read 0 for every car
 * (Samer's audit). Sold, delivered, registered, company, defective, scrapped and in-service cars are not stock.
 */
export const STOCK_NOW = ["inventory", "in_stock", "showroom", "available", "ready_to_sell", "demo", "test_drive"] as const;
export const STOCK_INBOUND = ["inbound", "sent_to_customs"] as const;
export const STOCK_RESERVED = ["reserved"] as const;
export const STOCK_SUB_DEALER = ["sent_to_sub_dealer"] as const;
export const STOCK_STATUSES: readonly string[] = [...STOCK_NOW, ...STOCK_INBOUND, ...STOCK_RESERVED, ...STOCK_SUB_DEALER];

export interface StockRow {
  model: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  status: string | null;
}

export interface CarStock {
  now: number;
  inbound: number;
  /** Reserved for a customer: not for sale, not yet sold. */
  reserved: number;
  /** At a sub-dealer. */
  subDealer: number;
  /** Exterior colour family → cars available now. */
  colours: { key: string; n: number }[];
}

export function stockByModel(rows: readonly StockRow[]): Map<ModelCode, CarStock> {
  const out = new Map<ModelCode, CarStock>();
  for (const r of rows) {
    const code = crmModelCode(r.model);
    if (!code) continue;
    const s = out.get(code) ?? { now: 0, inbound: 0, reserved: 0, subDealer: 0, colours: [] };
    if ((STOCK_INBOUND as readonly string[]).includes(r.status ?? "")) s.inbound++;
    else if ((STOCK_RESERVED as readonly string[]).includes(r.status ?? "")) s.reserved++;
    else if ((STOCK_SUB_DEALER as readonly string[]).includes(r.status ?? "")) s.subDealer++;
    else if ((STOCK_NOW as readonly string[]).includes(r.status ?? "")) {
      s.now++;
      const fam = colourFamily(r.exterior_color) ?? "other";
      const c = s.colours.find((x) => x.key === fam);
      if (c) c.n++;
      else s.colours.push({ key: fam, n: 1 });
    }
    out.set(code, s);
  }
  for (const s of out.values()) s.colours.sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  return out;
}

/* ── Sales outcomes, from the CRM's sales orders (read as the viewer) ───────────────────────── */

/**
 * What the CRM RECORDS happened — never what a customer said. "Wants a test drive" is a message; a
 * quotation sent, a reservation, a payment, a delivery or a cancellation is an order event here.
 * Samer, 2026-10-12: "Sales data is only called confirmed when verified".
 */
export type CrmOutcome = "won" | "reserved" | "quoted" | "open" | "lost";

export const OUTCOME_LABEL: Readonly<Record<CrmOutcome | "unknown", string>> = {
  won: "Bought (paid or delivered)",
  reserved: "Reserved / confirmed",
  quoted: "Quotation sent",
  open: "Order opened",
  lost: "Order cancelled",
  unknown: "No CRM order",
};

export interface CrmOrderRow {
  customerId: string;
  status: string | null;
  quoteSentAt: string | null;
  saleDate: string | null;
  createdAt: string | null;
  deliveredAt: string | null;
  model: string | null;
  exterior: string | null;
  interior: string | null;
}

/** One order's outcome. */
export function orderOutcome(o: Pick<CrmOrderRow, "status" | "quoteSentAt" | "deliveredAt">): CrmOutcome {
  const s = (o.status ?? "").toLowerCase();
  if (s === "paid" || s === "delivered" || o.deliveredAt) return "won";
  if (s === "cancelled") return "lost";
  if (s === "reserved" || s === "confirmed") return "reserved";
  if (o.quoteSentAt) return "quoted";
  return "open";
}

const RANK: Readonly<Record<CrmOutcome, number>> = { won: 5, reserved: 4, quoted: 3, open: 2, lost: 1 };

/** A customer's furthest outcome across their orders (a won order beats an older cancelled one). */
export function furthestOutcome(orders: readonly Pick<CrmOrderRow, "status" | "quoteSentAt" | "deliveredAt">[]): CrmOutcome | null {
  let best: CrmOutcome | null = null;
  for (const o of orders) {
    const r = orderOutcome(o);
    if (!best || RANK[r] > RANK[best]) best = r;
  }
  return best;
}

export interface PersonCrm {
  outcome: CrmOutcome;
  firstOrderAt: string | null;
  quoteSentAt: string | null;
  wonAt: string | null;
  models: ModelCode[];
}

/* ── Sales in UNITS (Samer, 2026-10-13: "my stock, my sales — not in price but in volume") ───────────── */

export interface CrmSaleRow {
  model: string | null;
  /** sale_status: reserved, draft, confirmed, paid, delivered, cancelled. */
  status: string | null;
  /** The sale date, else when the order was made. */
  at: string | null;
}

export interface ModelSales {
  /** Paid or delivered orders (a sale), by when. */
  last30: number;
  last90: number;
  last365: number;
  total: number;
  /** Open orders: reserved or confirmed, not yet paid. */
  open: number;
  /** "YYYY-MM" → sales that month. */
  byMonth: Record<string, number>;
  /** Sales whose date the CRM does not hold — counted in `total` only. */
  undated: number;
}

const SOLD = new Set(["paid", "delivered"]);
const OPEN = new Set(["reserved", "confirmed"]);

/** Units sold per car (paid or delivered orders), from the CRM's sales orders. Never a price. */
export function salesByModel(rows: readonly CrmSaleRow[], nowMs: number): Map<ModelCode, ModelSales> {
  const out = new Map<ModelCode, ModelSales>();
  const DAY = 86_400_000;
  for (const r of rows) {
    const code = crmModelCode(r.model);
    if (!code) continue;
    const s = out.get(code) ?? { last30: 0, last90: 0, last365: 0, total: 0, open: 0, byMonth: {}, undated: 0 };
    const status = (r.status ?? "").toLowerCase();
    if (OPEN.has(status)) s.open++;
    if (SOLD.has(status)) {
      s.total++;
      const t = r.at ? Date.parse(r.at) : NaN;
      if (Number.isNaN(t)) s.undated++;
      else {
        const age = nowMs - t;
        if (age <= 30 * DAY) s.last30++;
        if (age <= 90 * DAY) s.last90++;
        if (age <= 365 * DAY) s.last365++;
        const month = new Date(t).toISOString().slice(0, 7);
        s.byMonth[month] = (s.byMonth[month] ?? 0) + 1;
      }
    }
    out.set(code, s);
  }
  return out;
}

/** Months the cars in stock now would last at the last 90 days' pace; null when nothing sold (unknown, not "forever"). */
export function monthsOfStock(now: number, soldLast90: number): number | null {
  if (soldLast90 <= 0) return null;
  return Math.round((now / (soldLast90 / 3)) * 10) / 10;
}
