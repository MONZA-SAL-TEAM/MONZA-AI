/**
 * The Research Lab's choices and its CSV — PURE. The choices are the closed vocabularies themselves, so
 * the form can only ask what the data can answer.
 */

import { BUDGET_ORDER, TIMELINE_ORDER, valueLabel, carName } from "@/lib/insights/facts";
import { BRANDS, PLACES } from "@/lib/wasales/observe-profile";
import { COLOUR_FAMILIES } from "@/lib/wasales/observe-lexicon";
import { MODEL_CODES } from "@/lib/wasales/knowledge";
import { STAGE_LABEL, topicLabel } from "@/lib/wasales/signal";
import type { PersonFacts } from "@/lib/insights/people";
import { LOST_LABEL, LOST_REASONS } from "@/lib/insights/outcomes";

export interface Choice {
  value: string;
  label: string;
}

const TOPICS = ["PRICE", "FINANCING", "TEST_DRIVE", "AVAILABILITY", "BROCHURE", "COLOUR", "COLOUR_VIDEO", "RANGE", "CHARGING", "WARRANTY", "TRADE_IN", "DISCOUNT", "LOCATION", "COMPARE", "BUYING_INTENT", "SPECIFICATIONS", "SEATS"];

export const LAB_CHOICES: Readonly<Record<string, readonly Choice[]>> = {
  model: MODEL_CODES.map((c) => ({ value: c, label: carName(c) })),
  colour: Object.keys(COLOUR_FAMILIES).map((f) => ({ value: f, label: f.charAt(0).toUpperCase() + f.slice(1) })),
  topic: TOPICS.map((t) => ({ value: t, label: topicLabel(t) })),
  stage: Object.entries(STAGE_LABEL).map(([value, label]) => ({ value, label })),
  budget: BUDGET_ORDER.map((b) => ({ value: b, label: valueLabel("budget", b) })),
  timeline: TIMELINE_ORDER.map((t) => ({ value: t, label: valueLabel("timeline", t) })),
  city: [...PLACES.map((p) => ({ value: p.key, label: p.name })), { value: "abroad", label: "Abroad" }],
  purpose: ["business", "fleet", "family", "gift", "ride_hailing"].map((p) => ({ value: p, label: valueLabel("purpose", p) })),
  competitor: BRANDS.map((b) => ({ value: b.key, label: b.name })),
  concern: ["price_too_high", "power_cuts", "charging_access", "home_charging", "range", "resale", "parts_service", "brand_trust", "delivery_wait", "safety", "battery_life", "battery_replacement", "charging_cost", "kept_waiting"].map((c) => ({ value: c, label: valueLabel("concern", c) })),
  financing: ["interested", "cash", "down_payment", "term"].map((f) => ({ value: f, label: valueLabel("financing", f) })),
  channel: [
    { value: "whatsapp", label: "WhatsApp" },
    { value: "instagram", label: "Instagram" },
    { value: "facebook", label: "Messenger" },
  ],
  brand: [
    { value: "voyah", label: "VOYAH" },
    { value: "mhero", label: "MHERO" },
    { value: "monza", label: "Monza S.A.L." },
  ],
  anyModel: MODEL_CODES.map((c) => ({ value: c, label: carName(c) })),
  adModel: MODEL_CODES.map((c) => ({ value: c, label: carName(c) })),
  category: ["suv", "mpv", "sedan", "off_road", "bev", "erev", "phev", "hybrid"].map((c) => ({ value: c, label: { suv: "SUV", mpv: "MPV / van", sedan: "Sedan", off_road: "Off-road", bev: "Fully electric", erev: "Range extender", phev: "Plug-in hybrid", hybrid: "Hybrid" }[c] ?? c })),
  customerType: [
    { value: "new", label: "New" },
    { value: "returning", label: "Returning (30+ quiet days)" },
    { value: "business", label: "Business / fleet" },
  ],
  outcome: [
    { value: "won", label: "Bought (paid / delivered)" },
    { value: "reserved", label: "Reserved / confirmed" },
    { value: "quoted", label: "Quotation sent" },
    { value: "open", label: "Order opened" },
    { value: "lost", label: "Order cancelled" },
    { value: "none", label: "No CRM order" },
  ],
  firstTouch: [
    { value: "ad_click", label: "An ad" },
    { value: "social_post", label: "A post" },
    { value: "direct", label: "Not tracked" },
  ],
  language: [
    { value: "en", label: "English" },
    { value: "ar", label: "Arabic" },
    { value: "arabizi", label: "Arabizi" },
    { value: "fr", label: "French" },
    { value: "mixed", label: "Mixed" },
  ],
  lostReason: LOST_REASONS.map(([value, label]) => ({ value, label })),
  testDriveBooked: [
    { value: "1", label: "Booked" },
    { value: "0", label: "Not booked" },
  ],
  days: [
    { value: "7", label: "Last 7 days" },
    { value: "30", label: "Last 30 days" },
    { value: "60", label: "Last 60 days" },
    { value: "90", label: "Last 90 days" },
    { value: "365", label: "Last 12 months" },
  ],
};

