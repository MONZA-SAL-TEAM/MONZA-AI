/**
 * Writing what the insights reader understood (lib/wasales/reader.ts) — SERVER ONLY.
 *
 * `recordSignal` runs at the webhook, for every channel, with the message's words in hand and only
 * labels written: the words are read in memory and dropped, exactly as lib/leads/store.ts reads a car
 * name. It reads the message IN ITS CONVERSATION — the reader's memory per conversation is kept in
 * `insight_reader_state` (labels only). Best effort, always: a failure here never fails a delivery
 * (rule 16).
 *
 * `rebuildWhatsApp` replays the STORED WhatsApp history (channel_messages keeps WhatsApp for 12 months;
 * Instagram and Facebook are never stored) conversation by conversation, resumable within a time
 * budget, idempotent on the message id.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { channelDb } from "@/lib/channels/store";
import { folderMedia, loadCatalog } from "@/lib/wasales/catalog";
import { freshState, parseState, type SearchEngineState } from "@/lib/wasales/context";
import type { EngineDeps } from "@/lib/wasales/engine";
import { MONZA_KNOWLEDGE } from "@/lib/wasales/knowledge";
import type { Observation } from "@/lib/wasales/observe";
import { READER_VERSION, readConversation, readNext, type ReadResult, type Turn } from "@/lib/wasales/reader";
import type { SignalMeta } from "@/lib/wasales/signal";
import { isPilotChat } from "@/lib/wasales/autoreply-pilot";
import { readAliasDecisions, withAliasDecisions } from "@/lib/insights/aliases-server";

/** Samer's test phones writing to try the bot: never counted as clients. */
function isTestChat(meta: { accountId: string; channel: string; peerExternalId?: string }): boolean {
  return Boolean(meta.peerExternalId) && isPilotChat({ accountId: meta.accountId, channel: meta.channel, peerExternalId: meta.peerExternalId ?? "" });
}

/**
 * The insights reader's deps: the catalogue with managers' alias decisions applied (026). Only the insights
 * reader uses this — the live bot reads the catalogue as it is.
 */
export async function insightDeps(): Promise<EngineDeps> {
  const base = deps();
  return { ...base, catalog: withAliasDecisions(base.catalog, await readAliasDecisions()) };
}

export function deps(): EngineDeps {
  return { knowledge: MONZA_KNOWLEDGE, catalog: loadCatalog(), media: folderMedia, ttlHours: 72 };
}

export type Source = "webhook" | "whatsapp_rebuild" | "meta_backfill";

function signalRow(r: ReadResult, source: Source) {
  const s = r.signal;
  return {
    account_id: s.accountId,
    brand: s.brand,
    channel: s.channel,
    conversation_id: s.conversationId,
    external_message_id: s.externalMessageId.slice(0, 200),
    at: s.at,
    language: s.language,
    intents: s.intents,
    models: s.models,
    weak_models: s.weakModels,
    colour: s.colour,
    has_media: s.hasMedia,
    alert_kind: s.alertKind,
    alert_tags: s.alertTags,
    offered: s.offered,
    silenced: s.silenced,
    reader_version: s.readerVersion,
    source,
    context_models: s.contextModels,
    needs: s.needs,
    owner_support: s.ownerSupport,
    ended: s.ended,
    ad_model: s.adModel,
  };
}

function observationRow(o: Observation, signalId: string, s: ReadResult["signal"]) {
  return {
    signal_id: signalId,
    conversation_id: s.conversationId,
    account_id: s.accountId,
    brand: s.brand,
    channel: s.channel,
    at: s.at,
    external_message_id: s.externalMessageId.slice(0, 200),
    kind: o.kind,
    stance: o.stance,
    model: o.model,
    binding: o.binding,
    part: o.part,
    value: o.value,
    detail: o.detail,
    amount_min: o.amountMin,
    amount_max: o.amountMax,
    currency: o.currency,
    amount_kind: o.amountKind,
    months: o.months,
    rule: o.rule,
    reader_version: READER_VERSION,
  };
}

