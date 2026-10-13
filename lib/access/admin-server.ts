/**
 * Team & access — the admin's reads and changes (SERVER ONLY). Staff come from the CRM's staff list, read AS
 * THE ADMIN (their own token — the CRM decides what they may see); MONZA AI's access, presence, minutes and
 * the record of what each person did come from MONZA AI's own tables (029, 028). Nothing here touches the CRM.
 */

import type { StaffIdentity } from "@/lib/connectors/types";
import { crmEnv, makeUserClient } from "@/lib/connectors/crm";
import { accessDb, forgetAccess } from "@/lib/access/access-server";
import { ACTIONS, PAGES, presenceOf, PRESETS, type PresetKey } from "@/lib/access/access";
import { beirutDay } from "@/lib/insights/demand";

const DAY = 86_400_000;

export interface AccessSetting {
  isAdmin: boolean;
  blocked: boolean;
  preset: string | null;
  pages: string[];
  actions: string[];
  updatedAt: string | null;
  updatedByName: string | null;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string | null;
  crmRole: string | null;
  crmActive: boolean | null;
  jobTitle: string | null;
  /** Null = never set: the CRM role decides, as before. */
  access: AccessSetting | null;
  presence: "active" | "open" | "offline";
  section: string | null;
  device: string | null;
  lastSeen: string | null;
  lastSignIn: string | null;
  minutesToday: number;
  actionsToday: number;
}

export type TeamRead = { state: "ok"; members: TeamMember[]; crm: "ok" | "unavailable" | "not_connected" } | { state: "unavailable" };

type AccessDbRow = { user_id: string; name: string | null; email: string | null; is_admin: boolean; blocked: boolean; preset: string | null; pages: string[] | null; actions: string[] | null; updated_at: string | null; updated_by_name: string | null };
const settingOf = (r: AccessDbRow): AccessSetting => ({ isAdmin: r.is_admin, blocked: r.blocked, preset: r.preset, pages: r.pages ?? [], actions: r.actions ?? [], updatedAt: r.updated_at, updatedByName: r.updated_by_name });

async function crmStaff(viewer: StaffIdentity): Promise<{ state: "ok" | "unavailable" | "not_connected"; rows: { id: string; full_name: string | null; email: string | null; user_role: string | null; is_active: boolean | null; job_title: string | null }[] }> {
  if (!crmEnv() || viewer.crmAccessToken === "demo") return { state: "not_connected", rows: [] };
  try {
    const db = makeUserClient({ user: viewer, conversationId: null, turnId: "team-access" });
    const { data, error } = await db.from("profiles").select("id, full_name, email, user_role, is_active, job_title").limit(1000);
    if (error) throw error;
    return { state: "ok", rows: (data ?? []) as never };
  } catch (e) {
    console.error("[team] the CRM's staff list could not be read:", e instanceof Error ? e.message : JSON.stringify(e));
    return { state: "unavailable", rows: [] };
  }
}

