/**
 * Data quality — SERVER ONLY: how the labels were made (webhook, WhatsApp rebuild, Meta history), which
 * reader version made them, where each history read stands, and when the per-person summary was rebuilt.
 * Counts and codes only.
 */

import { channelDb } from "@/lib/channels/store";
import { readMetaRuns, type MetaRunView } from "@/lib/insights/meta-backfill";
import { READER_VERSION } from "@/lib/wasales/reader";

export interface QualityExtras {
  /** n null = could not be read. */
  sources: { key: string; n: number | null }[];
  readerVersions: { version: number; n: number | null }[];
  current: number;
  whatsappRebuild: { state: string | null; updatedAt: string | null };
  metaRuns: MetaRunView[];
  peopleRefreshedAt: string | null;
  peopleRows: number | null;
  /** The server-side WhatsApp re-read is running now (its lease is alive). */
  rereadRunning: boolean;
  /** Instagram customer messages recorded in the last 7 days. */
  instagram7d: number | null;
  /** When the permanent demand record was last stored; null = never. */
  demandStoredAt: string | null;
}

/** null = the count could not be read. Never 0: a health page that turns a failed query into "0" hides the failure. */
async function count(build: () => PromiseLike<{ count: number | null; error: unknown }>): Promise<number | null> {
  const { count: n, error } = await build();
  return error ? null : (n ?? 0);
}

export async function readQualityExtras(): Promise<QualityExtras | null> {
  const sb = channelDb();
  if (!sb) return null;
  const sources = await Promise.all(
    (["webhook", "whatsapp_rebuild", "meta_backfill"] as const).map(async (key) => ({ key, n: await count(() => sb.from("sales_signals").select("id", { count: "exact", head: true }).eq("source", key)) }))
  );
  const readerVersions = await Promise.all(
    Array.from({ length: READER_VERSION }, (_, i) => i + 1).map(async (version) => ({ version, n: await count(() => sb.from("sales_signals").select("id", { count: "exact", head: true }).eq("reader_version", version)) }))
  );
  const [{ data: wa }, metaRuns, { data: last }, peopleRows, instagram7d, { data: demand }] = await Promise.all([
    sb.from("insight_backfill_runs").select("state, updated_at, lease_until").eq("id", "wa:rebuild").maybeSingle(),
    readMetaRuns().catch(() => []),
    sb.from("insight_people").select("updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    count(() => sb.from("insight_people").select("person_key", { count: "exact", head: true })),
    count(() => sb.from("sales_signals").select("id", { count: "exact", head: true }).eq("channel", "instagram").gte("at", new Date(Date.now() - 7 * 86_400_000).toISOString())),
    sb.from("insight_demand_daily").select("computed_at").order("computed_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const w = wa as { state?: string; updated_at?: string; lease_until?: string | null } | null;
  return {
    sources,
    readerVersions: readerVersions.filter((r) => r.n !== 0),
    current: READER_VERSION,
    whatsappRebuild: { state: w?.state ?? null, updatedAt: w?.updated_at ?? null },
    metaRuns,
    peopleRefreshedAt: (last as { updated_at?: string } | null)?.updated_at ?? null,
    peopleRows,
    rereadRunning: Boolean(w?.lease_until && Date.parse(w.lease_until) > Date.now()),
    instagram7d,
    demandStoredAt: (demand as { computed_at?: string } | null)?.computed_at ?? null,
  };
}
