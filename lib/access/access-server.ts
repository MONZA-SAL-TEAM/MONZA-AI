/**
 * Team & access — SERVER ONLY: reading a person's MONZA AI access (staff_access, 029) for every request,
 * and recording presence and what they do (staff_presence, staff_events). Its own small database client, so
 * lib/auth.ts can use it without pulling in the channel code.
 *
 * Reads are kept in memory for 15 s per person: a change is in force everywhere within 15 s. If the table
 * cannot be read, the last known answer is used; with none, MONZA AI behaves as it did before this layer
 * existed (the CRM role decides) — and it says so in the log.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { noStoreFetch } from "@/lib/supabase-fetch";
import { aiServiceRoleKey, aiUrl } from "@/lib/env";
import { effectiveAccess, UNRESTRICTED, type AccessRow, type EffectiveAccess } from "@/lib/access/access";

let db: SupabaseClient | null | undefined;
export function accessDb(): SupabaseClient | null {
  if (db !== undefined) return db;
  const url = aiUrl();
  const key = aiServiceRoleKey();
  db = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: noStoreFetch } }) : null;
  return db;
}

const TTL_MS = 15_000;
const cache = new Map<string, { at: number; access: EffectiveAccess }>();

export function forgetAccess(userId: string): void {
  cache.delete(userId);
}

export async function loadAccess(userId: string): Promise<EffectiveAccess> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.access;
  const sb = accessDb();
  if (!sb) return UNRESTRICTED;
  const { data, error } = await sb.from("staff_access").select("user_id, is_admin, blocked, preset, pages, actions").eq("user_id", userId).maybeSingle();
  if (error) {
    console.error(`[access] could not be read (${(error as { code?: string }).code ?? "?"}) — ${hit ? "using the last known access" : "the CRM role decides"}`);
    return hit?.access ?? UNRESTRICTED;
  }
  const r = data as { user_id: string; is_admin: boolean; blocked: boolean; preset: string | null; pages: string[] | null; actions: string[] | null } | null;
  const row: AccessRow | null = r ? { userId: r.user_id, isAdmin: r.is_admin, blocked: r.blocked, preset: r.preset, pages: r.pages ?? [], actions: r.actions ?? [] } : null;
  const access = effectiveAccess(row);
  cache.set(userId, { at: Date.now(), access });
  return access;
}

/** One line of what a person did. Best effort: never fails the request it describes. */
export async function recordStaffEvent(staffId: string, kind: "sign_in" | "page" | "action" | "refused", detail: string | null, staffName: string | null = null): Promise<void> {
  const sb = accessDb();
  if (!sb) return;
  const clean = detail && /^[a-z0-9_]{1,40}$/.test(detail) ? detail : null;
  const { error } = await sb.from("staff_events").insert({ staff_id: staffId, kind, detail: clean, staff_name: staffName?.slice(0, 120) ?? null });
  if (error) console.error(`[access] event not recorded (${(error as { code?: string }).code ?? "?"})`);
}

/**
 * The person is here: the section open, and whether they used the app in the last minutes. A new section is a
 * "page" line; a sign-in is a "sign_in" line. Returns the section they were on before.
 */
export async function touchPresence(p: { staffId: string; name: string | null; section: string | null; active: boolean; device: "phone" | "tablet" | "computer" | null; signIn?: boolean }): Promise<void> {
  const sb = accessDb();
  if (!sb) return;
  const { data: before } = await sb.from("staff_presence").select("section, last_seen").eq("staff_id", p.staffId).maybeSingle();
  const prev = before as { section: string | null; last_seen: string } | null;
  const now = new Date().toISOString();
  await sb.from("staff_presence").upsert(
    {
      staff_id: p.staffId,
      staff_name: p.name?.slice(0, 120) ?? null,
      ...(p.section ? { section: p.section } : {}),
      device: p.device,
      last_seen: now,
      ...(p.active ? { last_active: now } : {}),
      ...(p.signIn ? { signed_in_at: now } : {}),
    },
    { onConflict: "staff_id" }
  );
  if (p.signIn) await recordStaffEvent(p.staffId, "sign_in", null, p.name);
  // A new section, or the same one after more than 30 minutes away, is a line in the record.
  const away = !prev || Date.now() - Date.parse(prev.last_seen) > 30 * 60_000;
  if (p.section && (prev?.section !== p.section || away)) await recordStaffEvent(p.staffId, "page", p.section, p.name);
}
