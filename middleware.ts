/**
 * Sign-in gate for the app pages.
 *
 * When the CRM project is configured, the staff-facing pages require the
 * 'monza-ai-token' cookie; without it the visitor is sent to /login. The
 * cookie's VALUE is not verified here — every API route verifies the token
 * against the CRM itself via requireStaff — this is only the front door.
 *
 * Never gated: /login, /api/*, Next internals, favicon (the matcher below).
 * With no CRM env set the whole app passes through — demo mode.
 */

import { NextResponse, type NextRequest } from "next/server";

const COOKIE_NAME = "monza-ai-token";

export function middleware(request: NextRequest) {
  const crmConfigured = Boolean(
    process.env.NEXT_PUBLIC_CRM_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_CRM_SUPABASE_ANON_KEY
  );
  if (!crmConfigured) return NextResponse.next();

  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (token) return NextResponse.next();

  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    "/chat/:path*",
    "/dashboard/:path*",
    "/connections/:path*",
    "/automations/:path*",
    "/settings/:path*",
  ],
};
