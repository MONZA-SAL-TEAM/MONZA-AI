/**
 * GET /api/channels/profiles?ids=<thread id>,<thread id>… — who the people in
 * these Instagram and Facebook conversations are, for the rows on screen:
 * name, username, picture, followers (Samer, 2026-09-15).
 *
 * Staff only. Each id must be one of OUR thread ids, and the person is read
 * from the conversation on Meta — the browser names a conversation, never a
 * person. Read live and never stored: Meta's picture links expire within days.
 */

import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { MEDIA_CAPABILITIES } from "@/lib/permissions/media";
import { PROFILES_PER_REQUEST, readProfilesForStaff } from "@/lib/channels/live";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, MEDIA_CAPABILITIES);
  if (!access.ok) {
    const status = access.reason === "unauthenticated" ? 401 : 403;
    return NextResponse.json({ ok: false }, { status, headers: NO_STORE });
  }
  const raw = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "" && s.length <= 300)
    .slice(0, PROFILES_PER_REQUEST);
  if (ids.length === 0) return NextResponse.json({ ok: true, profiles: {} }, { headers: NO_STORE });
  const profiles = await readProfilesForStaff(ids);
  return NextResponse.json({ ok: true, profiles }, { headers: NO_STORE });
}
