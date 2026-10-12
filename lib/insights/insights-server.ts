/**
 * Reading the insights — SERVER ONLY (the service client, as lib/leads/people-server.ts). The shaping
 * is pure in lib/insights/insights.ts. Reads MONZA AI's own tables, never the CRM, never a message's words.
 */

import { channelDb } from "@/lib/channels/store";
import { buildInsights, type InsightFilter, type InsightRows, type Insights, type SignalRow } from "@/lib/insights/insights";

const PAGE = 1000;

async function all<T>(read: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 50_000; from += PAGE) {
    const { data, error } = await read(from, from + PAGE - 1);
    if (error) throw error;
    const rows = Array.isArray(data) ? (data as T[]) : [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export type InsightsRead = { state: "ok"; insights: Insights; signalsTable: true } | { state: "no_table" } | { state: "unavailable" };

/** The insights, or why not: the table is missing (migration 020) or the database cannot be read here. */
export async function readInsights(filter: InsightFilter): Promise<InsightsRead> {
  const sb = channelDb();
  if (!sb) return { state: "unavailable" };
  try {
    const since = filter.days > 0 ? new Date(Date.parse(filter.now) - filter.days * 86_400_000).toISOString() : null;
    const probe = await sb.from("sales_signals").select("id").limit(1);
    if (probe.error) return (probe.error as { code?: string }).code === "42P01" ? { state: "no_table" } : { state: "unavailable" };
    const [signals, conversations, leads, leadConversations, alerts] = await Promise.all([
      all<SignalRow>((f, t) => {
        let q = sb.from("sales_signals").select("account_id, brand, channel, conversation_id, at, language, intents, models, weak_models, colour, has_media, alert_kind, alert_tags, offered, silenced").order("at", { ascending: false });
        if (since) q = q.gte("at", since);
        return q.range(f, t);
      }),
      all<InsightRows["conversations"][number]>((f, t) => sb.from("channel_conversations").select("id, account_id, brand, peer_external_id, peer_display, created_at").range(f, t)),
      all<InsightRows["leads"][number]>((f, t) => sb.from("leads").select("id, display_name, phone").range(f, t)),
      all<InsightRows["leadConversations"][number]>((f, t) => sb.from("lead_conversations").select("lead_id, conversation_id").range(f, t)),
      all<InsightRows["alerts"][number]>((f, t) => sb.from("sales_alerts").select("conversation_ref, kind, status, created_at").range(f, t)),
    ]);
    return { state: "ok", insights: buildInsights({ signals, conversations, leads, leadConversations, alerts }, filter), signalsTable: true };
  } catch (e) {
    console.error("[insights] reading failed:", e instanceof Error ? e.message : "unknown error");
    return { state: "unavailable" };
  }
}
