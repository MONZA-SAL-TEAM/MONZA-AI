/**
 * GET /api/channels/diagnose?account=<id> — times the smallest possible Meta
 * questions for one connected account (staff only, read-only, no-store). It
 * answers row counts and Meta's own error text; it never returns a key.
 */

import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { MEDIA_CAPABILITIES } from "@/lib/permissions/media";
import { diagnoseAccount } from "@/lib/channels/live";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, MEDIA_CAPABILITIES);
  if (!access.ok) {
    const status = access.reason === "unauthenticated" ? 401 : 403;
    return NextResponse.json({ ok: false, message: "Staff only." }, { status, headers: NO_STORE });
  }
  const result = await diagnoseAccount(new URL(request.url).searchParams.get("account"));
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.problem }, { status: result.status, headers: NO_STORE });
  }
  return NextResponse.json(result, { headers: NO_STORE });
}
