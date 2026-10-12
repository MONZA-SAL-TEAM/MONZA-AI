/**
 * Customers & Leads — PURE (Samer, 2026-10-12 master prompt, part 8). Built from the people (each once)
 * and, where the CRM can be read as the viewer, what the CRM RECORDS happened. A customer's words and a
 * CRM event are never the same thing: "wants a test drive" is a request; a booking is in the test-drive
 * calendar; "wants to buy" is a signal; a sale is a paid or delivered order.
 *
 * Every stage has a written definition (STAGES below) and every rate names its denominator.
 */

import type { InsightQuery } from "@/lib/insights/query";
import type { PersonFacts } from "@/lib/insights/people";
import type { CrmOutcome, PersonCrm } from "@/lib/insights/crm";
import { carName } from "@/lib/insights/facts";

const DAY = 86_400_000;
const QUALIFYING = new Set(["PRICE", "FINANCING", "TEST_DRIVE", "AVAILABILITY", "BUYING_INTENT", "TRADE_IN", "VISIT", "DISCOUNT"]);

export type StageKey = "wrote" | "asked" | "interest" | "qualified" | "handoff" | "test_drive_asked" | "test_drive_booked" | "quoted" | "reserved" | "won";

export interface StageDef {
  key: StageKey;
  label: string;
  /** Plain words: exactly who is counted. */
  definition: string;
  source: "messages" | "monza_ai" | "crm";
}

export const STAGES: readonly StageDef[] = [
  { key: "wrote", label: "Wrote", definition: "Sent at least one message in the period.", source: "messages" },
  { key: "asked", label: "Asked a question", definition: "Asked about anything the reader recognises (price, range, colours, location…).", source: "messages" },
  { key: "interest", label: "Vehicle interest", definition: "Named a car, asked about a car by context (its ad, the car being discussed), or asked for a kind of car (SUV, electric…).", source: "messages" },
  { key: "qualified", label: "Qualified lead", definition: "Vehicle interest AND asked about price, installments, availability, offers, a trade-in, a test drive or a visit, or said they want to buy.", source: "messages" },
  { key: "handoff", label: "Handed to Sales", definition: "The sales bot raised at least one alert for a person in their chat.", source: "monza_ai" },
  { key: "test_drive_asked", label: "Asked for a test drive", definition: "Asked for a test drive or a visit in their own words — a request, not a booking.", source: "messages" },
  { key: "test_drive_booked", label: "Test drive booked", definition: "Has a booked slot in the test-drive calendar.", source: "monza_ai" },
  { key: "quoted", label: "Quotation", definition: "The CRM has an order for them with a quotation sent (or further).", source: "crm" },
  { key: "reserved", label: "Reserved", definition: "The CRM has an order for them that is reserved, confirmed, paid or delivered.", source: "crm" },
  { key: "won", label: "Bought", definition: "The CRM has a paid or delivered order for them.", source: "crm" },
];

export interface StageCount {
  def: StageDef;
  /** null when the source could not be read (the CRM) — never 0. */
  n: number | null;
  /** n ÷ the previous stage's n, when both are known. */
  fromPrevious: number | null;
  q: InsightQuery | null;
}

export interface Breakdown {
  key: string;
  label: string;
  people: number;
  qualified: number;
  booked: number;
  won: number | null;
  q: InsightQuery;
}

export interface LeadsView {
  people: number;
  newInPeriod: number;
  returning: number;
  business: number;
  existingCustomers: number | null;
  multipleChats: number;
  multipleModels: number;
  knownBudget: number;
  knownColour: number;
  knownTimeline: number;
  waiting: number;
  unowned: number;
  inactive: number;
  lost: number | null;
  outcomeUnknown: number | null;
  stages: StageCount[];
  byModel: Breakdown[];
  byChannel: Breakdown[];
  bySource: Breakdown[];
  medianDaysToOrder: number | null;
  readyNow: PersonFacts[];
  neglected: PersonFacts[];
  crm: "ok" | "not_connected" | "unavailable";
}

export interface LeadsInput {
  people: readonly PersonFacts[];
  /** person key → had at least one sales alert (any status). */
  alerted: ReadonlySet<string>;
  /** person key → normalized mobile, when one is known. */
  phoneOf: (p: PersonFacts) => string | null;
  crm: { state: "ok"; byPhone: Readonly<Record<string, PersonCrm>> } | { state: "not_connected" } | { state: "unavailable" };
  /** Start of the period (ms), for "new in the period". 0 = all time. */
  sinceMs: number;
  nowMs: number;
  /** Days without a message after which a lead with no recorded outcome is "inactive". */
  inactiveDays?: number;
}

export function crmOf(p: PersonFacts, input: Pick<LeadsInput, "crm" | "phoneOf">): PersonCrm | null {
  if (input.crm.state !== "ok") return null;
  const phone = input.phoneOf(p);
  return phone ? (input.crm.byPhone[phone] ?? null) : null;
}

const interest = (p: PersonFacts) => p.models.length > 0 || p.contextModels.length > 0 || p.categories.length > 0;
const qualified = (p: PersonFacts) => (p.models.length > 0 || p.contextModels.length > 0) && p.topics.some((t) => QUALIFYING.has(t));
const atLeast = (o: CrmOutcome | undefined, min: "quoted" | "reserved" | "won") => {
  const rank: Record<CrmOutcome, number> = { lost: 0, open: 1, quoted: 2, reserved: 3, won: 4 };
  const need = { quoted: 2, reserved: 3, won: 4 }[min];
  return o !== undefined && rank[o] >= need;
};