export async function readTeam(viewer: StaffIdentity, nowMs = Date.now()): Promise<TeamRead> {
  const sb = accessDb();
  if (!sb) return { state: "unavailable" };
  try {
    const today = beirutDay(new Date(nowMs).toISOString());
    const since = new Date(nowMs - DAY).toISOString();
    const [crm, access, presence, minutes, events] = await Promise.all([
      crmStaff(viewer),
      sb.from("staff_access").select("*"),
      sb.from("staff_presence").select("staff_id, staff_name, section, device, last_seen, last_active, signed_in_at"),
      sb.from("staff_activity_days").select("staff_id, active_seconds").eq("day", today),
      sb.from("staff_events").select("staff_id, kind, at").gte("at", since).limit(20_000),
    ]);
    if (access.error || presence.error) throw access.error ?? presence.error;
    const accessBy = new Map(((access.data ?? []) as AccessDbRow[]).map((r) => [r.user_id, r]));
    const presenceBy = new Map(((presence.data ?? []) as { staff_id: string; staff_name: string | null; section: string | null; device: string | null; last_seen: string; last_active: string | null; signed_in_at: string | null }[]).map((r) => [r.staff_id, r]));
    const minutesBy = new Map(((minutes.data ?? []) as { staff_id: string; active_seconds: number }[]).map((r) => [r.staff_id, Math.round(r.active_seconds / 60)]));
    const actionsBy = new Map<string, number>();
    const signInBy = new Map<string, string>();
    for (const e of (events.data ?? []) as { staff_id: string; kind: string; at: string }[]) {
      if (e.kind === "action" && beirutDay(e.at) === today) actionsBy.set(e.staff_id, (actionsBy.get(e.staff_id) ?? 0) + 1);
      if (e.kind === "sign_in" && (!signInBy.get(e.staff_id) || e.at > signInBy.get(e.staff_id)!)) signInBy.set(e.staff_id, e.at);
    }
    const ids = new Set([...crm.rows.map((r) => r.id), ...accessBy.keys(), ...presenceBy.keys()]);
    const crmBy = new Map(crm.rows.map((r) => [r.id, r]));
    const members: TeamMember[] = [...ids].map((id) => {
      const c = crmBy.get(id);
      const a = accessBy.get(id);
      const p = presenceBy.get(id);
      return {
        id,
        name: c?.full_name?.trim() || a?.name || p?.staff_name || c?.email?.split("@")[0] || "Staff",
        email: c?.email ?? a?.email ?? null,
        crmRole: c?.user_role ?? null,
        crmActive: c ? c.is_active !== false : null,
        jobTitle: c?.job_title ?? null,
        access: a ? settingOf(a) : null,
        presence: presenceOf(p?.last_seen ?? null, p?.last_active ?? null, nowMs),
        section: p?.section ?? null,
        device: p?.device ?? null,
        lastSeen: p?.last_seen ?? null,
        lastSignIn: signInBy.get(id) ?? p?.signed_in_at ?? null,
        minutesToday: minutesBy.get(id) ?? 0,
        actionsToday: actionsBy.get(id) ?? 0,
      };
    });
    const RANK = { active: 0, open: 1, offline: 2 } as const;
    members.sort((x, y) => RANK[x.presence] - RANK[y.presence] || (y.lastSeen ?? "").localeCompare(x.lastSeen ?? "") || x.name.localeCompare(y.name));
    return { state: "ok", members, crm: crm.state };
  } catch (e) {
    console.error("[team] reading failed:", e instanceof Error ? e.message : JSON.stringify(e));
    return { state: "unavailable" };
  }
}

export interface PersonActivity {
  member: TeamMember | null;
  events: { at: string; kind: string; detail: string | null }[];
  days: { day: string; minutes: number; sections: Record<string, number>; firstAt: string; lastAt: string }[];
  log: { at: string; byName: string | null; before: unknown; after: unknown }[];
}

export async function readPerson(viewer: StaffIdentity, id: string, days: number, nowMs = Date.now()): Promise<PersonActivity | null> {
  const sb = accessDb();
  if (!sb) return null;
  const team = await readTeam(viewer, nowMs);
  const member = team.state === "ok" ? (team.members.find((m) => m.id === id) ?? null) : null;
  const since = new Date(nowMs - days * DAY).toISOString();
  const [ev, act, log] = await Promise.all([
    sb.from("staff_events").select("at, kind, detail").eq("staff_id", id).gte("at", since).order("at", { ascending: false }).limit(2000),
    sb.from("staff_activity_days").select("day, active_seconds, sections, first_at, last_at").eq("staff_id", id).gte("day", beirutDay(since)).order("day", { ascending: false }),
    sb.from("staff_access_log").select("at, by_name, before, after").eq("user_id", id).order("at", { ascending: false }).limit(50),
  ]);
  return {
    member,
    events: (ev.data ?? []) as PersonActivity["events"],
    days: ((act.data ?? []) as { day: string; active_seconds: number; sections: Record<string, number> | null; first_at: string; last_at: string }[]).map((d) => ({
      day: d.day,
      minutes: Math.round(d.active_seconds / 60),
      sections: Object.fromEntries(Object.entries(d.sections ?? {}).map(([k, v]) => [k, Math.round(Number(v) / 60)])),
      firstAt: d.first_at,
      lastAt: d.last_at,
    })),
    log: ((log.data ?? []) as { at: string; by_name: string | null; before: unknown; after: unknown }[]).map((l) => ({ at: l.at, byName: l.by_name, before: l.before, after: l.after })),
  };
}

