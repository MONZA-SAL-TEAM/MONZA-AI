import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { INSIGHTS_CAPS } from "@/lib/insights/access";
import { actorOf, canManage } from "@/lib/leads/ownership-server";
import { findPeople, mergePeople, separateChat } from "@/lib/leads/identity-server";
import { refreshInsightPeople } from "@/lib/insights/people-server";

/**
 * Same person / not this person (lib/leads/identity-server.ts).
 *   GET  ?search=…                          people to merge with (owner and managers)
 *   POST { action: "merge", target, source } SOURCE's chats join TARGET (managers and the owner)
 *   POST { action: "split", conversation }   the chat becomes its own person (managers and the owner)
 * Every change is recorded with who and when; the per-person summaries are rebuilt afterwards.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, INSIGHTS_CAPS);
  if (!access.ok) return NextResponse.json({ ok: false }, { status: access.reason === "unauthenticated" ? 401 : 403 });
  const search = new URL(request.url).searchParams.get("search") ?? "";
  return NextResponse.json({ ok: true, people: await findPeople(search) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, INSIGHTS_CAPS);
  if (!access.ok) return NextResponse.json({ ok: false, message: "Not available for your role." }, { status: access.reason === "unauthenticated" ? 401 : 403 });
  const actor = await actorOf(access.user);
  if (!canManage(actor)) return NextResponse.json({ ok: false, message: "Only a manager or the owner can join or separate people." }, { status: 403 });
  const b = (await request.json().catch(() => null)) as { action?: unknown; target?: unknown; source?: unknown; conversation?: unknown } | null;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const r =
    b?.action === "merge" ? await mergePeople(str(b.target), str(b.source), actor) : b?.action === "split" ? await separateChat(str(b.conversation), actor) : ({ ok: false, status: 400, reason: "Unknown action." } as const);
  if (!r.ok) return NextResponse.json({ ok: false, message: r.reason }, { status: r.status });
  console.info(`[insights/identity] ${String(b?.action)} by ${actor.id}`);
  await refreshInsightPeople();
  return NextResponse.json({ ok: true, key: r.key }, { headers: { "Cache-Control": "no-store" } });
}
