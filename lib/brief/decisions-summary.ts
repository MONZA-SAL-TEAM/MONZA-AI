/**
 * The Decision Center, counted, for the Monza S.A.L. app's morning brief
 * (owner, 24 Nov 2026). PURE: rows in, a summary out.
 *
 * Counts and labels only — no subject, no person key, no name, no car tied to
 * a person: the CRM's scheduled morning job has no signed-in viewer, and this
 * product never hands customer identity to a background caller (CLAUDE.md,
 * "Identity resolution is SPLIT"). Only items still waiting on a person count:
 * open and escalated. Acknowledged, resolved, dismissed and cleared do not.
 */
import { RULES, type RuleKey } from "@/lib/insights/decisions";

export const WAITING_STATES = ["open", "escalated"] as const;

export interface DecisionRow {
  rule: string;
  severity: string;
  state: string;
  first_seen: string;
  last_seen: string;
}

export interface DecisionSummaryItem {
  rule: string;
  label: string;
  group: string;
  severity: "critical" | "high" | "normal";
  count: number;
  /** When the oldest of them was first seen. */
  oldestFirstSeen: string;
}

export interface DecisionSummary {
  /** The newest last_seen: the items are as fresh as the Decision Center's last look. */
  asOf: string | null;
  items: DecisionSummaryItem[];
}

const RANK = { critical: 0, high: 1, normal: 2 } as const;

export function summariseDecisions(rows: readonly DecisionRow[]): DecisionSummary {
  const byRule = new Map<string, DecisionSummaryItem>();
  let asOf: string | null = null;
  for (const r of rows) {
    if (!(WAITING_STATES as readonly string[]).includes(r.state)) continue;
    const def = RULES[r.rule as RuleKey];
    if (!def) continue;
    if (!asOf || r.last_seen > asOf) asOf = r.last_seen;
    const sev = (["critical", "high", "normal"].includes(r.severity) ? r.severity : "normal") as DecisionSummaryItem["severity"];
    const cur = byRule.get(r.rule);
    if (!cur) {
      byRule.set(r.rule, { rule: r.rule, label: def.label, group: def.group, severity: sev, count: 1, oldestFirstSeen: r.first_seen });
    } else {
      cur.count += 1;
      if (RANK[sev] < RANK[cur.severity]) cur.severity = sev;
      if (r.first_seen < cur.oldestFirstSeen) cur.oldestFirstSeen = r.first_seen;
    }
  }
  const items = [...byRule.values()].sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.oldestFirstSeen.localeCompare(b.oldestFirstSeen));
  return { asOf, items };
}
