/**
 * GET  /api/sales/suggestion?thread=<id>   the Search Engine's suggested reply
 *                                          for one open chat
 * POST /api/sales/suggestion               { thread, action: "resume" } —
 *                                          "Suggest again" after a person replied
 *
 * A suggestion is only ever SHOWN here. Sending it is a separate route that a
 * person has to press (./send). Staff only, like the thread it reads.
 */

import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { MEDIA_CAPABILITIES } from "@/lib/permissions/media";
import { resumeSuggestions, suggestionFor } from "@/lib/wasales/suggestion-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };

async function staff(request: Request): Promise<NextResponse | null> {
  const access = await requireRealStaff(request, MEDIA_CAPABILITIES);
  if (access.ok) return null;
  const status = access.reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json(
    { ok: false, message: status === 401 ? "Please sign in." : "You do not have access to conversations." },
    { status, headers: NO_STORE }
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  const refused = await staff(request);
  if (refused) return refused;
  const thread = new URL(request.url).searchParams.get("thread");
  const r = await suggestionFor(thread);
  return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
}

export async function POST(request: Request): Promise<NextResponse> {
  const refused = await staff(request);
  if (refused) return refused;
  const body = (await request.json().catch(() => null)) as { thread?: unknown; action?: unknown } | null;
  if (!body || body.action !== "resume") {
    return NextResponse.json({ ok: false, message: "Unknown request." }, { status: 400, headers: NO_STORE });
  }
  const r = await resumeSuggestions(body.thread);
  return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
}
