import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { INSIGHTS_CAPS } from "@/lib/insights/access";
import { refreshInsightPeople } from "@/lib/insights/people-server";

/**
 * POST /api/insights/people — rebuild the per-person summaries (insight_people) from the labels now. Also
 * done nightly and after a history read. Owner and managers only. Labels only: no name, no phone.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, INSIGHTS_CAPS);
  if (!access.ok) return NextResponse.json({ ok: false, message: "Not available for your role." }, { status: access.reason === "unauthenticated" ? 401 : 403 });
  const r = await refreshInsightPeople();
  if (!r) return NextResponse.json({ ok: false, message: "The summaries could not be rebuilt just now." }, { status: 503 });
  return NextResponse.json({ ok: true, ...r }, { headers: { "Cache-Control": "no-store" } });
}
