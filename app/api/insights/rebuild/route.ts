import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { rebuildSignals } from "@/lib/wasales/signal-server";

/**
 * "Rebuild from history": read the stored WhatsApp messages of the past year through the engine and
 * record their labels (never their words) so the insights cover the past, not only from today.
 * Staff only. Idempotent: run it twice and nothing doubles.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request);
  if (!access.ok) return NextResponse.json({ ok: false, message: "Please sign in." }, { status: access.reason === "unauthenticated" ? 401 : 403 });
  const r = await rebuildSignals(365, 50_000);
  if (!r) return NextResponse.json({ ok: false, message: "The database is not reachable here." }, { status: 503 });
  return NextResponse.json({ ok: true, ...r, message: `Read ${r.read} messages, recorded ${r.written}, skipped ${r.skipped}.` }, { headers: { "Cache-Control": "no-store" } });
}
