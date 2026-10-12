/**
 * Writing signals (lib/wasales/signal.ts) — SERVER ONLY.
 *
 * `recordSignal` runs at the webhook, for every channel, with the message's words in hand and only
 * the labels written: the words are read in memory and dropped, exactly as lib/leads/store.ts reads a
 * car name. Best effort, always: a failure here can never fail a delivery (rule 16).
 *
 * `rebuildSignals` reads the STORED WhatsApp history (channel_messages keeps WhatsApp for 12 months;
 * Instagram and Facebook are never stored) and fills the table for the past — idempotent on the
 * message id, so it can be run again.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { channelDb } from "@/lib/channels/store";
import { folderMedia, loadCatalog } from "@/lib/wasales/catalog";
import { freshState } from "@/lib/wasales/context";
import { decide, type EngineDeps } from "@/lib/wasales/engine";
import { MONZA_KNOWLEDGE, salesBrandOf } from "@/lib/wasales/knowledge";
import { signalFromDecision, type Signal, type SignalMeta } from "@/lib/wasales/signal";

function deps(): EngineDeps {
  return { knowledge: MONZA_KNOWLEDGE, catalog: loadCatalog(), media: folderMedia, ttlHours: 72 };
}

/** The labels for one message, read fresh (no conversation memory: the same reading on every channel). */
export function readSignal(text: string, meta: SignalMeta): Signal | null {
  const brand = salesBrandOf(meta.brand);
  if (!brand) return null;
  const d = decide({ text, hasMedia: meta.hasMedia, brand, channel: meta.channel as "whatsapp" | "instagram" | "facebook", conversationIsNew: true, now: meta.at }, freshState(), deps());
  return signalFromDecision(d, meta);
}

function rowOf(s: Signal) {
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
  };
}

/** Record one inbound message's labels. Never throws. */
export async function recordSignal(sb: SupabaseClient, text: string, meta: SignalMeta): Promise<boolean> {
  try {
    const s = readSignal(text, meta);
    if (!s) return false;
    const { error } = await sb.from("sales_signals").upsert(rowOf(s), { onConflict: "account_id,external_message_id" });
    if (error) {
      console.error(`[signals] not written (${error.code ?? "?"}) — is migration 020 applied?`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[signals] failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

export interface RebuildOutcome {
  read: number;
  written: number;
  skipped: number;
}

/**
 * Fill the table from the stored WhatsApp history (`days` back). Only messages the engine does not
 * exclude; a message already recorded is rewritten with the current reading.
 */
export async function rebuildSignals(days = 365, budgetMs = 50_000): Promise<RebuildOutcome | null> {
  const sb = channelDb();
  if (!sb) return null;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const deadline = Date.now() + budgetMs;
  const PAGE = 500;
  let read = 0;
  let written = 0;
  let skipped = 0;
  for (let from = 0; from < 50_000 && Date.now() < deadline; from += PAGE) {
    const { data, error } = await sb
      .from("channel_messages")
      .select("account_id, brand, conversation_id, external_message_id, body, attachments, sent_at")
      .eq("direction", "in")
      .gte("sent_at", since)
      .order("sent_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error(`[signals] rebuild could not read messages (${error.code ?? "?"})`);
      break;
    }
    const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    const batch: ReturnType<typeof rowOf>[] = [];
    for (const r of rows) {
      read++;
      const id = typeof r.external_message_id === "string" ? r.external_message_id : null;
      const at = typeof r.sent_at === "string" ? r.sent_at : null;
      if (!id || !at || typeof r.account_id !== "string" || typeof r.brand !== "string" || typeof r.conversation_id !== "string") {
        skipped++;
        continue;
      }
      const body = typeof r.body === "string" ? r.body : "";
      const hasMedia = Array.isArray(r.attachments) && r.attachments.length > 0;
      const s = readSignal(body, { accountId: r.account_id, brand: r.brand, channel: "whatsapp", conversationId: r.conversation_id, externalMessageId: id, at, hasMedia });
      if (!s) {
        skipped++;
        continue;
      }
      batch.push(rowOf(s));
    }
    if (batch.length > 0) {
      const { error: upsertError } = await sb.from("sales_signals").upsert(batch, { onConflict: "account_id,external_message_id" });
      if (upsertError) {
        console.error(`[signals] rebuild could not write (${upsertError.code ?? "?"}) — is migration 020 applied?`);
        break;
      }
      written += batch.length;
    }
    if (rows.length < PAGE) break;
  }
  return { read, written, skipped };
}
