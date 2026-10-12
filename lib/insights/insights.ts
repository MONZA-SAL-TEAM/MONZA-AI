/**
 * INSIGHTS: what the sales signals say about the CARS and the CLIENTS (Samer, 2026-10-12: "a page
 * where I get the full insight of all clients and cars"). Pure: rows in, a picture out — tested in
 * tests/insights.test.ts; the read is lib/insights/insights-server.ts.
 *
 * Everything here is counted from labels the engine recorded (lib/wasales/signal.ts): which car was
 * named, which question asked, which colour, how far the customer went. No message text exists in
 * these rows, so nothing here can leak one.
 */

import { encodeThreadId } from "@/lib/channels/live-map";
import { MONZA_KNOWLEDGE, modelByCode } from "@/lib/wasales/knowledge";
import { STAGE_LABEL, furthestStage, stageOf, topicLabel, type Stage } from "@/lib/wasales/signal";
import { BUDGET_ORDER, TIMELINE_ORDER, factLabel, valueLabel } from "@/lib/insights/facts";

export interface SignalRow {
  account_id: string;
  brand: string;
  channel: string;
  conversation_id: string;
  at: string;
  language: string;
  intents: string[];
  models: string[];
  weak_models: string[];
  colour: string | null;
  has_media: boolean;
  alert_kind: string | null;
  alert_tags: string[];
  offered: string[];
  silenced: string[];
}

/** One typed fact (sales_observations): a colour wanted / asked / rejected, tied to a car. */
export interface ObservationRow {
  conversation_id: string;
  at: string;
  kind: string;
  stance: string | null;
  model: string | null;
  binding: string | null;
  part: string | null;
  value: string;
  detail: string | null;
  amount_min?: number | null;
  amount_max?: number | null;
  currency?: string | null;
  amount_kind?: string | null;
  months?: number | null;
  external_message_id?: string | null;
}

export interface InsightRows {
  signals: SignalRow[];
  /** Facts (021). Optional: absent before the reader ran, and then colours come from nothing. */
  observations?: ObservationRow[];
  conversations: { id: string; account_id: string; brand: string; peer_external_id: string; peer_display: string | null; created_at: string | null }[];
  leads: { id: string; display_name: string | null; phone: string | null }[];
  leadConversations: { lead_id: string; conversation_id: string }[];
  /** Every alert, open or done: the open ones mark who is waiting now. */
  alerts: { conversation_ref: string; kind: string; status: string; created_at: string }[];
}

export interface InsightFilter {
  /** Days back from `now`; 0 = everything. */
  days: number;
  brand?: string | null;
  channel?: string | null;
  model?: string | null;
  now: string;
}

export interface Count {
  key: string;
  label: string;
  n: number;
}

export interface CarInsight {
  code: string;
  name: string;
  brand: string;
  /** Distinct people who named it. */
  people: number;
  messages: number;
  price: number;
  testDrive: number;
  financing: number;
  buying: number;
  stock: number;
  /** Exterior colours people WANT or ASKED about — distinct people per colour. */
  colours: Count[];
  /** Interior colours. */
  interior: Count[];
  /** Colours people said they do NOT want. */
  rejected: Count[];
  /** People with a known colour wish for this car (the denominator for a share). */
  colourKnown: number;
  questions: Count[];
  /** People who named it, per week, oldest first (WEEKS weeks). */
  weekly: number[];
}

export interface ClientInsight {
  id: string;
  name: string;
  phone: string | null;
  channel: string;
  brand: string;
  cars: string[];
  stage: Stage;
  stageLabel: string;
  topics: string[];
  colours: string[];
  /** Colours they said they don't want. */
  rejectedColours: string[];
  /** Cars they said they don't want. */
  rejectedCars: string[];
  messages: number;
  language: string;
  firstAt: string;
  lastAt: string;
  waiting: string | null;
  /** The chat in the inbox, when it can be opened by thread id (WhatsApp). */
  threadId: string | null;
  /** The latest of each, in plain words (null when never said). */
  budget: string | null;
  timeline: string | null;
  city: string | null;
  purpose: string[];
  otherBrands: string[];
  concerns: string[];
  financing: string[];
  tradeIn: string[];
}

