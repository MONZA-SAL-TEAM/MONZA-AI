/**
 * Lead ownership — SERVER ONLY. The rules are pure in lib/leads/ownership.ts.
 *
 * An inbox thread names a conversation; ownership lives on OUR conversation row (channel_conversations).
 * WhatsApp threads ARE our rows. An Instagram / Facebook thread is found by Meta's thread id, or — the
 * first time — by asking Meta who the customer is and making the row (ensureConversation), never from the
 * browser's say-so. Every change is ONE conditional UPDATE (race-safe: two people pressing "Take" at once
 * → one wins, the other is told who) and one history row.
 */

import { crmEnv, makeUserClient } from "@/lib/connectors/crm";
import type { StaffIdentity } from "@/lib/connectors/types";
import { decodeThreadId, encodeThreadId } from "@/lib/channels/live-map";
import { threadPeerId } from "@/lib/channels/live";
import { channelDb, ensureConversation, listAccounts } from "@/lib/channels/store";
import { ownershipCapabilities } from "@/lib/access/access";
import { accessDb } from "@/lib/access/access-server";
import { canManage, ownershipDecision, type Actor, type Owner, type OwnerAction, type OwnershipDecision } from "@/lib/leads/ownership";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ConversationRef {
  id: string;
  accountId: string;
}

/** Our conversation row for an inbox thread, or null. `create` lets an Instagram/Facebook thread get one. */
export async function conversationForThread(threadId: unknown, create: boolean): Promise<ConversationRef | null> {
  const ids = decodeThreadId(threadId);
  const sb = channelDb();
  if (!ids || !sb) return null;
  const account = (await listAccounts()).find((a) => a.id === ids.accountId);
  if (!account) return null;
  if (account.channel === "whatsapp") {
    if (!UUID.test(ids.metaConversationId)) return null;
    const { data } = await sb.from("channel_conversations").select("id").eq("id", ids.metaConversationId).eq("account_id", account.id).maybeSingle();
    return data ? { id: (data as { id: string }).id, accountId: account.id } : null;
  }
  const { data } = await sb.from("channel_conversations").select("id").eq("account_id", account.id).eq("meta_conversation_id", ids.metaConversationId).maybeSingle();
  if (data) return { id: (data as { id: string }).id, accountId: account.id };
  if (!create) return null;
  const peer = await threadPeerId(threadId);
  if (!peer) return null;
  const id = await ensureConversation(account.id, peer, ids.metaConversationId);
  return id ? { id, accountId: account.id } : null;
}

export async function readOwner(conversationId: string): Promise<{ owner: Owner | null; at: string | null } | null> {
  const sb = channelDb();
  if (!sb) return null;
  const { data, error } = await sb.from("channel_conversations").select("assigned_to, assigned_name, assigned_at").eq("id", conversationId).maybeSingle();
  if (error || !data) return null;
  const row = data as { assigned_to: string | null; assigned_name: string | null; assigned_at: string | null };
  return { owner: row.assigned_to ? { id: row.assigned_to, name: row.assigned_name } : null, at: row.assigned_at };
}

/** The signed-in person as an actor: their name from the CRM's staff list, read as themselves. */
export async function actorOf(user: StaffIdentity): Promise<Actor> {
  let name = user.email?.split("@")[0] || "Staff";
  if (crmEnv() && user.crmAccessToken !== "demo") {
    try {
      const db = makeUserClient({ user, conversationId: null, turnId: "lead-owner" });
      const { data } = await db.from("profiles").select("full_name").eq("id", user.userId).maybeSingle();
      const full = (data as { full_name?: string | null } | null)?.full_name?.trim();
      if (full) name = full;
    } catch {
      // The email's name is enough to show who it was.
    }
  }
  // Someone whose MONZA AI access is set (Team & access): "take" and "assign" are what Samer ticked.
  if (user.access?.admin) return { id: user.userId, name: name.slice(0, 120), appRole: "owner", capabilities: user.capabilities };
  if (user.access?.restricted) return { id: user.userId, name: name.slice(0, 120), appRole: null, capabilities: ownershipCapabilities(user.access) };
  return { id: user.userId, name: name.slice(0, 120), appRole: user.appRole, capabilities: user.capabilities };
}

export type OwnerChange = OwnershipDecision | { ok: false; status: 404 | 503; reason: string };

