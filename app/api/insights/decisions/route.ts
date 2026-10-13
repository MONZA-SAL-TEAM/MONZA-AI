import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { INSIGHTS_CAPS } from "@/lib/insights/access";
import { actOnDecision, type DecisionAction } from "@/lib/insights/decisions-server";
import { actorOf, assignableStaff, canManage, changeOwner } from "@/lib/leads/ownership-server";
import { channelDb } from "@/lib/channels/store";
import { encodeThreadId } from "@/lib/channels/live-map";

/**
 * POST /api/insights/decisions { id, action, to? } — a person acting on a Decision Center item: assign,
 * acknowledge, escalate, resolve, dismiss or reopen. Owner and managers (the Insights roles). Every change is
 * recorded with who and when (insight_decision_events).
 *
 * Assigning a CUSTOMER's item to a salesperson also makes them the lead's owner (the inbox's "My leads"),
 * through the same race-safe change as "Take this lead" — when the person assigning may assign leads
 * (manage_team or the owner). The assignee must be on the CRM's assignable list: the browser names no one.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ACTIONS: readonly DecisionAction[] = ["assign", "acknowledge", "escalate", "resolve", "dismiss", "reopen"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, INSIGHTS_CAPS);
  if (!access.ok) return NextResponse.json({ ok: false, message: "Not available for your role." }, { status: access.reason === "unauthenticated" ? 401 : 403 });
  const body = (await request.json().catch(() => null)) as { id?: unknown; action?: unknown; to?: unknown } | null;
  const id = typeof body?.id === "string" && UUID.test(body.id) ? body.id : null;
  const action = ACTIONS.find((a) => a === body?.action) ?? null;
  if (!id || !action) return NextResponse.json({ ok: false, message: "Unknown item or action." }, { status: 400 });
  const actor = await actorOf(access.user);

  let target: { id: string; name: string | null } | null = null;
  if (action === "assign") {
    const wanted = typeof body?.to === "string" ? body.to : "";
    target = (await assignableStaff(access.user)).find((s) => s.id === wanted) ?? null;
    if (!target) return NextResponse.json({ ok: false, message: "That person cannot be assigned." }, { status: 400 });
  }
  const r = await actOnDecision(id, action, { id: actor.id, name: actor.name }, target);
  if (!r.ok) return NextResponse.json({ ok: false, message: r.reason }, { status: r.status });

  let lead: string | null = null;
  if (action === "assign" && target && r.item.conversationId) {
    if (!canManage(actor)) lead = "The item is assigned; only a sales manager or the owner can also make them the lead's owner.";
    else {
      const sb = channelDb();
      const { data } = sb ? await sb.from("channel_conversations").select("account_id, meta_conversation_id").eq("id", r.item.conversationId).maybeSingle() : { data: null };
      const c = data as { account_id: string; meta_conversation_id: string | null } | null;
      const { data: acc } = sb && c ? await sb.from("channel_accounts").select("channel").eq("id", c.account_id).maybeSingle() : { data: null };
      const channel = (acc as { channel?: string } | null)?.channel ?? null;
      const thread = c ? (channel === "whatsapp" ? encodeThreadId(c.account_id, r.item.conversationId) : c.meta_conversation_id ? encodeThreadId(c.account_id, c.meta_conversation_id) : null) : null;
      if (thread) {
        const o = await changeOwner(thread, actor, "assign", target);
        lead = o.ok ? `${target.name ?? "They"} now own${target.name ? "s" : ""} the lead.` : `The item is assigned; the lead's owner was not changed (${o.reason}).`;
      }
    }
  }
  return NextResponse.json({ ok: true, item: r.item, lead }, { headers: { "Cache-Control": "no-store" } });
}
