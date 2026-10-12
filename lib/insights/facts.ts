/**
 * Plain-English labels for the facts the reader keeps (lib/wasales/observe*.ts). Pure. A fact's value is
 * a closed-vocabulary key; this is the only place it becomes words on a screen.
 */

import { MONZA_KNOWLEDGE, modelByCode } from "@/lib/wasales/knowledge";
import { BRANDS, PLACES } from "@/lib/wasales/observe-profile";

export interface FactLike {
  kind: string;
  stance: string | null;
  model: string | null;
  part: string | null;
  value: string;
  detail: string | null;
  amount_min?: number | null;
  amount_max?: number | null;
  currency?: string | null;
  amount_kind?: string | null;
  months?: number | null;
}

const BUDGET_BAND: Readonly<Record<string, string>> = {
  total_under_20k: "Under $20k",
  total_20k_30k: "$20–30k",
  total_30k_40k: "$30–40k",
  total_40k_50k: "$40–50k",
  total_50k_60k: "$50–60k",
  total_60k_80k: "$60–80k",
  total_80k_100k: "$80–100k",
  total_over_100k: "Over $100k",
  monthly_under_500: "Under $500 a month",
  monthly_500_1000: "$500–1,000 a month",
  monthly_1000_1500: "$1,000–1,500 a month",
  monthly_over_1500: "Over $1,500 a month",
  down_under_10k: "Down payment under $10k",
  down_10k_20k: "Down payment $10–20k",
  down_20k_30k: "Down payment $20–30k",
  down_over_30k: "Down payment over $30k",
};
export const BUDGET_ORDER = Object.keys(BUDGET_BAND);

export const TIMELINE_LABEL: Readonly<Record<string, string>> = {
  now: "Now / this week",
  this_month: "This month",
  "1_3_months": "In 1–3 months",
  later: "Later (3+ months)",
  just_looking: "Just looking",
};
export const TIMELINE_ORDER = Object.keys(TIMELINE_LABEL);

const PURPOSE_LABEL: Readonly<Record<string, string>> = { business: "Business", fleet: "Fleet", family: "Family", gift: "A gift", ride_hailing: "Taxi / ride-hailing" };
const FINANCING_LABEL: Readonly<Record<string, string>> = { interested: "Asked about installments", cash: "Paying cash", down_payment: "Named a down payment", term: "Named a term" };
const CONCERN_LABEL: Readonly<Record<string, string>> = {
  safety: "Safety",
  battery_life: "Battery life",
  battery_replacement: "Battery replacement",
  charging_cost: "Charging cost",
  kept_waiting: "Kept waiting",
  price_too_high: "Price too high",
  power_cuts: "Power cuts",
  charging_access: "Where to charge",
  home_charging: "Charging at home",
  range: "Range on long trips",
  resale: "Resale value",
  parts_service: "Parts and service",
  brand_trust: "Trust in a Chinese brand",
  delivery_wait: "Delivery time",
};
const NEED_LABEL: Readonly<Record<string, string>> = {
  fastest: "Fast",
  longest_range: "Longest range",
  biggest: "Big",
  family: "Family car",
  suv: "An SUV",
  off_road: "Off-road",
  luxury: "Luxury",
  budget: "Affordable",
  general: "A recommendation",
};
const KM_LABEL: Readonly<Record<string, string>> = { km_under_50k: "under 50,000 km", km_50k_100k: "50–100,000 km", km_100k_150k: "100–150,000 km", km_150k_200k: "150–200,000 km", km_over_200k: "over 200,000 km" };

const placeName = (key: string) => (key === "abroad" ? "Abroad" : (PLACES.find((p) => p.key === key)?.name ?? key));
const brandName = (key: string) => BRANDS.find((b) => b.key === key)?.name ?? key;
export const carName = (code: string | null) => (code ? (modelByCode(MONZA_KNOWLEDGE, code as never)?.displayName ?? code) : "");
const money = (n: number, cur: string) => (cur === "USD" ? `$${n.toLocaleString("en-US")}` : `${n.toLocaleString("en-US")} ${cur}`);

/** The value alone, for a count ("$40–50k", "Metn", "BYD"). */
export function valueLabel(kind: string, value: string): string {
  switch (kind) {
    case "budget":
      return BUDGET_BAND[value] ?? value.replace(/_/g, " ");
    case "timeline":
      return TIMELINE_LABEL[value] ?? value;
    case "purpose":
      return PURPOSE_LABEL[value] ?? value;
    case "city":
      return placeName(value);
    case "competitor":
      return brandName(value);
    case "concern":
      return CONCERN_LABEL[value] ?? value.replace(/_/g, " ");
    case "need":
      return NEED_LABEL[value] ?? value;
    case "financing":
      return FINANCING_LABEL[value] ?? value;
    case "model":
      return carName(value.toUpperCase());
    default:
      return value.replace(/_/g, " ");
  }
}

/** One fact as a sentence fragment, with its amount, car or stance ("Budget $35,000–45,000"). */
export function factLabel(o: FactLike): string {
  switch (o.kind) {
    case "budget": {
      const cur = o.currency ?? "USD";
      const lo = o.amount_min ?? null;
      const hi = o.amount_max ?? null;
      const amount = lo === null ? valueLabel("budget", o.value) : lo === hi || hi === null ? money(lo, cur) : `${money(lo, cur)}–${money(hi, cur)}`;
      const what = o.amount_kind === "monthly" ? "Monthly" : o.amount_kind === "down_payment" ? "Down payment" : "Budget";
      return `${what} ${amount}`;
    }
    case "colour": {
      const name = o.detail ?? o.value;
      const where = o.part === "interior" ? "interior " : "";
      const car = o.model ? ` (${carName(o.model)})` : "";
      if (o.value === "any") return `Any colour${car}`;
      const verb = o.stance === "rejects" ? "Doesn't want" : o.stance === "wants" ? "Wants" : "Asked about";
      return `${verb} ${where}${name}${car}`;
    }
    case "model": {
      const verb = o.stance === "rejects" ? "Doesn't want the" : o.stance === "compared" ? "Compared the" : o.stance === "wants" ? "Wants the" : "Named the";
      return `${verb} ${carName(o.model)}`;
    }
    case "competitor": {
      const verb = o.stance === "owns" ? "Owns a" : o.stance === "trading_in" ? "Trading in a" : o.stance === "compared" ? "Compared with" : "Mentioned";
      return `${verb} ${brandName(o.value)}`;
    }
    case "trade_in": {
      if (o.value.startsWith("year_")) return `Trade-in from ${o.value.slice(5)}`;
      if (o.value.startsWith("km_")) return `Trade-in ${KM_LABEL[o.value] ?? o.value}`;
      return o.value === "car" ? "Has a car to trade in" : `Trade-in: ${brandName(o.value)}`;
    }
    case "financing":
      return o.value === "term" && o.months ? `Installments over ${o.months} months` : valueLabel("financing", o.value);
    case "timeline":
      return `Buying: ${valueLabel("timeline", o.value)}${o.months ? ` (${o.months} months)` : ""}`;
    case "purpose":
      return `For: ${valueLabel("purpose", o.value)}${o.detail ? ` (${o.detail})` : ""}`;
    case "city":
      return `Lives in ${placeName(o.value)}`;
    case "need":
      return `Wants: ${valueLabel("need", o.value)}`;
    case "concern":
      return `Concern: ${valueLabel("concern", o.value)}`;
    default:
      return o.value;
  }
}
