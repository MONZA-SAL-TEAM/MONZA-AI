/**
 * Identity for SERVER COMPONENTS (pages), as opposed to route handlers.
 *
 * Why this exists: middleware.ts is only the front door. It checks that the
 * sign-in cookie EXISTS — it deliberately does not verify it, because
 * verification means a network round-trip to the CRM on every navigation. The
 * comment there has always said "every API route verifies the token"… and that
 * was true of API routes and false of pages.
 *
 * A page that renders real data therefore rendered it for anyone who set a
 * cookie of any value: /dashboard read the audit log, /settings listed which
 * secrets were configured. Both now verify here first.
 *
 * Kept out of lib/auth.ts because this module imports next/headers, which may
 * only be used in a server context; lib/auth.ts stays importable from anywhere
 * a Request is available.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireStaff, isDemoIdentity } from "@/lib/auth";
import type { StaffIdentity } from "@/lib/connectors/types";

const COOKIE_NAME = "monza-ai-token";

/**
 * The signed-in staff member for the current page render, or null.
 *
 * In demo mode (no CRM configured) this returns the demo identity, exactly
 * like requireStaff — a reviewer with no credentials still sees the whole
 * product, and every demo surface is invented data by construction.
 */
export async function staffForPage(): Promise<StaffIdentity | null> {
  const token = cookies().get(COOKIE_NAME)?.value;
  const headers = new Headers();
  if (token) {
    headers.set("cookie", `${COOKIE_NAME}=${encodeURIComponent(token)}`);
  }
  // The URL is never used; requireStaff only reads headers off the Request.
  return requireStaff(new Request("https://monza-ai.internal/page", { headers }));
}

/**
 * Guard a page that renders real data. Returns the identity, or redirects to
 * sign-in — so a page body can never accidentally run unauthenticated.
 *
 * `next` is the path to come back to after signing in (relative only; the
 * login screen refuses anything else).
 */
export async function requireStaffForPage(next: string): Promise<StaffIdentity> {
  const user = await staffForPage();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  return user;
}

/** True when this render is the credential-free demo. */
export async function isDemoPage(): Promise<boolean> {
  const user = await staffForPage();
  return user !== null && isDemoIdentity(user);
}
