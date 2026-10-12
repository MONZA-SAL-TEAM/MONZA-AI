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

export interface InsightRows {
  signals: SignalRow[];
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
  colours: Count[];
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
  messages: number;
  language: string;
  firstAt: string;
  lastAt: string;
  waiting: string | null;
  /** The chat in the inbox, when it can be opened by thread id (WhatsApp). */
  threadId: string | null;
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
    questions: [],
    weekly: Array.from({ length: WEEKS }, () => 0),
  }));
  const carByCode = new Map(cars.map((c) => [c.code, c]));
  const carPeople = new Map<string, Set<string>>();
  const carWeekPeople = new Map<string, Set<string>>();
  const carColours = new Map<string, Map<string, number>>();
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
      if (s.colour) bump(carColours.get(code) ?? carColours.set(code, new Map()).get(code)!, s.colour);
      for (const i of s.intents) bump(carQuestions.get(code) ?? carQuestions.set(code, new Map()).get(code)!, i);
      const w = weekIndex(s.at, nowMs);
      if (w >= 0 && w < WEEKS) (carWeekPeople.get(`${code}:${w}`) ?? carWeekPeople.set(`${code}:${w}`, new Set()).get(`${code}:${w}`)!).add(key);
    }
  }
  for (const car of cars) {
    car.people = carPeople.get(car.code)?.size ?? 0;
    car.colours = counts(carColours.get(car.code) ?? new Map(), (k) => k).slice(0, 6);
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
  const clients: ClientInsight[] = [];
  const stages = new Map<string, number>();
  let hot = 0;
  let interested = 0;
  let waiting = 0;
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
    const coloursOf = [...new Set(sorted.map((s) => s.colour).filter((c): c is string => Boolean(c)))];
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
      messages: sorted.length,
      language: LANGUAGE_LABEL[lang] ?? lang,
      firstAt: first.at,
      lastAt: last.at,
      waiting: waitingKind,
      threadId: last.channel === "whatsapp" ? encodeThreadId(last.account_id, last.conversation_id) : null,
    });
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
  const head = ["Name", "Phone", "Channel", "Brand", "Cars", "Stage", "Questions", "Colours", "Messages", "Language", "First message", "Last message", "Waiting for a person"];
  const lines = clients.map((c) =>
    [c.name, c.phone, CHANNEL_LABEL[c.channel] ?? c.channel, BRAND_LABEL[c.brand] ?? c.brand, c.cars.join("; "), c.stageLabel, c.topics.join("; "), c.colours.join("; "), c.messages, c.language, c.firstAt.slice(0, 10), c.lastAt.slice(0, 10), c.waiting ?? ""].map(cell).join(",")
  );
  return [head.join(","), ...lines].join("\n");
}
