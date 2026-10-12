import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { canSell } from "@/lib/leads/ownership";
import { actorOf, assignableStaff, canManage, changeOwner, conversationForThread, readOwner } from "@/lib/leads/ownership-server";

/**
 * Who owns this lead (Samer, 2026-10-12: "Take this lead").
 *
 *   GET  ?thread=<inbox thread id>   the owner, and what the signed-in person may do; managers also get
 *                                    the staff they can assign to (from the CRM, read as them)
 *   POST { thread, action: "take" | "release" | "assign", to?: { id, name } }
 *
 * The rules are lib/leads/ownership.ts; the change is one race-safe UPDATE (409 names who won).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request);
  if (!access.ok) return NextResponse.json({ ok: false }, { status: access.reason === "unauthenticated" ? 401 : 403 });
  const thread = new URL(request.url).searchParams.get("thread");
  const actor = await actorOf(access.user);
  const conv = await conversationForThread(thread, false);
  const state = conv ? await readOwner(conv.id) : { owner: null, at: null };
  const owner = state?.owner ?? null;
  const manager = canManage(actor);
  return NextResponse.json(
    {
      ok: true,
      owner,
      since: state?.at ?? null,
      me: { id: actor.id, name: actor.name },
      canTake: canSell(actor) && !owner,
      canRelease: Boolean(owner) && (owner?.id === actor.id || manager),
      canAssign: manager,
      staff: manager ? await assignableStaff(access.user) : [],
    },
    { headers: NO_STORE }
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request);
  if (!access.ok) return NextResponse.json({ ok: false, message: "Sign in again." }, { status: access.reason === "unauthenticated" ? 401 : 403 });
  const body = (await request.json().catch(() => null)) as { thread?: unknown; action?: unknown; to?: { id?: unknown; name?: unknown } | null } | null;
  const action = body?.action;
  if (action !== "take" && action !== "release" && action !== "assign") return NextResponse.json({ ok: false, message: "Unknown action." }, { status: 400 });
  const actor = await actorOf(access.user);
  let target = null;
  if (action === "assign") {
    // The name shown is the CRM's, never the browser's: the person must be on the assignable list.
    const id = typeof body?.to?.id === "string" ? body.to.id : "";
    const staff = await assignableStaff(access.user);
    target = staff.find((s) => s.id === id) ?? null;
    if (!target) return NextResponse.json({ ok: false, message: "That person cannot be assigned leads." }, { status: 400 });
  }
  const r = await changeOwner(body?.thread, actor, action, target);
  if (!r.ok) return NextResponse.json({ ok: false, message: r.reason, owner: "owner" in r ? (r.owner ?? null) : null }, { status: r.status, headers: NO_STORE });
  console.info(`[leads/owner] ${action} by ${actor.id}${r.changed ? "" : " (no change)"}`);
  return NextResponse.json({ ok: true, owner: r.next }, { headers: NO_STORE });
}
