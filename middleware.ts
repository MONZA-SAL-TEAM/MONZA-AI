/**
 * The sign-in front door — a thin adapter over lib/gate.
 *
 * The decision itself (which paths are protected, what a refusal redirects to)
 * lives in lib/gate.ts as a pure function, because it is a security rule and a
 * security rule that cannot be tested is a security rule nobody checks.
 * next/server only resolves inside the bundler, so keeping it out of the rule
 * is what makes the rule testable at all.
 */

import { NextResponse, type NextRequest } from "next/server";
import { decideGate } from "@/lib/gate";

const COOKIE_NAME = "monza-ai-token";

export function middleware(request: NextRequest) {
  const decision = decideGate({
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    token: request.cookies.get(COOKIE_NAME)?.value,
    // Trimmed: a dashboard row saved with no value arrives as an empty string.
    crmConfigured: Boolean(
      (process.env.NEXT_PUBLIC_CRM_SUPABASE_URL ?? "").trim() &&
        (process.env.NEXT_PUBLIC_CRM_SUPABASE_ANON_KEY ?? "").trim()
    ),
  });

  if (decision.action === "pass") return NextResponse.next();

  const login = request.nextUrl.clone();
  const [pathname, search = ""] = decision.to.split("?");
  login.pathname = pathname;
  login.search = search ? `?${search}` : "";
  return NextResponse.redirect(login);
}

/**
 * Run on everything except Next internals, the API (which authenticates
 * itself), /login and static files. The precise page list is applied by
 * decideGate — a matcher cannot read an array, because it must be statically
 * analysable.
 */
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|login|favicon.ico).*)"],
};