/** Write a batch of read messages (one conversation): the signals, then all their facts at once. */
export async function writeResults(sb: SupabaseClient, results: readonly ReadResult[], source: Source): Promise<{ signals: number; observations: number } | null> {
  if (results.length === 0) return { signals: 0, observations: 0 };
  const { data, error } = await sb
    .from("sales_signals")
    .upsert(results.map((r) => signalRow(r, source)), { onConflict: "account_id,external_message_id" })
    .select("id, external_message_id");
  if (error || !Array.isArray(data)) {
    console.error(`[signals] not written (${(error as { code?: string } | null)?.code ?? "?"}) — are migrations 020/021 applied?`);
    return null;
  }
  const idOf = new Map((data as { id: string; external_message_id: string }[]).map((r) => [r.external_message_id, r.id]));
  const ids: string[] = [];
  const rows: ReturnType<typeof observationRow>[] = [];
  for (const r of results) {
    const id = idOf.get(r.signal.externalMessageId.slice(0, 200));
    if (!id) continue;
    ids.push(id);
    for (const o of r.observations) rows.push(observationRow(o, id, r.signal));
  }
  const { error: rpcError } = await sb.rpc("insight_replace_observations", { p_signal_ids: ids, p_rows: rows });
  if (rpcError) {
    console.error(`[signals] facts not written (${(rpcError as { code?: string }).code ?? "?"})`);
    return { signals: ids.length, observations: 0 };
  }
  return { signals: ids.length, observations: rows.length };
}

export async function loadState(sb: SupabaseClient, conversationId: string): Promise<{ state: SearchEngineState; lastAt: string | null; version: number }> {
  const { data } = await sb.from("insight_reader_state").select("state, last_at, reader_version").eq("conversation_id", conversationId).maybeSingle();
  const row = data as { state?: unknown; last_at?: string; reader_version?: number } | null;
  if (!row) return { state: freshState(), lastAt: null, version: READER_VERSION };
  return { state: parseState(row.state), lastAt: row.last_at ?? null, version: row.reader_version ?? 1 };
}

export async function saveState(sb: SupabaseClient, meta: { conversationId: string; accountId: string; brand: string }, state: SearchEngineState, lastAt: string, lastId: string | null): Promise<void> {
  await sb.from("insight_reader_state").upsert(
    { conversation_id: meta.conversationId, account_id: meta.accountId, brand: meta.brand, state, last_at: lastAt, last_external_message_id: lastId, reader_version: READER_VERSION, updated_at: new Date().toISOString() },
    { onConflict: "conversation_id" }
  );
}

/**
 * The headline of the ad a chat came from: its lead's FIRST touchpoint with a headline (recorded by the
 * webhook at arrival — Meta sends it once). An ad title, ours; never the customer's words. Null: no ad.
 */
export async function adHeadlineOf(sb: SupabaseClient, conversationId: string): Promise<string | null> {
  try {
    const { data: link } = await sb.from("lead_conversations").select("lead_id").eq("conversation_id", conversationId).maybeSingle();
    const leadId = (link as { lead_id?: string } | null)?.lead_id;
    if (!leadId) return null;
    const { data } = await sb.from("lead_touchpoints").select("headline").eq("lead_id", leadId).not("headline", "is", null).order("occurred_at", { ascending: true }).limit(1);
    const h = Array.isArray(data) && data.length ? (data[0] as { headline?: unknown }).headline : null;
    return typeof h === "string" && h.trim() ? h.slice(0, 200) : null;
  } catch {
    return null;
  }
}