/** [field, label, several values allowed] */
export const LAB_FIELDS: ReadonlyArray<[string, string, boolean?]> = [
  ["model", "Car they named", true],
  ["anyModel", "Car, named or by context", true],
  ["adModel", "Came from the ad for", true],
  ["category", "Kind of car", true],
  ["colour", "Colour (wanted or asked)", true],
  ["topic", "Asked about", true],
  ["stage", "How far", true],
  ["budget", "Budget", true],
  ["timeline", "Buying when", true],
  ["city", "Where", true],
  ["purpose", "For", true],
  ["competitor", "Other brand", true],
  ["concern", "Concern", true],
  ["financing", "Paying", true],
  ["channel", "Channel", true],
  ["brand", "Brand", true],
  ["language", "Language", true],
  ["firstTouch", "What brought them", true],
  ["customerType", "Customer type", true],
  ["testDriveBooked", "Test drive"],
  ["outcome", "CRM outcome", true],
  ["lostReason", "Lost because (recorded)", true],
  ["days", "Last message"],
];

/** The people as a table (header + rows) — the one source of the CSV and the Excel file. */
export function labTable(people: readonly (PersonFacts & { name: string; phone: string | null })[]): { header: string[]; rows: (string | number | null)[][] } {
  const header = ["Name", "Phone", "Channels", "Stage", "Cars (named or by context)", "Main car", "Came from the ad for", "Colours wanted", "Colours refused", "Interior", "Budget", "Buying when", "City", "Purpose", "Other brands", "Concerns", "Paying", "Trade-in", "Test drives booked", "Lost because", "Messages", "First message", "Last message"];
  const colour = (c: string) => {
    const [m, f] = c.split(":");
    return `${f}${m && m !== "ANY" ? ` (${carName(m)})` : ""}`;
  };
  const rows = people.map((p) => [
    p.name,
    p.phone ? `+${p.phone}` : null,
    p.channels.join("; "),
    STAGE_LABEL[p.stage] ?? p.stage,
    [...new Set([...p.models, ...p.contextModels])].map(carName).join("; "),
    p.primaryModel ? carName(p.primaryModel) : null,
    p.adModel ? carName(p.adModel) : null,
    p.coloursWanted.map(colour).join("; "),
    p.coloursRejected.map(colour).join("; "),
    p.interior.map(colour).join("; "),
    p.budgetBand ? valueLabel("budget", p.budgetBand) : null,
    p.timeline ? valueLabel("timeline", p.timeline) : null,
    p.city ? valueLabel("city", p.city) : null,
    p.purpose.map((x) => valueLabel("purpose", x)).join("; "),
    p.competitors.map((x) => valueLabel("competitor", x)).join("; "),
    p.concerns.map((x) => valueLabel("concern", x)).join("; "),
    p.financing.map((x) => valueLabel("financing", x)).join("; "),
    p.tradeIn ? "yes" : null,
    p.testDrivesBooked,
    p.lostReason ? (LOST_LABEL[p.lostReason] ?? p.lostReason) : null,
    p.messages,
    p.firstAt.slice(0, 10),
    p.lastAt.slice(0, 10),
  ]);
  return { header, rows };
}

/** The people as CSV. Cells that begin with = + - @ are defused: a customer chooses their own name. */
export function labCsv(people: readonly (PersonFacts & { name: string; phone: string | null })[]): string {
  const cell = (v: string | number | null) => {
    const s = v === null ? "" : String(v);
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const t = labTable(people);
  return [t.header.join(","), ...t.rows.map((r) => r.map(cell).join(","))].join("\n");
}
