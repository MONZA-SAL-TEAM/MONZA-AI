/**
 * One client's profile — SERVER ONLY. MONZA AI's own tables through the service client (labels only), and
 * the CRM as the viewer (lib/insights/crm-server.ts). The shaping is pure in lib/insights/profile.ts.
 */

import { channelDb } from "@/lib/channels/store";
import type { StaffIdentity } from "@/lib/connectors/types";
import { readCrmPurchases } from "@/lib/insights/crm-server";
import type { ObservationRow, SignalRow } from "@/lib/insights/insights";
import { OBSERVATION_COLUMNS } from "@/lib/insights/insights-server";
import { buildClientProfile, parsePersonKey, type ClientProfile, type ProfileRows } from "@/lib/insights/profile";
import { applyOverrides, latestOverrides, type Override } from "@/lib/insights/review";

/** People's review decisions (insight_overrides) applied to these facts; unread decisions leave them as they are. */
async function withDecisions(facts: ObservationRow[]): Promise<ObservationRow[]> {
  const sb = channelDb();
  if (!sb || facts.length === 0) return facts;
  const ids = [...new Set(facts.map((f) => f.external_message_id).filter((x): x is string => Boolean(x)))].slice(0, 2000);
  const { data, error } = await sb.from("insight_overrides").select("account_id, external_message_id, kind, value, model, action, new_value, new_model, by_name, at").in("external_message_id", ids);
  return error ? facts : applyOverrides(facts, latestOverrides((data ?? []) as Override[]));
}

export type ProfileRead = { state: "ok"; profile: ClientProfile } | { state: "not_found" } | { state: "unavailable" };

export async function readClientProfile(key: string, viewer: StaffIdentity): Promise<ProfileRead> {
  const parsed = parsePersonKey(key);
  if (!parsed) return { state: "not_found" };
  const sb = channelDb();
  if (!sb) return { state: "unavailable" };
  try {
    // Which chats are this person: a lead's chats, or the one chat (and its lead, if it has one).
    let leadId: string | null = parsed.kind === "lead" ? parsed.id : null;
    if (!leadId) {
      const { data } = await sb.from("lead_conversations").select("lead_id").eq("conversation_id", parsed.id).maybeSingle();
      leadId = (data as { lead_id?: string } | null)?.lead_id ?? null;
    }
    let convIds: string[] = [parsed.id];
    if (parsed.kind === "lead") {
      const { data, error } = await sb.from("lead_conversations").select("conversation_id").eq("lead_id", parsed.id);
      if (error) throw error;
      convIds = ((data ?? []) as { conversation_id: string }[]).map((r) => r.conversation_id);
    }
    if (convIds.length === 0) return { state: "not_found" };

    const [conversations, accounts, lead, signals, observations, alerts, touchpoints] = await Promise.all([
      sb.from("channel_conversations").select("id, account_id, brand, peer_external_id, peer_display, created_at, meta_conversation_id").in("id", convIds),
      sb.from("channel_accounts").select("id, channel"),
      leadId ? sb.from("leads").select("id, display_name, phone").eq("id", leadId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      sb.from("sales_signals").select("account_id, brand, channel, conversation_id, at, language, intents, models, weak_models, colour, has_media, alert_kind, alert_tags, offered, silenced").in("conversation_id", convIds).order("at", { ascending: true }).limit(5000),
      sb.from("sales_observations").select(OBSERVATION_COLUMNS).in("conversation_id", convIds).limit(10000),
      sb.from("sales_alerts").select("conversation_ref, kind, status, created_at, closed_at").in("conversation_ref", convIds).order("created_at", { ascending: false }).limit(500),
      leadId ? sb.from("lead_touchpoints").select("source_kind, source_ref, headline, occurred_at").eq("lead_id", leadId).order("occurred_at", { ascending: true }).limit(20) : Promise.resolve({ data: [], error: null }),
    ]);
    for (const r of [conversations, accounts, signals, alerts]) if (r.error) throw r.error;
    const convRows = (conversations.data ?? []) as ProfileRows["conversations"];
    if (convRows.length === 0) return { state: "not_found" };

    const rows: ProfileRows = {
      conversations: convRows,
      accountChannel: Object.fromEntries(((accounts.data ?? []) as { id: string; channel: string }[]).map((a) => [a.id, a.channel])),
      lead: (lead.data as ProfileRows["lead"]) ?? null,
      signals: (signals.data ?? []) as SignalRow[],
      // Facts and touchpoints are extras: a missing table (before 021) costs only them.
      observations: observations.error ? [] : await withDecisions((observations.data ?? []) as ObservationRow[]),
      alerts: (alerts.data ?? []) as ProfileRows["alerts"],
      touchpoints: touchpoints.error ? [] : ((touchpoints.data ?? []) as ProfileRows["touchpoints"]),
    };
    const [lost, identity] = await Promise.all([
      sb.from("insight_lead_outcomes").select("reason, by_name, at").eq("person_key", key).order("at", { ascending: false }).limit(20),
      sb.from("insight_identity_events").select("action, by_name, at").in("conversation_id", convIds).order("at", { ascending: false }).limit(20),
    ]);
    rows.lostHistory = lost.error ? [] : ((lost.data ?? []) as ProfileRows["lostHistory"]);
    rows.identityHistory = identity.error ? [] : ((identity.data ?? []) as ProfileRows["identityHistory"]);
    const waPhones = convRows.filter((c) => rows.accountChannel[c.account_id] === "whatsapp").map((c) => c.peer_external_id);
    const phones = [rows.lead?.phone ?? null, ...waPhones].filter((p): p is string => Boolean(p));
    const crm = await readCrmPurchases(viewer, phones);
    return { state: "ok", profile: buildClientProfile(key, rows, crm) };
  } catch (e) {
    console.error("[insights] reading a client profile failed:", e instanceof Error ? e.message : JSON.stringify(e));
    return { state: "unavailable" };
  }
}
