/**
 * The Decision Center — PURE (Samer, 2026-10-13: "Fixes + Decision Center"). A dashboard says what happened;
 * this says what needs a person NOW, by FIXED RULES over the facts already recorded — never generated text,
 * never a price. Each rule names its trigger in plain words, the predefined next step and who should act.
 * The server (decisions-server.ts) turns the hits into tracked items (open → acknowledged / escalated →
 * resolved / dismissed, or cleared by itself when the condition is gone), so whether acting on them helps
 * can be measured.
 *
 * Also here: the five morning numbers, the four levels of demand per car, and demand beside stock and
 * units sold.
 */

import type { PersonFacts } from "@/lib/insights/people";
import type { CarStock, CrmOutcome, ModelSales } from "@/lib/insights/crm";
import { monthsOfStock } from "@/lib/insights/crm";
import { isQualified } from "@/lib/insights/leads";
import { businessMinutes } from "@/lib/insights/team";
import { carName } from "@/lib/insights/facts";
import { MODEL_CODES } from "@/lib/wasales/knowledge";

const DAY = 86_400_000;
const HOUR = 3_600_000;

export type RuleKey =
  | "buyer_waiting"
  | "test_drive_unbooked"
  | "alert_overdue"
  | "unowned_qualified"
  | "demand_over_stock"
  | "colour_unavailable"
  | "stock_without_demand"
  | "data_reread"
  | "data_instagram_silent"
  | "data_demand_not_stored"
  | "data_crm_unlinked";

export type Severity = "critical" | "high" | "normal";
export type Group = "customers" | "stock" | "data";

export interface RuleDef {
  key: RuleKey;
  group: Group;
  label: string;
  /** Exactly when it fires. */
  trigger: string;
  /** The predefined next step. */
  action: string;
  /** Who should act. */
  who: string;
}

/** Thresholds, in one place. */
export const SLA = {
  /** Business minutes a buyer may wait for a person's reply. */
  replyMinutes: 120,
  /** A reply wait this long is critical. */
  criticalMinutes: 480,
  /** Hours an open alert may stay open. */
  alertHours: 24,
  /** Days a chat counts as active. */
  activeDays: 14,
  /** Days of demand compared with stock. */
  demandDays: 30,
} as const;

