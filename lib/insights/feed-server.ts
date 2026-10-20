/**
 * The insights FEED — what MONZA AI has learnt from the chats, served to the Monza S.A.L. app's own Insight
 * page (Samer, 2026-10-20: "the insight page … keep studying … and give insight in the Monza app … the one
 * from MONZA AI feeds it"). SERVER ONLY.
 *
 * The same numbers as /insights, assembled the same way (the overview, the funnel, the four demand levels,
 * the colour matrix, the Decision Center's open items, the data health) — counts and labels only. No name,
 * number, chat id or word a customer wrote leaves here: the Monza app shows what the market wants, and links
 * to MONZA AI for the people behind it. The CRM's own figures (stock, units sold, orders) are read AS THE
 * CALLER, with the token they sent, so the CRM's row-level security still decides.
 *
 * Kept 2 minutes per person in this server's memory: the Monza app may ask on every page view.
 */

import type { StaffIdentity } from "@/lib/connectors/types";
import { channelDb } from "@/lib/channels/store";
import { readInsightRows } from "@/lib/insights/insights-server";
import { buildPersonFacts, type PersonFacts } from "@/lib/insights/people";
import { executiveOverview, KPI_DEFINITIONS, type Overview } from "@/lib/insights/overview";
import { leadsView, STAGES } from "@/lib/insights/leads";
import { alertedPeople, phoneOfPerson } from "@/lib/insights/analysis-server";
import { colourMatrix, type ColourRow } from "@/lib/insights/analysis";
import { readCrmOutcomes, readCrmSales, readCrmStock } from "@/lib/insights/crm-server";
import { salesByModel, stockByModel, type CarStock, type CrmOutcome, type ModelSales } from "@/lib/insights/crm";
import { demandLevels, describe, RULES, type DemandLevels, type RuleKey, type Severity } from "@/lib/insights/decisions";
import { carName } from "@/lib/insights/facts";
import { rereadPending } from "@/lib/wasales/signal-server";

const DAY = 86_400_000;
const CACHE_MS = 2 * 60_000;

export interface FeedDecision {
  rule: RuleKey;
  label: string;
  group: string;
  action: string;
  who: string;
  severity: Severity;
  model: string | null;
  car: string | null;
  /** One plain sentence of counts and labels. */
  summary: string;
  since: string;
  dueAt: string | null;
  state: string;
}

export interface InsightFeed {
  generatedAt: string;
  period: { days: number; since: string; until: string };
  /** Each figure with its definition, this period and the equal period before. */
  kpis: { key: string; label: string; definition: string; value: number | null; previous: number | null; foot?: string }[];
  weeks: { week: string; newPeople: number; messages: number; buying: number }[];
  /** Per car: the four levels of demand beside CRM stock and units sold. */
  cars: DemandLevels[];
  colours: ColourRow[];
  /** The funnel, each stage defined and sourced. */
  funnel: { key: string; label: string; definition: string; source: string; n: number | null; fromPrevious: number | null }[];
  byCar: { code: string; key: string; label: string; people: number; qualified: number; booked: number; won: number | null }[];
  byChannel: { key: string; label: string; people: number; qualified: number; booked: number; won: number | null }[];
  bySource: { key: string; label: string; people: number; qualified: number; booked: number; won: number | null }[];
  lostReasons: { key: string; n: number }[];
  lists: Pick<Overview, "brands" | "types" | "channels" | "questions" | "objections" | "languages" | "budgets" | "timelines" | "sources" | "outcomes">;
  coverage: Overview["coverage"] & { people: number };
  decisions: { open: number; byGroup: Record<string, number>; items: FeedDecision[] };
  health: { rereadPending: boolean | null; instagramMessages7d: number | null; demandStoredAt: string | null; crm: "ok" | "not_connected" | "unavailable" };
  /** Where the people behind each figure are: MONZA AI's own pages. */
  links: { overview: string; decisions: string; customers: string; models: string; colours: string };
}

const cache = new Map<string, { at: number; feed: InsightFeed }>();

