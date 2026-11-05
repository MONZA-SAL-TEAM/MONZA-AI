import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { MEDIA_CAPABILITIES } from "@/lib/permissions/media";
import { findForInbox } from "@/lib/inbox/find-server";

/**
 * GET /api/conversations/find?q=<name or number> — the people the inbox's search box should also offer:
 * from MONZA AI's own records and the CRM as THIS person may see it (Samer, 2026-11-05: "search the
 * customers from his phone number or his name from the inbox"). Names, numbers and chat ids only — never
 * a message's words. Gated like the other inbox data routes.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, MEDIA_CAPABILITIES);
  if (!access.ok) return NextResponse.json({ ok: false }, { status: access.reason === "unauthenticated" ? 401 : 403 });
  const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 80);
  const result = await findForInbox(access.user, q);
  if (!result) return NextResponse.json({ ok: false, message: "The records could not be read." }, { status: 503 });
  return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
}
