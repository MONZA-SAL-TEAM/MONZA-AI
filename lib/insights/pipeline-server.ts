/**
 * Connections & Data Pipeline Health — SERVER ONLY. Whether a key is SET is read here and only a yes/no
 * leaves the server (rule 11); counts come from insight_pipeline_counts (025). The shaping is pure in
 * lib/insights/pipeline.ts.
 */

import { channelToken } from "@/lib/env";
import { instagramLoginTokenEnv } from "@/lib/channels/live-map";
import { channelDb, listAccounts } from "@/lib/channels/store";
import { readMetaRuns } from "@/lib/insights/meta-backfill";
import { accountHealth, type AccountHealth, type PipelineCounts } from "@/lib/insights/pipeline";
import { AUTOREPLY_PILOT } from "@/lib/wasales/autoreply-pilot";

export type PipelineRead = { state: "ok"; accounts: AccountHealth[]; readAt: string } | { state: "unavailable"; reason: string };

export async function readPipeline(): Promise<PipelineRead> {
  const sb = channelDb();
  if (!sb) return { state: "unavailable", reason: "The database is not configured on this server." };
  try {
    const testPeers = AUTOREPLY_PILOT.chats.map((c) => c.peer);
    const [accounts, counts, runs, wa] = await Promise.all([
      listAccounts(),
      sb.rpc("insight_pipeline_counts", { p_test_peers: testPeers }),
      readMetaRuns().catch(() => null),
      sb.from("insight_backfill_runs").select("state, finished_at").eq("id", "wa:rebuild").maybeSingle(),
    ]);
    // A failed count is shown as "could not be read" on every account — never as zero.
    const byId = new Map<string, PipelineCounts>();
    if (!counts.error) {
      for (const r of (counts.data ?? []) as Record<string, unknown>[]) {
        const n = (k: string) => Number(r[k] ?? 0);
        const t = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : null);
        byId.set(String(r.account_id), {
          conversations: n("conversations"),
          customerMessages: n("customer_messages"),
          ourMessages: n("our_messages"),
          lastCustomerMessage: t("last_customer_message"),
          lastOurMessage: t("last_our_message"),
          labelled: n("labelled"),
          lastLabelled: t("last_labelled"),
          facts: n("facts"),
          unlabelledSinceRebuild: n("unlabelled_since_rebuild"),
          unlabelledBefore: n("unlabelled_before"),
          testMessages: n("test_messages"),
        });
      }
    } else {
      console.error(`[insights/pipeline] counts failed (${(counts.error as { code?: string }).code ?? "?"})`);
    }
    const runById = new Map((runs ?? []).map((r) => [r.accountId, r]));
    const waRun = wa.data as { state?: string; finished_at?: string } | null;
    const now = Date.now();
    const out = accounts.map((a) => {
      const igEnv = a.channel === "instagram" ? instagramLoginTokenEnv(a.brand) : null;
      const run = runById.get(a.id);
      return accountHealth(
        {
          id: a.id,
          channel: a.channel,
          brand: a.brand,
          label: a.displayName || a.id,
          externalId: a.externalId,
          connectedAt: a.connectedAt,
          keySet: channelToken(a.tokenEnv) !== null,
          instagramLoginKey: igEnv ? channelToken(igEnv) !== null : false,
          counts: byId.get(a.id) ?? null,
          run: run ? { state: run.state, code: run.code, threads: run.threads, signals: run.signals, updatedAt: run.updatedAt } : runs === null ? null : { state: "not_started", code: null, threads: 0, signals: 0, updatedAt: null },
          whatsappRebuild: a.channel === "whatsapp" ? { state: waRun?.state ?? null, finishedAt: waRun?.finished_at ?? null } : null,
        },
        now
      );
    });
    const order = ["whatsapp", "instagram", "facebook"];
    out.sort((x, y) => order.indexOf(x.channel) - order.indexOf(y.channel) || x.brand.localeCompare(y.brand));
    return { state: "ok", accounts: out, readAt: new Date(now).toISOString() };
  } catch (e) {
    console.error("[insights/pipeline] failed:", e instanceof Error ? e.message : "unknown");
    return { state: "unavailable", reason: "The pipeline could not be read just now." };
  }
}
