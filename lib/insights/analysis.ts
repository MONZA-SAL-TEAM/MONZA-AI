/**
 * The analysis pages — PURE. Models, colours, conversations, channels and data quality, all counted in
 * PEOPLE (each person once), every count carrying the Research Lab question that opens those people.
 * Tested in tests/insights-analysis.test.ts.
 */

import type { Count, ObservationRow, SignalRow } from "@/lib/insights/insights";
import type { PersonFacts } from "@/lib/insights/people";
import type { InsightQuery } from "@/lib/insights/query";
import type { CarStock } from "@/lib/insights/crm";
import { valueLabel, carName } from "@/lib/insights/facts";
import { topicLabel } from "@/lib/wasales/signal";
import { MONZA_KNOWLEDGE } from "@/lib/wasales/knowledge";

/** A count with the Lab question that lists exactly those people. */
export interface LinkedCount extends Count {
  q: InsightQuery;
}

const DAY = 86_400_000;
const WEEKS = 12;

function tally(people: readonly PersonFacts[], valuesOf: (p: PersonFacts) => readonly string[], label: (k: string) => string, q: (k: string) => InsightQuery): LinkedCount[] {
  const m = new Map<string, number>();
  for (const p of people) for (const v of new Set(valuesOf(p))) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].map(([key, n]) => ({ key, label: label(key), n, q: q(key) })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}

const family = (entry: string) => entry.split(":")[1] ?? entry;
const modelOf = (entry: string) => entry.split(":")[0] ?? "";
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const HIGH_INTENT = new Set(["buying", "test_drive", "pricing"]);

/* ── Models ───────────────────────────────────────────────────────────── */

export interface ModelRow {
  code: string;
  name: string;
  brand: string;
  /** Named it, or asked about it by context. */
  people: number;
  named: number;
  fromAd: number;
  primary: number;
  newThisMonth: number;
  price: number;
  testDrive: number;
  financing: number;
  buying: number;
  topColour: LinkedCount | null;
  topCompetitor: LinkedCount | null;
}

export function modelsTable(people: readonly PersonFacts[], nowMs: number): ModelRow[] {
  return MONZA_KNOWLEDGE.models
    .map((m) => {
      const its = people.filter((p) => p.models.includes(m.code) || p.contextModels.includes(m.code));
      const has = (t: string) => its.filter((p) => p.topics.includes(t)).length;
      return {
        code: m.code,
        name: m.displayName,
        brand: m.brand,
        people: its.length,
        named: its.filter((p) => p.models.includes(m.code)).length,
        fromAd: people.filter((p) => p.adModel === m.code).length,
        primary: its.filter((p) => p.primaryModel === m.code).length,
        newThisMonth: its.filter((p) => nowMs - Date.parse(p.firstAt) <= 30 * DAY).length,
        price: has("PRICE"),
        testDrive: has("TEST_DRIVE"),
        financing: has("FINANCING"),
        buying: its.filter((p) => p.stage === "buying").length,
        topColour: tally(its, (p) => p.coloursWanted.filter((c) => modelOf(c) === m.code).map(family), capital, (k) => ({ anyModel: m.code, colour: k }))[0] ?? null,
        topCompetitor: tally(its, (p) => p.competitors, (k) => valueLabel("competitor", k), (k) => ({ anyModel: m.code, competitor: k }))[0] ?? null,
      };
    })
    .sort((a, b) => b.people - a.people || a.name.localeCompare(b.name));
}

export interface ModelDetail {
  code: string;
  name: string;
  /** People who named it OR asked about it by context (its ad, the car being discussed). */
  people: number;
  named: number;
  byContext: number;
  fromAd: number;
  activeRecently: number;
  returning: number;
  topics: LinkedCount[];
  channels: LinkedCount[];
  languages: LinkedCount[];
  alternatives: LinkedCount[];
  primary: number;
  secondary: number;
  newThisMonth: number;
  asks: LinkedCount[];
  exterior: LinkedCount[];
  interior: LinkedCount[];
  rejected: LinkedCount[];
  colourKnown: number;
  weekly: number[];
  questions: LinkedCount[];
  concerns: LinkedCount[];
  alsoAsked: LinkedCount[];
  compared: LinkedCount[];
  competitors: LinkedCount[];
  budget: LinkedCount[];
  timeline: LinkedCount[];
  city: LinkedCount[];
}