export const RULES: Readonly<Record<RuleKey, RuleDef>> = {
  buyer_waiting: {
    key: "buyer_waiting",
    group: "customers",
    label: "A buyer is waiting for a reply",
    trigger: `A customer interested in a car who asked to buy, a price, installments, availability, a test drive or a visit wrote last, and nobody has answered for ${SLA.replyMinutes / 60} business hours (chats active in the last ${SLA.activeDays} days).`,
    action: "Reply in the chat now, or assign it to a salesperson.",
    who: "Sales",
  },
  test_drive_unbooked: {
    key: "test_drive_unbooked",
    group: "customers",
    label: "A test drive was asked for, but nothing is booked",
    trigger: `A test-drive alert has been open for ${SLA.alertHours} hours and the test-drive calendar has no booking for that chat.`,
    action: "Call or write to agree a time, book it, then close the alert.",
    who: "Sales",
  },
  alert_overdue: {
    key: "alert_overdue",
    group: "customers",
    label: "An alert has been open too long",
    trigger: `A sales alert has been open for more than ${SLA.alertHours} hours.`,
    action: "Answer the customer — or, if they were already answered, close the alert.",
    who: "Sales",
  },
  unowned_qualified: {
    key: "unowned_qualified",
    group: "customers",
    label: "Qualified leads have no salesperson",
    trigger: `People who asked about a car AND about buying it (price, installments, availability, test drive, visit…) wrote in the last ${SLA.activeDays} days and nobody has taken the lead.`,
    action: "Assign each to a salesperson (inbox → Take this lead, or Assign).",
    who: "Sales manager",
  },
  demand_over_stock: {
    key: "demand_over_stock",
    group: "stock",
    label: "More buyers than cars",
    trigger: `In the last ${SLA.demandDays} days at least 3 people asked to buy a car (price, installments, test drive…) and they outnumber the cars in stock and on the way.`,
    action: "Review stock and incoming orders for this car — a purchasing review, not an automatic order.",
    who: "Management",
  },
  colour_unavailable: {
    key: "colour_unavailable",
    group: "stock",
    label: "A wanted colour is not in stock",
    trigger: "At least 2 people in the last 60 days wanted this exterior colour for this car, and the CRM has none in that colour in stock.",
    action: "Check incoming cars for the colour, or offer the closest colour in stock.",
    who: "Management",
  },
  stock_without_demand: {
    key: "stock_without_demand",
    group: "stock",
    label: "Cars in stock nobody asked about",
    trigger: `3 or more of this car are in stock and nobody asked about it in the last ${SLA.demandDays} days.`,
    action: "Review promotion, pricing policy or moving the cars to a sub-dealer.",
    who: "Management",
  },
  data_reread: {
    key: "data_reread",
    group: "data",
    label: "The WhatsApp history is not fully read with the current rules",
    trigger: "Some WhatsApp labels were made by an older reader — car demand figures mix old and new rules.",
    action: "Connections & imports → Read the stored history again (it runs on the server until finished).",
    who: "Owner",
  },
  data_instagram_silent: {
    key: "data_instagram_silent",
    group: "data",
    label: "Instagram messages are not reaching MONZA AI",
    trigger: "Instagram accounts are connected, but no Instagram message has been recorded in the last 7 days.",
    action: "Read the Instagram history (Connections & imports) and fix the Instagram webhook with Meta (CLAUDE.md rule 43).",
    who: "Owner",
  },
  data_demand_not_stored: {
    key: "data_demand_not_stored",
    group: "data",
    label: "The demand record is not up to date",
    trigger: "The permanent demand record (no client data) was not stored in the last 2 days.",
    action: "Stored demand → Store the record now.",
    who: "Owner",
  },
  data_crm_unlinked: {
    key: "data_crm_unlinked",
    group: "data",
    label: "Chats cannot be linked to CRM sales",
    trigger: "Hundreds of chats carry a mobile number, but almost none matches a CRM customer's mobile — so sales cannot be traced back to chats or ads.",
    action: "Enter customers' mobile numbers in the CRM (primary phone, Lebanese mobile).",
    who: "Owner",
  },
};

/** Which rule goes first when one chat triggers several. */
const PERSON_ORDER: RuleKey[] = ["buyer_waiting", "test_drive_unbooked", "alert_overdue"];

export interface DecisionHit {
  rule: RuleKey;
  /** One live item per rule and subject: a conversation id, a car, a car:colour, or "all". */
  subject: string;
  conversationId: string | null;
  personKey: string | null;
  model: string | null;
  severity: Severity;
  /** Counts and labels only — never words. */
  facts: Record<string, string | number | boolean | null>;
  dueAt: string | null;
}

export interface ConversationState {
  id: string;
  lastInboundAt: string | null;
  lastMessageAt: string | null;
  ownerId: string | null;
}

export interface DecisionInput {
  nowMs: number;
  people: readonly PersonFacts[];
  conversations: readonly ConversationState[];
  personOf: (conversationId: string) => string;
  /** OPEN sales alerts only. */
  openAlerts: readonly { conversation_ref: string; kind: string; created_at: string }[];
  /** Conversations with a test-drive booking. */
  bookedConvs: ReadonlySet<string>;
  /** CRM stock by car; null when the CRM could not be read (stock rules are then not evaluated). */
  stock: Readonly<Record<string, CarStock>> | null;
  health: {
    rereadPending: boolean | null;
    instagramAccounts: number;
    instagramSignals7d: number | null;
    demandLastStored: string | null;
    /** People with a mobile, and how many of them match a CRM customer; null when the CRM was not read. */
    withMobile: number;
    crmMatched: number | null;
  };
}

export interface DecisionRun {
  hits: DecisionHit[];
  /** Rules that were actually checked: only their old items may clear themselves. */
  evaluated: RuleKey[];
}

