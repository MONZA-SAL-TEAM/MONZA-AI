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

const COOKIE_NAME = "monza-ai-token";

export function crmConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_CRM_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_CRM_SUPABASE_ANON_KEY
  );
}

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
  const crmUrl = process.env.NEXT_PUBLIC_CRM_SUPABASE_URL;
  const crmAnon = process.env.NEXT_PUBLIC_CRM_SUPABASE_ANON_KEY;

  if (!crmUrl || !crmAnon) {
    return DEMO_IDENTITY;
  }

  const token = tokenFromRequest(request);
  if (!token) return null;

  try {
    const crm = createClient(crmUrl, crmAnon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await crm.auth.getUser(token);
    if (error || !data?.user) return null;

    const profile = await loadProfile(crmUrl, crmAnon, token, data.user.id);

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
