/**
 * GET /api/channels/diagnose?account=<id> — times the smallest possible Meta
 * questions for one connected account (staff only, read-only, no-store). It
 * answers row counts and Meta's own error text; it never returns a key.
 */

import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { MEDIA_CAPABILITIES } from "@/lib/permissions/media";
import { diagnoseAccount, diagnoseInstagramLogin, diagnoseThread } from "@/lib/channels/live";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, MEDIA_CAPABILITIES);
  if (!access.ok) {
    const status = access.reason === "unauthenticated" ? 401 : 403;
    return NextResponse.json({ ok: false, message: "Staff only." }, { status, headers: NO_STORE });
  }
  const params = new URL(request.url).searchParams;
  // ?thread=<inbox thread id> explains ONE Instagram / Facebook thread: every ask
  // made and the shape of each message (never a word). ?route=instagram-login
  // runs the opt-in Instagram-login experiment; without either the standard
  // diagnosis runs exactly as before.
  const thread = params.get("thread");
  const result = thread
    ? await diagnoseThread(thread)
    : params.get("route") === "instagram-login"
      ? await diagnoseInstagramLogin(params.get("account"))
      : await diagnoseAccount(params.get("account"));
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.problem }, { status: result.status, headers: NO_STORE });
  }
  return NextResponse.json(result, { headers: NO_STORE });
}
