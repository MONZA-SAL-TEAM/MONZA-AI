/**
 * The Executive Overview — PURE (Samer, 2026-10-12 master prompt, part 13). Every figure is a count of
 * PEOPLE (each once) unless it says messages, has a written definition (KPI_DEFINITIONS), is compared with
 * the equal period just before, and carries the Research Lab question that lists exactly those people.
 *
 * Date basis: a person is IN the period when they wrote at least one message in it (message activity).
 * "New" means their first message ever falls in the period; "returning" means they had written before it.
 * CRM figures (quotations, sales) are what the CRM recorded for those people, whatever its date.
 */

import type { PersonFacts } from "@/lib/insights/people";
import type { InsightQuery } from "@/lib/insights/query";
import type { SignalRow } from "@/lib/insights/insights";
import type { CarStock, CrmOutcome } from "@/lib/insights/crm";
import { carName, valueLabel, BUDGET_ORDER, TIMELINE_ORDER } from "@/lib/insights/facts";
import { topicLabel } from "@/lib/wasales/signal";
import { MONZA_KNOWLEDGE } from "@/lib/wasales/knowledge";
import type { LinkedCount } from "@/lib/insights/analysis";

export interface Kpi {
  key: string;
  label: string;
  /** null = could not be known (the CRM could not be read) — never shown as 0. */
  value: number | null;
  previous: number | null;
  q: InsightQuery | null;
  foot?: string;
}

export const KPI_DEFINITIONS: Readonly<Record<string, string>> = {
  people: "Distinct people (a lead, else a chat) who wrote at least one message in the period.",
  new: "People whose first message ever is in the period.",
  returning: "People in the period who had written before it.",
  conversations: "Chats with at least one customer message in the period.",
  messages: "Customer messages read in the period (our own and the bot's are never counted).",
  interested: "People who named a car, asked about one by context, or asked for a kind of car.",
  qualified: "Interested AND asked about price, installments, availability, offers, a trade-in, a test drive or a visit, or said they want to buy.",
  buying: "People who said, in their own words, that they want to buy.",
  testDriveAsked: "People who asked for a test drive or a visit — a request, not a booking.",
  booked: "People with a booked slot in the test-drive calendar.",
  quoted: "People with a CRM order that has a quotation sent, or went further.",
  won: "People with a paid or delivered CRM order.",
  active: "Qualified people with no CRM order who wrote in the last 14 days.",
  overdue: "People whose sales alert has been open for more than 2 hours.",
  waiting: "People with an open sales alert — waiting for a person.",
  knownColour: "People who named an exterior colour they want.",
  knownBudget: "People who stated a budget.",
};

const QUALIFYING = new Set(["PRICE", "FINANCING", "TEST_DRIVE", "AVAILABILITY", "BUYING_INTENT", "TRADE_IN", "VISIT", "DISCOUNT"]);
const interested = (p: PersonFacts) => p.models.length > 0 || p.contextModels.length > 0 || p.categories.length > 0;
const qualified = (p: PersonFacts) => (p.models.length > 0 || p.contextModels.length > 0) && p.topics.some((t) => QUALIFYING.has(t));

export interface OverviewInput {
  people: readonly PersonFacts[];
  previous: readonly PersonFacts[];
  signals: readonly SignalRow[];
  previousSignals: readonly SignalRow[];
  /** person key → first message ever (all time). */
  firstEver: ReadonlyMap<string, string>;
  overdueKeys: ReadonlySet<string>;
  outcomeOf: ((p: PersonFacts) => CrmOutcome | null) | null;
  stock: Readonly<Record<string, CarStock>> | null;
  window: { sinceMs: number; untilMs: number };
  nowMs: number;
}

export interface Overview {
  kpis: Kpi[];
  weeks: string[];
  newPerWeek: number[];
  messagesPerWeek: number[];
  buyingPerWeek: number[];
  demand: (LinkedCount & { previous: number; stockNow: number | null })[];
  brands: LinkedCount[];
  types: LinkedCount[];
  colours: LinkedCount[];
  channels: LinkedCount[];
  questions: LinkedCount[];
  objections: LinkedCount[];
  languages: LinkedCount[];
  budgets: LinkedCount[];
  timelines: LinkedCount[];
  sources: LinkedCount[];
  outcomes: LinkedCount[] | null;
  coverage: { colour: number; budget: number; timeline: number; city: number };
}

function tally(people: readonly PersonFacts[], values: (p: PersonFacts) => readonly string[], label: (k: string) => string, q: (k: string) => InsightQuery, order?: readonly string[]): LinkedCount[] {
  const m = new Map<string, number>();
  for (const p of people) for (const v of new Set(values(p))) m.set(v, (m.get(v) ?? 0) + 1);
  const rows = [...m.entries()].map(([key, n]) => ({ key, label: label(key), n, q: q(key) }));
  return order ? rows.sort((a, b) => (order.indexOf(a.key) + 1 || 99) - (order.indexOf(b.key) + 1 || 99)) : rows.sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}

