/**
 * Data quality — SERVER ONLY: how the labels were made (webhook, WhatsApp rebuild, Meta history), which
 * reader version made them, where each history read stands, and when the per-person summary was rebuilt.
 * Counts and codes only.
 */

import { channelDb } from "@/lib/channels/store";
import { readMetaRuns, type MetaRunView } from "@/lib/insights/meta-backfill";
import { READER_VERSION } from "@/lib/wasales/reader";

export interface QualityExtras {
  sources: { key: string; n: number }[];
  readerVersions: { version: number; n: number }[];
  current: number;
  whatsappRebuild: { state: string | null; updatedAt: string | null };
  metaRuns: MetaRunView[];
  peopleRefreshedAt: string | null;
  peopleRows: number;
}

async function count(build: () => PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  const { count: n, error } = await build();
  return error ? 0 : (n ?? 0);
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
  const [{ data: wa }, metaRuns, { data: last }, peopleRows] = await Promise.all([
    sb.from("insight_backfill_runs").select("state, updated_at").eq("id", "wa:rebuild").maybeSingle(),
    readMetaRuns().catch(() => []),
    sb.from("insight_people").select("updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    count(() => sb.from("insight_people").select("person_key", { count: "exact", head: true })),
  ]);
  const w = wa as { state?: string; updated_at?: string } | null;
  return {
    sources,
    readerVersions: readerVersions.filter((r) => r.n > 0),
    current: READER_VERSION,
    whatsappRebuild: { state: w?.state ?? null, updatedAt: w?.updated_at ?? null },
    metaRuns,
    peopleRefreshedAt: (last as { updated_at?: string } | null)?.updated_at ?? null,
    peopleRows,
  };
}
