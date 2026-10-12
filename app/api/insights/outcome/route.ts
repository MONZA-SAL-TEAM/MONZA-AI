import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { INSIGHTS_CAPS } from "@/lib/insights/access";
import { channelDb } from "@/lib/channels/store";
import { actorOf } from "@/lib/leads/ownership-server";
import { parsePersonKey } from "@/lib/insights/profile";
import { isLostReason } from "@/lib/insights/outcomes";

/**
 * POST /api/insights/outcome { person, reason } — a person records why a lead was lost (or "cleared" to
 * withdraw it). Append-only (026): every record is kept with who and when; the newest wins. The reason is
 * from a closed list; no free text. Owner and managers.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, INSIGHTS_CAPS);
  if (!access.ok) return NextResponse.json({ ok: false, message: "Not available for your role." }, { status: access.reason === "unauthenticated" ? 401 : 403 });
  const b = (await request.json().catch(() => null)) as { person?: unknown; reason?: unknown } | null;
  const person = typeof b?.person === "string" && parsePersonKey(b.person) ? b.person : null;
  if (!person || !isLostReason(b?.reason)) return NextResponse.json({ ok: false, message: "Choose a reason from the list." }, { status: 400 });
  const sb = channelDb();
  if (!sb) return NextResponse.json({ ok: false, message: "The database is not reachable here." }, { status: 503 });
  const actor = await actorOf(access.user);
  const { error } = await sb.from("insight_lead_outcomes").insert({ person_key: person, reason: b!.reason as string, by_staff: actor.id, by_name: actor.name });
  if (error) return NextResponse.json({ ok: false, message: "The reason could not be saved." }, { status: 503 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
