/**
 * History reads that run ON THE SERVER until they finish — SERVER ONLY (Samer's audit, 2026-10-13: the
 * WhatsApp re-read was driven by the browser and stopped when the one-hour sign-in ran out, at 638 of
 * 2,434 messages; the Instagram / Facebook history read had the same weakness).
 *
 * A job is "wa" (read the stored WhatsApp history again with the current reader) or "meta:<account>" (one
 * Instagram / Facebook account's history, labels only). One STEP reads for ~42 s inside a Vercel function's
 * minute and, while unfinished, starts the next step by calling GET /api/insights/catchup with CRON_SECRET.
 * A lease on the job's insight_backfill_runs row keeps ONE chain per job: a second start while a chain is
 * alive says "already reading"; a chain that dies (a deploy, a timeout) is picked up by the next start —
 * the button, or the nightly job — once its lease (90 s) has run out. Every step moves the saved cursor
 * forward, so nothing is read twice and nothing is lost.
 *
 * When a job finishes: the per-person summaries are rebuilt and, for WhatsApp, the stored demand record
 * (027) is rewritten whole — in a fresh step, with its own minute.
 */

import { randomUUID } from "node:crypto";
import { cronSecret } from "@/lib/env";
import { channelDb } from "@/lib/channels/store";
import { metaAccountIds, runMetaBackfill } from "@/lib/insights/meta-backfill";
import { refreshInsightPeople } from "@/lib/insights/people-server";
import { storeDemand } from "@/lib/insights/demand-server";
import { READER_VERSION } from "@/lib/wasales/reader";
import { rebuildWhatsApp, rereadPending } from "@/lib/wasales/signal-server";

const LEASE_MS = 90_000;
const STEP_MS = 42_000;
/** A chain never runs away: ~80 steps × 42 s ≈ 56 minutes, far more than the whole history needs. */
export const MAX_HOPS = 80;

export type CatchupJob = "wa" | `meta:${string}`;
export type StepResult =
  | { state: "busy" }
  | { state: "nothing_to_do" }
  | { state: "continuing"; hop: number; kicked: boolean }
  | { state: "finished" }
  | { state: "stopped"; code: string }
  | { state: "unavailable" };

const runIdOf = (job: CatchupJob) => (job === "wa" ? "wa:rebuild" : job);

/** A job name from a URL: only "wa" or one of OUR Instagram / Facebook accounts. */
export async function parseJob(raw: string | null): Promise<CatchupJob | null> {
  if (raw === "wa") return "wa";
  if (raw?.startsWith("meta:") && (await metaAccountIds()).includes(raw.slice(5))) return raw as CatchupJob;
  return null;
}

/**
 * Take the job's lease, or extend it when `lease` is the chain's own. Null = another chain holds it.
 * One conditional UPDATE, so two starters at once → one wins.
 */
async function claimLease(job: CatchupJob, lease: string | null): Promise<string | null> {
  const sb = channelDb();
  if (!sb) return null;
  const id = runIdOf(job);
  const now = new Date();
  const until = new Date(now.getTime() + LEASE_MS).toISOString();
  await sb.from("insight_backfill_runs").upsert({ id, account_id: job === "wa" ? null : job.slice(5), state: "running", updated_at: now.toISOString() }, { onConflict: "id", ignoreDuplicates: true });
  if (lease) {
    const { data } = await sb.from("insight_backfill_runs").update({ lease_until: until }).eq("id", id).eq("lease", lease).select("id");
    if (Array.isArray(data) && data.length === 1) return lease;
  }
  const fresh = randomUUID();
  const { data } = await sb
    .from("insight_backfill_runs")
    .update({ lease: fresh, lease_until: until })
    .eq("id", id)
    .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
    .select("id");
  return Array.isArray(data) && data.length === 1 ? fresh : null;
}

async function releaseLease(job: CatchupJob, lease: string): Promise<void> {
  const sb = channelDb();
  if (!sb) return;
  await sb.from("insight_backfill_runs").update({ lease: null, lease_until: null }).eq("id", runIdOf(job)).eq("lease", lease);
}

