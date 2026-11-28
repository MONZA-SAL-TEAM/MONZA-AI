/**
 * Quote capture: the price and payment terms the TEAM sent on WhatsApp, kept as numbers
 * (migration 036, lib/wasales/quote.ts).
 *
 * WHEN it runs:
 *   - the moment a reply is sent from MONZA AI or arrives as the phone app's echo (best effort, one
 *     message), and the moment a message is edited or deleted in the WhatsApp Business app;
 *   - every night from /api/insights/refresh, as the net: everything since its cursor, plus every
 *     message edited or deleted in the last days.
 *
 * ONE meaning of "this message's quote" (`reconcile`): the message's rows are replaced whole. An
 * edit leaves the new figures and none of the old; a deletion, or an edit that removes the price,
 * leaves none. (A customer's own edit window in WhatsApp is 15 minutes: the old figures were a slip,
 * not an earlier offer, so they are not kept as history.)
 *
 * - Reads only messages the team wrote; the body is read in memory and dropped. Numbers only.
 * - The car: the one the message names; else the one car the customer was on just before it; else
 *   none. A message pricing several cars is split per car; if one LINE names two, it is skipped.
 * - The pilot's test phones are never clients.
 * - Any failure returns null and changes nothing: the table may not exist yet.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { channelDb } from "@/lib/channels/store";
import { isPilotChat } from "@/lib/wasales/autoreply-pilot";
import type { EngineDeps } from "@/lib/wasales/engine";
import { mayHoldQuote, readQuote, splitByCar, type Quote } from "@/lib/wasales/quote";
import { staffCars } from "@/lib/wasales/reader";
import { insightDeps } from "@/lib/wasales/signal-server";

const RUN_ID = "wa:quotes";
const PAGE = 300;
/** How far back the nightly net looks for edited and deleted messages. */
const REVISION_DAYS = 8;

export interface QuoteRow {
  conversation_id: string;
  account_id: string;
  brand: string;
  external_message_id: string;
  option_no: number;
  at: string;
  kind: Quote["kind"];
  model: string | null;
  model_binding: "message" | "conversation" | null;
  total_min: number | null;
  total_max: number | null;
  list_price: number | null;
  down_payment: number | null;
  monthly: number | null;
  months: number | null;
  confidence: "high" | "low";
}

export interface QuoteMessage {
  conversationId: string;
  accountId: string;
  brand: string;
  externalMessageId: string;
  at: string;
  text: string;
}

/**
 * Pure: one message's quotes as rows — one per payment option, per car. `carsOf` names the cars a
 * piece of text plainly names; `discussed` is the car the customer was on, used only when the
 * message names none. Empty = keep nothing for this message.
 */
export function quoteRows(m: QuoteMessage, carsOf: (text: string) => readonly string[], discussed: string | null): QuoteRow[] {
  const blocks = splitByCar(m.text, carsOf);
  if (!blocks) return [];
  const rows: QuoteRow[] = [];
  for (const block of blocks) {
    const q = readQuote(block.text);
    if (!q) continue;
    const model = block.car ?? discussed ?? null;
    const options = q.options.length > 0 ? q.options : [{ down: null, monthly: null, months: null }];
    for (const o of options) {
      if (rows.length >= 12) break;
      rows.push({
        conversation_id: m.conversationId,
        account_id: m.accountId,
        brand: m.brand,
        external_message_id: m.externalMessageId.slice(0, 200),
        option_no: rows.length + 1,
        at: m.at,
        kind: q.kind,
        model,
        model_binding: block.car ? "message" : discussed ? "conversation" : null,
        total_min: q.totalMin,
        total_max: q.totalMax,
        list_price: q.listPrice,
        down_payment: o.down,
        monthly: o.monthly,
        months: o.months,
        confidence: q.confidence,
      });
    }
  }
  return rows;
}

