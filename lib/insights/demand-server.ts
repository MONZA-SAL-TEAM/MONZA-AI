/**
 * Storing the anonymous demand record — SERVER ONLY (027 insight_demand_daily). Reads the labels, counts
 * them per day and per month with no client data (lib/insights/demand.ts), and rewrites each period it
 * recomputes whole.
 *
 *   recent  from the start of last month (nightly — re-reads and late messages change recent periods)
 *   all     every period the labels still cover (on demand). Periods whose labels are gone (chats deleted by
 *           the 12-month clean-up or a person's deletion) are NOT touched: their stored counts are the record.
 */

import { channelDb } from "@/lib/channels/store";
import { rereadPending } from "@/lib/wasales/signal-server";
import { readInsightRows } from "@/lib/insights/insights-server";
import { beirutDay, demandRows, type DemandRow } from "@/lib/insights/demand";

export type StoreDemandResult = { days: number; months: number; rows: number } | { skipped: "reread" };

/**
 * While WhatsApp labels from an older reader remain, the record WAITS (Samer's audit, 2026-10-13): stored
 * from half-read history it would keep the ad's car counted as "named" for good. The end of the server-side
 * re-read (catchup-server.ts) stores it whole, `evenIfRereading` — labels that can no longer be read again
 * (their messages are gone) must not hold it forever.
 */
export async function storeDemand(scope: "recent" | "all", opts: { evenIfRereading?: boolean } = {}): Promise<StoreDemandResult | null> {
  const sb = channelDb();
  if (!sb) return null;
  if (!opts.evenIfRereading && (await rereadPending()) === true) return { skipped: "reread" };
  // "recent": from the first day of LAST month (Beirut), read with six hours to spare so the first Beirut
  // day is whole; that first month is then complete too.
  const now = new Date();
  const fromMonth = scope === "recent" ? `${new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7)}-01` : null;
  const since = fromMonth ? new Date(Date.parse(`${fromMonth}T00:00:00Z`) - 6 * 3_600_000).toISOString() : null;
  const read = await readInsightRows(since);
  if (read.state !== "ok") return null;
  const { signals, observations } = read.rows;
  const leadByConv = new Map(read.rows.leadConversations.map((lc) => [lc.conversation_id, lc.lead_id]));
  const personOf = (conv: string) => (leadByConv.get(conv) ? `lead:${leadByConv.get(conv)}` : `chat:${conv}`);

  const days = new Set([...new Set(signals.map((s) => beirutDay(s.at)))].filter((d) => !fromMonth || d >= fromMonth));
  const months = new Set([...days].map((d) => `${d.slice(0, 7)}-01`));
  if (days.size === 0) return { days: 0, months: 0, rows: 0 };
  const rows: DemandRow[] = [...demandRows(signals, observations ?? [], personOf, days, "day"), ...demandRows(signals, observations ?? [], personOf, months, "month")];
  const computedAt = new Date().toISOString();

  const rewrite = async (period: "day" | "month", keys: string[]) => {
    for (let i = 0; i < keys.length; i += 50) {
      const chunk = keys.slice(i, i + 50);
      const { error: delError } = await sb.from("insight_demand_daily").delete().eq("period", period).in("day", chunk);
      if (delError) throw delError;
      const these = rows.filter((r) => r.period === period && chunk.includes(r.day)).map((r) => ({ ...r, computed_at: computedAt }));
      for (let j = 0; j < these.length; j += 1000) {
        const { error } = await sb.from("insight_demand_daily").insert(these.slice(j, j + 1000));
        if (error) throw error;
      }
    }
  };
  try {
    await rewrite("day", [...days].sort());
    await rewrite("month", [...months].sort());
  } catch (e) {
    console.error(`[insights/demand] not written (${(e as { code?: string })?.code ?? "?"})`);
    return null;
  }
  return { days: days.size, months: months.size, rows: rows.length };
}

export interface StoredDemand {
  period: "day" | "month";
  day: string;
  brand: string;
  channel: string;
  dimension: string;
  model: string;
  value: string;
  people: number;
  messages: number;
}

export type DemandRead = { state: "ok"; rows: StoredDemand[]; firstDay: string | null; lastComputed: string | null } | { state: "unavailable" };

/** The stored record for one period kind, optionally from a day. */
export async function readDemand(period: "day" | "month", sinceDay: string | null): Promise<DemandRead> {
  const sb = channelDb();
  if (!sb) return { state: "unavailable" };
  try {
    const out: StoredDemand[] = [];
    let lastComputed: string | null = null;
    for (let from = 0; from < 500_000; from += 1000) {
      let q = sb.from("insight_demand_daily").select("period, day, brand, channel, dimension, model, value, people, messages, computed_at").eq("period", period).order("day").range(from, from + 999);
      if (sinceDay) q = q.gte("day", sinceDay);
      const { data, error } = await q;
      if (error) throw error;
      const page = (data ?? []) as (StoredDemand & { computed_at: string })[];
      for (const r of page) if (!lastComputed || r.computed_at > lastComputed) lastComputed = r.computed_at;
      out.push(...page);
      if (page.length < 1000) break;
    }
    return { state: "ok", rows: out, firstDay: out[0]?.day ?? null, lastComputed };
  } catch (e) {
    console.error("[insights/demand] reading failed:", e instanceof Error ? e.message : JSON.stringify(e));
    return { state: "unavailable" };
  }
}