export interface AccessChange {
  userId: string;
  name: string | null;
  email: string | null;
  /** Null = remove the setting: back to the CRM role. */
  setting: { isAdmin: boolean; blocked: boolean; preset: PresetKey | "custom"; pages: string[]; actions: string[] } | null;
}

const PAGE_KEYS = PAGES.map((p) => p.key as string);
const ACTION_KEYS = ACTIONS.map((a) => a.key as string);

/** Save one person's access. Guards: nobody removes their own admin or blocks themselves; one admin always stays. */
export async function saveAccess(by: { id: string; name: string }, change: AccessChange): Promise<{ ok: true } | { ok: false; status: 400 | 409 | 503; reason: string }> {
  const sb = accessDb();
  if (!sb) return { ok: false, status: 503, reason: "The database is not reachable here." };
  const s = change.setting;
  if (change.userId === by.id && (!s || !s.isAdmin || s.blocked)) return { ok: false, status: 400, reason: "You cannot remove your own admin access or block yourself." };
  const { data: beforeRow } = await sb.from("staff_access").select("*").eq("user_id", change.userId).maybeSingle();
  const before = beforeRow as AccessDbRow | null;
  if (before?.is_admin && (!s || !s.isAdmin || s.blocked)) {
    const { count } = await sb.from("staff_access").select("user_id", { count: "exact", head: true }).eq("is_admin", true).eq("blocked", false);
    if ((count ?? 0) <= 1) return { ok: false, status: 409, reason: "At least one admin must remain." };
  }
  let after: Record<string, unknown> | null = null;
  if (!s) {
    const { error } = await sb.from("staff_access").delete().eq("user_id", change.userId);
    if (error) return { ok: false, status: 503, reason: "It could not be saved just now." };
  } else {
    const pages = s.preset !== "custom" && s.preset in PRESETS ? PRESETS[s.preset as PresetKey].pages : s.pages.filter((p) => PAGE_KEYS.includes(p));
    const actions = s.preset !== "custom" && s.preset in PRESETS ? PRESETS[s.preset as PresetKey].actions : s.actions.filter((a) => ACTION_KEYS.includes(a));
    after = {
      user_id: change.userId,
      name: change.name?.slice(0, 120) ?? null,
      email: change.email?.slice(0, 200) ?? null,
      is_admin: s.isAdmin,
      blocked: s.isAdmin ? false : s.blocked,
      preset: s.preset,
      pages,
      actions,
      updated_by: by.id,
      updated_by_name: by.name.slice(0, 120),
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from("staff_access").upsert(after, { onConflict: "user_id" });
    if (error) return { ok: false, status: 503, reason: "It could not be saved just now." };
  }
  const keep = (r: Record<string, unknown> | null) => (r ? { is_admin: r.is_admin, blocked: r.blocked, preset: r.preset, pages: r.pages, actions: r.actions } : null);
  await sb.from("staff_access_log").insert({ user_id: change.userId, by_staff: by.id, by_name: by.name.slice(0, 120), before: keep(before as unknown as Record<string, unknown> | null), after: keep(after) });
  forgetAccess(change.userId);
  return { ok: true };
}