/** The ONE car the customer was on just before `at` (their own words, the context or the ad), else null. */
async function discussedCar(sb: SupabaseClient, conversationId: string, at: string): Promise<string | null> {
  const { data } = await sb.from("sales_signals").select("models, context_models, ad_model").eq("conversation_id", conversationId).lte("at", at).order("at", { ascending: false }).limit(5);
  for (const r of (Array.isArray(data) ? data : []) as { models?: string[]; context_models?: string[]; ad_model?: string | null }[]) {
    const cars = [...new Set([...(r.models ?? []), ...(r.context_models ?? [])])];
    if (cars.length === 1) return cars[0];
    if (cars.length > 1) return null;
    if (r.ad_model) return r.ad_model;
  }
  return null;
}

interface StoredMessage {
  conversation_id: string;
  account_id: string;
  brand: string;
  body: string | null;
  sent_at: string | null;
  created_at: string;
  external_message_id: string | null;
  deleted_at: string | null;
}
const COLUMNS = "conversation_id, account_id, brand, body, sent_at, created_at, external_message_id, deleted_at";

/** Replace the stored quote of each message with what it says NOW. Returns rows kept, or null on a failed write. */
async function reconcile(sb: SupabaseClient, d: EngineDeps, messages: readonly StoredMessage[], firstRead = false): Promise<number | null> {
  const list = messages.filter((m) => m.external_message_id);
  if (list.length === 0) return 0;
  const convIds = [...new Set(list.map((m) => m.conversation_id))];
  const { data: convs } = await sb.from("channel_conversations").select("id, peer_external_id").in("id", convIds);
  const peerOf = new Map(((Array.isArray(convs) ? convs : []) as { id: string; peer_external_id: string }[]).map((c) => [c.id, c.peer_external_id]));
  const carsOf = (text: string) => staffCars(text, d);

  let kept = 0;
  const batch: QuoteRow[] = [];
  for (const m of list) {
    const id = (m.external_message_id as string).slice(0, 200);
    const at = m.sent_at ?? m.created_at;
    let rows: QuoteRow[] = [];
    const live = !m.deleted_at && Boolean(m.body) && !isPilotChat({ accountId: m.account_id, channel: "whatsapp", peerExternalId: peerOf.get(m.conversation_id) ?? "" });
    if (live && mayHoldQuote(m.body as string)) {
      const message = { conversationId: m.conversation_id, accountId: m.account_id, brand: m.brand, externalMessageId: id, at, text: m.body as string };
      rows = quoteRows(message, carsOf, null);
      // Ask the conversation for its car only when the message has a quote and names no car itself.
      if (rows.some((r) => r.model === null)) rows = quoteRows(message, carsOf, await discussedCar(sb, m.conversation_id, at));
    }
    kept += rows.length;
    // A message read for the first time has nothing older to remove: its rows go in one write per page.
    if (firstRead) {
      batch.push(...rows);
      continue;
    }
    if (rows.length > 0) {
      const { error } = await sb.from("sales_quotes").upsert(rows, { onConflict: "account_id,external_message_id,option_no" });
      if (error) return null;
    }
    // Whatever this message held before and no longer says goes: every row when it says nothing now.
    const { error: gone } = await sb.from("sales_quotes").delete().eq("account_id", m.account_id).eq("external_message_id", id).gt("option_no", rows.length);
    if (gone) return null;
  }
  if (batch.length > 0) {
    const { error } = await sb.from("sales_quotes").upsert(batch, { onConflict: "account_id,external_message_id,option_no" });
    if (error) return null;
  }
  return kept;
}

async function tableReady(sb: SupabaseClient): Promise<boolean> {
  const probe = await sb.from("sales_quotes").select("id", { count: "exact", head: true });
  return !probe.error;
}

/**
 * One message, now: after it is sent, echoed, edited or deleted. Best effort — a caller in the
 * webhook or the send path must never fail because of this.
 */
