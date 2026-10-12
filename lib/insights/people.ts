/**
 * One summary per PERSON, as labels — PURE. What the Research Lab filters (insight_people, migration 023)
 * and what the analysis pages count. A person = a lead when the chat has one, else the chat itself (the
 * same rule as /customers and /insights). Never a name, never a phone, never a word.
 */

import type { InsightRows, ObservationRow, SignalRow } from "@/lib/insights/insights";
import { furthestStage, stageOf, type Stage } from "@/lib/wasales/signal";

export interface PersonFacts {
  key: string;
  leadId: string | null;
  conversationIds: string[];
  channels: string[];
  brands: string[];
  firstAt: string;
  lastAt: string;
  messages: number;
  activeDays: number;
  stage: Stage;
  language: string | null;
  topics: string[];
  models: string[];
  primaryModel: string | null;
  comparedModels: string[];
  rejectedModels: string[];
  /** "COURAGE:black" (or "ANY:black" when no car was tied). Wants and asks. */
  coloursWanted: string[];
  coloursRejected: string[];
  interior: string[];
  budgetBand: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  budgetCurrency: string | null;
  timeline: string | null;
  city: string | null;
  purpose: string[];
  competitors: string[];
  concerns: string[];
  needs: string[];
  financing: string[];
  tradeIn: boolean;
  firstTouch: string | null;
  ownerId: string | null;
  waiting: boolean;
  /** The car of the ad that brought them (a Click-to-WhatsApp headline) — acquisition, not interest. */
  adModel: string | null;
  /** Cars a question was about by context (the ad's car, the car being discussed) — not named by them. */
  contextModels: string[];
  /** Kinds of car wanted: suv, mpv, sedan, off_road, bev, erev, phev, hybrid. */
  categories: string[];
  /** Car names said that could be ordinary words ("dream") — never counted as interest. */
  unresolved: string[];
  /** HOW they named cars: "COURAGE:courage", "MHERO_1:917", "FREE_318:fuzzy" (dictionary keys). */
  mentions: string[];
  /** Colours they accept as a second choice: "COURAGE:grey". */
  colourAlternatives: string[];
  testDrivesBooked: number;
  /** Why the lead was lost, as a person recorded it (026) — never inferred. */
  lostReason: string | null;
  /** Wanted one exterior colour for a car, then later wanted a different one. */
  colourSwitched: boolean;
  /** We sent a brochure (a PDF), and the customer has not written since — for 3+ days. */
  brochureThenQuiet: boolean;
  /** new · returning (back after 30+ days) · business (fleet / company). A CRM buyer is decided at read time. */
  customerType: "new" | "returning" | "business";
}

export interface PeopleExtras {
  /** conversation id → owner (channel_conversations.assigned_to). */
  ownerByConv?: Readonly<Record<string, string>>;
  /** lead id → the first touchpoint's kind ("ad", "post", "direct"…). */
  firstTouchByLead?: Readonly<Record<string, string>>;
  /** conversation id → test drives booked (014, status booked). */
  bookingsByConv?: Readonly<Record<string, number>>;
  /** conversation id → when we last sent a brochure (a PDF) in it. */
  brochureByConv?: Readonly<Record<string, string>>;
  /** person key → the reason a person recorded for losing the lead (newest; "cleared" removed). */
  lostReasonByPerson?: Readonly<Record<string, string>>;
  /** "Now", for anything measured against today (brochure then quiet). */
  nowMs?: number;
}

const uniq = <T>(xs: readonly T[]) => [...new Set(xs)];

