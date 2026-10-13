/**
 * Employees — SERVER ONLY. Records the "I am using the app" minute (staff_activity_days, 028, through
 * staff_activity_ping, which caps the time by the wall clock so two open tabs never count double) and reads
 * the period back with the tasks the records already hold. No customer and no page address is ever stored
 * with a minute — only the section's name.
 */

import type { StaffIdentity } from "@/lib/connectors/types";
import { channelDb } from "@/lib/channels/store";
import { actorOf } from "@/lib/leads/ownership-server";
import { beirutDay } from "@/lib/insights/demand";
import { employeesReport, minutesByDay, type ActivityDay, type EmployeeRow, type TaskEvent } from "@/lib/insights/activity";

const DAY = 86_400_000;

/** Names come from the CRM's staff list; kept in memory for 6 h so a minute's ping does not ask every time. */
const names = new Map<string, { name: string; at: number }>();

export async function recordActivity(user: StaffIdentity, section: string, seconds: number): Promise<boolean> {
  const sb = channelDb();
  if (!sb) return false;
  let cached = names.get(user.userId);
  if (!cached || Date.now() - cached.at > 6 * 3_600_000) {
    cached = { name: (await actorOf(user)).name, at: Date.now() };
    names.set(user.userId, cached);
  }
  const { error } = await sb.rpc("staff_activity_ping", { p_staff: user.userId, p_name: cached.name, p_day: beirutDay(new Date().toISOString()), p_seconds: Math.round(seconds), p_section: section });
  if (error) console.error(`[activity] not recorded (${(error as { code?: string }).code ?? "?"})`);
  return !error;
}

export type EmployeesRead =
  | { state: "ok"; employees: EmployeeRow[]; daily: { days: string[]; rows: { staffId: string; name: string; minutes: number[] }[] }; notAttributed: number | null; firstDay: string | null }
  | { state: "unavailable" };

async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export async function readEmployees(days: number, nowMs = Date.now()): Promise<EmployeesRead> {
  const sb = channelDb();
  if (!sb) return { state: "unavailable" };
  const since = new Date(nowMs - days * DAY).toISOString();
  const sinceDay = beirutDay(since);
  try {
    const [activity, waSends, metaSends, ownerEvents, alerts, decisionEvents, reviews, lost, identity, phoneApp, first] = await Promise.all([
      all<ActivityDay>((f, t) => sb.from("staff_activity_days").select("staff_id, day, staff_name, active_seconds, sections, first_at, last_at").gte("day", sinceDay).range(f, t)),
      all<{ staff_id: string; staff_name: string | null; sent_at: string }>((f, t) => sb.from("channel_messages").select("staff_id, staff_name, sent_at").eq("direction", "out").eq("author", "staff").not("staff_id", "is", null).gte("sent_at", since).range(f, t)),
      all<{ staff_id: string; at: string }>((f, t) => sb.from("channel_turns").select("staff_id, at").eq("direction", "out").not("staff_id", "is", null).gte("at", since).range(f, t)),
      all<{ action: string; by_staff: string | null; by_name: string | null; at: string }>((f, t) => sb.from("conversation_owner_events").select("action, by_staff, by_name, at").gte("at", since).range(f, t)),
      all<{ closed_by: string | null; closed_at: string }>((f, t) => sb.from("sales_alerts").select("closed_by, closed_at").eq("status", "done").gte("closed_at", since).not("closed_by", "like", "auto:%").range(f, t)),
      all<{ by_staff: string | null; by_name: string | null; at: string }>((f, t) => sb.from("insight_decision_events").select("by_staff, by_name, at").not("by_staff", "is", null).gte("at", since).range(f, t)),
      all<{ by_staff: string | null; by_name: string | null; at: string }>((f, t) => sb.from("insight_overrides").select("by_staff, by_name, at").gte("at", since).range(f, t)),
      all<{ by_staff: string | null; by_name: string | null; at: string }>((f, t) => sb.from("insight_lead_outcomes").select("by_staff, by_name, at").gte("at", since).range(f, t)),
      all<{ by_staff: string | null; by_name: string | null; at: string }>((f, t) => sb.from("insight_identity_events").select("by_staff, by_name, at").gte("at", since).range(f, t)),
      sb.from("channel_messages").select("id", { count: "exact", head: true }).eq("direction", "out").eq("author", "staff").is("staff_id", null).gte("sent_at", since),
      sb.from("staff_activity_days").select("day").order("day", { ascending: true }).limit(1).maybeSingle(),
    ]);
    const tasks: TaskEvent[] = [
      ...waSends.map((r) => ({ kind: "replies_whatsapp" as const, staffId: r.staff_id, staffName: r.staff_name, at: r.sent_at })),
      ...metaSends.map((r) => ({ kind: "replies_meta" as const, staffId: r.staff_id, staffName: null, at: r.at })),
      ...ownerEvents.filter((e) => e.action === "take" || e.action === "assign").map((e) => ({ kind: e.action === "take" ? ("leads_taken" as const) : ("leads_assigned" as const), staffId: e.by_staff, staffName: e.by_name, at: e.at })),
      ...alerts.filter((a) => a.closed_by && a.closed_by.trim()).map((a) => ({ kind: "alerts_closed" as const, staffId: null, staffName: a.closed_by, at: a.closed_at })),
      ...decisionEvents.map((e) => ({ kind: "decisions" as const, staffId: e.by_staff, staffName: e.by_name, at: e.at })),
      ...reviews.map((e) => ({ kind: "reviews" as const, staffId: e.by_staff, staffName: e.by_name, at: e.at })),
      ...lost.map((e) => ({ kind: "lost_reasons" as const, staffId: e.by_staff, staffName: e.by_name, at: e.at })),
      ...identity.map((e) => ({ kind: "identity" as const, staffId: e.by_staff, staffName: e.by_name, at: e.at })),
    ];
    const dayList: string[] = [];
    for (let i = Math.min(days, 14) - 1; i >= 0; i--) dayList.push(beirutDay(new Date(nowMs - i * DAY).toISOString()));
    return {
      state: "ok",
      employees: employeesReport(activity, tasks),
      daily: { days: dayList, rows: minutesByDay(activity, dayList) },
      notAttributed: phoneApp.error ? null : (phoneApp.count ?? 0),
      firstDay: (first.data as { day?: string } | null)?.day ?? null,
    };
  } catch (e) {
    console.error("[activity] reading failed:", e instanceof Error ? e.message : JSON.stringify(e));
    return { state: "unavailable" };
  }
}