export async function reconcileQuoteOf(accountId: string, externalMessageId: string): Promise<void> {
  try {
    const sb = channelDb();
    if (!sb || !externalMessageId || !(await tableReady(sb))) return;
    const { data } = await sb.from("channel_messages").select(`${COLUMNS}, author`).eq("account_id", accountId).eq("external_message_id", externalMessageId).maybeSingle();
    const row = data as (StoredMessage & { author: string }) | null;
    if (!row || row.author !== "staff") return;
    await reconcile(sb, await insightDeps(), [row]);
  } catch {
    /* the nightly net picks it up */
  }
}

export interface QuoteOutcome {
  done: boolean;
  messages: number;
  quotes: number;
  revised: number;
}

/** The nightly net: everything the team wrote since the cursor, then everything edited or deleted lately. */
export async function captureQuotes(budgetMs = 6_000): Promise<QuoteOutcome | null> {
  const sb = channelDb();
  if (!sb) return null;
  const deadline = Date.now() + budgetMs;
  try {
    // The table must exist before anything is read: before migration 036 this stops here.
    if (!(await tableReady(sb))) return null;

    const d = await insightDeps();
    const { data: accounts } = await sb.from("channel_accounts").select("id").eq("channel", "whatsapp");
    const ids = (Array.isArray(accounts) ? (accounts as { id: string }[]) : []).map((a) => a.id);
    const out: QuoteOutcome = { done: false, messages: 0, quotes: 0, revised: 0 };
    if (ids.length === 0) return { ...out, done: true };

    const { data: run } = await sb.from("insight_backfill_runs").select("cursor").eq("id", RUN_ID).maybeSingle();
    let cursor = (run as { cursor?: string | null } | null)?.cursor ?? null;
    if (!run) await sb.from("insight_backfill_runs").insert({ id: RUN_ID, state: "running" });

    while (Date.now() < deadline) {
      // EVERY message the team wrote, not only those with a "$": whether one holds a quote is the
      // parser's decision (it also reads "USD", "dollars", "دولار"), never a database pattern's.
      let q = sb.from("channel_messages").select(COLUMNS).in("account_id", ids).eq("author", "staff").order("created_at", { ascending: true }).limit(PAGE);
      // gte, not gt: several messages can share a timestamp, and reconciling one twice is harmless.
      if (cursor) q = q.gte("created_at", cursor);
      const { data, error } = await q;
      if (error) return null;
      const page = (Array.isArray(data) ? data : []) as StoredMessage[];
      if (page.length === 0) {
        out.done = true;
        break;
      }
      // Only messages that could hold a quote cost a write; the rest are stepped over.
      const kept = await reconcile(sb, d, page.filter((m) => !m.deleted_at && m.body && mayHoldQuote(m.body)), true);
      if (kept === null) return null;
      out.messages += page.length;
      out.quotes += kept;
      const last = page[page.length - 1].created_at;
      // A full page that never left one timestamp cannot move on with gte: step past it.
      cursor = page.length === PAGE && last === cursor ? new Date(Date.parse(last) + 1).toISOString() : last;
      await sb.from("insight_backfill_runs").update({ cursor, updated_at: new Date().toISOString() }).eq("id", RUN_ID);
      if (page.length < PAGE) {
        out.done = true;
        break;
      }
    }

    // Edited or deleted lately, wherever the cursor is: a deleted message has no words left for
    // the scan above to find, so it is looked for by its own mark.
    if (Date.now() < deadline) {
      const since = new Date(Date.now() - REVISION_DAYS * 86_400_000).toISOString();
      const { data: revised } = await sb.from("channel_messages").select(COLUMNS).in("account_id", ids).eq("author", "staff").or(`deleted_at.gte.${since},edited_at.gte.${since}`).limit(500);
      const list = (Array.isArray(revised) ? revised : []) as StoredMessage[];
      if (list.length > 0 && (await reconcile(sb, d, list)) !== null) out.revised = list.length;
    }
    return out;
  } catch {
    return null;
  }
}