/** What clients told us about themselves: distinct PEOPLE per value (the latest value, for one-value kinds). */
export interface ProfileCounts {
  budget: Count[];
  timeline: Count[];
  purpose: Count[];
  city: Count[];
  competitors: Count[];
  concerns: Count[];
  financing: Count[];
  needs: Count[];
  /** How many people said anything at all of each kind: the denominator, never everyone. */
  known: Record<"budget" | "timeline" | "purpose" | "city" | "competitor" | "concern" | "financing" | "need" | "trade_in", number>;
}

export interface Insights {
  totals: { people: number; messages: number; interested: number; hot: number; waiting: number };
  cars: CarInsight[];
  topics: Count[];
  stages: Count[];
  channels: Count[];
  languages: Count[];
  brands: Count[];
  /** Messages per week, oldest first. */
  weekly: { labels: string[]; messages: number[]; people: number[] };
  clients: ClientInsight[];
  profile: ProfileCounts;
  /** The window the figures cover. */
  since: string | null;
}

export const WEEKS = 12;

const CHANNEL_LABEL: Readonly<Record<string, string>> = { whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Messenger" };
const LANGUAGE_LABEL: Readonly<Record<string, string>> = { en: "English", ar: "Arabic", arabizi: "Arabizi", fr: "French", mixed: "Mixed", unknown: "Unknown" };
const BRAND_LABEL: Readonly<Record<string, string>> = { voyah: "VOYAH", mhero: "MHERO", monza: "Monza S.A.L." };

function digits(s: string): string {
  return s.replace(/\D/g, "");
}

function counts(map: Map<string, number>, label: (k: string) => string): Count[] {
  return [...map.entries()].map(([key, n]) => ({ key, label: label(key), n })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}

/** Counts in a fixed order (budget bands low to high), leaving out the empty ones. */
function ordered(map: Map<string, number>, order: readonly string[], label: (k: string) => string): Count[] {
  const known = order.filter((k) => map.has(k)).map((key) => ({ key, label: label(key), n: map.get(key) ?? 0 }));
  const rest = [...map.keys()].filter((k) => !order.includes(k)).map((key) => ({ key, label: label(key), n: map.get(key) ?? 0 }));
  return [...known, ...rest];
}

function bump(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

function weekIndex(iso: string, nowMs: number): number {
  const age = nowMs - Date.parse(iso);
  const w = WEEKS - 1 - Math.floor(age / (7 * 86_400_000));
  return w;
}

export function buildInsights(rows: InsightRows, f: InsightFilter): Insights {
  const nowMs = Date.parse(f.now);
  const sinceMs = f.days > 0 ? nowMs - f.days * 86_400_000 : 0;
  const convById = new Map(rows.conversations.map((c) => [c.id, c]));
  const leadByConv = new Map(rows.leadConversations.map((lc) => [lc.conversation_id, lc.lead_id]));
  const leadById = new Map(rows.leads.map((l) => [l.id, l]));
  const openAlertByConv = new Map<string, string>();
  for (const a of rows.alerts) if (a.status === "open" && !openAlertByConv.has(a.conversation_ref)) openAlertByConv.set(a.conversation_ref, a.kind);

  const signals = rows.signals.filter((s) => {
    const t = Date.parse(s.at);
    if (!Number.isFinite(t) || t < sinceMs || t > nowMs + 86_400_000) return false;
    if (f.brand && s.brand !== f.brand) return false;
    if (f.channel && s.channel !== f.channel) return false;
    if (f.model && !s.models.includes(f.model)) return false;
    return true;
  });

  // A person = a lead when the chat has one, else the chat itself (the same rule as /customers).
  const personKey = (conversationId: string) => {
    const lead = leadByConv.get(conversationId);
    return lead ? `lead:${lead}` : `chat:${conversationId}`;
  };

  const people = new Map<string, { convs: Set<string>; signals: SignalRow[] }>();
  for (const s of signals) {
    const key = personKey(s.conversation_id);
    const p = people.get(key) ?? { convs: new Set(), signals: [] };
    p.convs.add(s.conversation_id);
    p.signals.push(s);
    people.set(key, p);
  }

  // ── Cars ─────────────────────────────────────────────────────────────
  const cars: CarInsight[] = MONZA_KNOWLEDGE.models.map((m) => ({
    code: m.code,
    name: m.displayName,
    brand: m.brand,
    people: 0,
    messages: 0,
    price: 0,
    testDrive: 0,
    financing: 0,
    buying: 0,
    stock: 0,
    colours: [],
    interior: [],
    rejected: [],
    colourKnown: 0,
    questions: [],
    weekly: Array.from({ length: WEEKS }, () => 0),
  }));
  const carByCode = new Map(cars.map((c) => [c.code, c]));
  const carPeople = new Map<string, Set<string>>();
  const carWeekPeople = new Map<string, Set<string>>();
  const carQuestions = new Map<string, Map<string, number>>();
  for (const s of signals) {
    const key = personKey(s.conversation_id);
    for (const code of s.models) {
      const car = carByCode.get(code);
      if (!car) continue;
      car.messages++;
      (carPeople.get(code) ?? carPeople.set(code, new Set()).get(code)!).add(key);
      if (s.intents.includes("PRICE")) car.price++;
      if (s.intents.includes("TEST_DRIVE")) car.testDrive++;
      if (s.intents.includes("FINANCING")) car.financing++;
      if (s.intents.includes("BUYING_INTENT")) car.buying++;
      if (s.intents.includes("AVAILABILITY")) car.stock++;
      for (const i of s.intents) bump(carQuestions.get(code) ?? carQuestions.set(code, new Map()).get(code)!, i);
      const w = weekIndex(s.at, nowMs);
      if (w >= 0 && w < WEEKS) (carWeekPeople.get(`${code}:${w}`) ?? carWeekPeople.set(`${code}:${w}`, new Set()).get(`${code}:${w}`)!).add(key);
    }
  }
  // Colours: distinct PEOPLE per car and colour, from the facts — wishes and questions apart from refusals.
  const colourPeople = new Map<string, Set<string>>();
  const knownPeople = new Map<string, Set<string>>();
  const signalConvs = new Set(signals.map((s) => s.conversation_id));
  for (const o of rows.observations ?? []) {
    if (o.kind !== "colour" || !o.model || !signalConvs.has(o.conversation_id)) continue;
    const t = Date.parse(o.at);
    if (!Number.isFinite(t) || t < sinceMs || t > nowMs + 86_400_000) continue;
    if (o.value === "any") continue;
    const key = personKey(o.conversation_id);
    const bucket = o.stance === "rejects" ? "rejected" : o.part === "interior" ? "interior" : "exterior";
    const label = o.detail ?? o.value;
    const k2 = `${o.model}|${bucket}|${label}`;
    (colourPeople.get(k2) ?? colourPeople.set(k2, new Set()).get(k2)!).add(key);
    if (bucket === "exterior") (knownPeople.get(o.model) ?? knownPeople.set(o.model, new Set()).get(o.model)!).add(key);
  }
  const colourCounts = (code: string, bucket: string): Count[] =>
    [...colourPeople.entries()]
      .filter(([k2]) => k2.startsWith(`${code}|${bucket}|`))
      .map(([k2, set]) => {
        const label = k2.split("|")[2];
        return { key: label, label: label.charAt(0).toUpperCase() + label.slice(1), n: set.size };
      })
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  for (const car of cars) {
    car.people = carPeople.get(car.code)?.size ?? 0;
    car.colours = colourCounts(car.code, "exterior").slice(0, 8);
    car.interior = colourCounts(car.code, "interior").slice(0, 6);
    car.rejected = colourCounts(car.code, "rejected").slice(0, 6);
    car.colourKnown = knownPeople.get(car.code)?.size ?? 0;
    car.questions = counts(carQuestions.get(car.code) ?? new Map(), topicLabel).slice(0, 8);
    for (let w = 0; w < WEEKS; w++) car.weekly[w] = carWeekPeople.get(`${car.code}:${w}`)?.size ?? 0;
  }
  cars.sort((a, b) => b.people - a.people || b.messages - a.messages || a.name.localeCompare(b.name));

  // ── Overall ──────────────────────────────────────────────────────────
  const topics = new Map<string, number>();
  const channels = new Map<string, number>();
  const languages = new Map<string, number>();
  const brands = new Map<string, number>();
  const weeklyMessages = Array.from({ length: WEEKS }, () => 0);
  const weeklyPeople = Array.from({ length: WEEKS }, () => new Set<string>());
  for (const s of signals) {
    for (const i of s.intents) bump(topics, i);
    bump(channels, s.channel);
    bump(languages, s.language);
    bump(brands, s.brand);
    const w = weekIndex(s.at, nowMs);
    if (w >= 0 && w < WEEKS) {
      weeklyMessages[w]++;
      weeklyPeople[w].add(personKey(s.conversation_id));
    }
  }
  const labels: string[] = [];
  for (let w = 0; w < WEEKS; w++) {
    const start = new Date(nowMs - (WEEKS - 1 - w) * 7 * 86_400_000);
    labels.push(`${start.getUTCDate()} ${start.toLocaleString("en", { month: "short", timeZone: "UTC" })}`);
  }

  // ── Clients ──────────────────────────────────────────────────────────
  const factsByConv = new Map<string, ObservationRow[]>();
  for (const o of rows.observations ?? []) (factsByConv.get(o.conversation_id) ?? factsByConv.set(o.conversation_id, []).get(o.conversation_id)!).push(o);
  const clients: ClientInsight[] = [];
  const stages = new Map<string, number>();
  let hot = 0;
  let interested = 0;
  let waiting = 0;
  const profileKnown: ProfileCounts["known"] = { budget: 0, timeline: 0, purpose: 0, city: 0, competitor: 0, concern: 0, financing: 0, need: 0, trade_in: 0 };
  const [pBudget, pTimeline, pPurpose, pCity, pCompetitors, pConcerns, pFinancing, pNeeds] = Array.from({ length: 8 }, () => new Map<string, number>());
  for (const [key, p] of people) {
    const sorted = [...p.signals].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const conv = convById.get(last.conversation_id);
    const lead = key.startsWith("lead:") ? leadById.get(key.slice(5)) ?? null : null;
    const phone = lead?.phone ? digits(lead.phone) : conv && last.channel === "whatsapp" ? digits(conv.peer_external_id) : null;
    const name = lead?.display_name?.trim() || conv?.peer_display?.trim() || (phone ? `+${phone}` : "Customer");
    const carCodes = [...new Set(sorted.flatMap((s) => s.models))];
    const stage = furthestStage(sorted.map((s) => stageOf(s.intents, s.models)));
    const topicsOf = [...new Set(sorted.flatMap((s) => s.intents))].map(topicLabel);
    const convIds = new Set(p.convs);
    const facts = [...convIds].flatMap((c) => factsByConv.get(c) ?? []).filter((o) => {
      const t = Date.parse(o.at);
      return Number.isFinite(t) && t >= sinceMs && t <= nowMs + 86_400_000;
    });
    const nameOfCar = (c: string | null) => (c ? (modelByCode(MONZA_KNOWLEDGE, c)?.displayName ?? c) : "");
    const colourLabel = (o: ObservationRow) => `${o.part === "interior" ? "interior " : ""}${o.detail ?? o.value}${o.model ? ` (${nameOfCar(o.model)})` : ""}`;
    const coloursOf = [...new Set(facts.filter((o) => o.kind === "colour" && o.stance !== "rejects" && o.value !== "any").map(colourLabel))];
    const rejectedColours = [...new Set(facts.filter((o) => o.kind === "colour" && o.stance === "rejects").map(colourLabel))];
    const rejectedCars = [...new Set(facts.filter((o) => o.kind === "model" && o.stance === "rejects").map((o) => nameOfCar(o.model)))];
    const byTime = [...facts].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const latest = (kind: string) => byTime.find((o) => o.kind === kind) ?? null;
    const all = (kind: string, label: (o: ObservationRow) => string) => [...new Set(byTime.filter((o) => o.kind === kind).map(label))];
    const budgetFact = latest("budget");
    const timelineFact = latest("timeline");
    const cityFact = latest("city");
    const lang = counts(sorted.reduce((m, s) => (bump(m, s.language), m), new Map<string, number>()), (k) => k)[0]?.key ?? "unknown";
    const waitingKind = [...p.convs].map((c) => openAlertByConv.get(c) ?? null).find((k) => k) ?? null;
    if (stage === "buying") hot++;
    if (carCodes.length > 0) interested++;
    if (waitingKind) waiting++;
    bump(stages, stage);
    clients.push({
      id: key,
      name,
      phone,
      channel: last.channel,
      brand: last.brand,
      cars: carCodes.map((c) => modelByCode(MONZA_KNOWLEDGE, c)?.displayName ?? c),
      stage,
      stageLabel: STAGE_LABEL[stage],
      topics: topicsOf,
      colours: coloursOf,
      rejectedColours,
      rejectedCars,
      messages: sorted.length,
      language: LANGUAGE_LABEL[lang] ?? lang,
      firstAt: first.at,
      lastAt: last.at,
      waiting: waitingKind,
      threadId: last.channel === "whatsapp" ? encodeThreadId(last.account_id, last.conversation_id) : null,
      budget: budgetFact ? factLabel(budgetFact).replace(/^Budget /, "") : null,
      timeline: timelineFact ? valueLabel("timeline", timelineFact.value) : null,
      city: cityFact ? valueLabel("city", cityFact.value) : null,
      purpose: all("purpose", (o) => valueLabel("purpose", o.value)),
      otherBrands: all("competitor", (o) => factLabel(o)),
      concerns: all("concern", (o) => valueLabel("concern", o.value)),
      financing: all("financing", (o) => factLabel(o)),
      tradeIn: all("trade_in", (o) => factLabel(o)),
    });
    for (const kind of Object.keys(profileKnown) as (keyof ProfileCounts["known"])[]) if (facts.some((o) => o.kind === kind)) profileKnown[kind]++;
    if (budgetFact) bump(pBudget, budgetFact.value);
    if (timelineFact) bump(pTimeline, timelineFact.value);
    if (cityFact) bump(pCity, cityFact.value);
    const each = (kind: string, map: Map<string, number>) => {
      for (const v of new Set(facts.filter((o) => o.kind === kind && o.stance !== "rejects").map((o) => o.value))) bump(map, v);
    };
    each("purpose", pPurpose);
    each("competitor", pCompetitors);
    each("concern", pConcerns);
    each("financing", pFinancing);
    each("need", pNeeds);
  }
  const STAGE_ORDER: Stage[] = ["buying", "test_drive", "pricing", "interested", "asking", "wrote"];
  clients.sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) || Date.parse(b.lastAt) - Date.parse(a.lastAt));

  return {
    totals: { people: people.size, messages: signals.length, interested, hot, waiting },
    cars,
    topics: counts(topics, topicLabel),
    stages: STAGE_ORDER.map((s) => ({ key: s, label: STAGE_LABEL[s], n: stages.get(s) ?? 0 })),
    channels: counts(channels, (k) => CHANNEL_LABEL[k] ?? k),
    languages: counts(languages, (k) => LANGUAGE_LABEL[k] ?? k),
    brands: counts(brands, (k) => BRAND_LABEL[k] ?? k),
    weekly: { labels, messages: weeklyMessages, people: weeklyPeople.map((s) => s.size) },
    clients,
    profile: {
      budget: ordered(pBudget, BUDGET_ORDER, (k) => valueLabel("budget", k)),
      timeline: ordered(pTimeline, TIMELINE_ORDER, (k) => valueLabel("timeline", k)),
      purpose: counts(pPurpose, (k) => valueLabel("purpose", k)),
      city: counts(pCity, (k) => valueLabel("city", k)),
      competitors: counts(pCompetitors, (k) => valueLabel("competitor", k)),
      concerns: counts(pConcerns, (k) => valueLabel("concern", k)),
      financing: counts(pFinancing, (k) => valueLabel("financing", k)),
      needs: counts(pNeeds, (k) => valueLabel("need", k)),
      known: profileKnown,
    },
    since: f.days > 0 ? new Date(sinceMs).toISOString() : null,
  };
}

/** The clients as CSV, for a spreadsheet. Cells that begin with = + - @ are defused (a customer chooses their own name). */
export function clientsCsv(clients: readonly ClientInsight[]): string {
  const cell = (v: string | number | null) => {
    const s = v === null ? "" : String(v);
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = ["Name", "Phone", "Channel", "Brand", "Cars", "Stage", "Questions", "Colours", "Budget", "Buying when", "City", "Purpose", "Other brands", "Concerns", "Financing", "Trade-in", "Messages", "Language", "First message", "Last message", "Waiting for a person"];
  const lines = clients.map((c) =>
    [c.name, c.phone, CHANNEL_LABEL[c.channel] ?? c.channel, BRAND_LABEL[c.brand] ?? c.brand, c.cars.join("; "), c.stageLabel, c.topics.join("; "), c.colours.join("; "), c.budget ?? "", c.timeline ?? "", c.city ?? "", c.purpose.join("; "), c.otherBrands.join("; "), c.concerns.join("; "), c.financing.join("; "), c.tradeIn.join("; "), c.messages, c.language, c.firstAt.slice(0, 10), c.lastAt.slice(0, 10), c.waiting ?? ""].map(cell).join(",")
  );
  return [head.join(","), ...lines].join("\n");
}
