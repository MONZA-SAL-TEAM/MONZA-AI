import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { INSIGHTS_CAPS } from "@/lib/insights/access";
import { readInsightFeed } from "@/lib/insights/feed-server";

/**
 * GET /api/insights/feed?days=30|90|365|0 — the insights feed for the Monza S.A.L. app's Insight page
 * (lib/insights/feed-server.ts). The Monza app's SERVER calls it with the signed-in person's own CRM token as
 * `Authorization: Bearer …` — the same token MONZA AI verifies for its own pages — so the same people may see it
 * (owner, manage_team, view_reports, and whatever Team & access says) and the CRM's figures are read as them.
 * Counts and labels only; never a name, a number, a chat id or a customer's words.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, INSIGHTS_CAPS);
  if (!access.ok) return NextResponse.json({ ok: false, message: "Not available for your role." }, { status: access.reason === "unauthenticated" ? 401 : 403, headers: NO_STORE });
  const url = new URL(request.url);
  const raw = Number(url.searchParams.get("days") ?? 90);
  const days = [30, 90, 365, 0].includes(raw) ? raw : 90;
  const feed = await readInsightFeed(access.user, days, url.origin);
  if (!feed) return NextResponse.json({ ok: false, message: "MONZA AI's database could not be read just now — not an empty feed." }, { status: 503, headers: NO_STORE });
  return NextResponse.json({ ok: true, ...feed }, { headers: NO_STORE });
}