export function modelDetail(code: string, people: readonly PersonFacts[], signals: readonly SignalRow[], personOf: (conv: string) => string, nowMs: number): ModelDetail {
  const its = people.filter((p) => p.models.includes(code) || p.contextModels.includes(code));
  const q = (extra: InsightQuery): InsightQuery => ({ anyModel: code, ...extra });
  const TOPICS: ReadonlyArray<[string, string]> = [
    ["PRICE", "Price"], ["FINANCING", "Installments / financing"], ["DISCOUNT", "Offers"], ["AVAILABILITY", "Availability"], ["RANGE", "Range"],
    ["CHARGING", "Charging"], ["HOME_CHARGING", "Charging at home"], ["BATTERY", "Battery"], ["WARRANTY", "Warranty"], ["SERVICE", "Service / maintenance"],
    ["SPECIFICATIONS", "Specifications"], ["OTHER_SPEC", "Features"], ["INTERIOR_COLOUR", "Interior"], ["COLOUR", "Colours"], ["SEATS", "Seats"],
    ["TEST_DRIVE", "Test drive"], ["VISIT", "Showroom visit"], ["DELIVERY_LOCATION", "Delivery"], ["TRADE_IN", "Trade-in"], ["BUYING_INTENT", "Wants to buy"],
  ];
  const ASKS: ReadonlyArray<[string, string]> = [["BROCHURE", "Brochure"], ["COLOUR_VIDEO", "Video"], ["PRICE", "Price"], ["FINANCING", "Installments"], ["TEST_DRIVE", "Test drive"], ["AVAILABILITY", "Availability"], ["TRADE_IN", "Trade-in"]];
  const weekly = Array.from({ length: WEEKS }, () => new Set<string>());
  for (const s of signals) {
    if (!s.models.includes(code)) continue;
    const w = WEEKS - 1 - Math.floor((nowMs - Date.parse(s.at)) / (7 * DAY));
    if (w >= 0 && w < WEEKS) weekly[w].add(personOf(s.conversation_id));
  }
  const onCar = (list: readonly string[]) => list.filter((c) => modelOf(c) === code).map(family);
  return {
    code,
    name: carName(code),
    people: its.length,
    named: its.filter((p) => p.models.includes(code)).length,
    byContext: its.filter((p) => !p.models.includes(code)).length,
    fromAd: people.filter((p) => p.adModel === code).length,
    activeRecently: its.filter((p) => nowMs - Date.parse(p.lastAt) <= 14 * DAY).length,
    returning: its.filter((p) => p.customerType === "returning").length,
    topics: TOPICS.map(([t, label]) => ({ key: t, label, n: its.filter((p) => p.topics.includes(t)).length, q: q({ topic: t }) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n),
    channels: tally(its, (p) => p.channels, (k) => ({ whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Messenger" })[k] ?? k, (k) => q({ channel: k })),
    languages: tally(its, (p) => (p.language ? [p.language] : []), (k) => ({ en: "English", ar: "Arabic", arabizi: "Arabizi", fr: "French", mixed: "Mixed" })[k] ?? k, (k) => q({ language: k })),
    alternatives: tally(its, (p) => p.colourAlternatives.filter((c) => modelOf(c) === code).map(family), capital, (k) => q({ colour: k })),
    primary: its.filter((p) => p.primaryModel === code).length,
    secondary: its.filter((p) => p.models.includes(code) && p.primaryModel !== code).length,
    newThisMonth: its.filter((p) => nowMs - Date.parse(p.firstAt) <= 30 * DAY).length,
    asks: ASKS.map(([t, label]) => ({ key: t, label, n: its.filter((p) => p.topics.includes(t)).length, q: q({ topic: t }) })),
    exterior: tally(its, (p) => onCar(p.coloursWanted), capital, (k) => q({ colour: k })),
    interior: tally(its, (p) => onCar(p.interior), capital, (k) => q({ interior: k })),
    rejected: tally(its, (p) => onCar(p.coloursRejected), capital, (k) => q({ rejectedColour: k })),
    colourKnown: its.filter((p) => onCar(p.coloursWanted).length > 0).length,
    weekly: weekly.map((s) => s.size),
    questions: tally(its, (p) => p.topics, topicLabel, (k) => q({ topic: k })).slice(0, 12),
    concerns: tally(its, (p) => p.concerns, (k) => valueLabel("concern", k), (k) => q({ concern: k })),
    alsoAsked: tally(its, (p) => p.models.filter((m) => m !== code), carName, (k) => q({ alsoModel: k })),
    compared: tally(its, (p) => p.comparedModels.filter((m) => m !== code), carName, (k) => q({ comparedModel: k })),
    competitors: tally(its, (p) => p.competitors, (k) => valueLabel("competitor", k), (k) => q({ competitor: k })),
    budget: tally(its, (p) => (p.budgetBand ? [p.budgetBand] : []), (k) => valueLabel("budget", k), (k) => q({ budget: k })),
    timeline: tally(its, (p) => (p.timeline ? [p.timeline] : []), (k) => valueLabel("timeline", k), (k) => q({ timeline: k })),
    city: tally(its, (p) => (p.city ? [p.city] : []), (k) => valueLabel("city", k), (k) => q({ city: k })),
  };
}

/* ── Colours ──────────────────────────────────────────────────────────── */

export interface ColourCell {
  family: string;
  people: number;
  /** Share of the people with a known exterior wish for this car (never of everyone). */
  share: number | null;
  stockNow: number | null;
  q: InsightQuery;
}

export interface ColourRow {
  code: string;
  name: string;
  known: number;
  unknown: number;
  exterior: ColourCell[];
  interior: LinkedCount[];
  rejected: LinkedCount[];
  stockNow: number | null;
  inbound: number | null;
}

/**
 * Per car: who wants or asked which exterior colour (people), interior, refused, beside the CRM's stock.
 * `strict` counts only colours tied to the car by the customer's own words (same clause / the only car
 * named), leaving out ones tied through the conversation or the ad.
 */
export function colourMatrix(observations: readonly ObservationRow[], people: readonly PersonFacts[], personOf: (conv: string) => string, strict: boolean, stock: Readonly<Record<string, CarStock>> | null): ColourRow[] {
  const allowed = (o: ObservationRow) => !strict || o.binding === "same_clause" || o.binding === "only_car_named";
  const ext = new Map<string, Map<string, Set<string>>>();
  const int = new Map<string, Map<string, Set<string>>>();
  const rej = new Map<string, Map<string, Set<string>>>();
  const add = (m: Map<string, Map<string, Set<string>>>, code: string, fam: string, who: string) => {
    const inner = m.get(code) ?? m.set(code, new Map()).get(code)!;
    (inner.get(fam) ?? inner.set(fam, new Set()).get(fam)!).add(who);
  };
  for (const o of observations) {
    if (o.kind !== "colour" || !o.model || o.value === "any" || o.value === "which" || o.stance === "alternative" || !allowed(o)) continue;
    const who = personOf(o.conversation_id);
    if (o.stance === "rejects") add(rej, o.model, o.value, who);
    else if (o.part === "interior") add(int, o.model, o.value, who);
    else add(ext, o.model, o.value, who);
  }
  return MONZA_KNOWLEDGE.models.map((m) => {
    const e = ext.get(m.code) ?? new Map<string, Set<string>>();
    const knownSet = new Set<string>();
    for (const s of e.values()) for (const w of s) knownSet.add(w);
    const its = people.filter((p) => p.models.includes(m.code)).length;
    const st = stock ? (stock[m.code] ?? { now: 0, inbound: 0, colours: [] }) : null;
    const toCounts = (mm: Map<string, Set<string>> | undefined, key: "interior" | "rejectedColour"): LinkedCount[] =>
      [...(mm ?? new Map<string, Set<string>>()).entries()].map(([fam, s]) => ({ key: fam, label: capital(fam), n: s.size, q: { anyModel: m.code, [key]: fam } as InsightQuery })).sort((a, b) => b.n - a.n);
    return {
      code: m.code,
      name: m.displayName,
      known: knownSet.size,
      unknown: Math.max(0, its - knownSet.size),
      exterior: [...e.entries()]
        .map(([fam, s]) => ({ family: fam, people: s.size, share: knownSet.size ? s.size / knownSet.size : null, stockNow: st ? (st.colours.find((c) => c.key === fam)?.n ?? 0) : null, q: { anyModel: m.code, colour: fam } }))
        .sort((a, b) => b.people - a.people || a.family.localeCompare(b.family)),
      interior: toCounts(int.get(m.code), "interior"),
      rejected: toCounts(rej.get(m.code), "rejectedColour"),
      stockNow: st ? st.now : null,
      inbound: st ? st.inbound : null,
    };
  });
}

/* ── Conversations ───────────────────────────────────────────────────── */

export interface Rising {
  key: string;
  label: string;
  now: number;
  before: number;
  q: InsightQuery;
}

export interface ConversationsView {
  questions: LinkedCount[];
  concerns: LinkedCount[];
  needs: LinkedCount[];
  byModel: { code: string; name: string; questions: LinkedCount[] }[];
  rising: Rising[];
  byBrand: { key: string; label: string; questions: LinkedCount[] }[];
  byChannel: { key: string; label: string; questions: LinkedCount[] }[];
  /** People who made each kind of statement: a question, a concern, a preference, a refusal, a wish to buy. */
  statements: LinkedCount[];
  /** Questions among qualified leads vs everyone else (people). */
  qualifiedTopics: LinkedCount[];
  otherTopics: LinkedCount[];
}

/** Topics asked by people; rising = asked by at least `minPeople` in the last 30 days and more than in the 30 before. */
export function conversationsView(people: readonly PersonFacts[], signals: readonly SignalRow[], personOf: (conv: string) => string, nowMs: number, minPeople = 5): ConversationsView {
  const window = (from: number, to: number) => {
    const m = new Map<string, Set<string>>();
    for (const s of signals) {
      const t = Date.parse(s.at);
      if (t < from || t >= to) continue;
      for (const i of s.intents) if (i !== "UNKNOWN") (m.get(i) ?? m.set(i, new Set()).get(i)!).add(personOf(s.conversation_id));
    }
    return m;
  };
  const recent = window(nowMs - 30 * DAY, nowMs + DAY);
  const earlier = window(nowMs - 60 * DAY, nowMs - 30 * DAY);
  const rising = [...recent.entries()]
    .map(([key, s]) => ({ key, label: topicLabel(key), now: s.size, before: earlier.get(key)?.size ?? 0, q: { topic: key, days: 30 } as InsightQuery }))
    .filter((r) => r.now >= minPeople && r.now > r.before)
    .sort((a, b) => b.now - b.before - (a.now - a.before) || b.now - a.now);
  return {
    questions: tally(people, (p) => p.topics, topicLabel, (k) => ({ topic: k })),
    concerns: tally(people, (p) => p.concerns, (k) => valueLabel("concern", k), (k) => ({ concern: k })),
    needs: tally(people, (p) => p.needs, (k) => valueLabel("need", k), (k) => ({ need: k })),
    byModel: MONZA_KNOWLEDGE.models
      .map((m) => ({ code: m.code, name: m.displayName, questions: tally(people.filter((p) => p.models.includes(m.code) || p.contextModels.includes(m.code)), (p) => p.topics, topicLabel, (k) => ({ anyModel: m.code, topic: k })).slice(0, 6) }))
      .filter((r) => r.questions.length > 0),
    rising,
    byBrand: ["voyah", "mhero", "monza"]
      .map((b) => ({ key: b, label: b === "voyah" ? "VOYAH" : b === "mhero" ? "MHERO" : "Monza S.A.L.", questions: tally(people.filter((p) => p.brands.includes(b)), (p) => p.topics, topicLabel, (k) => ({ brand: b, topic: k })).slice(0, 8) }))
      .filter((r) => r.questions.length > 0),
    byChannel: ["whatsapp", "instagram", "facebook"]
      .map((c) => ({ key: c, label: c === "whatsapp" ? "WhatsApp" : c === "instagram" ? "Instagram" : "Messenger", questions: tally(people.filter((p) => p.channels.includes(c)), (p) => p.topics, topicLabel, (k) => ({ channel: c, topic: k })).slice(0, 8) }))
      .filter((r) => r.questions.length > 0),
    statements: [
      { key: "question", label: "Asked a question", n: people.filter((p) => p.topics.length > 0).length, q: {} },
      { key: "concern", label: "Raised a concern", n: people.filter((p) => p.concerns.length > 0).length, q: {} },
      { key: "preference", label: "Stated a preference (car, colour, budget…)", n: people.filter((p) => p.coloursWanted.length > 0 || p.budgetBand !== null || p.categories.length > 0 || p.timeline !== null).length, q: {} },
      { key: "refusal", label: "Refused a car or a colour", n: people.filter((p) => p.rejectedModels.length > 0 || p.coloursRejected.length > 0).length, q: {} },
      { key: "buying", label: "Said they want to buy", n: people.filter((p) => p.stage === "buying").length, q: { stage: "buying" } },
    ],
    qualifiedTopics: tally(people.filter(isQualified), (p) => p.topics, topicLabel, (k) => ({ topic: k, stage: "pricing,test_drive,buying" })).slice(0, 10),
    otherTopics: tally(people.filter((p) => !isQualified(p)), (p) => p.topics, topicLabel, (k) => ({ topic: k, stage: "asking,interested,wrote" })).slice(0, 10),
  };
}

const QUALIFYING_TOPICS = new Set(["PRICE", "FINANCING", "TEST_DRIVE", "AVAILABILITY", "BUYING_INTENT", "TRADE_IN", "VISIT", "DISCOUNT"]);
const isQualified = (p: PersonFacts) => (p.models.length > 0 || p.contextModels.length > 0) && p.topics.some((t) => QUALIFYING_TOPICS.has(t));

/* ── Channels ─────────────────────────────────────────────────────────── */

export interface ChannelView {
  channel: string;
  people: number;
  highIntent: number;
  models: LinkedCount[];
  colours: LinkedCount[];
  languages: LinkedCount[];
  firstTouch: LinkedCount[];
}

const TOUCH_LABEL: Readonly<Record<string, string>> = { ad: "An ad", post: "A post", story: "A story", direct: "Not tracked", referral: "A link" };
const LANGUAGE_LABEL: Readonly<Record<string, string>> = { en: "English", ar: "Arabic", arabizi: "Arabizi", fr: "French", mixed: "Mixed", unknown: "Unknown" };

export function channelsView(people: readonly PersonFacts[]): ChannelView[] {
  return ["whatsapp", "instagram", "facebook"].map((ch) => {
    const its = people.filter((p) => p.channels.includes(ch));
    const q = (extra: InsightQuery): InsightQuery => ({ channel: ch, ...extra });
    return {
      channel: ch,
      people: its.length,
      highIntent: its.filter((p) => HIGH_INTENT.has(p.stage)).length,
      models: tally(its, (p) => [...new Set([...p.models, ...p.contextModels])], carName, (k) => q({ anyModel: k })).slice(0, 8),
      colours: tally(its, (p) => p.coloursWanted.map(family), capital, (k) => q({ colour: k })).slice(0, 8),
      languages: tally(its, (p) => (p.language ? [p.language] : []), (k) => LANGUAGE_LABEL[k] ?? k, (k) => q({ language: k })),
      firstTouch: tally(its, (p) => [p.firstTouch ?? "direct"], (k) => TOUCH_LABEL[k] ?? k, (k) => q({ firstTouch: k })),
    };
  });
}

/* ── Data quality ─────────────────────────────────────────────────────── */

export interface QualityView {
  people: number;
  coverage: { key: string; label: string; n: number; share: number }[];
  colourFacts: number;
  unboundColours: number;
  byBinding: Count[];
  linkedByPhone: number;
}

export function qualityView(people: readonly PersonFacts[], observations: readonly ObservationRow[], phoneOf: (p: PersonFacts) => boolean): QualityView {
  const n = people.length;
  const cover = (key: string, label: string, ok: (p: PersonFacts) => boolean) => {
    const k = people.filter(ok).length;
    return { key, label, n: k, share: n ? k / n : 0 };
  };
  const colours = observations.filter((o) => o.kind === "colour" && o.value !== "any" && o.value !== "which");
  const binding = new Map<string, number>();
  for (const o of colours) binding.set(o.binding ?? "none", (binding.get(o.binding ?? "none") ?? 0) + 1);
  const BINDING_LABEL: Readonly<Record<string, string>> = { same_clause: "Same sentence as the car", only_car_named: "The only car named", conversation: "The car being discussed", ad: "The ad's car", none: "No car" };
  return {
    people: n,
    coverage: [
      cover("model", "A car", (p) => p.models.length > 0),
      cover("colour", "An exterior colour", (p) => p.coloursWanted.length > 0),
      cover("budget", "A budget", (p) => p.budgetBand !== null),
      cover("timeline", "When they will buy", (p) => p.timeline !== null),
      cover("city", "Where they live", (p) => p.city !== null),
      cover("purpose", "What it's for", (p) => p.purpose.length > 0),
      cover("owner", "An owner in the team", (p) => p.ownerId !== null),
    ],
    colourFacts: colours.length,
    unboundColours: binding.get("none") ?? 0,
    byBinding: [...binding.entries()].map(([key, k]) => ({ key, label: BINDING_LABEL[key] ?? key, n: k })).sort((a, b) => b.n - a.n),
    linkedByPhone: people.filter(phoneOf).length,
  };
}
