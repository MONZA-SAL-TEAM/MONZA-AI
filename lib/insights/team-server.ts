/**
 * The team's response times — SERVER ONLY. Reads WHEN each side spoke and who answered, never a word
 * (no `body` column is selected). The shaping is pure in lib/insights/team.ts.
 */

import { channelDb } from "@/lib/channels/store";
import { buildTeamReport, type TeamReport, type TeamRows, type TurnRow } from "@/lib/insights/team";
import { isPilotChat } from "@/lib/wasales/autoreply-pilot";

const PAGE = 1000;

async function pages<T>(read: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>, max = 50_000): Promise<T[]> {
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

export type TeamRead = { state: "ok"; report: TeamReport } | { state: "unavailable" };

export async function readTeamReport(days: number, now = new Date().toISOString()): Promise<TeamRead> {
  const sb = channelDb();
  if (!sb) return { state: "unavailable" };
  try {
    const since = new Date(Date.parse(now) - days * 86_400_000).toISOString();
    const [messages, turns, convs, accounts, alerts, events] = await Promise.all([
      pages<{ conversation_id: string; account_id: string; direction: string; author: string; staff_id: string | null; staff_name: string | null; sent_at: string; external_message_id: string | null }>((f, t) =>
        sb.from("channel_messages").select("conversation_id, account_id, direction, author, staff_id, staff_name, sent_at, external_message_id").gte("sent_at", since).order("sent_at").range(f, t)
      ),
      pages<{ conversation_id: string; account_id: string; direction: string; author: string; staff_id: string | null; at: string; external_message_id: string }>((f, t) =>
        sb.from("channel_turns").select("conversation_id, account_id, direction, author, staff_id, at, external_message_id").gte("at", since).order("at").range(f, t)
      ).catch(() => []),
      pages<{ id: string; account_id: string; peer_external_id: string; assigned_to: string | null; assigned_name: string | null }>((f, t) =>
        sb.from("channel_conversations").select("id, account_id, peer_external_id, assigned_to, assigned_name").range(f, t)
      ),
      sb.from("channel_accounts").select("id, channel"),
      sb.from("sales_alerts").select("conversation_ref, status, created_at, kind").eq("status", "open").limit(5000),
      sb.from("conversation_owner_events").select("by_staff, by_name, to_staff, to_name").limit(5000),
    ]);
    const channelOf = new Map(((accounts.data ?? []) as { id: string; channel: string }[]).map((a) => [a.id, a.channel]));
    // Samer's test phones are never clients — nor a measure of how fast anyone answers.
    const pilot = new Set(convs.filter((c) => channelOf.get(c.account_id) === "whatsapp" && isPilotChat({ accountId: c.account_id, channel: "whatsapp", peerExternalId: c.peer_external_id })).map((c) => c.id));

    // Staff names we know: from WhatsApp sends and from the ownership history.
    const names = new Map<string, string>();
    for (const m of messages) if (m.staff_id && m.staff_name) names.set(m.staff_id, m.staff_name);
    for (const e of (events.data ?? []) as { by_staff: string; by_name: string | null; to_staff: string | null; to_name: string | null }[]) {
      if (e.by_name && !names.has(e.by_staff)) names.set(e.by_staff, e.by_name);
      if (e.to_staff && e.to_name && !names.has(e.to_staff)) names.set(e.to_staff, e.to_name);
    }

    const seen = new Set<string>();
    const rows: TurnRow[] = [];
    const push = (r: TurnRow, account: string, ext: string | null) => {
      if (pilot.has(r.conversation_id)) return;
      if (ext) {
        const k = `${account}|${ext}`;
        if (seen.has(k)) return;
        seen.add(k);
      }
      rows.push(r);
    };
    const authorOf = (direction: string, author: string): TurnRow["author"] => (direction === "in" ? "customer" : author === "automation" ? "automation" : "staff");
    for (const m of messages) {
      push({ conversation_id: m.conversation_id, at: m.sent_at, direction: m.direction === "in" ? "in" : "out", author: authorOf(m.direction, m.author), staff_id: m.staff_id, staff_name: m.staff_name ?? (m.staff_id ? names.get(m.staff_id) ?? null : null) }, m.account_id, m.external_message_id);
    }
    for (const t of turns) {
      push({ conversation_id: t.conversation_id, at: t.at, direction: t.direction === "in" ? "in" : "out", author: authorOf(t.direction, t.author), staff_id: t.staff_id, staff_name: t.staff_id ? names.get(t.staff_id) ?? null : null }, t.account_id, t.external_message_id);
    }
    const owned = convs.filter((c) => c.assigned_to && !pilot.has(c.id)).map((c) => ({ conversation_id: c.id, owner_id: c.assigned_to as string, owner_name: c.assigned_name }));
    const report = buildTeamReport({ turns: rows, owned, alerts: (alerts.data ?? []) as TeamRows["alerts"] }, now);
    return { state: "ok", report };
  } catch (e) {
    console.error("[insights/team] reading failed:", e instanceof Error ? e.message : JSON.stringify(e));
    return { state: "unavailable" };
  }
}
