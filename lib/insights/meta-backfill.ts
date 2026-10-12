/**
 * The Instagram and Facebook history, read ONCE from Meta, then every night — LABELS ONLY (Samer,
 * 2026-10-12: "yes, labels only"; "yes, every night"). SERVER ONLY.
 *
 * Instagram and Facebook words are never stored (2026-09-10). Each thread's latest messages are read
 * from Meta in memory (lib/channels/live.ts readThreadsForInsights, the only place that holds a key),
 * passed through the same reader as the webhook (lib/wasales/reader.ts), and only the signals and facts
 * are written. The words are gone when this function returns. No channel_messages row is ever written.
 *
 *   backfill  resumable: the cursor is saved after every page (insight_backfill_runs "meta:<account>"),
 *             a thread Meta says is unchanged is skipped (insight_meta_threads).
 *   nightly   from the newest, stopping at the first thread already read and unchanged.
 *   dry       counts threads, messages and how many are already recorded; writes nothing at all.
 *
 * Stops on Meta's rate-limit codes (#4, #17, #32, #613), on -2/2534084, above 75% of the rate limit, and
 * after 60 calls — saved as "blocked" with the code, never retried in a loop. A first page that comes
 * back empty is UNKNOWN (rule 21), never "no chats".
 */

import { readThreadsForInsights } from "@/lib/channels/live";
import { channelDb, ensureConversation } from "@/lib/channels/store";
import { emptyFirstPage, shouldStop, turnsOf, unchanged } from "@/lib/insights/meta-backfill-rules";
import { freshState } from "@/lib/wasales/context";
import { readConversation } from "@/lib/wasales/reader";
import { deps, loadState, saveState, writeResults } from "@/lib/wasales/signal-server";

export interface BackfillOutcome {
  accountId: string;
  mode: "backfill" | "nightly";
  dry: boolean;
  state: "running" | "done" | "blocked" | "unknown";
  /** Meta's code or our own stop reason; never a message. */
  code: string | null;
  threads: number;
  skipped: number;
  messages: number;
  /** Customer messages already recorded (by the webhook): read for context, not written again. */
  matchedExisting: number;
  signals: number;
  observations: number;
  calls: number;
}

export async function runMetaBackfill(opts: { accountId: string; mode: "backfill" | "nightly"; dry?: boolean; restart?: boolean; budgetMs?: number }): Promise<BackfillOutcome | null> {
  const sb = channelDb();
  if (!sb) return null;
  const dry = opts.dry === true;
  const budgetMs = opts.budgetMs ?? 40_000;
  const started = Date.now();
  const out: BackfillOutcome = { accountId: opts.accountId, mode: opts.mode, dry, state: "running", code: null, threads: 0, skipped: 0, messages: 0, matchedExisting: 0, signals: 0, observations: 0, calls: 0 };

  const { data: acc } = await sb.from("channel_accounts").select("id, brand, channel").eq("id", opts.accountId).maybeSingle();
  const account = acc as { id: string; brand: string; channel: string } | null;
  if (!account || (account.channel !== "instagram" && account.channel !== "facebook")) return { ...out, state: "blocked", code: "not_connected" };

  const runId = `${opts.mode === "nightly" ? "metanight" : "meta"}:${account.id}`.slice(0, 60);
  const { data: runRow } = await sb.from("insight_backfill_runs").select("cursor, state").eq("id", runId).maybeSingle();
  const run = runRow as { cursor: string | null; state: string } | null;
  if (opts.mode === "backfill" && run?.state === "done" && !opts.restart && !dry) return { ...out, state: "done" };
  let cursor = opts.mode === "backfill" && !opts.restart && !dry ? (run?.cursor ?? null) : null;
  if (!dry && (!run || opts.restart || opts.mode === "nightly")) {
    await sb.from("insight_backfill_runs").upsert({ id: runId, account_id: account.id, state: "running", cursor, started_at: new Date().toISOString(), updated_at: new Date().toISOString(), finished_at: null, last_error_code: null }, { onConflict: "id" });
  }

  const d = deps();
  let firstPage = true;
  let usage: number | null = null;
  let reachedKnown = false;
  while (true) {
    const remaining = budgetMs - (Date.now() - started);
    if (remaining < 5_000) break;
    const page = await readThreadsForInsights(account.id, cursor, Math.min(remaining, 30_000));
    out.calls += page.calls;
    if (!page.ok) {
      const stop = shouldStop({ calls: out.calls, usage, errorCode: page.code, elapsedMs: Date.now() - started, budgetMs });
      out.state = "blocked";
      out.code = stop.stop ? stop.code : page.code;
      break;
    }
    usage = page.usage;
    if (emptyFirstPage(firstPage, page.threads.length, page.next)) {
      out.state = "unknown";
      out.code = "empty_first_page";
      break;
    }
    firstPage = false;

    for (const t of page.threads) {
      out.threads++;
      const { data: knownRow } = await sb.from("insight_meta_threads").select("meta_updated_at").eq("account_id", account.id).eq("meta_conversation_id", t.metaConversationId).maybeSingle();
      if (unchanged(knownRow as { meta_updated_at: string | null } | null, t.updatedAt)) {
        out.skipped++;
        if (opts.mode === "nightly") {
          reachedKnown = true;
          break;
        }
        continue;
      }
      const turns = turnsOf(t.messages);
      out.messages += turns.length;
      if (!t.peer || turns.length === 0) continue;
      const customerIds = turns.filter((x) => x.author === "customer").map((x) => x.externalMessageId.slice(0, 200));
      const { data: existing } = customerIds.length
        ? await sb.from("sales_signals").select("external_message_id").eq("account_id", account.id).in("external_message_id", customerIds)
        : { data: [] };
      const already = new Set(((existing ?? []) as { external_message_id: string }[]).map((r) => r.external_message_id));
      out.matchedExisting += already.size;
      if (dry) continue;

      const conversationId = await ensureConversation(account.id, t.peer.id, t.metaConversationId);
      if (!conversationId) continue;
      const stored = await loadState(sb, conversationId);
      // The saved memory is used only when it ends before this window starts; otherwise read the window fresh.
      const start = stored.lastAt && turns[0] && Date.parse(stored.lastAt) < Date.parse(turns[0].at) ? stored.state : freshState();
      const read = readConversation(turns, { accountId: account.id, brand: account.brand, channel: account.channel, conversationId, peerExternalId: t.peer.id }, d, start);
      // What the webhook already read live stays as it was; only what it never saw is written.
      const fresh = read.results.filter((r) => !already.has(r.signal.externalMessageId.slice(0, 200)));
      const w = await writeResults(sb, fresh, "meta_backfill");
      if (w) {
        out.signals += w.signals;
        out.observations += w.observations;
      }
      if (read.lastAt && (!stored.lastAt || Date.parse(read.lastAt) >= Date.parse(stored.lastAt))) {
        await saveState(sb, { conversationId, accountId: account.id, brand: account.brand }, read.state, read.lastAt, read.lastId);
      }
      await sb.from("insight_meta_threads").upsert(
        { account_id: account.id, meta_conversation_id: t.metaConversationId, conversation_id: conversationId, meta_updated_at: t.updatedAt, read_at: new Date().toISOString(), messages_read: turns.length },
        { onConflict: "account_id,meta_conversation_id" }
      );
    }

    cursor = page.next;
    if (!dry) await sb.from("insight_backfill_runs").update({ cursor: opts.mode === "backfill" ? cursor : null, updated_at: new Date().toISOString() }).eq("id", runId);
    if (!page.next || reachedKnown) {
      out.state = "done";
      break;
    }
    const stop = shouldStop({ calls: out.calls, usage, errorCode: null, elapsedMs: Date.now() - started, budgetMs });
    if (stop.stop) {
      out.state = "blocked";
      out.code = stop.code;
      break;
    }
  }

  if (!dry) {
    const { data: totals } = await sb.from("insight_backfill_runs").select("threads_seen, messages_read, signals_written, matched_existing").eq("id", runId).maybeSingle();
    const t = (totals ?? {}) as { threads_seen?: number; messages_read?: number; signals_written?: number; matched_existing?: number };
    await sb
      .from("insight_backfill_runs")
      .update({
        state: out.state === "unknown" ? "blocked" : out.state,
        last_error_code: out.code,
        threads_seen: (t.threads_seen ?? 0) + out.threads,
        messages_read: (t.messages_read ?? 0) + out.messages,
        signals_written: (t.signals_written ?? 0) + out.signals,
        matched_existing: (t.matched_existing ?? 0) + out.matchedExisting,
        updated_at: new Date().toISOString(),
        ...(out.state === "done" ? { finished_at: new Date().toISOString(), cursor: null } : {}),
      })
      .eq("id", runId);
  }
  // Codes and counts only: never a name, an id of a person, or a word.
  console.log(`[insights/meta] ${account.id} ${opts.mode}${dry ? " (dry)" : ""}: ${out.state}${out.code ? ` ${out.code}` : ""}, ${out.threads} threads, ${out.calls} calls`);
  return out;
}

