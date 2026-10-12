/**
 * Market trends — PURE (Samer, 2026-10-12 master prompt: "which models are gaining or losing demand", "what
 * should Monza investigate before ordering inventory", and cost per lead from REAL ad spend). Months are
 * calendar months (UTC). People are counted once per month; growth compares equal windows; a zero baseline
 * reads "new", never an infinite percentage. Tested in tests/insights-trends.test.ts.
 */

import type { PersonFacts } from "@/lib/insights/people";
import type { ObservationRow, SignalRow } from "@/lib/insights/insights";
import type { CrmOutcome } from "@/lib/insights/crm";
import { carName } from "@/lib/insights/facts";
import { topicLabel } from "@/lib/wasales/signal";
import { MONZA_KNOWLEDGE } from "@/lib/wasales/knowledge";

const DAY = 86_400_000;

export interface Growth {
  key: string;
  label: string;
  now: number;
  before: number;
  /** null when the baseline is zero (shown as "new"). */
  change: number | null;
}

export interface SpendRow {
  month: string; // YYYY-MM-01
  brand: string;
  channel: string;
  amount: number;
}

export interface SpendLine extends SpendRow {
  /** New people in that month, brand and channel who came from an ad. */
  adLeads: number;
  qualified: number;
  /** null when the CRM could not be read. */
  won: number | null;
  costPerLead: number | null;
  costPerQualified: number | null;
  costPerSale: number | null;
}

export interface Trends {
  months: string[];
  newLeads: number[];
  activePeople: number[];
  demand: { code: string; name: string; series: number[] }[];
  colours: { key: string; series: number[] }[];
  channels: { key: string; series: number[] }[];
  growth30: Growth[];
  growth90: Growth[];
  topicsRising: Growth[];
  topicsFalling: Growth[];
  spend: SpendLine[];
}

const QUALIFYING = new Set(["PRICE", "FINANCING", "TEST_DRIVE", "AVAILABILITY", "BUYING_INTENT", "TRADE_IN", "VISIT", "DISCOUNT"]);
const qualified = (p: PersonFacts) => (p.models.length > 0 || p.contextModels.length > 0) && p.topics.some((t) => QUALIFYING.has(t));
const monthKey = (iso: string) => `${iso.slice(0, 7)}-01`;

function growth(nowMap: Map<string, Set<string>>, beforeMap: Map<string, Set<string>>, label: (k: string) => string): Growth[] {
  const keys = new Set([...nowMap.keys(), ...beforeMap.keys()]);
  return [...keys]
    .map((key) => {
      const now = nowMap.get(key)?.size ?? 0;
      const before = beforeMap.get(key)?.size ?? 0;
      return { key, label: label(key), now, before, change: before === 0 ? null : (now - before) / before };
    })
    .sort((a, b) => b.now - a.now || a.label.localeCompare(b.label));
}

