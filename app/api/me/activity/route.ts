import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { recordActivity } from "@/lib/insights/activity-server";
import { SECTIONS } from "@/lib/insights/activity";

/**
 * POST /api/me/activity { section } — "I used MONZA AI this last minute" (components/ActivityPing.tsx). Any
 * signed-in staff member, for THEMSELVES only (the id is the session's, never the browser's). Only the
 * section's name is kept — never a page address, never a customer. The database credits at most the time
 * since the previous minute, so two open tabs never count double.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request);
  if (!access.ok) return NextResponse.json({ ok: false }, { status: access.reason === "unauthenticated" ? 401 : 403 });
  const body = (await request.json().catch(() => null)) as { section?: unknown } | null;
  const section = (SECTIONS as readonly string[]).find((s) => s === body?.section) ?? "other";
  const ok = await recordActivity(access.user, section, 60);
  return NextResponse.json({ ok }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
