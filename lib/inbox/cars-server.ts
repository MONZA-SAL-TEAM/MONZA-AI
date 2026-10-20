/**
 * Which car each conversation is about, by inbox thread id — SERVER ONLY (lib/inbox/cars.ts is the pure half).
 * Read from the insights labels: WhatsApp fully; Instagram / Facebook only for threads that have a conversation
 * row with Meta's thread id (a webhook delivery or a history read). Labels only — no words leave the server.
 *
 * Kept 2 minutes in this server's memory: every open inbox tab asks every 5 minutes, and the whole
 * sales_signals table is read each time. A failed or partial read is never kept and never answered as
 * "ok" — the inbox keeps its last good map instead.
 */

import { channelDb, listAccounts } from "@/lib/channels/store";
import { encodeThreadId } from "@/lib/channels/live-map";
import { carName } from "@/lib/insights/facts";
import { MONZA_KNOWLEDGE } from "@/lib/wasales/knowledge";
import { anyCar, carsOfSignals, type CarChoice, type CarSignalRow } from "@/lib/inbox/cars";

export interface ConversationCarsView {
  cars: CarChoice[];
  /** Thread id → the cars it is about (named, by context, or from the ad). */
  byThread: Record<string, string[]>;
}

let cached: { at: number; view: ConversationCarsView } | null = null;
const CACHE_MS = 2 * 60_000;

export async function listConversationCars(): Promise<ConversationCarsView | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.view;
  const view = await readConversationCars();
  if (view) cached = { at: Date.now(), view };
  return view;
}

async function readConversationCars(): Promise<ConversationCarsView | null> {
  const sb = channelDb();
  if (!sb) return null;
  const rows: CarSignalRow[] = [];
  for (let from = 0; from < 200_000; from += 1000) {
    // Ordered, so a row rewritten between two pages cannot slip past the page boundary.
    const { data, error } = await sb.from("sales_signals").select("conversation_id, models, context_models, ad_model").order("id").range(from, from + 999);
    if (error) return null;
    const page = (data ?? []) as CarSignalRow[];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  const byConv = carsOfSignals(rows);
  const ids = [...byConv.keys()];
  const convs: { id: string; account_id: string; meta_conversation_id: string | null }[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await sb.from("channel_conversations").select("id, account_id, meta_conversation_id").in("id", ids.slice(i, i + 500));
    if (error) return null;
    convs.push(...((data ?? []) as typeof convs));
  }
  const accounts = await listAccounts();
  if (accounts.length === 0) return null;
  const channelOf = new Map(accounts.map((a) => [a.id, a.channel]));
  const byThread: Record<string, string[]> = {};
  for (const c of convs) {
    const cars = byConv.get(c.id);
    if (!cars) continue;
    const thread = channelOf.get(c.account_id) === "whatsapp" ? encodeThreadId(c.account_id, c.id) : c.meta_conversation_id ? encodeThreadId(c.account_id, c.meta_conversation_id) : null;
    if (!thread) continue;
    const list = anyCar(cars);
    if (list.length) byThread[thread] = list;
  }
  const cars: CarChoice[] = MONZA_KNOWLEDGE.models.map((m) => ({ code: m.code, label: carName(m.code), brand: m.brand }));
  return { cars, byThread };
}