export async function readInsightFeed(user: StaffIdentity, days: number, origin: string, nowMs = Date.now()): Promise<InsightFeed | null> {
  const key = `${user.userId}|${days}`;
  const hit = cache.get(key);
  if (hit && nowMs - hit.at < CACHE_MS) return hit.feed;
  const feed = await buildFeed(user, days, origin, nowMs);
  if (feed) {
    cache.set(key, { at: nowMs, feed });
    if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  }
  return feed;
}

async function buildFeed(user: StaffIdentity, days: number, origin: string, nowMs: number): Promise<InsightFeed | null> {
  const sb = channelDb();
  if (!sb) return null;
  const [read, crm, stockRead, salesRead, pending, igCount, demandLast, liveDecisions] = await Promise.all([
    readInsightRows(null),
    readCrmOutcomes(user),
    readCrmStock(user),
    readCrmSales(user),
    rereadPending(),
    sb.from("sales_signals").select("id", { count: "exact", head: true }).eq("channel", "instagram").gte("at", new Date(nowMs - 7 * DAY).toISOString()),
    sb.from("insight_demand_daily").select("computed_at").order("computed_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("insight_decisions").select("rule, severity, model, facts, first_seen, due_at, state").in("state", ["open", "acknowledged", "escalated"]).order("first_seen", { ascending: true }).limit(500),
  ]);
  if (read.state !== "ok") return null;
  const rows = read.rows;
  const all = buildPersonFacts(rows, read.extras);
  const firstEver = new Map(all.map((p) => [p.key, p.firstAt]));
  const phoneOf = phoneOfPerson(rows);
  const outcomeOf = crm.state === "ok" ? (p: PersonFacts): CrmOutcome | null => {
    const ph = phoneOf(p);
    return ph ? (crm.data[ph]?.outcome ?? null) : null;
  } : null;
  const orderedModels = crm.state === "ok" ? (p: PersonFacts): readonly string[] => {
    const ph = phoneOf(p);
    return ph ? (crm.data[ph]?.models ?? []) : [];
  } : null;
  const untilMs = nowMs;
  const sinceMs = days > 0 ? nowMs - days * DAY : 0;
  const span = sinceMs > 0 ? untilMs - sinceMs : untilMs - Math.min(...all.map((p) => Date.parse(p.firstAt)), untilMs);
  const window = { sinceMs: sinceMs || untilMs - span, untilMs };
  const prevWindow = { sinceMs: window.sinceMs - span, untilMs: window.sinceMs - 1 };
  const people = buildPersonFacts(rows, read.extras, window);
  const previous = sinceMs > 0 ? buildPersonFacts(rows, read.extras, prevWindow) : [];
  const leadByConv = new Map(rows.leadConversations.map((lc) => [lc.conversation_id, lc.lead_id]));
  const personOf = (conv: string) => (leadByConv.get(conv) ? `lead:${leadByConv.get(conv)}` : `chat:${conv}`);
  const keys = new Set(people.map((p) => p.key));
  const prevKeys = new Set(previous.map((p) => p.key));
  const inside = (at: string, w: { sinceMs: number; untilMs: number }) => {
    const t = Date.parse(at);
    return t >= w.sinceMs && t <= w.untilMs;
  };
  const signals = rows.signals.filter((s) => inside(s.at, window) && keys.has(personOf(s.conversation_id)));
  const previousSignals = rows.signals.filter((s) => inside(s.at, prevWindow) && prevKeys.has(personOf(s.conversation_id)));
  const overdueKeys = new Set(rows.alerts.filter((a) => a.status === "open" && nowMs - Date.parse(a.created_at) > 2 * 3_600_000).map((a) => personOf(a.conversation_ref)));
  const stock: Record<string, CarStock> | null = stockRead.state === "ok" ? Object.fromEntries(stockByModel(stockRead.data)) : null;
  const sales: Record<string, ModelSales> | null = salesRead.state === "ok" ? Object.fromEntries(salesByModel(salesRead.data, nowMs)) : null;

  const o = executiveOverview({ people, previous, signals, previousSignals, firstEver, overdueKeys, outcomeOf, stock, window, nowMs });
  if (!sinceMs) for (const k of o.kpis) k.previous = null;
  const funnel = leadsView({ people, alerted: alertedPeople(rows, personOf), phoneOf, crm: crm.state === "ok" ? { state: "ok", byPhone: crm.data } : crm, sinceMs: window.sinceMs, nowMs });
  const breakdown = (b: { key: string; label: string; people: number; qualified: number; booked: number; won: number | null }) => ({ key: b.key, label: b.label, people: b.people, qualified: b.qualified, booked: b.booked, won: b.won });

  const decisionRows = ((liveDecisions.data ?? []) as { rule: string; severity: Severity; model: string | null; facts: Record<string, unknown> | null; first_seen: string; due_at: string | null; state: string }[]).filter((d) => d.rule in RULES);
  const byGroup: Record<string, number> = {};
  for (const d of decisionRows) byGroup[RULES[d.rule as RuleKey].group] = (byGroup[RULES[d.rule as RuleKey].group] ?? 0) + 1;
  const RANK: Record<Severity, number> = { critical: 0, high: 1, normal: 2 };
  const items: FeedDecision[] = decisionRows
    .map((d) => {
      const rule = RULES[d.rule as RuleKey];
      return {
        rule: rule.key,
        label: rule.label,
        group: rule.group,
        action: rule.action,
        who: rule.who,
        severity: d.severity,
        model: d.model,
        car: d.model ? carName(d.model) : null,
        summary: describe(rule.key, d.facts ?? {}, d.model),
        since: d.first_seen,
        dueAt: d.due_at,
        state: d.state,
      };
    })
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.since.localeCompare(b.since))
    .slice(0, 50);

  return {
    generatedAt: new Date(nowMs).toISOString(),
    period: { days, since: new Date(window.sinceMs).toISOString(), until: new Date(untilMs).toISOString() },
    kpis: o.kpis.map((k) => ({ key: k.key, label: k.label, definition: KPI_DEFINITIONS[k.key] ?? "", value: k.value, previous: k.previous, ...(k.foot ? { foot: k.foot } : {}) })),
    weeks: o.weeks.map((week, i) => ({ week, newPeople: o.newPerWeek[i] ?? 0, messages: o.messagesPerWeek[i] ?? 0, buying: o.buyingPerWeek[i] ?? 0 })),
    cars: demandLevels({ people, stock, sales, orderedModels }),
    colours: colourMatrix(rows.observations ?? [], people, personOf, false, stock),
    funnel: funnel.stages.map((s) => ({ key: s.def.key, label: s.def.label, definition: s.def.definition, source: s.def.source, n: s.n, fromPrevious: s.fromPrevious })),
    byCar: funnel.byModel.map((b) => ({ code: b.key, ...breakdown({ ...b, label: carName(b.key) }) })),
    byChannel: funnel.byChannel.map(breakdown),
    bySource: funnel.bySource.map(breakdown),
    lostReasons: funnel.lostReasons,
    lists: { brands: o.brands, types: o.types, channels: o.channels, questions: o.questions, objections: o.objections, languages: o.languages, budgets: o.budgets, timelines: o.timelines, sources: o.sources, outcomes: o.outcomes },
    coverage: { ...o.coverage, people: people.length },
    decisions: { open: decisionRows.length, byGroup, items },
    health: {
      rereadPending: pending,
      instagramMessages7d: igCount.error ? null : (igCount.count ?? 0),
      demandStoredAt: (demandLast.data as { computed_at?: string } | null)?.computed_at ?? null,
      crm: stockRead.state,
    },
    links: {
      overview: `${origin}/insights`,
      decisions: `${origin}/insights/decisions`,
      customers: `${origin}/insights/customers`,
      models: `${origin}/insights/models`,
      colours: `${origin}/insights/colours`,
    },
  };
}