const intentFor = (p: PersonFacts, code: string) => (p.models.includes(code) || p.contextModels.includes(code)) && isQualified(p);
const askedAbout = (p: PersonFacts, code: string) => p.models.includes(code) || p.contextModels.includes(code);
const buyerTopics = new Set(["BUYING_INTENT", "TEST_DRIVE", "VISIT"]);

export function findDecisions(input: DecisionInput): DecisionRun {
  const { nowMs } = input;
  const now = new Date(nowMs).toISOString();
  const hits: DecisionHit[] = [];
  const evaluated: RuleKey[] = ["buyer_waiting", "test_drive_unbooked", "alert_overdue", "unowned_qualified", "data_reread", "data_instagram_silent", "data_demand_not_stored"];
  const personByKey = new Map(input.people.map((p) => [p.key, p]));
  const activeSince = nowMs - SLA.activeDays * DAY;

  // ── Customers: one item per chat, the most urgent rule wins ────────────────────────────────────────
  const perConv = new Map<string, DecisionHit>();
  const offer = (h: DecisionHit) => {
    const cur = perConv.get(h.subject);
    if (!cur || PERSON_ORDER.indexOf(h.rule) < PERSON_ORDER.indexOf(cur.rule)) perConv.set(h.subject, h);
  };
  const carOf = (p: PersonFacts | undefined) => p?.primaryModel ?? p?.contextModels[0] ?? p?.adModel ?? null;

  for (const c of input.conversations) {
    if (!c.lastInboundAt) continue;
    const t = Date.parse(c.lastInboundAt);
    if (t < activeSince) continue;
    const customerSpokeLast = !c.lastMessageAt || Date.parse(c.lastMessageAt) <= t + 1000;
    if (!customerSpokeLast) continue;
    const key = input.personOf(c.id);
    const p = personByKey.get(key);
    if (!p || !(isQualified(p) || p.topics.some((x) => buyerTopics.has(x)))) continue;
    const waited = businessMinutes(c.lastInboundAt, now);
    if (waited < SLA.replyMinutes) continue;
    offer({
      rule: "buyer_waiting",
      subject: c.id,
      conversationId: c.id,
      personKey: key,
      model: carOf(p),
      severity: waited >= SLA.criticalMinutes || p.topics.includes("BUYING_INTENT") ? "critical" : "high",
      facts: { businessMinutesWaiting: waited, stage: p.stage, owned: Boolean(c.ownerId) },
      dueAt: new Date(t + 2 * HOUR).toISOString(),
    });
  }

  const convById = new Map(input.conversations.map((c) => [c.id, c]));
  const alertsByConv = new Map<string, { kind: string; created_at: string }[]>();
  for (const a of input.openAlerts) (alertsByConv.get(a.conversation_ref) ?? alertsByConv.set(a.conversation_ref, []).get(a.conversation_ref)!).push(a);
  for (const [conv, list] of alertsByConv) {
    const key = input.personOf(conv);
    const p = personByKey.get(key);
    const c = convById.get(conv);
    const old = list.filter((a) => nowMs - Date.parse(a.created_at) > SLA.alertHours * HOUR).sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (old.length === 0) continue;
    const td = old.find((a) => a.kind === "TEST_DRIVE");
    if (td && !input.bookedConvs.has(conv)) {
      offer({
        rule: "test_drive_unbooked",
        subject: conv,
        conversationId: conv,
        personKey: key,
        model: carOf(p),
        severity: "high",
        facts: { hoursOpen: Math.round((nowMs - Date.parse(td.created_at)) / HOUR) },
        dueAt: new Date(Date.parse(td.created_at) + SLA.alertHours * HOUR).toISOString(),
      });
      continue;
    }
    const first = old[0];
    // A person already wrote after the alert: it was answered, only never closed.
    const answered = Boolean(c?.lastMessageAt && c.lastInboundAt && Date.parse(c.lastMessageAt) > Date.parse(c.lastInboundAt) + 1000 && Date.parse(c.lastMessageAt) > Date.parse(first.created_at));
    offer({
      rule: "alert_overdue",
      subject: conv,
      conversationId: conv,
      personKey: key,
      model: carOf(p),
      severity: answered ? "normal" : ["BUYING", "CALLBACK", "OVERDUE", "HUMAN"].includes(first.kind) ? "high" : "normal",
      facts: { kind: first.kind, alerts: old.length, hoursOpen: Math.round((nowMs - Date.parse(first.created_at)) / HOUR), answered },
      dueAt: new Date(Date.parse(first.created_at) + SLA.alertHours * HOUR).toISOString(),
    });
  }
  hits.push(...perConv.values());

  const unowned = input.people.filter((p) => isQualified(p) && !p.ownerId && Date.parse(p.lastAt) >= activeSince);
  if (unowned.length > 0) {
    hits.push({ rule: "unowned_qualified", subject: "all", conversationId: null, personKey: null, model: null, severity: unowned.length >= 20 ? "high" : "normal", facts: { people: unowned.length }, dueAt: null });
  }

  // ── Stock and demand (only when the CRM was read) ──────────────────────────────────────────────────
  if (input.stock) {
    evaluated.push("demand_over_stock", "colour_unavailable", "stock_without_demand");
    const recent = input.people.filter((p) => Date.parse(p.lastAt) >= nowMs - SLA.demandDays * DAY);
    for (const code of MODEL_CODES) {
      const st = input.stock[code] ?? { now: 0, inbound: 0, reserved: 0, subDealer: 0, colours: [] };
      const intent = recent.filter((p) => intentFor(p, code)).length;
      const asked = recent.filter((p) => askedAbout(p, code)).length;
      if (intent >= 3 && intent > st.now + st.inbound) {
        hits.push({ rule: "demand_over_stock", subject: code, conversationId: null, personKey: null, model: code, severity: st.now === 0 ? "high" : "normal", facts: { intent, inStock: st.now, inbound: st.inbound, reserved: st.reserved }, dueAt: null });
      }
      if (st.now >= 3 && asked === 0) {
        hits.push({ rule: "stock_without_demand", subject: code, conversationId: null, personKey: null, model: code, severity: "normal", facts: { inStock: st.now }, dueAt: null });
      }
    }
    const since60 = nowMs - 60 * DAY;
    const wanted = new Map<string, number>();
    for (const p of input.people) {
      if (Date.parse(p.lastAt) < since60) continue;
      for (const cw of new Set(p.coloursWanted)) {
        const [code, colour] = cw.split(":");
        if (!code || code === "ANY" || !colour || colour === "any" || colour === "which") continue;
        wanted.set(`${code}:${colour}`, (wanted.get(`${code}:${colour}`) ?? 0) + 1);
      }
    }
    for (const [key, n] of wanted) {
      const [code, colour] = key.split(":");
      const have = input.stock[code]?.colours.find((c) => c.key === colour)?.n ?? 0;
      if (n >= 2 && have === 0) hits.push({ rule: "colour_unavailable", subject: key, conversationId: null, personKey: null, model: code, severity: "normal", facts: { colour, people: n, inStockThatColour: 0 }, dueAt: null });
    }
  }

  // ── Data health ────────────────────────────────────────────────────────────────────────────────────
  const h = input.health;
  if (h.rereadPending === true) hits.push({ rule: "data_reread", subject: "whatsapp", conversationId: null, personKey: null, model: null, severity: "critical", facts: {}, dueAt: null });
  if (h.instagramAccounts > 0 && h.instagramSignals7d === 0) hits.push({ rule: "data_instagram_silent", subject: "instagram", conversationId: null, personKey: null, model: null, severity: "high", facts: { accounts: h.instagramAccounts }, dueAt: null });
  if (h.rereadPending === false && (!h.demandLastStored || nowMs - Date.parse(h.demandLastStored) > 2 * DAY)) {
    hits.push({ rule: "data_demand_not_stored", subject: "demand", conversationId: null, personKey: null, model: null, severity: "normal", facts: { lastStored: h.demandLastStored }, dueAt: null });
  }
  if (h.crmMatched !== null) {
    evaluated.push("data_crm_unlinked");
    if (h.withMobile >= 50 && h.crmMatched / h.withMobile < 0.05) hits.push({ rule: "data_crm_unlinked", subject: "crm", conversationId: null, personKey: null, model: null, severity: "high", facts: { withMobile: h.withMobile, matched: h.crmMatched }, dueAt: null });
  }
  return { hits, evaluated };
}

