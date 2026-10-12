/**
 * ONE client, everything known — PURE (the read is lib/insights/profile-server.ts). Samer, 2026-10-12:
 * "I want to know all data of clients and leads … and connected to the client is the car."
 *
 * Built from labels only (sales_signals, sales_observations), the lead's own record, the first ad or post
 * that brought them, the alerts Sales got, and — read live as the viewer, never stored — the car the
 * CRM sold them. No message text exists in any of it; every entry links to the chat instead.
 */

import { encodeThreadId } from "@/lib/channels/live-map";
import { carName, factLabel, valueLabel } from "@/lib/insights/facts";
import type { CrmPurchase, CrmResult } from "@/lib/insights/crm";
import type { ObservationRow, SignalRow } from "@/lib/insights/insights";
import { STAGE_LABEL, furthestStage, stageOf, topicLabel, type Stage } from "@/lib/wasales/signal";

export interface ProfileRows {
  conversations: { id: string; account_id: string; brand: string; peer_external_id: string; peer_display: string | null; created_at: string | null; meta_conversation_id?: string | null }[];
  /** account id → channel ("whatsapp" | "instagram" | "facebook"). */
  accountChannel: Record<string, string>;
  lead: { id: string; display_name: string | null; phone: string | null } | null;
  signals: SignalRow[];
  observations: ObservationRow[];
  alerts: { conversation_ref: string; kind: string; status: string; created_at: string; closed_at?: string | null }[];
  touchpoints: { source_kind: string; source_ref: string | null; headline: string | null; occurred_at: string }[];
  lostHistory?: { reason: string; by_name: string | null; at: string }[];
  identityHistory?: { action: string; by_name: string | null; at: string }[];
}

export interface JourneyEntry {
  at: string;
  kind: "message" | "alert" | "crm";
  channel: string | null;
  title: string;
  details: string[];
  /** The chat to open, when the inbox can open it by thread id. */
  threadId: string | null;
}

export interface ClientProfile {
  key: string;
  name: string;
  phone: string | null;
  type: "customer" | "returning" | "new";
  typeLabel: string;
  threads: { conversationId: string; channel: string; brand: string; threadId: string | null; firstAt: string | null; lastAt: string | null }[];
  /** Why a person recorded the lead as lost, newest first (026); "cleared" withdraws. */
  lostHistory: { reason: string; by: string | null; at: string }[];
  identityHistory: { action: string; by: string | null; at: string }[];
  firstAt: string | null;
  lastAt: string | null;
  messages: number;
  activeDays: number;
  language: string | null;
  firstTouch: { label: string; at: string } | null;
  stage: Stage;
  stageLabel: string;
  models: { primary: string | null; secondary: string[]; compared: string[]; rejected: string[] };
  colours: { wants: string[]; asked: string[]; alternatives: string[]; askedWhich: boolean; interior: string[]; rejects: string[]; anyColour: boolean };
  /** One line per kind, latest first: "Budget $35,000–45,000". */
  facts: { kind: string; label: string; items: string[] }[];
  waiting: string | null;
  journey: JourneyEntry[];
  crm: CrmResult<CrmPurchase[]>;
}

