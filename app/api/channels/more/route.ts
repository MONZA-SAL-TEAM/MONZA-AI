/**
 * GET /api/channels/more?account=<id>&after=<cursor>&lite=0|1 — the next page
 * of one account's conversations, read live from Meta for "Load more" /
 * "Load all". Passed through, never stored, never cached.
 */

import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { MEDIA_CAPABILITIES } from "@/lib/permissions/media";
import { readMore } from "@/lib/channels/live";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  const params = new URL(request.url).searchParams;
  const page = await readMore(params.get("account"), params.get("after"), params.get("lite") === "1");
  if (!page.ok) {
    return NextResponse.json({ ok: false, message: page.problem }, { status: page.status, headers: NO_STORE });
  }
  return NextResponse.json(page, { headers: NO_STORE });
}