export function leadsView(input: LeadsInput): LeadsView {
  const { people, nowMs } = input;
  const inactiveMs = (input.inactiveDays ?? 30) * DAY;
  const crmOk = input.crm.state === "ok";
  const outcome = (p: PersonFacts) => crmOf(p, input)?.outcome;

  const test: Record<StageKey, (p: PersonFacts) => boolean> = {
    wrote: () => true,
    asked: (p) => p.topics.length > 0,
    interest,
    qualified,
    handoff: (p) => input.alerted.has(p.key),
    test_drive_asked: (p) => p.topics.includes("TEST_DRIVE") || p.topics.includes("VISIT"),
    test_drive_booked: (p) => p.testDrivesBooked > 0,
    quoted: (p) => atLeast(outcome(p), "quoted"),
    reserved: (p) => atLeast(outcome(p), "reserved"),
    won: (p) => outcome(p) === "won",
  };
  const STAGE_Q: Partial<Record<StageKey, InsightQuery>> = { asked: {}, qualified: { stage: "pricing" }, handoff: {}, test_drive_asked: { topic: "TEST_DRIVE" }, test_drive_booked: { testDriveBooked: true } };

  let prev: number | null = null;
  const stages: StageCount[] = STAGES.map((def) => {
    const n = def.source === "crm" && !crmOk ? null : people.filter(test[def.key]).length;
    const row: StageCount = { def, n, fromPrevious: n !== null && prev ? n / prev : null, q: STAGE_Q[def.key] ?? null };
    if (n !== null) prev = n;
    return row;
  });

  const breakdown = (key: string, label: string, its: PersonFacts[], q: InsightQuery): Breakdown => ({
    key,
    label,
    people: its.length,
    qualified: its.filter(qualified).length,
    booked: its.filter((p) => p.testDrivesBooked > 0).length,
    won: crmOk ? its.filter((p) => outcome(p) === "won").length : null,
    q,
  });
  const codes = [...new Set(people.flatMap((p) => [...p.models, ...p.contextModels]))];
  const byModel = codes
    .map((code) => breakdown(code, carName(code), people.filter((p) => p.models.includes(code) || p.contextModels.includes(code)), { model: code }))
    .sort((a, b) => b.people - a.people);
  const byChannel = ["whatsapp", "instagram", "facebook"]
    .map((ch) => breakdown(ch, ch === "whatsapp" ? "WhatsApp" : ch === "instagram" ? "Instagram" : "Messenger", people.filter((p) => p.channels.includes(ch)), { channel: ch }))
    .filter((b) => b.people > 0);
  const SOURCE_LABEL: Record<string, string> = { ad_click: "An ad", ad: "An ad", social_post: "A post", direct: "Not tracked" };
  const sources = [...new Set(people.map((p) => p.firstTouch ?? "direct"))];
  const bySource = sources.map((s) => breakdown(s, SOURCE_LABEL[s] ?? s, people.filter((p) => (p.firstTouch ?? "direct") === s), { firstTouch: s })).sort((a, b) => b.people - a.people);

  const toOrder = crmOk
    ? people
        .map((p) => {
          const c = crmOf(p, input);
          return c?.firstOrderAt ? (Date.parse(c.firstOrderAt) - Date.parse(p.firstAt)) / DAY : null;
        })
        .filter((d): d is number => d !== null && d >= 0)
        .sort((a, b) => a - b)
    : [];

  const won = (p: PersonFacts) => outcome(p) === "won";
  return {
    people: people.length,
    newInPeriod: people.filter((p) => Date.parse(p.firstAt) >= input.sinceMs).length,
    returning: people.filter((p) => p.customerType === "returning").length,
    business: people.filter((p) => p.customerType === "business").length,
    existingCustomers: crmOk ? people.filter(won).length : null,
    multipleChats: people.filter((p) => p.conversationIds.length > 1).length,
    multipleModels: people.filter((p) => p.models.length > 1).length,
    knownBudget: people.filter((p) => p.budgetBand !== null).length,
    knownColour: people.filter((p) => p.coloursWanted.length > 0).length,
    knownTimeline: people.filter((p) => p.timeline !== null).length,
    waiting: people.filter((p) => p.waiting).length,
    unowned: people.filter((p) => qualified(p) && !p.ownerId).length,
    inactive: people.filter((p) => nowMs - Date.parse(p.lastAt) > inactiveMs && !won(p)).length,
    lost: crmOk ? people.filter((p) => outcome(p) === "lost").length : null,
    outcomeUnknown: crmOk ? people.filter((p) => !outcome(p)).length : null,
    stages,
    byModel,
    byChannel,
    bySource,
    medianDaysToOrder: toOrder.length ? Math.round(toOrder[Math.floor((toOrder.length - 1) / 2)] * 10) / 10 : null,
    // Ready now: close to buying in their own words, no CRM order yet, newest first.
    readyNow: people.filter((p) => (p.stage === "buying" || p.stage === "test_drive") && !outcome(p)).slice(0, 25),
    // Neglected: waiting for a person, or qualified with no owner, quiet for over a day.
    neglected: people.filter((p) => (p.waiting || (qualified(p) && !p.ownerId)) && nowMs - Date.parse(p.lastAt) > DAY && !won(p)).slice(0, 25),
    crm: input.crm.state,
  };
}