export function marketTrends(input: {
  people: readonly PersonFacts[];
  signals: readonly SignalRow[];
  observations: readonly ObservationRow[];
  personOf: (conv: string) => string;
  firstEver: ReadonlyMap<string, string>;
  spend: readonly SpendRow[];
  outcomeOf: ((p: PersonFacts) => CrmOutcome | null) | null;
  nowMs: number;
  monthsBack?: number;
}): Trends {
  const n = input.monthsBack ?? 12;
  const now = new Date(input.nowMs);
  const months = Array.from({ length: n }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (n - 1 - i), 1)).toISOString().slice(0, 10));
  const idx = new Map(months.map((m, i) => [m, i]));
  const series = () => Array.from({ length: n }, () => new Set<string>());

  const newLeads = series();
  for (const p of input.people) {
    const i = idx.get(monthKey(input.firstEver.get(p.key) ?? p.firstAt));
    if (i !== undefined) newLeads[i].add(p.key);
  }
  const active = series();
  const demand = new Map<string, Set<string>[]>();
  const channels = new Map<string, Set<string>[]>();
  const window = (from: number, to: number) => ({ from, to });
  const w30 = window(input.nowMs - 30 * DAY, input.nowMs);
  const p30 = window(input.nowMs - 60 * DAY, input.nowMs - 30 * DAY);
  const w90 = window(input.nowMs - 90 * DAY, input.nowMs);
  const p90 = window(input.nowMs - 180 * DAY, input.nowMs - 90 * DAY);
  const inW = (t: number, w: { from: number; to: number }) => t >= w.from && t < w.to;
  const maps = { m30: new Map<string, Set<string>>(), b30: new Map<string, Set<string>>(), m90: new Map<string, Set<string>>(), b90: new Map<string, Set<string>>(), t30: new Map<string, Set<string>>(), tb30: new Map<string, Set<string>>() };
  const add = (m: Map<string, Set<string>>, k: string, who: string) => (m.get(k) ?? m.set(k, new Set()).get(k)!).add(who);

  for (const s of input.signals) {
    const who = input.personOf(s.conversation_id);
    const t = Date.parse(s.at);
    const i = idx.get(monthKey(s.at));
    const cars = [...new Set([...s.models, ...(s.context_models ?? [])])];
    if (i !== undefined) {
      active[i].add(who);
      for (const c of cars) (demand.get(c) ?? demand.set(c, series()).get(c)!)[i].add(who);
      (channels.get(s.channel) ?? channels.set(s.channel, series()).get(s.channel)!)[i].add(who);
    }
    for (const c of cars) {
      if (inW(t, w30)) add(maps.m30, c, who);
      if (inW(t, p30)) add(maps.b30, c, who);
      if (inW(t, w90)) add(maps.m90, c, who);
      if (inW(t, p90)) add(maps.b90, c, who);
    }
    for (const topic of s.intents) {
      if (topic === "UNKNOWN") continue;
      if (inW(t, w30)) add(maps.t30, topic, who);
      if (inW(t, p30)) add(maps.tb30, topic, who);
    }
  }
  const colours = new Map<string, Set<string>[]>();
  for (const o of input.observations) {
    if (o.kind !== "colour" || o.stance === "rejects" || o.stance === "alternative" || o.part === "interior" || o.value === "any" || o.value === "which") continue;
    const i = idx.get(monthKey(o.at));
    if (i !== undefined) (colours.get(o.value) ?? colours.set(o.value, series()).get(o.value)!)[i].add(input.personOf(o.conversation_id));
  }
  const topics = growth(maps.t30, maps.tb30, topicLabel).filter((g) => g.now + g.before >= 5);

  // Cost per lead: only from what a manager typed as spend; leads are new people from an ad that month.
  const spend: SpendLine[] = input.spend.map((s) => {
    const its = input.people.filter((p) => {
      const first = input.firstEver.get(p.key) ?? p.firstAt;
      return monthKey(first) === s.month && p.brands.includes(s.brand) && (s.channel === "all" || p.channels.includes(s.channel)) && p.firstTouch === "ad_click";
    });
    const won = input.outcomeOf ? its.filter((p) => input.outcomeOf!(p) === "won").length : null;
    const per = (k: number | null) => (k ? Math.round((s.amount / k) * 100) / 100 : null);
    return { ...s, adLeads: its.length, qualified: its.filter(qualified).length, won, costPerLead: per(its.length), costPerQualified: per(its.filter(qualified).length), costPerSale: won === null ? null : per(won) };
  });

  const toCounts = (m: Map<string, Set<string>[]>) => [...m.entries()].map(([key, s]) => ({ key, series: s.map((x) => x.size) }));
  return {
    months,
    newLeads: newLeads.map((s) => s.size),
    activePeople: active.map((s) => s.size),
    demand: MONZA_KNOWLEDGE.models.map((m) => ({ code: m.code, name: m.displayName, series: (demand.get(m.code) ?? series()).map((x) => x.size) })).filter((d) => d.series.some((v) => v > 0)),
    colours: toCounts(colours).sort((a, b) => b.series.reduce((x, y) => x + y, 0) - a.series.reduce((x, y) => x + y, 0)).slice(0, 8),
    channels: toCounts(channels),
    growth30: growth(maps.m30, maps.b30, carName),
    growth90: growth(maps.m90, maps.b90, carName),
    topicsRising: topics.filter((g) => g.now > g.before).sort((a, b) => b.now - b.before - (a.now - a.before)).slice(0, 10),
    topicsFalling: topics.filter((g) => g.now < g.before).sort((a, b) => a.now - a.before - (b.now - b.before)).slice(0, 10),
    spend: spend.sort((a, b) => b.month.localeCompare(a.month) || a.brand.localeCompare(b.brand)),
  };
}
