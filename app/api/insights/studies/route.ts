import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { INSIGHTS_CAPS } from "@/lib/insights/access";
import { channelDb } from "@/lib/channels/store";
import { actorOf, canManage } from "@/lib/leads/ownership-server";
import { normalizeStudyQuery } from "@/lib/insights/studies";

/**
 * The Research Lab's saved studies (migration 024): a NAME and a QUESTION (the Lab's URL query) — never
 * results, so re-running one always uses today's data. Owner and managers only.
 *   GET                 every saved study
 *   POST { name, query } save one
 *   DELETE ?id=         delete one (its author, or a manager)
 */
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, INSIGHTS_CAPS);
  if (!access.ok) return NextResponse.json({ ok: false }, { status: access.reason === "unauthenticated" ? 401 : 403 });
  const sb = channelDb();
  if (!sb) return NextResponse.json({ ok: false, message: "The database is not reachable here." }, { status: 503 });
  const { data, error } = await sb.from("insight_saved_queries").select("id, name, query, created_by, created_by_name, created_at").order("created_at", { ascending: false }).limit(200);
  if (error) return NextResponse.json({ ok: false, message: "Saved studies could not be read." }, { status: 503 });
  return NextResponse.json({ ok: true, studies: data ?? [] }, { headers: NO_STORE });
}

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, INSIGHTS_CAPS);
  if (!access.ok) return NextResponse.json({ ok: false, message: "Not available for your role." }, { status: access.reason === "unauthenticated" ? 401 : 403 });
  const body = (await request.json().catch(() => null)) as { name?: unknown; query?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim().replace(/[<>]/g, "").slice(0, 80) : "";
  const query = normalizeStudyQuery(typeof body?.query === "string" ? body.query : "");
  if (!name) return NextResponse.json({ ok: false, message: "Give the study a name." }, { status: 400 });
  const sb = channelDb();
  if (!sb) return NextResponse.json({ ok: false, message: "The database is not reachable here." }, { status: 503 });
  const actor = await actorOf(access.user);
  const { data, error } = await sb.from("insight_saved_queries").insert({ name, query, created_by: actor.id, created_by_name: actor.name }).select("id").single();
  if (error) return NextResponse.json({ ok: false, message: "The study could not be saved." }, { status: 503 });
  return NextResponse.json({ ok: true, id: (data as { id: string }).id }, { headers: NO_STORE });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, INSIGHTS_CAPS);
  if (!access.ok) return NextResponse.json({ ok: false, message: "Not available for your role." }, { status: access.reason === "unauthenticated" ? 401 : 403 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, message: "Unknown study." }, { status: 400 });
  const sb = channelDb();
  if (!sb) return NextResponse.json({ ok: false, message: "The database is not reachable here." }, { status: 503 });
  const actor = await actorOf(access.user);
  let q = sb.from("insight_saved_queries").delete().eq("id", id);
  if (!canManage(actor)) q = q.eq("created_by", actor.id);
  const { error } = await q;
  if (error) return NextResponse.json({ ok: false, message: "The study could not be deleted." }, { status: 503 });
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