/** Record one inbound message, read in its conversation. Never throws. */
export async function recordSignal(sb: SupabaseClient, text: string, meta: SignalMeta): Promise<boolean> {
  try {
    if (isTestChat(meta)) return false;
    const stored = await loadState(sb, meta.conversationId);
    const turn: Turn = { author: "customer", text, hasMedia: meta.hasMedia, at: meta.at, externalMessageId: meta.externalMessageId };
    const adHeadline = stored.state.adModel ? null : await adHeadlineOf(sb, meta.conversationId);
    const { result, state } = readNext(turn, stored.state, { ...meta, adHeadline }, await insightDeps());
    if (!result) return false;
    const written = await writeResults(sb, [result], "webhook");
    // A message older than what was already read (a redelivery) is recorded, but the memory moves only forward.
    if (!stored.lastAt || Date.parse(meta.at) >= Date.parse(stored.lastAt)) {
      await saveState(sb, meta, state, meta.at, meta.externalMessageId);
    }
    return written !== null;
  } catch (e) {
    console.error("[signals] failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

export interface RebuildOutcome {
  done: boolean;
  conversations: number;
  messages: number;
  signals: number;
  observations: number;
}

const RUN_ID = "wa:rebuild";

/**
 * Replay the stored WhatsApp conversations through the reader, in conversation order, from where the
 * last run stopped. `restart` starts again from the first conversation (after a reader change).
 */
export async function rebuildWhatsApp(budgetMs = 45_000, restart = false): Promise<RebuildOutcome | null> {
  const sb = channelDb();
  if (!sb) return null;
  const deadline = Date.now() + budgetMs;
  const d = await insightDeps();

  const { data: accounts } = await sb.from("channel_accounts").select("id, brand").eq("channel", "whatsapp");
  const waAccounts = Array.isArray(accounts) ? (accounts as { id: string; brand: string }[]) : [];
  if (waAccounts.length === 0) return { done: true, conversations: 0, messages: 0, signals: 0, observations: 0 };

  const { data: runRow } = await sb.from("insight_backfill_runs").select("cursor, state").eq("id", RUN_ID).maybeSingle();
  let cursor = restart ? null : ((runRow as { cursor?: string | null } | null)?.cursor ?? null);
  if (restart || !runRow) await sb.from("insight_backfill_runs").upsert({ id: RUN_ID, state: "running", cursor: null, started_at: new Date().toISOString(), updated_at: new Date().toISOString(), finished_at: null }, { onConflict: "id" });

  const out: RebuildOutcome = { done: false, conversations: 0, messages: 0, signals: 0, observations: 0 };
  while (Date.now() < deadline) {
    let q = sb.from("channel_conversations").select("id, account_id, brand, peer_external_id").in("account_id", waAccounts.map((a) => a.id)).order("id", { ascending: true }).limit(25);
    if (cursor) q = q.gt("id", cursor);
    const { data: convs, error } = await q;
    if (error) {
      console.error(`[signals] rebuild could not list conversations (${(error as { code?: string }).code ?? "?"})`);
      return null;
    }
    const list = Array.isArray(convs) ? (convs as { id: string; account_id: string; brand: string; peer_external_id: string }[]) : [];
    if (list.length === 0) {
      out.done = true;
      break;
    }
    for (const c of list) {
      if (Date.now() > deadline) break;
      cursor = c.id;
      if (isPilotChat({ accountId: c.account_id, channel: "whatsapp", peerExternalId: c.peer_external_id })) continue;
      const { data: msgs } = await sb
        .from("channel_messages")
        .select("direction, author, body, attachments, sent_at, external_message_id")
        .eq("conversation_id", c.id)
        .order("sent_at", { ascending: true })
        .limit(5000);
      const turns: Turn[] = (Array.isArray(msgs) ? (msgs as Record<string, unknown>[]) : [])
        .filter((m) => typeof m.sent_at === "string" && typeof m.external_message_id === "string")
        .map((m) => ({
          author: m.direction === "in" ? "customer" : m.author === "automation" ? "automation" : "staff",
          text: typeof m.body === "string" ? m.body : "",
          hasMedia: Array.isArray(m.attachments) && m.attachments.length > 0,
          at: m.sent_at as string,
          externalMessageId: m.external_message_id as string,
        }));
      const adHeadline = await adHeadlineOf(sb, c.id);
      const read = readConversation(turns, { accountId: c.account_id, brand: c.brand, channel: "whatsapp", conversationId: c.id, adHeadline }, d);
      const w = await writeResults(sb, read.results, "whatsapp_rebuild");
      if (w) {
        out.signals += w.signals;
        out.observations += w.observations;
      }
      if (read.lastAt) await saveState(sb, { conversationId: c.id, accountId: c.account_id, brand: c.brand }, read.state, read.lastAt, read.lastId);
      out.conversations++;
      out.messages += turns.length;
    }
    await sb.from("insight_backfill_runs").update({ cursor, updated_at: new Date().toISOString() }).eq("id", RUN_ID);
    if (list.length < 25) {
      out.done = true;
      break;
    }
  }
  if (out.done) await sb.from("insight_backfill_runs").update({ state: "done", cursor: null, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", RUN_ID);
  return out;
}
