import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { INSIGHTS_CAPS } from "@/lib/insights/access";
import { metaAccountIds, runMetaBackfill } from "@/lib/insights/meta-backfill";
import { refreshInsightPeople } from "@/lib/insights/people-server";

/**
 * POST /api/insights/backfill?account=<id>[&dry=1][&restart=1] — read one Instagram or Facebook account's
 * past conversations from Meta for LABELS (lib/insights/meta-backfill.ts). One call reads for ~35 s and
 * says where it stopped; the Insights page calls again until it is done or blocked. `dry=1` only counts
 * (threads, messages, already recorded) and writes nothing. Owner and managers only. Read-only on Meta.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, INSIGHTS_CAPS);
  if (!access.ok) return NextResponse.json({ ok: false, message: "Not available for your role." }, { status: access.reason === "unauthenticated" ? 401 : 403 });
  const q = new URL(request.url).searchParams;
  const accountId = q.get("account") ?? "";
  // The account must be one of OURS: the browser cannot name anything else.
  if (!(await metaAccountIds()).includes(accountId)) return NextResponse.json({ ok: false, message: "That account is not an Instagram or Facebook account here." }, { status: 400 });
  const r = await runMetaBackfill({ accountId, mode: "backfill", dry: q.get("dry") === "1", restart: q.get("restart") === "1", budgetMs: 35_000 });
  if (!r) return NextResponse.json({ ok: false, message: "The database is not reachable here." }, { status: 503 });
  if (r.state === "done" && !r.dry) await refreshInsightPeople();
  return NextResponse.json({ ok: true, ...r }, { headers: { "Cache-Control": "no-store" } });
}
