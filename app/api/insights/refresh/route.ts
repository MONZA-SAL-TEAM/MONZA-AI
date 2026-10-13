import { NextResponse } from "next/server";
import { cronSecret } from "@/lib/env";
import { isCronAuthorized } from "@/lib/channels/retention";
import { channelDb } from "@/lib/channels/store";
import { backfillDone, metaAccountIds, runMetaBackfill, type BackfillOutcome } from "@/lib/insights/meta-backfill";
import { refreshInsightPeople } from "@/lib/insights/people-server";
import { storeDemand } from "@/lib/insights/demand-server";
import { rereadPending } from "@/lib/wasales/signal-server";
import { startCatchup } from "@/lib/insights/catchup-server";

/**
 * GET /api/insights/refresh — the nightly insights read (vercel.json, 02:00 UTC; Samer, 2026-10-12:
 * "every night"). Inside the route's 60 s:
 *
 *   1. WhatsApp conversations still read by an OLDER reader: the server-side re-read is started (it runs in
 *      its own steps until finished — lib/insights/catchup-server.ts).
 *   2. Each Instagram / Facebook account: its one-time history read continues where it stopped; once
 *      done, the newest threads are read, stopping at the first one already read and unchanged.
 *      The account that starts rotates each night, so none is starved.
 *   3. The per-person summaries (insight_people) are rebuilt for the Research Lab.
 *   4. The anonymous demand record (insight_demand_daily) is stored for recent months — not while a re-read
 *      is pending; the re-read stores it whole when it finishes.
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

  // 1. WhatsApp on an old reader version: the server-side re-read is started (or found already reading) and
  //    continues in its own steps (catchup-server.ts), so the night's minute stays for Meta.
  let whatsapp: string | null = null;
  if ((await rereadPending()) === true) {
    const { data: run } = await sb.from("insight_backfill_runs").select("state").eq("id", "wa:rebuild").maybeSingle();
    whatsapp = await startCatchup(new URL(request.url).origin, "wa", (run as { state?: string } | null)?.state === "done");
  }

  // 2. Instagram and Facebook, rotating which account goes first.
  const ids = await metaAccountIds();
  const day = Math.floor(Date.now() / 86_400_000);
  const order = ids.map((_, i) => ids[(i + day) % ids.length]);
  const accounts: Pick<BackfillOutcome, "accountId" | "mode" | "state" | "code" | "threads" | "signals" | "calls">[] = [];
  for (const id of order) {
    const remaining = deadline - Date.now();
    // Keep ~14 s for the per-person summaries and the demand record at the end.
    if (remaining < 22_000) break;
    const mode = (await backfillDone(id)) ? "nightly" : "backfill";
    // A history read already running on the server for this account owns its cursor: leave it alone.
    if (mode === "backfill") {
      const { data: lease } = await sb.from("insight_backfill_runs").select("lease_until").eq("id", `meta:${id}`).maybeSingle();
      const until = (lease as { lease_until?: string | null } | null)?.lease_until;
      if (until && Date.parse(until) > Date.now()) continue;
    }
    const r = await runMetaBackfill({ accountId: id, mode, budgetMs: Math.min(remaining - 13_000, 35_000) });
    if (!r) break;
    accounts.push({ accountId: r.accountId, mode: r.mode, state: r.state, code: r.code, threads: r.threads, signals: r.signals, calls: r.calls });
    // Meta's rate limit is shared with the inbox: once it pushes back, nothing more tonight.
    if (r.code === "usage_over_75" || r.code === "meta_4" || r.code === "meta_17" || r.code === "meta_32" || r.code === "meta_613") break;
  }
  // 3. The per-person summaries the Research Lab reads (migration 023).
  const people = deadline - Date.now() > 4_000 ? await refreshInsightPeople() : null;
  // 4. The anonymous demand record (027) for recent months — kept permanently, no client data.
  const demand = deadline - Date.now() > 3_000 ? await storeDemand("recent") : null;
  return NextResponse.json({ ok: true, whatsapp, accounts, people, demand }, { headers: NO_STORE });
}