/** One plain sentence for an item's facts — numbers and labels only. */
export function describe(rule: RuleKey, facts: Readonly<Record<string, unknown>>, model: string | null): string {
  const car = model ? carName(model) : null;
  const n = (k: string) => Number(facts[k] ?? 0);
  switch (rule) {
    case "buyer_waiting": {
      const m = n("businessMinutesWaiting");
      return `Waiting ${m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`} in business hours${car ? ` · ${car}` : ""}${facts.owned ? "" : " · no salesperson"}.`;
    }
    case "test_drive_unbooked":
      return `Asked ${n("hoursOpen")} h ago${car ? ` · ${car}` : ""}; no booking in the calendar.`;
    case "alert_overdue":
      return `${String(facts.kind ?? "Alert").replace(/_/g, " ").toLowerCase()} alert open ${n("hoursOpen")} h${n("alerts") > 1 ? ` (${n("alerts")} alerts)` : ""}${car ? ` · ${car}` : ""}${facts.answered ? " · a person already wrote after it — close it if it is done" : ""}.`;
    case "unowned_qualified":
      return `${n("people")} qualified ${n("people") === 1 ? "person has" : "people have"} no salesperson.`;
    case "demand_over_stock":
      return `${n("intent")} buyers in ${SLA.demandDays} days · ${n("inStock")} in stock · ${n("inbound")} on the way · ${n("reserved")} reserved.`;
    case "colour_unavailable":
      return `${n("people")} people want it in ${String(facts.colour)}; none in stock in that colour.`;
    case "stock_without_demand":
      return `${n("inStock")} in stock; nobody asked about it in ${SLA.demandDays} days.`;
    case "data_instagram_silent":
      return `${n("accounts")} Instagram accounts connected; 0 messages recorded in 7 days.`;
    case "data_demand_not_stored":
      return facts.lastStored ? `Last stored ${String(facts.lastStored).slice(0, 10)}.` : "Never stored.";
    case "data_crm_unlinked":
      return `${n("matched")} of ${n("withMobile")} people with a mobile match a CRM customer.`;
    default:
      return "";
  }
}

/* ── The five morning numbers ───────────────────────────────────────────────────────────────────────── */

export interface MorningNumbers {
  /** Qualified people active in 14 days who are waiting for us or have no salesperson. */
  buyersNeedingAction: number;
  /** Customer items open now: buyers waiting past the SLA, test drives not booked, alerts past 24 h. */
  overdue: number;
  /** Per car: people interested (90 days) and how many the CRM shows as bought; null = cannot be known. */
  conversion: { code: string; label: string; people: number; won: number | null }[];
  conversionKnown: boolean;
  /** Per car: qualified buyers (30 days) beside cars in stock now. */
  demandVsStock: { code: string; label: string; intent: number; inStock: number | null }[];
  /** People active in 90 days by how far they got, with the median days since they last wrote. */
  pipeline: { stage: PersonFacts["stage"]; people: number; medianDaysQuiet: number | null }[];
}

export function morningNumbers(input: {
  nowMs: number;
  people: readonly PersonFacts[];
  hits: readonly DecisionHit[];
  stock: Readonly<Record<string, CarStock>> | null;
  outcomeOf: ((p: PersonFacts) => CrmOutcome | null) | null;
}): MorningNumbers {
  const { nowMs, people } = input;
  const active = people.filter((p) => Date.parse(p.lastAt) >= nowMs - SLA.activeDays * DAY);
  const waitingConvs = new Set(input.hits.filter((h) => h.rule === "buyer_waiting" || h.rule === "test_drive_unbooked" || h.rule === "alert_overdue").map((h) => h.personKey));
  const buyersNeedingAction = active.filter((p) => isQualified(p) && (!p.ownerId || waitingConvs.has(p.key) || p.waiting)).length;
  const overdue = input.hits.filter((h) => h.rule === "buyer_waiting" || h.rule === "test_drive_unbooked" || (h.rule === "alert_overdue" && !h.facts.answered)).length;

  const last90 = people.filter((p) => Date.parse(p.lastAt) >= nowMs - 90 * DAY);
  const last30 = people.filter((p) => Date.parse(p.lastAt) >= nowMs - SLA.demandDays * DAY);
  const anyLinked = input.outcomeOf ? last90.some((p) => input.outcomeOf!(p) !== null) : false;
  const conversion = MODEL_CODES.map((code) => {
    const its = last90.filter((p) => askedAbout(p, code));
    return { code, label: carName(code), people: its.length, won: input.outcomeOf && anyLinked ? its.filter((p) => input.outcomeOf!(p) === "won").length : null };
  }).filter((r) => r.people > 0);
  const demandVsStock = MODEL_CODES.map((code) => ({ code, label: carName(code), intent: last30.filter((p) => intentFor(p, code)).length, inStock: input.stock ? (input.stock[code]?.now ?? 0) : null })).filter(
    (r) => r.intent > 0 || (r.inStock ?? 0) > 0
  );
  const STAGES: PersonFacts["stage"][] = ["buying", "test_drive", "pricing", "interested", "asking", "wrote"];
  const pipeline = STAGES.map((stage) => {
    const days = last90.filter((p) => p.stage === stage).map((p) => (nowMs - Date.parse(p.lastAt)) / DAY).sort((a, b) => a - b);
    return { stage, people: days.length, medianDaysQuiet: days.length ? Math.round(days[Math.floor((days.length - 1) / 2)] * 10) / 10 : null };
  });
  return { buyersNeedingAction, overdue, conversion, conversionKnown: anyLinked, demandVsStock, pipeline };
}

/* ── Four levels of demand, beside stock and units sold ─────────────────────────────────────────────── */

export interface DemandLevels {
  code: string;
  label: string;
  /** Came from this car's ad. */
  exposure: number;
  /** Named the car in their own words. */
  named: number;
  /** Asked about it by context only (the ad's car, the car being discussed). */
  context: number;
  /** Named or asked about it AND asked to buy, a price, installments, availability, a test drive or a visit. */
  intent: number;
  /** Booked a test drive, or the CRM has an order for them for this car. */
  committed: number;
  stock: CarStock | null;
  sales: ModelSales | null;
  monthsOfStock: number | null;
}

export function demandLevels(input: {
  people: readonly PersonFacts[];
  stock: Readonly<Record<string, CarStock>> | null;
  sales: Readonly<Record<string, ModelSales>> | null;
  /** The CRM's cars ordered by this person (by mobile); null when unknown. */
  orderedModels: ((p: PersonFacts) => readonly string[]) | null;
}): DemandLevels[] {
  return MODEL_CODES.map((code) => {
    const its = input.people;
    const committed = its.filter((p) => askedAbout(p, code) && (p.testDrivesBooked > 0 || (input.orderedModels?.(p) ?? []).includes(code))).length;
    const stock = input.stock ? (input.stock[code] ?? { now: 0, inbound: 0, reserved: 0, subDealer: 0, colours: [] }) : null;
    const sales = input.sales ? (input.sales[code] ?? { last30: 0, last90: 0, last365: 0, total: 0, open: 0, byMonth: {}, undated: 0 }) : null;
    return {
      code,
      label: carName(code),
      exposure: its.filter((p) => p.adModel === code).length,
      named: its.filter((p) => p.models.includes(code)).length,
      context: its.filter((p) => !p.models.includes(code) && p.contextModels.includes(code)).length,
      intent: its.filter((p) => intentFor(p, code)).length,
      committed,
      stock,
      sales,
      monthsOfStock: stock && sales ? monthsOfStock(stock.now, sales.last90) : null,
    };
  });
}
