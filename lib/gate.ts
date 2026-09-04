/**
 * The sign-in gate's DECISION, as a pure function.
 *
 * Separated from middleware.ts so the rule can be tested. The middleware itself
 * is then a thin adapter: read the request, ask this, return a NextResponse.
 * (Nothing here imports next/server, which only resolves inside the bundler.)
 *
 * What the gate is, precisely: a check that a sign-in cookie EXISTS. It does
 * NOT verify the cookie, because verification means a round-trip to the CRM on
 * every navigation. Every API route verifies (lib/auth) and every page that
 * renders real data verifies (lib/auth-server) — the pages did not, once, and a
 * junk cookie was enough to read the audit log.
 *
 * What it must get right is WHICH paths it covers. That used to be a
 * hand-maintained matcher, and /departments was added to the product and left
 * out of it. The list is now derived from lib/nav.ts.
 */

import { PROTECTED_PATHS } from "@/lib/nav";

export interface GateRequest {
  /** Path only, e.g. "/customers". */
  pathname: string;
  /** Query string including "?", or "". */
  search: string;
  /** The sign-in cookie's value, if the request carried one. */
  token: string | undefined;
  /** Whether this deployment has staff sign-in configured at all. */
  crmConfigured: boolean;
}

export type GateDecision =
  | { action: "pass" }
  | { action: "redirect"; to: string };

/**
 * Is this path one of the product's screens?
 *
 * Prefix matching respects the segment boundary: "/inbox" covers "/inbox" and
 * "/inbox/anything", but never "/inboxes".
 */
export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

export function decideGate(request: GateRequest): GateDecision {
  // No sign-in configured: the whole app is the credential-free demo.
  if (!request.crmConfigured) return { action: "pass" };
  if (!isProtectedPath(request.pathname)) return { action: "pass" };
  if (request.token) return { action: "pass" };

  // Carry the intended destination through sign-in so a deep link like
  // /customers?open=... survives the front door. Relative paths only — the
  // login screen refuses anything else, so this cannot become an open redirect.
  const wanted = request.pathname + request.search;
  const next = wanted.startsWith("/")
    ? `?next=${encodeURIComponent(wanted)}`
    : "";
  return { action: "redirect", to: `/login${next}` };
}
