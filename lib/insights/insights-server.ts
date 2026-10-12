/**
 * Reading the insights — SERVER ONLY (the service client, as lib/leads/people-server.ts). The shaping
 * is pure in lib/insights/insights.ts (overview), people.ts (per person) and analysis.ts (the analysis
 * pages). Reads MONZA AI's own tables, never the CRM, never a message's words.
 */

import { channelDb } from "@/lib/channels/store";
import { buildInsights, type InsightFilter, type InsightRows, type Insights, type ObservationRow, type SignalRow } from "@/lib/insights/insights";
import type { PeopleExtras } from "@/lib/insights/people";
import { applyOverrides, latestOverrides, type Override } from "@/lib/insights/review";

const PAGE = 1000;
export const OBSERVATION_COLUMNS = "conversation_id, at, kind, stance, model, binding, part, value, detail, amount_min, amount_max, currency, amount_kind, months, external_message_id, rule, account_id";
const SIGNAL_COLUMNS = "account_id, brand, channel, conversation_id, at, language, intents, models, weak_models, colour, has_media, alert_kind, alert_tags, offered, silenced, ad_model, context_models";

async function all<T>(read: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>, max = 200_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await read(from, from + PAGE - 1);
    if (error) throw error;
    const rows = Array.isArray(data) ? (data as T[]) : [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export type RowsRead = { state: "ok"; rows: InsightRows; extras: PeopleExtras } | { state: "no_table" } | { state: "unavailable" };

/** Every row the insights are built from, since a date (or all time). Pilot chats were never recorded. */
export async function readInsightRows(sinceIso: string | null): Promise<RowsRead> {
  const sb = channelDb();
  if (!sb) return { state: "unavailable" };
  try {
    const probe = await sb.from("sales_signals").select("id").limit(1);
    if (probe.error) return (probe.error as { code?: string }).code === "42P01" ? { state: "no_table" } : { state: "unavailable" };
    const [signals, observations, conversations, leads, leadConversations, alerts, touchpoints, bookings, sentFiles, sentMeta, lost] = await Promise.all([
      all<SignalRow>((f, t) => {
        let q = sb.from("sales_signals").select(SIGNAL_COLUMNS).order("at", { ascending: false });
        if (sinceIso) q = q.gte("at", sinceIso);
        return q.range(f, t);
      }),
      all<ObservationRow>((f, t) => {
        let q = sb.from("sales_observations").select(OBSERVATION_COLUMNS).order("at", { ascending: false });
        if (sinceIso) q = q.gte("at", sinceIso);
        return q.range(f, t);
      }).catch(() => [] as ObservationRow[]),
      all<InsightRows["conversations"][number] & { assigned_to?: string | null }>((f, t) =>
        sb.from("channel_conversations").select("id, account_id, brand, peer_external_id, peer_display, created_at, meta_conversation_id, assigned_to").range(f, t)
      ),
      all<InsightRows["leads"][number]>((f, t) => sb.from("leads").select("id, display_name, phone").range(f, t)),
      all<InsightRows["leadConversations"][number]>((f, t) => sb.from("lead_conversations").select("lead_id, conversation_id").range(f, t)),
      all<InsightRows["alerts"][number]>((f, t) => sb.from("sales_alerts").select("conversation_ref, kind, status, created_at").range(f, t)),
      all<{ lead_id: string; source_kind: string; occurred_at: string }>((f, t) => sb.from("lead_touchpoints").select("lead_id, source_kind, occurred_at").order("occurred_at", { ascending: true }).range(f, t)).catch(() => []),
      all<{ conversation_ref: string; status: string }>((f, t) => sb.from("test_drive_bookings").select("conversation_ref, status").eq("status", "booked").range(f, t)).catch(() => []),
      // Files WE sent (no words): a PDF is a brochure. WhatsApp keeps them on the message, Instagram and
      // Facebook in channel_sent_files (011).
      all<{ conversation_id: string; sent_at: string; attachments: unknown }>((f, t) => sb.from("channel_messages").select("conversation_id, sent_at, attachments").eq("direction", "out").neq("attachments", "[]").range(f, t)).catch(() => []),
      all<{ account_id: string; conversation_ref: string; mime: string | null; kind: string | null; created_at: string }>((f, t) => sb.from("channel_sent_files").select("account_id, conversation_ref, mime, kind, created_at").range(f, t)).catch(() => []),
      all<{ person_key: string; reason: string; at: string }>((f, t) => sb.from("insight_lead_outcomes").select("person_key, reason, at").order("at", { ascending: true }).range(f, t)).catch(() => []),
    ]);
    const isPdf = (a: unknown) => {
      const x = a && typeof a === "object" ? (a as { mime?: string; filename?: string; kind?: string }) : {};
      return x.mime === "application/pdf" || /\.pdf$/i.test(x.filename ?? "");
    };
    const brochureByConv: Record<string, string> = {};
    const later = (conv: string, at: string) => {
      if (!brochureByConv[conv] || brochureByConv[conv] < at) brochureByConv[conv] = at;
    };
    for (const m of sentFiles) if (Array.isArray(m.attachments) && m.attachments.some(isPdf)) later(m.conversation_id, m.sent_at);
    const byMeta = new Map(conversations.filter((c) => c.meta_conversation_id).map((c) => [`${c.account_id}|${c.meta_conversation_id}`, c.id]));
    for (const f of sentMeta) {
      const conv = byMeta.get(`${f.account_id}|${f.conversation_ref}`);
      if (conv && (f.mime === "application/pdf" || f.kind === "document")) later(conv, f.created_at);
    }
    const lostReasonByPerson: Record<string, string> = {};
    for (const o of lost) {
      if (o.reason === "cleared") delete lostReasonByPerson[o.person_key];
      else lostReasonByPerson[o.person_key] = o.reason;
    }
    const bookingsByConv: Record<string, number> = {};
    for (const b of bookings) bookingsByConv[b.conversation_ref] = (bookingsByConv[b.conversation_ref] ?? 0) + 1;
    // Every person's review decision, applied to the facts before anything is counted (024).
    const overrides = await sb.from("insight_overrides").select("account_id, external_message_id, kind, value, model, action, new_value, new_model, by_name, at").limit(20000);
    const facts = overrides.error ? observations : applyOverrides(observations, latestOverrides((overrides.data ?? []) as Override[]));
    const firstTouchByLead: Record<string, string> = {};
    for (const t of touchpoints) if (!firstTouchByLead[t.lead_id] && /^[a-z_]{1,20}$/.test(t.source_kind)) firstTouchByLead[t.lead_id] = t.source_kind;
    const ownerByConv: Record<string, string> = {};
    for (const c of conversations) if (c.assigned_to) ownerByConv[c.id] = c.assigned_to;
    return { state: "ok", rows: { signals, observations: facts, conversations, leads, leadConversations, alerts }, extras: { ownerByConv, firstTouchByLead, bookingsByConv, brochureByConv, lostReasonByPerson, nowMs: Date.now() } };
  } catch (e) {
    console.error("[insights] reading failed:", e instanceof Error ? e.message : "unknown error");
    return { state: "unavailable" };
  }
}

export type InsightsRead = { state: "ok"; insights: Insights; signalsTable: true } | { state: "no_table" } | { state: "unavailable" };

/** The overview, or why not: the table is missing (migration 020) or the database cannot be read here. */
export async function readInsights(filter: InsightFilter): Promise<InsightsRead> {
  const since = filter.days > 0 ? new Date(Date.parse(filter.now) - filter.days * 86_400_000).toISOString() : null;
  const r = await readInsightRows(since);
  if (r.state !== "ok") return r;
  return { state: "ok", insights: buildInsights(r.rows, filter), signalsTable: true };
}
