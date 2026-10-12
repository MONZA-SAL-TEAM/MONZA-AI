/**
 * The per-person summary (insight_people, migration 023) — SERVER ONLY. Rebuilt from the signals and
 * facts (nightly, after a rebuild, and on "Refresh" in the Lab); read by the Research Lab, with names and
 * numbers joined at read time from MONZA AI's own leads and chats (never stored in the summary).
 */

import { channelDb } from "@/lib/channels/store";
import { readInsightRows } from "@/lib/insights/insights-server";
import { buildPersonFacts, type PersonFacts } from "@/lib/insights/people";
import { matchesQuery, type InsightQuery } from "@/lib/insights/query";
import { READER_VERSION } from "@/lib/wasales/reader";

function row(p: PersonFacts, at: string) {
  return {
    person_key: p.key,
    lead_id: p.leadId,
    conversation_ids: p.conversationIds,
    channels: p.channels,
    brands: p.brands,
    first_at: p.firstAt,
    last_at: p.lastAt,
    messages: p.messages,
    active_days: p.activeDays,
    stage: p.stage,
    language: p.language,
    topics: p.topics,
    models: p.models,
    primary_model: p.primaryModel,
    compared_models: p.comparedModels,
    rejected_models: p.rejectedModels,
    colours_wanted: p.coloursWanted,
    colours_rejected: p.coloursRejected,
    interior: p.interior,
    budget_band: p.budgetBand,
    budget_min: p.budgetMin,
    budget_max: p.budgetMax,
    budget_currency: p.budgetCurrency,
    timeline: p.timeline,
    city: p.city,
    purpose: p.purpose,
    competitors: p.competitors,
    concerns: p.concerns,
    needs: p.needs,
    financing: p.financing,
    trade_in: p.tradeIn,
    first_touch: p.firstTouch,
    owner_id: p.ownerId,
    waiting: p.waiting,
    ad_model: p.adModel,
    context_models: p.contextModels,
    categories: p.categories,
    unresolved: p.unresolved,
    mentions: p.mentions,
    colour_alternatives: p.colourAlternatives,
    test_drives_booked: p.testDrivesBooked,
    customer_type: p.customerType,
    reader_version: READER_VERSION,
    updated_at: at,
  };
}

type Row = ReturnType<typeof row>;

function factsOf(r: Row): PersonFacts {
  return {
    key: r.person_key,
    leadId: r.lead_id,
    conversationIds: r.conversation_ids,
    channels: r.channels,
    brands: r.brands,
    firstAt: r.first_at,
    lastAt: r.last_at,
    messages: r.messages,
    activeDays: r.active_days,
    stage: r.stage,
    language: r.language,
    topics: r.topics,
    models: r.models,
    primaryModel: r.primary_model,
    comparedModels: r.compared_models,
    rejectedModels: r.rejected_models,
    coloursWanted: r.colours_wanted,
    coloursRejected: r.colours_rejected,
    interior: r.interior,
    budgetBand: r.budget_band,
    budgetMin: r.budget_min === null ? null : Number(r.budget_min),
    budgetMax: r.budget_max === null ? null : Number(r.budget_max),
    budgetCurrency: r.budget_currency,
    timeline: r.timeline,
    city: r.city,
    purpose: r.purpose,
    competitors: r.competitors,
    concerns: r.concerns,
    needs: r.needs,
    financing: r.financing,
    tradeIn: r.trade_in,
    firstTouch: r.first_touch,
    ownerId: r.owner_id,
    waiting: r.waiting,
    adModel: r.ad_model ?? null,
    contextModels: r.context_models ?? [],
    categories: r.categories ?? [],
    unresolved: r.unresolved ?? [],
    mentions: r.mentions ?? [],
    colourAlternatives: r.colour_alternatives ?? [],
    testDrivesBooked: r.test_drives_booked ?? 0,
    customerType: (r.customer_type as PersonFacts["customerType"]) ?? "new",
  };
}

