import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { INSIGHTS_CAPS } from "@/lib/insights/access";
import { storeDemand } from "@/lib/insights/demand-server";

/**
 * POST /api/insights/demand[?scope=all] — store the anonymous demand record now (027): daily and monthly
 * counts per car, colour, question and more, with no client data. Also done nightly for recent months.
 * Owner and managers.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, INSIGHTS_CAPS);
  if (!access.ok) return NextResponse.json({ ok: false, message: "Not available for your role." }, { status: access.reason === "unauthenticated" ? 401 : 403 });
  const scope = new URL(request.url).searchParams.get("scope") === "all" ? "all" : "recent";
  const r = await storeDemand(scope);
  if (!r) return NextResponse.json({ ok: false, message: "The demand record could not be stored just now." }, { status: 503 });
  if ("skipped" in r) return NextResponse.json({ ok: false, message: "The WhatsApp history is still being read again; the record is stored by itself when that finishes." }, { status: 409 });
  return NextResponse.json({ ok: true, ...r }, { headers: { "Cache-Control": "no-store" } });
}