export function buildPersonFacts(rows: InsightRows, extras: PeopleExtras = {}, window?: { sinceMs: number; untilMs: number }): PersonFacts[] {
  const leadByConv = new Map(rows.leadConversations.map((lc) => [lc.conversation_id, lc.lead_id]));
  const keyOf = (conv: string) => {
    const lead = leadByConv.get(conv);
    return lead ? `lead:${lead}` : `chat:${conv}`;
  };
  const inWindow = (at: string) => {
    if (!window) return true;
    const t = Date.parse(at);
    return Number.isFinite(t) && t >= window.sinceMs && t <= window.untilMs;
  };
  const openAlert = new Set(rows.alerts.filter((a) => a.status === "open").map((a) => a.conversation_ref));

  const signalsBy = new Map<string, SignalRow[]>();
  for (const s of rows.signals) if (inWindow(s.at)) (signalsBy.get(keyOf(s.conversation_id)) ?? signalsBy.set(keyOf(s.conversation_id), []).get(keyOf(s.conversation_id))!).push(s);
  const factsBy = new Map<string, ObservationRow[]>();
  for (const o of rows.observations ?? []) if (inWindow(o.at)) (factsBy.get(keyOf(o.conversation_id)) ?? factsBy.set(keyOf(o.conversation_id), []).get(keyOf(o.conversation_id))!).push(o);

  const out: PersonFacts[] = [];
  for (const [key, list] of signalsBy) {
    const signals = [...list].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const facts = [...(factsBy.get(key) ?? [])].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const latest = (kind: string) => facts.find((o) => o.kind === kind) ?? null;
    const values = (kind: string, keep: (o: ObservationRow) => boolean = () => true) => uniq(facts.filter((o) => o.kind === kind && keep(o)).map((o) => o.value));
    const convs = uniq(signals.map((s) => s.conversation_id));

    const named = new Map<string, number>();
    for (const s of signals) for (const m of new Set(s.models)) named.set(m, (named.get(m) ?? 0) + 1);
    const rejectedModels = uniq(facts.filter((o) => o.kind === "model" && o.stance === "rejects" && o.model).map((o) => o.model as string));
    const ranked = [...named.entries()].filter(([m]) => !rejectedModels.includes(m)).sort((a, b) => b[1] - a[1]).map(([m]) => m);

    const colour = (o: ObservationRow) => `${o.model ?? "ANY"}:${o.value}`;
    const colourFacts = facts.filter((o) => o.kind === "colour" && o.value !== "any" && o.value !== "which");
    let returning = false;
    for (let i = 1; i < signals.length; i++) if (Date.parse(signals[i].at) - Date.parse(signals[i - 1].at) >= 30 * 86_400_000) returning = true;
    const purposes = values("purpose");
    const budget = latest("budget");
    const languages = new Map<string, number>();
    for (const s of signals) languages.set(s.language, (languages.get(s.language) ?? 0) + 1);
    const leadId = key.startsWith("lead:") ? key.slice(5) : null;

    out.push({
      key,
      leadId,
      conversationIds: convs,
      channels: uniq(signals.map((s) => s.channel)),
      brands: uniq(signals.map((s) => s.brand)),
      firstAt: signals[0].at,
      lastAt: signals[signals.length - 1].at,
      messages: signals.length,
      activeDays: new Set(signals.map((s) => s.at.slice(0, 10))).size,
      stage: furthestStage(signals.map((s) => stageOf(s.intents, [...s.models, ...(s.context_models ?? [])]))),
      language: [...languages.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      topics: uniq(signals.flatMap((s) => s.intents)).filter((i) => i !== "UNKNOWN"),
      models: uniq(signals.flatMap((s) => s.models)),
      primaryModel: ranked[0] ?? null,
      comparedModels: uniq(facts.filter((o) => o.kind === "model" && o.stance === "compared" && o.model).map((o) => o.model as string)),
      rejectedModels,
      coloursWanted: uniq(colourFacts.filter((o) => o.stance !== "rejects" && o.stance !== "alternative" && o.part !== "interior").map(colour)),
      coloursRejected: uniq(colourFacts.filter((o) => o.stance === "rejects").map(colour)),
      interior: uniq(colourFacts.filter((o) => o.stance !== "rejects" && o.part === "interior").map(colour)),
      budgetBand: budget?.value ?? null,
      budgetMin: budget?.amount_min ?? null,
      budgetMax: budget?.amount_max ?? null,
      budgetCurrency: budget?.currency ?? null,
      timeline: latest("timeline")?.value ?? null,
      city: latest("city")?.value ?? null,
      purpose: purposes,
      competitors: values("competitor"),
      concerns: values("concern"),
      needs: values("need"),
      financing: values("financing"),
      tradeIn: facts.some((o) => o.kind === "trade_in"),
      firstTouch: leadId ? (extras.firstTouchByLead?.[leadId] ?? null) : null,
      ownerId: convs.map((c) => extras.ownerByConv?.[c]).find(Boolean) ?? null,
      waiting: convs.some((c) => openAlert.has(c)),
      adModel: signals.map((s) => s.ad_model).find((m): m is string => Boolean(m)) ?? null,
      contextModels: uniq(signals.flatMap((s) => s.context_models ?? [])),
      categories: values("category"),
      unresolved: uniq(facts.filter((o) => o.kind === "unresolved" && o.model).map((o) => o.model as string)),
      mentions: uniq(facts.filter((o) => o.kind === "mention" && o.model).map((o) => `${o.model}:${o.value}`)),
      colourAlternatives: uniq(colourFacts.filter((o) => o.stance === "alternative").map(colour)),
      testDrivesBooked: convs.reduce((n, c) => n + (extras.bookingsByConv?.[c] ?? 0), 0),
      lostReason: extras.lostReasonByPerson?.[key] ?? null,
      colourSwitched: colourSwitchedOf(colourFacts),
      brochureThenQuiet: brochureThenQuietOf(convs.map((c) => extras.brochureByConv?.[c]).filter((x): x is string => Boolean(x)), signals[signals.length - 1].at, extras.nowMs ?? Date.now()),
      customerType: purposes.includes("fleet") || purposes.includes("business") ? "business" : returning ? "returning" : "new",
    });
  }
  return out.sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
}

/** Wanted one exterior colour for a car, then later a different one (wishes only, oldest first). */
export function colourSwitchedOf(colourFacts: readonly ObservationRow[]): boolean {
  const byCar = new Map<string, string[]>();
  for (const o of [...colourFacts].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    if (o.stance !== "wants" || o.part === "interior" || !o.model) continue;
    (byCar.get(o.model) ?? byCar.set(o.model, []).get(o.model)!).push(o.value);
  }
  for (const list of byCar.values()) if (list.length > 1 && list[0] !== list[list.length - 1]) return true;
  return false;
}

/** A brochure went out, nothing came back from the customer after it, and it has been 3+ days. */
export function brochureThenQuietOf(brochuresAt: readonly string[], lastCustomerAt: string, nowMs: number): boolean {
  const last = brochuresAt.map((d) => Date.parse(d)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  if (last === undefined) return false;
  return Date.parse(lastCustomerAt) < last && nowMs - last >= 3 * 86_400_000;
}
