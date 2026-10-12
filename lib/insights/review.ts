/**
 * The review queue — PURE (Samer, 2026-10-12 master prompt, part 15). Which facts deserve a person's eye,
 * and how a person's decision changes them. Decisions live in insight_overrides (024), keyed by the
 * MESSAGE (account + platform id) and the fact (kind, value, car), so they survive every re-read; the
 * newest decision wins and the table is its own audit trail. Tested in tests/insights-review.test.ts.
 */

import type { ObservationRow } from "@/lib/insights/insights";

export type ReviewReason = "unresolved_car" | "colour_no_car" | "colour_by_context" | "misspelling" | "kind_only";

export const REVIEW_LABEL: Readonly<Record<ReviewReason, string>> = {
  unresolved_car: "A car name that could be an ordinary word",
  colour_no_car: "A colour tied to no car",
  colour_by_context: "A colour tied to a car by context, not by the customer",
  misspelling: "A car named with a misspelling",
  kind_only: "A kind of car with no model",
};

export function reviewReason(o: ObservationRow): ReviewReason | null {
  if (o.kind === "unresolved") return "unresolved_car";
  if (o.kind === "colour" && o.value !== "which" && o.value !== "any") {
    if (!o.model || o.binding === "none") return "colour_no_car";
    if (o.binding === "conversation" || o.binding === "ad") return "colour_by_context";
  }
  if (o.kind === "mention" && o.value === "fuzzy") return "misspelling";
  if (o.kind === "category" && o.rule === "category.only") return "kind_only";
  return null;
}

export interface Override {
  account_id: string;
  external_message_id: string;
  kind: string;
  value: string;
  model: string | null;
  action: "confirm" | "correct" | "mark_unknown";
  new_value: string | null;
  new_model: string | null;
  by_name: string | null;
  at: string;
}

export const overrideKey = (o: { account_id?: string | null; external_message_id?: string | null; kind: string; value: string; model: string | null }) =>
  `${o.account_id ?? ""}|${o.external_message_id ?? ""}|${o.kind}|${o.value}|${o.model ?? ""}`;

/** The newest decision per fact. */
export function latestOverrides(rows: readonly Override[]): Map<string, Override> {
  const out = new Map<string, Override>();
  for (const r of [...rows].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) out.set(overrideKey(r), r);
  return out;
}

/**
 * The facts with every person's decision applied: "mark unknown" removes a fact, "correct" changes its
 * value and/or car (an unresolved car word confirmed as a car becomes a model fact), "confirm" keeps it
 * and marks it reviewed (rule ends in ".confirmed").
 */
export function applyOverrides(rows: readonly ObservationRow[], decisions: ReadonlyMap<string, Override>): ObservationRow[] {
  if (decisions.size === 0) return [...rows];
  const out: ObservationRow[] = [];
  for (const o of rows) {
    const d = decisions.get(overrideKey(o));
    if (!d) {
      out.push(o);
      continue;
    }
    if (d.action === "mark_unknown") continue;
    if (d.action === "confirm") {
      out.push(o.kind === "unresolved" ? { ...o, kind: "model", stance: "named", value: (o.model ?? o.value).toLowerCase(), rule: "review.confirmed" } : { ...o, rule: `${o.rule ?? "fact"}.confirmed`.slice(0, 60) });
      continue;
    }
    const model = d.new_model ?? o.model;
    const kind = o.kind === "unresolved" ? "model" : o.kind;
    out.push({ ...o, kind, stance: o.kind === "unresolved" ? "named" : o.stance, value: kind === "model" ? (model ?? o.value).toLowerCase() : (d.new_value ?? o.value), model, binding: o.kind === "colour" && model ? "same_clause" : o.binding, rule: "review.corrected" });
  }
  return out;
}
