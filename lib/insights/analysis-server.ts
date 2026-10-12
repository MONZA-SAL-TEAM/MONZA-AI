/**
 * What the analysis pages read — SERVER ONLY: the insight rows for a period, as people (each once).
 */

import { readInsightRows } from "@/lib/insights/insights-server";
import type { InsightRows } from "@/lib/insights/insights";
import { buildPersonFacts, type PersonFacts } from "@/lib/insights/people";
import { isAutoLinkable, normalizeLebanesePhone } from "@/lib/leads/phone";

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

/** Each person's normalized Lebanese MOBILE (961…), from their lead or their WhatsApp chat — never a landline. */
export function phoneOfPerson(rows: InsightRows): (p: PersonFacts) => string | null {
  const leadPhone = new Map(rows.leads.map((l) => [l.id, l.phone]));
  // Only a WhatsApp chat's peer id is a phone number (an Instagram or Messenger id never is).
  const whatsapp = new Set(rows.signals.filter((s) => s.channel === "whatsapp").map((s) => s.conversation_id));
  const waPeer = new Map(rows.conversations.filter((c) => whatsapp.has(c.id)).map((c) => [c.id, c.peer_external_id]));
  return (p) => {
    const candidates = [p.leadId ? leadPhone.get(p.leadId) : null, ...p.conversationIds.map((c) => waPeer.get(c))];
    for (const c of candidates) if (c && isAutoLinkable(c)) return normalizeLebanesePhone(c);
    return null;
  };
}

/** People who got at least one sales alert (any status). */
export function alertedPeople(rows: InsightRows, personOf: (conv: string) => string): Set<string> {
  return new Set(rows.alerts.map((a) => personOf(a.conversation_ref)));
}