const LANGUAGE: Readonly<Record<string, string>> = { en: "English", ar: "Arabic", arabizi: "Arabizi", fr: "French", mixed: "Mixed", unknown: "Unknown" };
const CHANNEL: Readonly<Record<string, string>> = { whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Messenger" };
const BRAND: Readonly<Record<string, string>> = { voyah: "VOYAH", mhero: "MHERO" };
const TYPE: Readonly<Record<string, string>> = { suv: "SUV", mpv: "MPV / van", sedan: "Sedan", off_road: "Off-road", bev: "Fully electric", erev: "Range extender", phev: "Plug-in hybrid", hybrid: "Hybrid" };
const SOURCE: Readonly<Record<string, string>> = { ad_click: "An ad", social_post: "A post", direct: "Not tracked" };
const OUTCOME: Readonly<Record<string, string>> = { won: "Bought", reserved: "Reserved / confirmed", quoted: "Quotation sent", open: "Order opened", lost: "Order cancelled", none: "No CRM order" };

/** Which brand a car belongs to (VOYAH / MHERO), from the catalogue. */
const brandOf = (code: string): string | null => MONZA_KNOWLEDGE.models.find((m) => m.code === code)?.brand ?? null;

export function executiveOverview(input: OverviewInput): Overview {
  const { people, previous, window, nowMs } = input;
  const crm = input.outcomeOf;
  const isNew = (p: PersonFacts) => {
    const f = input.firstEver.get(p.key) ?? p.firstAt;
    return Date.parse(f) >= window.sinceMs;
  };
  const span = window.untilMs - window.sinceMs;
  const prevSince = window.sinceMs - span;
  const isNewPrev = (p: PersonFacts) => Date.parse(input.firstEver.get(p.key) ?? p.firstAt) >= prevSince;
  const count = (list: readonly PersonFacts[], f: (p: PersonFacts) => boolean) => list.filter(f).length;
  const crmCount = (list: readonly PersonFacts[], f: (o: CrmOutcome | null) => boolean) => (crm ? list.filter((p) => f(crm(p))).length : null);
  const quotedOrMore = (o: CrmOutcome | null) => o === "quoted" || o === "reserved" || o === "won";
  const kpi = (key: string, label: string, value: number | null, prev: number | null, q: InsightQuery | null, foot?: string): Kpi => ({ key, label, value, previous: prev, q, foot });
  const convs = (list: readonly SignalRow[]) => new Set(list.map((s) => s.conversation_id)).size;

  const kpis: Kpi[] = [
    kpi("people", "Customers who wrote", people.length, previous.length, {}),
    kpi("new", "New leads", count(people, isNew), count(previous, isNewPrev), {}, "first message ever in the period"),
    kpi("returning", "Returning", count(people, (p) => !isNew(p)), count(previous, (p) => !isNewPrev(p)), null, "had written before"),
    kpi("conversations", "Conversations", convs(input.signals), convs(input.previousSignals), null),
    kpi("messages", "Customer messages read", input.signals.length, input.previousSignals.length, null),
    kpi("interested", "Interested in a car", count(people, interested), count(previous, interested), null),
    kpi("qualified", "Qualified leads", count(people, qualified), count(previous, qualified), { stage: "pricing,test_drive,buying" }),
    kpi("buying", "Said they want to buy", count(people, (p) => p.stage === "buying"), count(previous, (p) => p.stage === "buying"), { stage: "buying" }),
    kpi("testDriveAsked", "Asked for a test drive", count(people, (p) => p.topics.includes("TEST_DRIVE") || p.topics.includes("VISIT")), count(previous, (p) => p.topics.includes("TEST_DRIVE") || p.topics.includes("VISIT")), { topic: "TEST_DRIVE,VISIT" }),
    kpi("booked", "Test drives booked", count(people, (p) => p.testDrivesBooked > 0), count(previous, (p) => p.testDrivesBooked > 0), { testDriveBooked: true }),
    kpi("quoted", "Quotations (CRM)", crmCount(people, quotedOrMore), crmCount(previous, quotedOrMore), crm ? { outcome: "quoted,reserved,won" } : null),
    kpi("won", "Bought (CRM)", crmCount(people, (o) => o === "won"), crmCount(previous, (o) => o === "won"), crm ? { outcome: "won" } : null),
    kpi("active", "Active opportunities", crm ? count(people, (p) => qualified(p) && !crm(p) && nowMs - Date.parse(p.lastAt) <= 14 * 86_400_000) : null, null, crm ? { stage: "pricing,test_drive,buying", outcome: "none", days: 30 } : null),
    kpi("overdue", "Overdue follow-ups", count(people, (p) => input.overdueKeys.has(p.key)), null, { waiting: true }),
    kpi("waiting", "Waiting for a person", count(people, (p) => p.waiting), null, { waiting: true }),
    kpi("knownColour", "Known colour", count(people, (p) => p.coloursWanted.length > 0), count(previous, (p) => p.coloursWanted.length > 0), null),
    kpi("knownBudget", "Known budget", count(people, (p) => p.budgetBand !== null), count(previous, (p) => p.budgetBand !== null), null),
  ];

  // Weekly series across the window (at most 26 weeks shown).
  const weeksN = Math.max(1, Math.min(26, Math.ceil(span / (7 * 86_400_000))));
  const weekOf = (iso: string) => weeksN - 1 - Math.floor((window.untilMs - Date.parse(iso)) / (7 * 86_400_000));
  const newPerWeek = Array.from({ length: weeksN }, () => 0);
  for (const p of people) {
    if (!isNew(p)) continue;
    const w = weekOf(input.firstEver.get(p.key) ?? p.firstAt);
    if (w >= 0 && w < weeksN) newPerWeek[w]++;
  }
  const messagesPerWeek = Array.from({ length: weeksN }, () => 0);
  for (const s of input.signals) {
    const w = weekOf(s.at);
    if (w >= 0 && w < weeksN) messagesPerWeek[w]++;
  }
  const buyingPerWeek = Array.from({ length: weeksN }, () => new Set<string>());
  for (const s of input.signals) {
    if (!s.intents.includes("BUYING_INTENT")) continue;
    const w = weekOf(s.at);
    if (w >= 0 && w < weeksN) buyingPerWeek[w].add(s.conversation_id);
  }
  const weeks = Array.from({ length: weeksN }, (_, i) => {
    const d = new Date(window.untilMs - (weeksN - 1 - i) * 7 * 86_400_000);
    return `${d.getUTCDate()} ${d.toLocaleString("en", { month: "short", timeZone: "UTC" })}`;
  });

  const carsOf = (p: PersonFacts) => [...new Set([...p.models, ...p.contextModels])];
  const prevDemand = new Map<string, number>();
  for (const p of previous) for (const c of carsOf(p)) prevDemand.set(c, (prevDemand.get(c) ?? 0) + 1);
  const demand = tally(people, carsOf, carName, (k) => ({ anyModel: k })).map((d) => ({ ...d, previous: prevDemand.get(d.key) ?? 0, stockNow: input.stock ? (input.stock[d.key]?.now ?? 0) : null }));

  return {
    kpis,
    weeks,
    newPerWeek,
    messagesPerWeek,
    buyingPerWeek: buyingPerWeek.map((s) => s.size),
    demand,
    brands: tally(people, (p) => carsOf(p).map(brandOf).filter((b): b is string => Boolean(b)), (k) => BRAND[k] ?? k.toUpperCase(), (k) => ({ anyModel: MONZA_KNOWLEDGE.models.filter((m) => m.brand === k).map((m) => m.code).join(",") })),
    types: tally(people, (p) => p.categories, (k) => TYPE[k] ?? k, (k) => ({ category: k })),
    colours: tally(people, (p) => p.coloursWanted.map((c) => c.split(":")[1]), (k) => k.charAt(0).toUpperCase() + k.slice(1), (k) => ({ colour: k })),
    channels: tally(people, (p) => p.channels, (k) => CHANNEL[k] ?? k, (k) => ({ channel: k })),
    questions: tally(people, (p) => p.topics, topicLabel, (k) => ({ topic: k })).slice(0, 12),
    objections: tally(people, (p) => p.concerns, (k) => valueLabel("concern", k), (k) => ({ concern: k })),
    languages: tally(people, (p) => (p.language ? [p.language] : []), (k) => LANGUAGE[k] ?? k, (k) => ({ language: k })),
    budgets: tally(people, (p) => (p.budgetBand ? [p.budgetBand] : []), (k) => valueLabel("budget", k), (k) => ({ budget: k }), BUDGET_ORDER),
    timelines: tally(people, (p) => (p.timeline ? [p.timeline] : []), (k) => valueLabel("timeline", k), (k) => ({ timeline: k }), TIMELINE_ORDER),
    sources: tally(people, (p) => [p.firstTouch ?? "direct"], (k) => SOURCE[k] ?? k, (k) => ({ firstTouch: k })),
    outcomes: crm ? tally(people, (p) => [crm(p) ?? "none"], (k) => OUTCOME[k] ?? k, (k) => ({ outcome: k })) : null,
    coverage: {
      colour: count(people, (p) => p.coloursWanted.length > 0),
      budget: count(people, (p) => p.budgetBand !== null),
      timeline: count(people, (p) => p.timeline !== null),
      city: count(people, (p) => p.city !== null),
    },
  };
}