/** Every Instagram and Facebook account. */
export async function metaAccountIds(): Promise<string[]> {
  const sb = channelDb();
  if (!sb) return [];
  const { data } = await sb.from("channel_accounts").select("id, channel").in("channel", ["instagram", "facebook"]).order("id");
  return ((data ?? []) as { id: string }[]).map((a) => a.id);
}

/** Whether this account's one-time history read has finished. */
export async function backfillDone(accountId: string): Promise<boolean> {
  const sb = channelDb();
  if (!sb) return false;
  const { data } = await sb.from("insight_backfill_runs").select("state").eq("id", `meta:${accountId}`).maybeSingle();
  return (data as { state?: string } | null)?.state === "done";
}

export interface MetaRunView {
  accountId: string;
  label: string;
  channel: string;
  brand: string;
  state: "not_started" | "running" | "done" | "blocked";
  code: string | null;
  threads: number;
  signals: number;
  updatedAt: string | null;
}

/** Each Instagram / Facebook account and where its history read stands. Codes and counts only. */
export async function readMetaRuns(): Promise<MetaRunView[]> {
  const sb = channelDb();
  if (!sb) return [];
  const [{ data: accounts }, { data: runs }] = await Promise.all([
    sb.from("channel_accounts").select("id, display_name, channel, brand").in("channel", ["instagram", "facebook"]).order("id"),
    sb.from("insight_backfill_runs").select("id, state, last_error_code, threads_seen, signals_written, updated_at").like("id", "meta:%"),
  ]);
  const runById = new Map(((runs ?? []) as { id: string; state: string; last_error_code: string | null; threads_seen: number; signals_written: number; updated_at: string }[]).map((r) => [r.id, r]));
  return ((accounts ?? []) as { id: string; display_name: string | null; channel: string; brand: string }[]).map((a) => {
    const r = runById.get(`meta:${a.id}`);
    return {
      accountId: a.id,
      label: a.display_name ?? a.id,
      channel: a.channel,
      brand: a.brand,
      state: (r?.state as MetaRunView["state"]) ?? "not_started",
      code: r?.last_error_code ?? null,
      threads: r?.threads_seen ?? 0,
      signals: r?.signals_written ?? 0,
      updatedAt: r?.updated_at ?? null,
    };
  });
}
