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

/** Statuses that mean a car can be sold now, and the one that means it is on its way. */
export const STOCK_NOW = ["in_stock", "showroom", "available", "ready_to_sell", "demo"] as const;
export const STOCK_INBOUND = ["inbound"] as const;

export interface StockRow {
  model: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  status: string | null;
}

export interface CarStock {
  now: number;
  inbound: number;
  /** Exterior colour family → cars available now. */
  colours: { key: string; n: number }[];
}

export function stockByModel(rows: readonly StockRow[]): Map<ModelCode, CarStock> {
  const out = new Map<ModelCode, CarStock>();
  for (const r of rows) {
    const code = crmModelCode(r.model);
    if (!code) continue;
    const s = out.get(code) ?? { now: 0, inbound: 0, colours: [] };
    if ((STOCK_INBOUND as readonly string[]).includes(r.status ?? "")) s.inbound++;
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
