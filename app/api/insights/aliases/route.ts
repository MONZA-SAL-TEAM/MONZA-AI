import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { INSIGHTS_CAPS } from "@/lib/insights/access";
import { channelDb } from "@/lib/channels/store";
import { actorOf, canManage } from "@/lib/leads/ownership-server";
import { aliasProblem, forgetAliasCache } from "@/lib/insights/aliases-server";

/**
 * POST /api/insights/aliases { alias, model, status: "approved" | "rejected" } — a manager decides whether a
 * word names a car, for the INSIGHTS reader only (never the live bot). Every decision is kept with who and
 * when (026). Re-read the history afterwards for past messages to follow.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, INSIGHTS_CAPS);
  if (!access.ok) return NextResponse.json({ ok: false, message: "Not available for your role." }, { status: access.reason === "unauthenticated" ? 401 : 403 });
  const actor = await actorOf(access.user);
  if (!canManage(actor)) return NextResponse.json({ ok: false, message: "Only a manager or the owner can approve words." }, { status: 403 });
  const b = (await request.json().catch(() => null)) as { alias?: unknown; model?: unknown; status?: unknown } | null;
  const alias = typeof b?.alias === "string" ? b.alias.trim() : "";
  const model = typeof b?.model === "string" ? b.model : "";
  const status = b?.status === "approved" || b?.status === "rejected" ? b.status : null;
  const problem = status ? aliasProblem(alias, model) : "Approve or reject.";
  if (problem) return NextResponse.json({ ok: false, message: problem }, { status: 400 });
  const sb = channelDb();
  if (!sb) return NextResponse.json({ ok: false, message: "The database is not reachable here." }, { status: 503 });
  const { error } = await sb.from("insight_aliases").insert({ alias, model, status, by_staff: actor.id, by_name: actor.name });
  if (error) return NextResponse.json({ ok: false, message: "The word could not be saved." }, { status: 503 });
  forgetAliasCache();
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
