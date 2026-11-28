/**
 * Quote capture: the price and payment terms the TEAM sent on WhatsApp, kept as numbers
 * (migration 036, lib/wasales/quote.ts). Runs nightly from /api/insights/refresh.
 *
 * - Reads only messages the team wrote that contain a "$" — the body is read in memory and dropped.
 * - Idempotent on the message id; resumable (its cursor is `wa:quotes` in insight_backfill_runs).
 * - The car: the one the message names; else the one car the customer was talking about just
 *   before it; else none. A message naming SEVERAL cars is skipped — which price is whose cannot
 *   be told from numbers alone.
 * - The pilot's test phones are never clients. A deleted message's quote is removed.
 * - Any failure returns null and changes nothing: the table may not exist yet.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { channelDb } from "@/lib/channels/store";
import { isPilotChat } from "@/lib/wasales/autoreply-pilot";
import { readQuote, type Quote } from "@/lib/wasales/quote";
import { staffCars } from "@/lib/wasales/reader";
import { insightDeps } from "@/lib/wasales/signal-server";

const RUN_ID = "wa:quotes";
const PAGE = 300;

export interface QuoteRow {
  conversation_id: string;
  account_id: string;
  brand: string;
  external_message_id: string;
  at: string;
  kind: Quote["kind"];
  model: string | null;
  model_binding: "message" | "conversation" | null;
  total_min: number | null;
  total_max: number | null;
  down_payment: number | null;
  monthly: number | null;
  months: number | null;
}

/** Pure: one message's quote as a row, given the cars it names and the car being discussed. Null = keep nothing. */
export function quoteRow(
  m: { conversationId: string; accountId: string; brand: string; externalMessageId: string; at: string; text: string },
  named: readonly string[],
  discussed: string | null
): QuoteRow | null {
  if (named.length > 1) return null;
  const q = readQuote(m.text);
  if (!q) return null;
  const model = named[0] ?? discussed ?? null;
  return {
    conversation_id: m.conversationId,
    account_id: m.accountId,
    brand: m.brand,
    external_message_id: m.externalMessageId.slice(0, 200),
    at: m.at,
    kind: q.kind,
    model,
    model_binding: named[0] ? "message" : discussed ? "conversation" : null,
    total_min: q.totalMin,
    total_max: q.totalMax,
    down_payment: q.down,
    monthly: q.monthly,
    months: q.months,
  };
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

export interface QuoteOutcome {
  done: boolean;
  messages: number;
  quotes: number;
}

export async function captureQuotes(budgetMs = 6_000): Promise<QuoteOutcome | null> {
  const sb = channelDb();
  if (!sb) return null;
  const deadline = Date.now() + budgetMs;
  try {
    // The table must exist before anything is read: before migration 036 this stops here.
    const probe = await sb.from("sales_quotes").select("id", { count: "exact", head: true });
    if (probe.error) return null;

    const d = await insightDeps();
    const { data: accounts } = await sb.from("channel_accounts").select("id").eq("channel", "whatsapp");
    const ids = (Array.isArray(accounts) ? (accounts as { id: string }[]) : []).map((a) => a.id);
    if (ids.length === 0) return { done: true, messages: 0, quotes: 0 };

    const { data: run } = await sb.from("insight_backfill_runs").select("cursor").eq("id", RUN_ID).maybeSingle();
    let cursor = (run as { cursor?: string | null } | null)?.cursor ?? null;
    if (!run) await sb.from("insight_backfill_runs").insert({ id: RUN_ID, state: "running" });

    const out: QuoteOutcome = { done: false, messages: 0, quotes: 0 };
    while (Date.now() < deadline) {
      let q = sb
        .from("channel_messages")
        .select("conversation_id, account_id, brand, body, sent_at, created_at, external_message_id, deleted_at")
        .in("account_id", ids)
        .eq("author", "staff")
        .like("body", "%$%")
        .order("created_at", { ascending: true })
        .limit(PAGE);
      // gte, not gt: several messages can share a timestamp, and writing one twice is harmless.
      if (cursor) q = q.gte("created_at", cursor);
      const { data, error } = await q;
      if (error) return null;
      const page = (Array.isArray(data) ? data : []) as { conversation_id: string; account_id: string; brand: string; body: string | null; sent_at: string | null; created_at: string; external_message_id: string | null; deleted_at: string | null }[];
      if (page.length === 0) {
        out.done = true;
        break;
      }

      const convIds = [...new Set(page.map((m) => m.conversation_id))];
      const { data: convs } = await sb.from("channel_conversations").select("id, peer_external_id").in("id", convIds);
      const peerOf = new Map(((Array.isArray(convs) ? convs : []) as { id: string; peer_external_id: string }[]).map((c) => [c.id, c.peer_external_id]));

      const rows: QuoteRow[] = [];
      const gone: { account_id: string; external_message_id: string }[] = [];
      for (const m of page) {
        if (!m.external_message_id) continue;
        if (isPilotChat({ accountId: m.account_id, channel: "whatsapp", peerExternalId: peerOf.get(m.conversation_id) ?? "" })) continue;
        if (m.deleted_at || !m.body) {
          gone.push({ account_id: m.account_id, external_message_id: m.external_message_id.slice(0, 200) });
          continue;
        }
        const at = m.sent_at ?? m.created_at;
        const named = staffCars(m.body, d);
        const needsContext = named.length === 0 && readQuote(m.body) !== null;
        const row = quoteRow({ conversationId: m.conversation_id, accountId: m.account_id, brand: m.brand, externalMessageId: m.external_message_id, at, text: m.body }, named, needsContext ? await discussedCar(sb, m.conversation_id, at) : null);
        if (row) rows.push(row);
      }
      if (rows.length > 0) {
        const { error: writeError } = await sb.from("sales_quotes").upsert(rows, { onConflict: "account_id,external_message_id" });
        if (writeError) return null;
      }
      for (const g of gone) await sb.from("sales_quotes").delete().eq("account_id", g.account_id).eq("external_message_id", g.external_message_id);

      out.messages += page.length;
      out.quotes += rows.length;
      const last = page[page.length - 1].created_at;
      // A full page that never left one timestamp cannot move on with gte: step past it.
      cursor = page.length === PAGE && last === cursor ? new Date(Date.parse(last) + 1).toISOString() : last;
      await sb.from("insight_backfill_runs").update({ cursor, updated_at: new Date().toISOString() }).eq("id", RUN_ID);
      if (page.length < PAGE) {
        out.done = true;
        break;
      }
    }
    return out;
  } catch {
    return null;
  }
}