const CHANNEL_LABEL: Readonly<Record<string, string>> = { whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Messenger" };
const LANGUAGE_LABEL: Readonly<Record<string, string>> = { en: "English", ar: "Arabic", arabizi: "Arabizi", fr: "French", mixed: "Mixed", unknown: "Unknown" };
const SOURCE_LABEL: Readonly<Record<string, string>> = { ad: "An ad", post: "A post", story: "A story", direct: "Not tracked", referral: "A link" };
const FACT_KINDS: ReadonlyArray<[string, string]> = [
  ["budget", "Budget"],
  ["timeline", "Buying when"],
  ["purpose", "For"],
  ["city", "Where"],
  ["financing", "Paying"],
  ["trade_in", "Trade-in"],
  ["competitor", "Other brands"],
  ["need", "Looking for"],
  ["concern", "Concerns"],
];
const DAY = 86_400_000;

/** "lead:<uuid>" or "chat:<uuid>": the person keys /insights uses. Anything else is refused. */
export function parsePersonKey(key: string): { kind: "lead" | "chat"; id: string } | null {
  const m = /^(lead|chat):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(key);
  return m ? { kind: m[1] as "lead" | "chat", id: m[2] } : null;
}

export function buildClientProfile(key: string, rows: ProfileRows, crm: CrmResult<CrmPurchase[]>): ClientProfile {
  const signals = [...rows.signals].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const facts = [...rows.observations].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const channelOf = (accountId: string) => rows.accountChannel[accountId] ?? "whatsapp";
  const first = signals[0] ?? null;
  const last = signals[signals.length - 1] ?? null;

  const waConv = rows.conversations.find((c) => channelOf(c.account_id) === "whatsapp");
  const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "") || null;
  const phone = digits(rows.lead?.phone) ?? (waConv ? digits(waConv.peer_external_id) : null);
  const display = rows.lead?.display_name?.trim() || rows.conversations.map((c) => c.peer_display?.trim()).find(Boolean) || null;
  const crmName = crm.state === "ok" ? crm.data.map((p) => p.customerName).find(Boolean) : undefined;
  const name = display || crmName || (phone ? `+${phone}` : "Customer");

  const metaIdOf = new Map(rows.conversations.map((c) => [c.id, c.meta_conversation_id ?? null]));
  const threadOf = (convId: string, accountId: string) => {
    if (channelOf(accountId) === "whatsapp") return encodeThreadId(accountId, convId);
    const metaId = metaIdOf.get(convId);
    return metaId ? encodeThreadId(accountId, metaId) : null;
  };
  const threads = rows.conversations.map((c) => {
    const own = signals.filter((s) => s.conversation_id === c.id);
    return { conversationId: c.id, channel: channelOf(c.account_id), brand: c.brand, threadId: threadOf(c.id, c.account_id), firstAt: own[0]?.at ?? c.created_at, lastAt: own[own.length - 1]?.at ?? null };
  });

  // Who they are to Monza: a buyer (the CRM says so), back after a long silence, or new.
  const bought = crm.state === "ok" && crm.data.length > 0;
  let returning = false;
  for (let i = 1; i < signals.length; i++) if (Date.parse(signals[i].at) - Date.parse(signals[i - 1].at) >= 30 * DAY) returning = true;
  const type: ClientProfile["type"] = bought ? "customer" : returning ? "returning" : "new";
  const typeLabel = type === "customer" ? "Customer (bought from Monza)" : type === "returning" ? "Came back after a month or more" : "New lead";

  // Cars: the one they name most is the main one; refused and compared ones are kept apart.
  const modelCount = new Map<string, number>();
  for (const s of signals) for (const m of new Set(s.models)) modelCount.set(m, (modelCount.get(m) ?? 0) + 1);
  const rejected = [...new Set(facts.filter((o) => o.kind === "model" && o.stance === "rejects").map((o) => o.model ?? ""))].filter(Boolean);
  const ranked = [...modelCount.entries()].filter(([m]) => !rejected.includes(m)).sort((a, b) => b[1] - a[1]).map(([m]) => m);
  const compared = [...new Set(facts.filter((o) => o.kind === "model" && o.stance === "compared").map((o) => o.model ?? ""))].filter(Boolean);

  const colourFacts = facts.filter((o) => o.kind === "colour");
  const colourText = (o: ObservationRow) => `${o.detail ?? valueLabel("colour", o.value)}${o.model ? ` (${carName(o.model)})` : ""}`;
  const uniq = (xs: string[]) => [...new Set(xs)];
  const colours = {
    wants: uniq(colourFacts.filter((o) => o.stance === "wants" && o.part !== "interior" && o.value !== "any").map(colourText)),
    asked: uniq(colourFacts.filter((o) => o.stance === "asked" && o.part !== "interior" && o.value !== "which").map(colourText)),
    alternatives: uniq(colourFacts.filter((o) => o.stance === "alternative").map(colourText)),
    askedWhich: colourFacts.some((o) => o.value === "which"),
    interior: uniq(colourFacts.filter((o) => o.part === "interior" && o.stance !== "rejects").map(colourText)),
    rejects: uniq(colourFacts.filter((o) => o.stance === "rejects").map((o) => `${o.part === "interior" ? "interior " : ""}${colourText(o)}`)),
    anyColour: colourFacts.some((o) => o.value === "any"),
  };

  const factLines = FACT_KINDS.map(([kind, label]) => ({ kind, label, items: uniq(facts.filter((o) => o.kind === kind).map((o) => factLabel(o))) })).filter((l) => l.items.length > 0);

  const languages = new Map<string, number>();
  for (const s of signals) languages.set(s.language, (languages.get(s.language) ?? 0) + 1);
  const lang = [...languages.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const touch = [...rows.touchpoints].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at))[0] ?? null;
  const firstTouch = touch ? { label: `${SOURCE_LABEL[touch.source_kind] ?? touch.source_kind}${touch.headline ? `: ${touch.headline}` : ""}`, at: touch.occurred_at } : null;

  const convIds = new Set(rows.conversations.map((c) => c.id));
  const alerts = rows.alerts.filter((a) => convIds.has(a.conversation_ref));
  const waiting = alerts.find((a) => a.status === "open")?.kind ?? null;

  // The journey: each message as its labels, each alert, each CRM order — newest first, never the words.
  const journey: JourneyEntry[] = [];
  for (const s of signals) {
    const own = facts.filter((o) => o.conversation_id === s.conversation_id && o.at === s.at && o.kind !== "model");
    const topics = s.intents.filter((i) => i !== "UNKNOWN").map(topicLabel);
    const cars = s.models.map((m) => carName(m));
    journey.push({
      at: s.at,
      kind: "message",
      channel: s.channel,
      title: topics.length > 0 ? topics.join(", ") : s.has_media ? "Sent a file" : "Wrote",
      details: [...(cars.length ? [`Car: ${cars.join(", ")}`] : []), ...own.map((o) => factLabel(o))],
      threadId: threadOf(s.conversation_id, s.account_id),
    });
  }
  for (const a of alerts) {
    const conv = rows.conversations.find((c) => c.id === a.conversation_ref);
    journey.push({ at: a.created_at, kind: "alert", channel: conv ? channelOf(conv.account_id) : null, title: `Alert for Sales: ${a.kind.replace(/_/g, " ").toLowerCase()}`, details: [a.status === "open" ? "Still open" : "Closed"], threadId: conv ? threadOf(conv.id, conv.account_id) : null });
  }
  if (crm.state === "ok") {
    for (const p of crm.data) {
      if (p.at) journey.push({ at: p.at, kind: "crm", channel: null, title: `CRM order: ${p.carLabel || "a car"}`, details: [p.orderStatus ? `Order ${p.orderStatus.replace(/_/g, " ")}` : "", p.exterior ? `Exterior ${p.exterior}` : "", p.interior ? `Interior ${p.interior}` : ""].filter(Boolean), threadId: null });
      if (p.deliveredAt) journey.push({ at: p.deliveredAt, kind: "crm", channel: null, title: `Delivered: ${p.carLabel || "a car"}`, details: [], threadId: null });
    }
  }
  journey.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const stage = furthestStage(signals.map((s) => stageOf(s.intents, [...s.models, ...(s.context_models ?? [])])));
  const activeDays = new Set(signals.map((s) => s.at.slice(0, 10))).size;

  return {
    key,
    name,
    phone,
    type,
    typeLabel,
    threads: threads.map((t) => ({ ...t, channel: t.channel })),
    firstAt: first?.at ?? null,
    lastAt: last?.at ?? null,
    messages: signals.length,
    activeDays,
    language: lang ? (LANGUAGE_LABEL[lang] ?? lang) : null,
    firstTouch,
    stage,
    stageLabel: STAGE_LABEL[stage],
    models: { primary: ranked[0] ? carName(ranked[0]) : null, secondary: ranked.slice(1).map(carName), compared: compared.map(carName), rejected: rejected.map(carName) },
    colours,
    facts: factLines,
    waiting,
    journey,
    crm,
    lostHistory: (rows.lostHistory ?? []).map((r) => ({ reason: r.reason, by: r.by_name, at: r.at })).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
    identityHistory: (rows.identityHistory ?? []).map((r) => ({ action: r.action, by: r.by_name, at: r.at })).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
  };
}

export const channelLabel = (c: string | null) => (c ? (CHANNEL_LABEL[c] ?? c) : "");
