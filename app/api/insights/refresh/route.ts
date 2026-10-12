import { NextResponse } from "next/server";
import { cronSecret } from "@/lib/env";
import { isCronAuthorized } from "@/lib/channels/retention";
import { channelDb } from "@/lib/channels/store";
import { backfillDone, metaAccountIds, runMetaBackfill, type BackfillOutcome } from "@/lib/insights/meta-backfill";
import { READER_VERSION } from "@/lib/wasales/reader";
import { rebuildWhatsApp } from "@/lib/wasales/signal-server";

/**
 * GET /api/insights/refresh — the nightly insights read (vercel.json, 02:00 UTC; Samer, 2026-10-12:
 * "every night"). Inside the route's 60 s:
 *
 *   1. WhatsApp conversations still read by an OLDER reader are read again (rebuildWhatsApp).
 *   2. Each Instagram / Facebook account: its one-time history read continues where it stopped; once
 *      done, the newest threads are read, stopping at the first one already read and unchanged.
 *      The account that starts rotates each night, so none is starved.
 *
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; anybody else — and everybody while it is
 * unset — gets 401. Codes and counts only in the answer and the log.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request): Promise<NextResponse> {
  if (!isCronAuthorized(request.headers.get("authorization"), cronSecret())) {
    return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
  }
  const deadline = Date.now() + 52_000;
  const sb = channelDb();
  if (!sb) return NextResponse.json({ ok: false, message: "The database is not reachable here." }, { status: 503, headers: NO_STORE });

  // 1. WhatsApp on an old reader version.
  let whatsapp: { conversations: number; done: boolean } | null = null;
  const { data: stale } = await sb.from("sales_signals").select("id").eq("channel", "whatsapp").lt("reader_version", READER_VERSION).limit(1);
  if (Array.isArray(stale) && stale.length > 0) {
    const { data: run } = await sb.from("insight_backfill_runs").select("state").eq("id", "wa:rebuild").maybeSingle();
    const r = await rebuildWhatsApp(15_000, (run as { state?: string } | null)?.state === "done");
    whatsapp = r ? { conversations: r.conversations, done: r.done } : null;
  }

  // 2. Instagram and Facebook, rotating which account goes first.
  const ids = await metaAccountIds();
  const day = Math.floor(Date.now() / 86_400_000);
  const order = ids.map((_, i) => ids[(i + day) % ids.length]);
  const accounts: Pick<BackfillOutcome, "accountId" | "mode" | "state" | "code" | "threads" | "signals" | "calls">[] = [];
  for (const id of order) {
    const remaining = deadline - Date.now();
    if (remaining < 8_000) break;
    const mode = (await backfillDone(id)) ? "nightly" : "backfill";
    const r = await runMetaBackfill({ accountId: id, mode, budgetMs: Math.min(remaining - 3_000, 40_000) });
    if (!r) break;
    accounts.push({ accountId: r.accountId, mode: r.mode, state: r.state, code: r.code, threads: r.threads, signals: r.signals, calls: r.calls });
    // Meta's rate limit is shared with the inbox: once it pushes back, nothing more tonight.
    if (r.code === "usage_over_75" || r.code === "meta_4" || r.code === "meta_17" || r.code === "meta_32" || r.code === "meta_613") break;
  }
  return NextResponse.json({ ok: true, whatsapp, accounts }, { headers: NO_STORE });
}