/** Rebuild every person's summary; people with no signal any more are removed. */
export async function refreshInsightPeople(): Promise<{ people: number } | null> {
  const sb = channelDb();
  if (!sb) return null;
  const read = await readInsightRows(null);
  if (read.state !== "ok") return null;
  const started = new Date().toISOString();
  const people = buildPersonFacts(read.rows, read.extras);
  for (let i = 0; i < people.length; i += 500) {
    const { error } = await sb.from("insight_people").upsert(people.slice(i, i + 500).map((p) => row(p, started)), { onConflict: "person_key" });
    if (error) {
      console.error(`[insights/people] not written (${(error as { code?: string }).code ?? "?"})`);
      return null;
    }
  }
  await sb.from("insight_people").delete().lt("updated_at", started);
  return { people: people.length };
}

export interface LabPerson extends PersonFacts {
  name: string;
  phone: string | null;
}

export type LabRead = { state: "ok"; people: LabPerson[]; total: number; refreshedAt: string | null } | { state: "unavailable" } | { state: "empty" };

/** The people who answer the question, newest first, with their names joined now. */
export async function readLab(q: InsightQuery, now = Date.now()): Promise<LabRead> {
  const sb = channelDb();
  if (!sb) return { state: "unavailable" };
  try {
    const out: Row[] = [];
    for (let from = 0; from < 100_000; from += 1000) {
      let query = sb.from("insight_people").select("*").order("last_at", { ascending: false });
      // The selective ones in the database; everything else in matchesQuery (one meaning, tested).
      if (q.model) query = query.contains("models", [q.model]);
      if (q.stage) query = query.eq("stage", q.stage);
      if (q.city) query = query.eq("city", q.city);
      if (q.budget) query = query.eq("budget_band", q.budget);
      if (q.timeline) query = query.eq("timeline", q.timeline);
      if (q.days) query = query.gte("last_at", new Date(now - q.days * 86_400_000).toISOString());
      const { data, error } = await query.range(from, from + 999);
      if (error) throw error;
      const rows = (data ?? []) as Row[];
      out.push(...rows);
      if (rows.length < 1000) break;
    }
    if (out.length === 0 && !Object.keys(q).length) return { state: "empty" };
    const matched = out.map(factsOf).filter((p) => matchesQuery(p, q, now));
    const refreshedAt = out.map((r) => r.updated_at).sort().at(-1) ?? null;

    // Names and numbers, from MONZA AI's own leads and chats, at read time.
    const shown = matched.slice(0, 2000);
    const leadIds = [...new Set(shown.map((p) => p.leadId).filter((x): x is string => Boolean(x)))];
    const convIds = [...new Set(shown.flatMap((p) => p.conversationIds))];
    const [leads, convs, accounts] = await Promise.all([
      leadIds.length ? sb.from("leads").select("id, display_name, phone").in("id", leadIds.slice(0, 2000)) : Promise.resolve({ data: [] }),
      convIds.length ? sb.from("channel_conversations").select("id, account_id, peer_external_id, peer_display").in("id", convIds.slice(0, 4000)) : Promise.resolve({ data: [] }),
      sb.from("channel_accounts").select("id, channel"),
    ]);
    const leadById = new Map(((leads.data ?? []) as { id: string; display_name: string | null; phone: string | null }[]).map((l) => [l.id, l]));
    const convById = new Map(((convs.data ?? []) as { id: string; account_id: string; peer_external_id: string; peer_display: string | null }[]).map((c) => [c.id, c]));
    const channelOf = new Map(((accounts.data ?? []) as { id: string; channel: string }[]).map((a) => [a.id, a.channel]));
    const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "") || null;
    const people: LabPerson[] = shown.map((p) => {
      const lead = p.leadId ? leadById.get(p.leadId) : undefined;
      const conv = p.conversationIds.map((c) => convById.get(c)).find(Boolean);
      const wa = p.conversationIds.map((c) => convById.get(c)).find((c) => c && channelOf.get(c.account_id) === "whatsapp");
      const phone = digits(lead?.phone) ?? (wa ? digits(wa.peer_external_id) : null);
      return { ...p, name: lead?.display_name?.trim() || conv?.peer_display?.trim() || (phone ? `+${phone}` : "Customer"), phone };
    });
    return { state: "ok", people, total: matched.length, refreshedAt };
  } catch (e) {
    console.error("[insights/lab] reading failed:", e instanceof Error ? e.message : JSON.stringify(e));
    return { state: "unavailable" };
  }
}
