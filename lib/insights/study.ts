/**
 * A Research Lab study — PURE (Samer, 2026-10-12 master prompt, part 14). Who answers the question, what
 * share of everyone that is, and what they have in common: cars, colours, stages, channels, the CRM's
 * outcomes, when they first wrote, and how much is known about them. Optionally grouped by one dimension.
 * Tested in tests/insights-study.test.ts.
 */

import type { PersonFacts } from "@/lib/insights/people";
import { matchesQuery, type InsightQuery } from "@/lib/insights/query";
import { carName, valueLabel } from "@/lib/insights/facts";
import { STAGE_LABEL } from "@/lib/wasales/signal";
import { OUTCOME_LABEL } from "@/lib/insights/crm";

export interface Share {
  key: string;
  label: string;
  n: number;
}

export interface Study {
  matched: PersonFacts[];
  total: number;
  base: number;
  share: number;
  models: Share[];
  colours: Share[];
  stages: Share[];
  channels: Share[];
  outcomes: Share[] | null;
  /** People by the week they FIRST wrote, oldest first (12 weeks). */
  firstWrote: number[];
  coverage: { budget: number; colour: number; timeline: number; city: number; owner: number };
  groups: Share[] | null;
}

export const GROUP_BY: ReadonlyArray<[string, string]> = [
  ["model", "Car named"],
  ["primary", "Main car"],
  ["ad", "Ad that brought them"],
  ["colour", "Colour wanted"],
  ["stage", "How far"],
  ["channel", "Channel"],
  ["brand", "Brand"],
  ["budget", "Budget"],
  ["timeline", "Buying when"],
  ["city", "Where"],
  ["source", "What brought them"],
  ["language", "Language"],
  ["customerType", "Customer type"],
  ["outcome", "CRM outcome"],
];

const LANGUAGE: Readonly<Record<string, string>> = { en: "English", ar: "Arabic", arabizi: "Arabizi", fr: "French", mixed: "Mixed", unknown: "Unknown" };
const CHANNEL: Readonly<Record<string, string>> = { whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Messenger" };
const SOURCE: Readonly<Record<string, string>> = { ad_click: "An ad", social_post: "A post", direct: "Not tracked" };
const BRAND: Readonly<Record<string, string>> = { voyah: "VOYAH", mhero: "MHERO", monza: "Monza S.A.L." };

function tally(people: readonly PersonFacts[], values: (p: PersonFacts) => readonly string[], label: (k: string) => string): Share[] {
  const m = new Map<string, number>();
  for (const p of people) for (const v of new Set(values(p))) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].map(([key, n]) => ({ key, label: label(key), n })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}

function groupValues(by: string, outcomeOf: ((p: PersonFacts) => string | null) | null): ((p: PersonFacts) => string[]) | null {
  switch (by) {
    case "model": return (p) => (p.models.length ? p.models : ["—"]);
    case "primary": return (p) => [p.primaryModel ?? "—"];
    case "ad": return (p) => [p.adModel ?? "—"];
    case "colour": return (p) => (p.coloursWanted.length ? p.coloursWanted.map((c) => c.split(":")[1]) : ["—"]);
    case "stage": return (p) => [p.stage];
    case "channel": return (p) => p.channels;
    case "brand": return (p) => p.brands;
    case "budget": return (p) => [p.budgetBand ?? "—"];
    case "timeline": return (p) => [p.timeline ?? "—"];
    case "city": return (p) => [p.city ?? "—"];
    case "source": return (p) => [p.firstTouch ?? "direct"];
    case "language": return (p) => [p.language ?? "unknown"];
    case "customerType": return (p) => [p.customerType];
    case "outcome": return outcomeOf ? (p) => [outcomeOf(p) ?? "unknown"] : null;
    default: return null;
  }
}

function groupLabel(by: string, k: string): string {
  if (k === "—") return "Not known";
  switch (by) {
    case "model": case "primary": case "ad": return carName(k);
    case "colour": return k.charAt(0).toUpperCase() + k.slice(1);
    case "stage": return STAGE_LABEL[k as keyof typeof STAGE_LABEL] ?? k;
    case "channel": return CHANNEL[k] ?? k;
    case "brand": return BRAND[k] ?? k;
    case "budget": return valueLabel("budget", k);
    case "timeline": return valueLabel("timeline", k);
    case "city": return valueLabel("city", k);
    case "source": return SOURCE[k] ?? k;
    case "language": return LANGUAGE[k] ?? k;
    case "customerType": return k === "new" ? "New" : k === "returning" ? "Returning" : k === "business" ? "Business / fleet" : k;
    case "outcome": return OUTCOME_LABEL[k as keyof typeof OUTCOME_LABEL] ?? k;
    default: return k;
  }
}

export function runStudy(base: readonly PersonFacts[], q: InsightQuery, nowMs: number, outcomeOf: ((p: PersonFacts) => string | null) | null, groupBy: string | null): Study {
  const matched = base.filter((p) => matchesQuery(p, q, nowMs, outcomeOf ?? undefined));
  const n = matched.length;
  const weeks = 12;
  const firstWrote = Array.from({ length: weeks }, () => 0);
  for (const p of matched) {
    const w = weeks - 1 - Math.floor((nowMs - Date.parse(p.firstAt)) / (7 * 86_400_000));
    if (w >= 0 && w < weeks) firstWrote[w]++;
  }
  const by = groupBy ? groupValues(groupBy, outcomeOf) : null;
  return {
    matched,
    total: n,
    base: base.length,
    share: base.length ? n / base.length : 0,
    models: tally(matched, (p) => [...new Set([...p.models, ...p.contextModels])], carName),
    colours: tally(matched, (p) => p.coloursWanted.map((c) => c.split(":")[1]), (k) => k.charAt(0).toUpperCase() + k.slice(1)),
    stages: tally(matched, (p) => [p.stage], (k) => STAGE_LABEL[k as keyof typeof STAGE_LABEL] ?? k),
    channels: tally(matched, (p) => p.channels, (k) => CHANNEL[k] ?? k),
    outcomes: outcomeOf ? tally(matched, (p) => [outcomeOf(p) ?? "unknown"], (k) => OUTCOME_LABEL[k as keyof typeof OUTCOME_LABEL] ?? k) : null,
    firstWrote,
    coverage: {
      budget: matched.filter((p) => p.budgetBand).length,
      colour: matched.filter((p) => p.coloursWanted.length).length,
      timeline: matched.filter((p) => p.timeline).length,
      city: matched.filter((p) => p.city).length,
      owner: matched.filter((p) => p.ownerId).length,
    },
    groups: by && groupBy ? tally(matched, by, (k) => groupLabel(groupBy, k)) : null,
  };
}
