/**
 * GET /api/channels/thread?id=<thread id> — one conversation, read live from
 * Meta for the inbox. Passed through, never stored, never cached.
 */

import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { MEDIA_CAPABILITIES } from "@/lib/permissions/media";
import { readThreadForStaff } from "@/lib/channels/live";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, MEDIA_CAPABILITIES);
  if (!access.ok) {
    const status = access.reason === "unauthenticated" ? 401 : 403;
    return NextResponse.json(
      { ok: false, message: status === 401 ? "Please sign in." : "You do not have access to conversations." },
      { status, headers: NO_STORE }
    );
  }

  const id = new URL(request.url).searchParams.get("id");
  const view = await readThreadForStaff(id);
  if (!view.ok) {
    return NextResponse.json(
      { ok: false, message: view.problem },
      { status: view.status, headers: NO_STORE }
    );
  }
  return NextResponse.json(view, { headers: NO_STORE });
}
