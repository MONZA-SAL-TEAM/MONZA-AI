/**
 * Staff authentication — against the Monza CRM Supabase project.
 *
 * Staff sign in with their CRM accounts; this module verifies the token they
 * present (Bearer header or the 'monza-ai-token' cookie) with the CRM project
 * and resolves their StaffIdentity. The token itself is carried forward on the
 * identity so every connector query runs AS THEM (identity pass-through).
 *
 * Demo mode: when the CRM env vars are absent, the whole app must work with
 * zero credentials, so requireStaff returns a fixed demo identity. When the
 * env IS set, this module fails closed: no valid token, no identity.
 */

import { createClient } from "@supabase/supabase-js";
import type { StaffIdentity } from "@/lib/connectors/types";
import { crmAnonKey, crmConfigured, crmUrl } from "@/lib/env";

const COOKIE_NAME = "monza-ai-token";

export { crmConfigured };

/** The identity everything runs as when no CRM is configured. */
export const DEMO_IDENTITY: StaffIdentity = {
  userId: "demo",
  email: "demo@monza.example",
  crmAccessToken: "demo",
  appRole: "owner",
  capabilities: [],
};

export function isDemoIdentity(user: StaffIdentity): boolean {
  return user.userId === "demo" && user.crmAccessToken === "demo";
}

function tokenFromRequest(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === COOKIE_NAME) {
      const value = part.slice(eq + 1).trim();
      if (value) return decodeURIComponent(value);
    }
  }
  return null;
}

/**
 * Load the user's profile row from the CRM with THEIR OWN token, so profile
 * RLS applies. Defensive on shape: `capabilities` may not exist as a column
 * (it may live elsewhere in some CRM versions) — fall back to [].
 */
async function loadProfile(
  crmUrl: string,
  crmAnon: string,
  token: string,
  userId: string
): Promise<{ appRole: string | null; capabilities: string[] }> {
  const asUser = createClient(crmUrl, crmAnon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // First attempt: both columns. If the column list is wrong the query errors
  // as a whole, so retry with just user_role before giving up.
  const attempts: string[] = ["user_role, capabilities", "user_role"];
  for (const columns of attempts) {
    const { data, error } = await asUser
      .from("profiles")
      .select(columns)
      .eq("id", userId)
      .maybeSingle();
    if (error || !data) continue;
    const row = data as unknown as Record<string, unknown>;
    const appRole = typeof row.user_role === "string" ? row.user_role : null;
    const capabilities = Array.isArray(row.capabilities)
      ? (row.capabilities as unknown[]).filter(
          (c): c is string => typeof c === "string"
        )
      : [];
    return { appRole, capabilities };
  }
  return { appRole: null, capabilities: [] };
}

/**
 * Resolve the signed-in staff member for an API request.
 *
 * Returns a StaffIdentity, or null when the request carries no valid token
 * (the caller responds 401). In demo mode (CRM env absent) it always returns
 * the demo identity.
 */
export async function requireStaff(
  request: Request
): Promise<StaffIdentity | null> {
  const url = crmUrl();
  const anon = crmAnonKey();

  if (!url || !anon) {
    return DEMO_IDENTITY;
  }

  const token = tokenFromRequest(request);
  if (!token) return null;

  try {
    const crm = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await crm.auth.getUser(token);
    if (error || !data?.user) return null;

    const profile = await loadProfile(url, anon, token, data.user.id);

    return {
      userId: data.user.id,
      email: data.user.email ?? null,
      crmAccessToken: token,
      appRole: profile.appRole,
      capabilities: profile.capabilities,
    };
  } catch {
    // Any verification failure is a failed sign-in, never a pass-through.
    return null;
  }
}


/* ── Guard for routes that touch REAL shared infrastructure ──────────────── */

/**
 * Why this is separate from requireStaff().
 *
 * requireStaff() answers "who is asking?", and in demo mode the answer is the
 * fixed DEMO_IDENTITY so a reviewer with no credentials can walk the whole
 * product. That is correct for surfaces made of invented data.
 *
 * It is NOT correct for a route that reaches real shared infrastructure —
 * production storage, or (later) an outbound message to a real customer. In
 * demo mode requireStaff() hands the demo identity to ANY caller, including an
 * anonymous one, so a route that mutates a real resource behind it is
 * effectively public. That is exactly how the media bucket became world
 * writable.
 *
 * So: mutating a real shared resource requires a REAL, verified staff identity.
 * Demo mode has no such identity by definition, and says so plainly.
 */
export type StaffAccess =
  | { ok: true; user: StaffIdentity }
  /** No CRM is configured, so no real identity can exist on this deployment. */
  | { ok: false; reason: "demo_mode" }
  /** A CRM is configured but the request carried no valid token. */
  | { ok: false; reason: "unauthenticated" }
  /** Signed in, but this staff member may not perform this action. */
  | { ok: false; reason: "forbidden" };

/**
 * Resolve a real staff identity, refusing the demo identity outright.
 * `needsCapability` (optional) additionally requires the signed-in user to be
 * an owner or to hold one of the listed CRM capabilities.
 */
export async function requireRealStaff(
  request: Request,
  needsCapability?: readonly string[]
): Promise<StaffAccess> {
  const user = await requireStaff(request);
  if (!user) return { ok: false, reason: "unauthenticated" };
  if (isDemoIdentity(user)) return { ok: false, reason: "demo_mode" };
  if (!hasAnyCapability(user, needsCapability)) {
    return { ok: false, reason: "forbidden" };
  }
  return { ok: true, user };
}

/**
 * Does this staff member hold at least one of the required capabilities?
 *
 * Owners always do. An empty or absent requirement means "any staff member" —
 * NOT "anybody", because callers reach this only after identity is proven.
 *
 * Pure, so the policy is testable without a CRM. Mirrors the same
 * owner-plus-capability shape as lib/permissions/kernel.ts, which is the
 * assistant's equivalent decision.
 */
export function hasAnyCapability(
  user: StaffIdentity,
  needsCapability?: readonly string[]
): boolean {
  if (!needsCapability || needsCapability.length === 0) return true;
  if (user.appRole === "owner") return true;
  return needsCapability.some((c) => user.capabilities.includes(c));
}