/** Start the next step and return without waiting for it: the step keeps running on its own. */
async function kick(origin: string, params: Record<string, string>): Promise<boolean> {
  const secret = cronSecret();
  if (!secret) return false;
  try {
    await fetch(`${origin}/api/insights/catchup?${new URLSearchParams(params).toString()}`, {
      headers: { authorization: `Bearer ${secret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(2_500),
    });
  } catch {
    // Expected: we stop listening after 2.5 s; Vercel runs the step to its end regardless.
  }
  return true;
}

/**
 * Start a job's chain (the button, the nightly job). Returns at once: "started", "busy" (a chain is
 * already reading), or "not_configured" (no CRON_SECRET — the chain cannot call itself).
 */
export async function startCatchup(origin: string, job: CatchupJob, restart: boolean): Promise<"started" | "busy" | "not_configured" | "unavailable"> {
  if (!cronSecret()) return "not_configured";
  const sb = channelDb();
  if (!sb) return "unavailable";
  const { data } = await sb.from("insight_backfill_runs").select("lease_until").eq("id", runIdOf(job)).maybeSingle();
  const until = (data as { lease_until?: string | null } | null)?.lease_until;
  if (until && Date.parse(until) > Date.now()) return "busy";
  await kick(origin, { job, hop: "0", ...(restart ? { restart: "1" } : {}) });
  return "started";
}

/** One step of a chain. `finish` is the last step: summaries, and the demand record after WhatsApp. */
export async function runCatchupStep(opts: { origin: string; job: CatchupJob; lease: string | null; hop: number; restart: boolean; finish: boolean; wrapped?: boolean }): Promise<StepResult> {
  const sb = channelDb();
  if (!sb) return { state: "unavailable" };
  const lease = await claimLease(opts.job, opts.lease);
  if (!lease) return { state: "busy" };

  if (opts.finish) {
    await refreshInsightPeople();
    if (opts.job === "wa") await storeDemand("all", { evenIfRereading: true });
    await releaseLease(opts.job, lease);
    return { state: "finished" };
  }

  let done = false;
  let stopCode: string | null = null;
  if (opts.job === "wa") {
    const { data: run } = await sb.from("insight_backfill_runs").select("state, cursor").eq("id", "wa:rebuild").maybeSingle();
    const row = run as { state?: string; cursor?: string | null } | null;
    const pending = await rereadPending();
    // Nothing older to read and no read half-way: there is nothing to do.
    if (!opts.restart && pending === false && !row?.cursor) {
      await releaseLease(opts.job, lease);
      return { state: "nothing_to_do" };
    }
    // A finished read with labels still on an older reader starts again from the first conversation.
    const r = await rebuildWhatsApp(STEP_MS, opts.restart || (row?.state === "done" && pending === true));
    if (!r) {
      await releaseLease(opts.job, lease);
      return { state: "unavailable" };
    }
    done = r.done;
  } else {
    const r = await runMetaBackfill({ accountId: opts.job.slice(5), mode: "backfill", restart: opts.restart, budgetMs: STEP_MS });
    if (!r) {
      await releaseLease(opts.job, lease);
      return { state: "unavailable" };
    }
    done = r.state === "done";
    // Meta being slow is a pause; a rate limit, a refusal or an empty first page stops the chain.
    if (r.state === "blocked" || r.state === "unknown") stopCode = r.code ?? r.state;
  }

  await sb.from("insight_backfill_runs").update({ hops: opts.hop + 1 }).eq("id", runIdOf(opts.job)).eq("lease", lease);
  if (stopCode) {
    await releaseLease(opts.job, lease);
    return { state: "stopped", code: stopCode };
  }
  const carry: Record<string, string> = opts.wrapped ? { wrapped: "1" } : {};
  // A read that resumed half-way finishes with the conversations BEFORE its cursor still on an older reader:
  // it goes round once more from the first conversation (only once — labels whose messages are gone can
  // never be read again and must not keep it going).
  if (done && opts.job === "wa" && !opts.wrapped && (await rereadPending()) === true && opts.hop + 1 < MAX_HOPS) {
    const kicked = await kick(opts.origin, { job: opts.job, lease, hop: String(opts.hop + 1), restart: "1", wrapped: "1" });
    if (!kicked) await releaseLease(opts.job, lease);
    return { state: "continuing", hop: opts.hop + 1, kicked };
  }
  if (done) {
    const kicked = await kick(opts.origin, { job: opts.job, lease, hop: String(opts.hop + 1), finish: "1" });
    if (!kicked) await releaseLease(opts.job, lease);
    return { state: "continuing", hop: opts.hop + 1, kicked };
  }
  if (opts.hop + 1 >= MAX_HOPS) {
    await releaseLease(opts.job, lease);
    return { state: "stopped", code: "max_steps" };
  }
  const kicked = await kick(opts.origin, { job: opts.job, lease, hop: String(opts.hop + 1), ...carry });
  // Without a next step the lease is let go at once, so the button or the nightly job can continue it.
  if (!kicked) await releaseLease(opts.job, lease);
  return { state: "continuing", hop: opts.hop + 1, kicked };
}

export interface CatchupStatus {
  job: CatchupJob;
  reading: boolean;
  state: string | null;
  hops: number;
  updatedAt: string | null;
  /** WhatsApp only: labels by the current reader / all WhatsApp labels. */
  current: number | null;
  total: number | null;
}

export async function catchupStatus(job: CatchupJob): Promise<CatchupStatus | null> {
  const sb = channelDb();
  if (!sb) return null;
  const { data } = await sb.from("insight_backfill_runs").select("state, hops, updated_at, lease_until").eq("id", runIdOf(job)).maybeSingle();
  const row = data as { state?: string; hops?: number; updated_at?: string; lease_until?: string | null } | null;
  let current: number | null = null;
  let total: number | null = null;
  if (job === "wa") {
    const [a, b] = await Promise.all([
      sb.from("sales_signals").select("id", { count: "exact", head: true }).eq("channel", "whatsapp").eq("reader_version", READER_VERSION),
      sb.from("sales_signals").select("id", { count: "exact", head: true }).eq("channel", "whatsapp"),
    ]);
    current = a.error ? null : (a.count ?? 0);
    total = b.error ? null : (b.count ?? 0);
  }
  return {
    job,
    reading: Boolean(row?.lease_until && Date.parse(row.lease_until) > Date.now()),
    state: row?.state ?? null,
    hops: row?.hops ?? 0,
    updatedAt: row?.updated_at ?? null,
    current,
    total,
  };
}
