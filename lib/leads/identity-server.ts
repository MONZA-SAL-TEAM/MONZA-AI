/**
 * Merging and separating people by hand — SERVER ONLY (Samer, 2026-10-12: "Merge verified identities /
 * Separate incorrectly merged identities").
 *
 * Who a chat belongs to is lead_conversations (005; one lead per chat). A person deciding "these chats are
 * the same person" links them with method `human_confirmed` — the only method besides an exact mobile match
 * allowed to link (a name never links by itself; here a PERSON is accountable, and every change is recorded
 * in insight_identity_events with who and when). "Not this person" moves the chat to a NEW lead of its own,
 * with no phone, so the webhook's phone match (lib/leads/store.ts openLead) cannot quietly re-attach it.
 */

import { channelDb } from "@/lib/channels/store";
import { parsePersonKey } from "@/lib/insights/profile";
import type { Actor } from "@/lib/leads/ownership";

export type IdentityResult = { ok: true; key: string } | { ok: false; status: 400 | 404 | 503; reason: string };

async function chatsOf(key: string): Promise<{ leadId: string | null; convs: string[] } | null> {
  const sb = channelDb();
  const k = parsePersonKey(key);
  if (!sb || !k) return null;
  if (k.kind === "lead") {
    const { data } = await sb.from("lead_conversations").select("conversation_id").eq("lead_id", k.id);
    return { leadId: k.id, convs: ((data ?? []) as { conversation_id: string }[]).map((r) => r.conversation_id) };
  }
  const { data } = await sb.from("lead_conversations").select("lead_id").eq("conversation_id", k.id).maybeSingle();
  return { leadId: (data as { lead_id?: string } | null)?.lead_id ?? null, convs: [k.id] };
}

/** Make SOURCE the same person as TARGET: every chat of SOURCE joins TARGET's lead. */
export async function mergePeople(targetKey: string, sourceKey: string, actor: Actor): Promise<IdentityResult> {
  const sb = channelDb();
  if (!sb) return { ok: false, status: 503, reason: "The database is not reachable here." };
  if (targetKey === sourceKey) return { ok: false, status: 400, reason: "That is the same person." };
  const [target, source] = await Promise.all([chatsOf(targetKey), chatsOf(sourceKey)]);
  if (!target || !source || target.convs.length === 0 || source.convs.length === 0) return { ok: false, status: 404, reason: "One of the two people was not found." };

  // The target needs a lead to gather the chats under; a lone chat gets one now, named as the chat is.
  let leadId = target.leadId;
  if (!leadId) {
    const { data: conv } = await sb.from("channel_conversations").select("peer_display").eq("id", target.convs[0]).maybeSingle();
    const { data, error } = await sb.from("leads").insert({ display_name: (conv as { peer_display?: string | null } | null)?.peer_display ?? null, phone: null }).select("id").single();
    if (error || !data) return { ok: false, status: 503, reason: "The person could not be created." };
    leadId = (data as { id: string }).id;
    const link = await sb.from("lead_conversations").upsert({ conversation_id: target.convs[0], lead_id: leadId, method: "human_confirmed", confidence: 1, confirmed_by: actor.id, confirmed_at: new Date().toISOString() }, { onConflict: "conversation_id" });
    if (link.error) return { ok: false, status: 503, reason: "The person could not be linked." };
  }
  const now = new Date().toISOString();
  for (const conv of source.convs) {
    const { error } = await sb.from("lead_conversations").upsert({ conversation_id: conv, lead_id: leadId, method: "human_confirmed", confidence: 1, confirmed_by: actor.id, confirmed_at: now }, { onConflict: "conversation_id" });
    if (error) return { ok: false, status: 503, reason: "A chat could not be moved." };
    await sb.from("insight_identity_events").insert({ action: "merge", conversation_id: conv, from_lead: source.leadId, to_lead: leadId, by_staff: actor.id, by_name: actor.name });
  }
  return { ok: true, key: `lead:${leadId}` };
}

/** "Not this person": the chat leaves its lead for a new lead of its own (no phone). */
export async function separateChat(conversationId: string, actor: Actor): Promise<IdentityResult> {
  const sb = channelDb();
  if (!sb) return { ok: false, status: 503, reason: "The database is not reachable here." };
  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return { ok: false, status: 400, reason: "Unknown chat." };
  const { data: link } = await sb.from("lead_conversations").select("lead_id").eq("conversation_id", conversationId).maybeSingle();
  const fromLead = (link as { lead_id?: string } | null)?.lead_id ?? null;
  if (!fromLead) return { ok: false, status: 400, reason: "This chat is not joined to anyone." };
  const { data: conv } = await sb.from("channel_conversations").select("peer_display").eq("id", conversationId).maybeSingle();
  const { data, error } = await sb.from("leads").insert({ display_name: (conv as { peer_display?: string | null } | null)?.peer_display ?? null, phone: null }).select("id").single();
  if (error || !data) return { ok: false, status: 503, reason: "The chat could not be separated." };
  const leadId = (data as { id: string }).id;
  const moved = await sb.from("lead_conversations").upsert({ conversation_id: conversationId, lead_id: leadId, method: "human_confirmed", confidence: 1, confirmed_by: actor.id, confirmed_at: new Date().toISOString() }, { onConflict: "conversation_id" });
  if (moved.error) return { ok: false, status: 503, reason: "The chat could not be separated." };
  await sb.from("insight_identity_events").insert({ action: "split", conversation_id: conversationId, from_lead: fromLead, to_lead: leadId, by_staff: actor.id, by_name: actor.name });
  return { ok: true, key: `lead:${leadId}` };
}

/** People to merge with: a name or number search over MONZA AI's own leads and chats (staff decide). */
export async function findPeople(search: string): Promise<{ key: string; name: string; detail: string }[]> {
  const sb = channelDb();
  const q = search.trim().replace(/[%_,()]/g, " ").slice(0, 40);
  if (!sb || q.length < 2) return [];
  const digits = q.replace(/\D/g, "");
  const [leads, convs] = await Promise.all([
    sb.from("leads").select("id, display_name, phone").or(`display_name.ilike.%${q}%${digits.length >= 4 ? `,phone.ilike.%${digits}%` : ""}`).limit(15),
    sb.from("channel_conversations").select("id, peer_display, peer_external_id, account_id").or(`peer_display.ilike.%${q}%${digits.length >= 4 ? `,peer_external_id.ilike.%${digits}%` : ""}`).limit(15),
  ]);
  const out: { key: string; name: string; detail: string }[] = [];
  for (const l of (leads.data ?? []) as { id: string; display_name: string | null; phone: string | null }[]) out.push({ key: `lead:${l.id}`, name: l.display_name ?? "Customer", detail: l.phone ? `+${l.phone.replace(/\D/g, "")}` : "lead" });
  const convIds = ((convs.data ?? []) as { id: string }[]).map((c) => c.id);
  const linked = convIds.length ? await sb.from("lead_conversations").select("conversation_id, lead_id").in("conversation_id", convIds) : { data: [] };
  const leadOf = new Map(((linked.data ?? []) as { conversation_id: string; lead_id: string }[]).map((r) => [r.conversation_id, r.lead_id]));
  for (const c of (convs.data ?? []) as { id: string; peer_display: string | null; account_id: string }[]) {
    const key = leadOf.has(c.id) ? `lead:${leadOf.get(c.id)}` : `chat:${c.id}`;
    if (!out.some((o) => o.key === key)) out.push({ key, name: c.peer_display ?? "Customer", detail: c.account_id });
  }
  return out.slice(0, 20);
}
