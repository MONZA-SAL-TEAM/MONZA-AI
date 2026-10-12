/**
 * What the analysis pages read — SERVER ONLY: the insight rows for a period, as people (each once).
 */

import { readInsightRows } from "@/lib/insights/insights-server";
import type { InsightRows } from "@/lib/insights/insights";
import { buildPersonFacts, type PersonFacts } from "@/lib/insights/people";

export type AnalysisRead =
  | { state: "ok"; people: PersonFacts[]; rows: InsightRows; personOf: (conv: string) => string; nowMs: number }
  | { state: "no_table" }
  | { state: "unavailable" };

export async function readAnalysis(days: number): Promise<AnalysisRead> {
  const nowMs = Date.now();
  const since = days > 0 ? new Date(nowMs - days * 86_400_000).toISOString() : null;
  const r = await readInsightRows(since);
  if (r.state !== "ok") return r;
  const leadByConv = new Map(r.rows.leadConversations.map((lc) => [lc.conversation_id, lc.lead_id]));
  const personOf = (conv: string) => {
    const lead = leadByConv.get(conv);
    return lead ? `lead:${lead}` : `chat:${conv}`;
  };
  return { state: "ok", people: buildPersonFacts(r.rows, r.extras), rows: r.rows, personOf, nowMs };
}
