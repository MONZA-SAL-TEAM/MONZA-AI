/**
 * What the insights reader concluded about each person, for the leads feed — SERVER ONLY (it holds
 * the service client). Reads insight_people: labels only, never a name, a number or a word.
 */
import { channelDb } from "@/lib/channels/store";
import { carName } from "@/lib/insights/facts";
import { STAGE_LABEL, type Stage } from "@/lib/wasales/signal";
import type { LeadFacts } from "@/lib/leads/feed";

const RANK: Readonly<Record<Stage, number>> = { buying: 5, test_drive: 4, pricing: 3, interested: 2, asking: 1, wrote: 0 };

/**
 * By person key ("lead:<id>" / "chat:<id>", the same keys listPeople uses). An unreadable table
 * gives an EMPTY map: the feed then carries no stage at all, which the page shows as "not read
 * yet" — never as everybody having only written.
 */
export async function readLeadFacts(): Promise<Map<string, LeadFacts>> {
  const out = new Map<string, LeadFacts>();
  const sb = channelDb();
  if (!sb) return out;
  try {
    for (let from = 0; from < 20_000; from += 1000) {
      const { data, error } = await sb.from("insight_people").select("person_key, stage, primary_model").order("person_key").range(from, from + 999);
      if (error) return new Map();
      const rows = (data ?? []) as { person_key: string; stage: string | null; primary_model: string | null }[];
      for (const r of rows) {
        const stage = r.stage as Stage | null;
        if (!stage || !(stage in RANK)) continue;
        out.set(r.person_key, { stage, stageLabel: STAGE_LABEL[stage], stageRank: RANK[stage], mainCar: r.primary_model ? carName(r.primary_model) : null });
      }
      if (rows.length < 1000) break;
    }
    return out;
  } catch {
    return new Map();
  }
}