/** Take, release or assign — one conditional UPDATE, then the history row. */
export async function changeOwner(threadId: unknown, actor: Actor, action: OwnerAction, target: Owner | null): Promise<OwnerChange & { conversationId?: string }> {
  const sb = channelDb();
  if (!sb) return { ok: false, status: 503, reason: "The database is not reachable here." };
  const conv = await conversationForThread(threadId, action !== "release");
  if (!conv) return { ok: false, status: 404, reason: "This conversation could not be found." };
  const before = await readOwner(conv.id);
  if (!before) return { ok: false, status: 503, reason: "The owner could not be read just now." };
  const decision = ownershipDecision(actor, before.owner, action, target);
  if (!decision.ok || !decision.changed) return { ...decision, conversationId: conv.id };

  const next = decision.next;
  const patch = next
    ? { assigned_to: next.id, assigned_name: next.name, assigned_at: new Date().toISOString(), assigned_by: actor.id }
    : { assigned_to: null, assigned_name: null, assigned_at: null, assigned_by: actor.id };
  let q = sb.from("channel_conversations").update(patch).eq("id", conv.id);
  // Only if nobody changed it since we looked: otherwise the loser is told who owns it now.
  q = before.owner ? q.eq("assigned_to", before.owner.id) : q.is("assigned_to", null);
  const { data, error } = await q.select("id");
  if (error) return { ok: false, status: 503, reason: "The owner could not be saved just now." };
  if (!Array.isArray(data) || data.length === 0) {
    const now = await readOwner(conv.id);
    return { ok: false, status: 409, reason: `${now?.owner?.name ?? "Someone"} changed the owner a moment ago.`, owner: now?.owner ?? null };
  }
  await sb.from("conversation_owner_events").insert({
    conversation_id: conv.id,
    account_id: conv.accountId,
    action,
    from_staff: before.owner?.id ?? null,
    from_name: before.owner?.name ?? null,
    to_staff: next?.id ?? null,
    to_name: next?.name ?? null,
    by_staff: actor.id,
    by_name: actor.name,
  });
  return { ...decision, conversationId: conv.id };
}

/** Every owned conversation, keyed by the inbox's thread id. Owned leads are few; unowned are everything else. */
export async function listOwners(): Promise<Record<string, Owner> | null> {
  const sb = channelDb();
  if (!sb) return null;
  const [{ data, error }, accounts] = await Promise.all([
    sb.from("channel_conversations").select("id, account_id, assigned_to, assigned_name, meta_conversation_id").not("assigned_to", "is", null).limit(5000),
    listAccounts(),
  ]);
  if (error) return null;
  const channelOf = new Map(accounts.map((a) => [a.id, a.channel]));
  const out: Record<string, Owner> = {};
  for (const r of (data ?? []) as { id: string; account_id: string; assigned_to: string; assigned_name: string | null; meta_conversation_id: string | null }[]) {
    const thread = channelOf.get(r.account_id) === "whatsapp" ? encodeThreadId(r.account_id, r.id) : r.meta_conversation_id ? encodeThreadId(r.account_id, r.meta_conversation_id) : null;
    if (thread) out[thread] = { id: r.assigned_to, name: r.assigned_name };
  }
  return out;
}

/** Who a manager can assign to: active staff who sell or manage, from the CRM, read as the manager. */
export async function assignableStaff(viewer: StaffIdentity): Promise<Owner[]> {
  if (!crmEnv() || viewer.crmAccessToken === "demo") return [];
  try {
    const db = makeUserClient({ user: viewer, conversationId: null, turnId: "lead-owner-staff" });
    const { data } = await db.from("profiles").select("id, full_name, email, user_role, capabilities, is_active").eq("is_active", true).limit(500);
    // Team & access (lib/access) decides for anyone whose MONZA AI access is set: admins and people allowed to
    // take or assign leads are on the list; blocked people and people with no lead action are not.
    const sb = accessDb();
    const set = new Map(
      ((sb ? (await sb.from("staff_access").select("user_id, is_admin, blocked, actions")).data : null) ?? []).map((r: { user_id: string; is_admin: boolean; blocked: boolean; actions: string[] | null }) => [r.user_id, r])
    );
    return ((data ?? []) as { id: string; full_name: string | null; email: string | null; user_role: string | null; capabilities: unknown }[])
      .filter((p) => {
        const a = set.get(p.id);
        if (a) return a.is_admin || (!a.blocked && (a.actions ?? []).some((x) => x === "take_leads" || x === "assign_leads"));
        return p.user_role === "owner" || (Array.isArray(p.capabilities) && (p.capabilities.includes("sales") || p.capabilities.includes("manage_team")));
      })
      .map((p) => ({ id: p.id, name: (p.full_name?.trim() || p.email?.split("@")[0] || "Staff").slice(0, 120) }))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  } catch {
    return [];
  }
}

export { canManage };
