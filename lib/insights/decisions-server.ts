/**
 * The Decision Center — SERVER ONLY. Reads the facts (MONZA AI's own labels, chats and alerts; the CRM AS
 * THE VIEWER, never stored), runs the fixed rules (decisions.ts), keeps the tracked items in step
 * (insight_decisions, 028) and reads them back with names joined at read time.
 *
 * Keeping in step, on every look:
 *   - a rule that fires for a subject with no live item opens one — unless a person DISMISSED that same
 *     item in the last 7 days (a list that keeps re-proposing what was refused gets ignored);
 *   - a live item whose condition still holds is refreshed (its facts, severity, last seen);
 *   - a live item whose rule was checked and no longer fires is CLEARED by itself — but only for rules that
 *     were actually checked (a CRM that could not be read clears no stock item).
 * Every change writes insight_decision_events.
 */

import type { StaffIdentity } from "@/lib/connectors/types";
import { channelDb } from "@/lib/channels/store";
import { encodeThreadId } from "@/lib/channels/live-map";
import { readInsightRows } from "@/lib/insights/insights-server";
import { buildPersonFacts, type PersonFacts } from "@/lib/insights/people";
import { phoneOfPerson } from "@/lib/insights/analysis-server";
import { readCrmOutcomes, readCrmSales, readCrmStock } from "@/lib/insights/crm-server";
import { salesByModel, stockByModel, type CarStock, type CrmOutcome, type ModelSales } from "@/lib/insights/crm";
import { attachNames } from "@/lib/insights/people-server";
import { rereadPending } from "@/lib/wasales/signal-server";
import { demandLevels, findDecisions, morningNumbers, RULES, type DecisionHit, type DemandLevels, type MorningNumbers, type RuleKey, type Severity } from "@/lib/insights/decisions";

const DAY = 86_400_000;
const LIVE = ["open", "acknowledged", "escalated"] as const;

export type DecisionState = "open" | "acknowledged" | "escalated" | "resolved" | "dismissed" | "cleared";

export interface DecisionItem {
  id: string;
  rule: RuleKey;
  subject: string;
  conversationId: string | null;
  personKey: string | null;
  model: string | null;
  severity: Severity;
  state: DecisionState;
  facts: Record<string, unknown>;
  dueAt: string | null;
  assignedTo: string | null;
  assignedName: string | null;
  firstSeen: string;
  lastSeen: string;
  closedAt: string | null;
  closedName: string | null;
  /** Joined at read time, for a person's item: their name and the chat to open. */
  personName: string | null;
  threadId: string | null;
}

export interface Effectiveness {
  /** Last 30 days. */
  opened: number;
  resolved: number;
  cleared: number;
  dismissed: number;
  /** Median hours from opening to resolved or cleared. */
  medianHoursToClose: number | null;
}

export type DecisionCenterRead =
  | {
      state: "ok";
      items: DecisionItem[];
      recentlyClosed: DecisionItem[];
      morning: MorningNumbers;
      levels: DemandLevels[];
      effectiveness: Effectiveness;
      crm: "ok" | "not_connected" | "unavailable";
      salesKnown: boolean;
    }
  | { state: "unavailable" };

interface Row {
  id: string;
  rule: RuleKey;
  subject: string;
  conversation_id: string | null;
  person_key: string | null;
  model: string | null;
  severity: Severity;
  state: DecisionState;
  facts: Record<string, unknown> | null;
  due_at: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  first_seen: string;
  last_seen: string;
  closed_at: string | null;
  closed_name: string | null;
}

const COLUMNS = "id, rule, subject, conversation_id, person_key, model, severity, state, facts, due_at, assigned_to, assigned_name, first_seen, last_seen, closed_at, closed_name";

/** Apply the rules' hits to the stored items. Best effort: a failure leaves the items as they were. */
async function syncItems(hits: readonly DecisionHit[], evaluated: readonly RuleKey[], validConvs: ReadonlySet<string>): Promise<void> {
  const sb = channelDb();
  if (!sb) return;
  const now = new Date().toISOString();
  const { data: liveData, error } = await sb.from("insight_decisions").select("id, rule, subject").in("state", [...LIVE]).limit(5000);
  if (error) throw error;
  const live = new Map(((liveData ?? []) as { id: string; rule: string; subject: string }[]).map((r) => [`${r.rule}|${r.subject}`, r.id]));
  const { data: dismissedData } = await sb.from("insight_decisions").select("rule, subject").eq("state", "dismissed").gte("closed_at", new Date(Date.now() - 7 * DAY).toISOString()).limit(5000);
  const dismissed = new Set(((dismissedData ?? []) as { rule: string; subject: string }[]).map((r) => `${r.rule}|${r.subject}`));

  const seen = new Set<string>();
  const fresh: Record<string, unknown>[] = [];
  const refreshed: Record<string, unknown>[] = [];
  for (const h of hits) {
    const k = `${h.rule}|${h.subject}`;
    seen.add(k);
    const id = live.get(k);
    if (id) {
      refreshed.push({ id, rule: h.rule, subject: h.subject, facts: h.facts, severity: h.severity, due_at: h.dueAt, last_seen: now, model: h.model });
    } else if (!dismissed.has(k)) {
      fresh.push({
        rule: h.rule,
        subject: h.subject,
        conversation_id: h.conversationId && validConvs.has(h.conversationId) ? h.conversationId : null,
        person_key: h.personKey,
        model: h.model,
        severity: h.severity,
        facts: h.facts,
        due_at: h.dueAt,
        first_seen: now,
        last_seen: now,
      });
    }
  }
  // Still true: refreshed in batches (the row exists, so this only updates the columns named).
  for (let i = 0; i < refreshed.length; i += 500) {
    const { error: e } = await sb.from("insight_decisions").upsert(refreshed.slice(i, i + 500), { onConflict: "id" });
    if (e) throw e;
  }
  for (let i = 0; i < fresh.length; i += 200) {
    // Two people opening the page at once: the unique index refuses the second copy, which is fine.
    const { data: inserted } = await sb.from("insight_decisions").insert(fresh.slice(i, i + 200)).select("id");
    const ids = ((inserted ?? []) as { id: string }[]).map((r) => r.id);
    if (ids.length) await sb.from("insight_decision_events").insert(ids.map((decision_id) => ({ decision_id, action: "opened" })));
  }
  const gone = [...live.entries()].filter(([k]) => !seen.has(k) && evaluated.includes(k.split("|")[0] as RuleKey)).map(([, id]) => id);
  for (let i = 0; i < gone.length; i += 200) {
    const chunk = gone.slice(i, i + 200);
    const { data: cleared } = await sb.from("insight_decisions").update({ state: "cleared", closed_at: now, closed_name: "Cleared by itself" }).in("id", chunk).in("state", [...LIVE]).select("id");
    const ids = ((cleared ?? []) as { id: string }[]).map((r) => r.id);
    if (ids.length) await sb.from("insight_decision_events").insert(ids.map((decision_id) => ({ decision_id, action: "cleared" })));
  }
}

async function count(build: () => PromiseLike<{ count: number | null; error: unknown }>): Promise<number | null> {
  const { count: n, error } = await build();
  return error ? null : (n ?? 0);
}

/** Everything the Decision Center shows, after bringing the items up to date. */
export async function readDecisionCenter(viewer: StaffIdentity, nowMs = Date.now()): Promise<DecisionCenterRead> {
  const sb = channelDb();
  if (!sb) return { state: "unavailable" };
  try {
    const [read, stockRead, outcomes, salesRead, convData, pending, igAccounts, demandLast] = await Promise.all([
      readInsightRows(null),
      readCrmStock(viewer),
      readCrmOutcomes(viewer),
      readCrmSales(viewer),
      (async () => {
        const out: { id: string; account_id: string; last_inbound_at: string | null; last_message_at: string | null; assigned_to: string | null; meta_conversation_id: string | null }[] = [];
        for (let from = 0; from < 50_000; from += 1000) {
          const { data, error } = await sb.from("channel_conversations").select("id, account_id, last_inbound_at, last_message_at, assigned_to, meta_conversation_id").range(from, from + 999);
          if (error) throw error;
          out.push(...((data ?? []) as typeof out));
          if (!data || data.length < 1000) break;
        }
        return out;
      })(),
      rereadPending(),
      sb.from("channel_accounts").select("id").eq("channel", "instagram"),
      sb.from("insight_demand_daily").select("computed_at").order("computed_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (read.state !== "ok") return { state: "unavailable" };
    const rows = read.rows;
    const people = buildPersonFacts(rows, read.extras);
    const leadByConv = new Map(rows.leadConversations.map((lc) => [lc.conversation_id, lc.lead_id]));
    const personOf = (conv: string) => (leadByConv.get(conv) ? `lead:${leadByConv.get(conv)}` : `chat:${conv}`);
    const phoneOf = phoneOfPerson(rows);
    const stock: Record<string, CarStock> | null = stockRead.state === "ok" ? Object.fromEntries(stockByModel(stockRead.data)) : null;
    const sales: Record<string, ModelSales> | null = salesRead.state === "ok" ? Object.fromEntries(salesByModel(salesRead.data, nowMs)) : null;
    const outcomeOf = outcomes.state === "ok" ? (p: PersonFacts): CrmOutcome | null => {
      const ph = phoneOf(p);
      return ph ? (outcomes.data[ph]?.outcome ?? null) : null;
    } : null;
    const orderedModels = outcomes.state === "ok" ? (p: PersonFacts): readonly string[] => {
      const ph = phoneOf(p);
      return ph ? (outcomes.data[ph]?.models ?? []) : [];
    } : null;
    const igIds = ((igAccounts.data ?? []) as { id: string }[]).map((a) => a.id);
    const igSignals = igIds.length ? await count(() => sb.from("sales_signals").select("id", { count: "exact", head: true }).eq("channel", "instagram").gte("at", new Date(nowMs - 7 * DAY).toISOString())) : 0;
    const withMobile = people.filter((p) => phoneOf(p) !== null);

    const run = findDecisions({
      nowMs,
      people,
      conversations: convData.map((c) => ({ id: c.id, lastInboundAt: c.last_inbound_at, lastMessageAt: c.last_message_at, ownerId: c.assigned_to })),
      personOf,
      openAlerts: rows.alerts.filter((a) => a.status === "open"),
      bookedConvs: new Set(Object.keys(read.extras.bookingsByConv ?? {})),
      stock,
      health: {
        rereadPending: pending,
        instagramAccounts: igIds.length,
        instagramSignals7d: igSignals,
        demandLastStored: (demandLast.data as { computed_at?: string } | null)?.computed_at ?? null,
        withMobile: withMobile.length,
        crmMatched: outcomes.state === "ok" ? withMobile.filter((p) => outcomes.data[phoneOf(p)!] !== undefined).length : null,
      },
    });
    await syncItems(run.hits, run.evaluated, new Set(convData.map((c) => c.id))).catch((e) => console.error("[decisions] not kept in step:", e instanceof Error ? e.message : JSON.stringify(e)));

    const [{ data: liveRows }, { data: closedRows }, { data: events }] = await Promise.all([
      sb.from("insight_decisions").select(COLUMNS).in("state", [...LIVE]).limit(2000),
      sb.from("insight_decisions").select(COLUMNS).in("state", ["resolved", "dismissed", "cleared"]).gte("closed_at", new Date(nowMs - 7 * DAY).toISOString()).order("closed_at", { ascending: false }).limit(50),
      sb.from("insight_decisions").select("state, first_seen, closed_at").gte("first_seen", new Date(nowMs - 30 * DAY).toISOString()).limit(10_000),
    ]);

    // Names and the chat to open, joined now (never stored with the item).
    const keyed = new Map(people.map((p) => [p.key, p]));
    const shown = [...((liveRows ?? []) as Row[]), ...((closedRows ?? []) as Row[])];
    const named = await attachNames([...new Set(shown.map((r) => r.person_key).filter((k): k is string => Boolean(k)))].map((k) => keyed.get(k)).filter((p): p is PersonFacts => Boolean(p)));
    const nameOf = new Map(named.map((p) => [p.key, p.name]));
    const convById = new Map(convData.map((c) => [c.id, c]));
    const waAccounts = new Set(rows.signals.filter((s) => s.channel === "whatsapp").map((s) => s.account_id));
    const threadOf = (conv: string | null) => {
      const c = conv ? convById.get(conv) : undefined;
      if (!c) return null;
      if (waAccounts.has(c.account_id)) return encodeThreadId(c.account_id, c.id);
      return c.meta_conversation_id ? encodeThreadId(c.account_id, c.meta_conversation_id) : null;
    };
    const item = (r: Row): DecisionItem => ({
      id: r.id,
      rule: r.rule,
      subject: r.subject,
      conversationId: r.conversation_id,
      personKey: r.person_key,
      model: r.model,
      severity: r.severity,
      state: r.state,
      facts: r.facts ?? {},
      dueAt: r.due_at,
      assignedTo: r.assigned_to,
      assignedName: r.assigned_name,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      closedAt: r.closed_at,
      closedName: r.closed_name,
      personName: r.person_key ? (nameOf.get(r.person_key) ?? null) : null,
      threadId: threadOf(r.conversation_id ?? (r.subject.length === 36 ? r.subject : null)),
    });
    const RANK: Record<Severity, number> = { critical: 0, high: 1, normal: 2 };
    const items = ((liveRows ?? []) as Row[]).map(item).sort((a, b) => RANK[a.severity] - RANK[b.severity] || (a.dueAt ?? a.firstSeen).localeCompare(b.dueAt ?? b.firstSeen));

    const ev = (events ?? []) as { state: string; first_seen: string; closed_at: string | null }[];
    const hours = ev.filter((e) => (e.state === "resolved" || e.state === "cleared") && e.closed_at).map((e) => (Date.parse(e.closed_at!) - Date.parse(e.first_seen)) / 3_600_000).sort((a, b) => a - b);
    const effectiveness: Effectiveness = {
      opened: ev.length,
      resolved: ev.filter((e) => e.state === "resolved").length,
      cleared: ev.filter((e) => e.state === "cleared").length,
      dismissed: ev.filter((e) => e.state === "dismissed").length,
      medianHoursToClose: hours.length ? Math.round(hours[Math.floor((hours.length - 1) / 2)] * 10) / 10 : null,
    };

    return {
      state: "ok",
      items,
      recentlyClosed: ((closedRows ?? []) as Row[]).map(item),
      morning: morningNumbers({ nowMs, people, hits: run.hits, stock, outcomeOf }),
      levels: demandLevels({ people: people.filter((p) => Date.parse(p.lastAt) >= nowMs - 90 * DAY), stock, sales, orderedModels }),
      effectiveness,
      crm: stockRead.state,
      salesKnown: sales !== null,
    };
  } catch (e) {
    console.error("[decisions] reading failed:", e instanceof Error ? e.message : JSON.stringify(e));
    return { state: "unavailable" };
  }
}

export type DecisionAction = "assign" | "acknowledge" | "escalate" | "resolve" | "dismiss" | "reopen";

/** A person acting on an item. Only live items can be acted on, except "reopen" of a closed one. */
export async function actOnDecision(id: string, action: DecisionAction, by: { id: string; name: string }, to: { id: string; name: string | null } | null): Promise<{ ok: true; item: { id: string; state: DecisionState; conversationId: string | null } } | { ok: false; status: 404 | 409 | 503; reason: string }> {
  const sb = channelDb();
  if (!sb) return { ok: false, status: 503, reason: "The database is not reachable here." };
  const { data } = await sb.from("insight_decisions").select("id, rule, subject, state, conversation_id").eq("id", id).maybeSingle();
  const row = data as { id: string; rule: string; subject: string; state: DecisionState; conversation_id: string | null } | null;
  if (!row) return { ok: false, status: 404, reason: "That item could not be found." };
  const live = (LIVE as readonly string[]).includes(row.state);
  if (action === "reopen" ? live : !live) return { ok: false, status: 409, reason: action === "reopen" ? "It is still open." : "It was already closed." };
  const now = new Date().toISOString();
  const patch: Record<string, unknown> =
    action === "assign"
      ? { assigned_to: to?.id ?? null, assigned_name: to?.name ?? null }
      : action === "acknowledge"
        ? { state: "acknowledged" }
        : action === "escalate"
          ? { state: "escalated", severity: "critical" }
          : action === "reopen"
            ? { state: "open", closed_at: null, closed_by: null, closed_name: null }
            : { state: action === "resolve" ? "resolved" : "dismissed", closed_at: now, closed_by: by.id, closed_name: by.name };
  let q = sb.from("insight_decisions").update(patch).eq("id", id).eq("state", row.state);
  if (action === "reopen") {
    // A newer live item for the same thing may exist already; then this one stays closed.
    const { data: twin } = await sb.from("insight_decisions").select("id").eq("rule", row.rule).eq("subject", row.subject).in("state", [...LIVE]).limit(1);
    if (Array.isArray(twin) && twin.length) return { ok: false, status: 409, reason: "A newer item for the same thing is open." };
    q = sb.from("insight_decisions").update(patch).eq("id", id).eq("state", row.state);
  }
  const { data: changed, error } = await q.select("id, state, conversation_id");
  if (error) return { ok: false, status: 503, reason: "It could not be saved just now." };
  if (!Array.isArray(changed) || changed.length === 0) return { ok: false, status: 409, reason: "Someone changed it a moment ago — reload." };
  await sb.from("insight_decision_events").insert({
    decision_id: id,
    action: action === "acknowledge" ? "acknowledged" : action === "escalate" ? "escalated" : action === "resolve" ? "resolved" : action === "dismiss" ? "dismissed" : action === "reopen" ? "reopened" : "assigned",
    by_staff: by.id,
    by_name: by.name.slice(0, 120),
    to_staff: to?.id ?? null,
    to_name: to?.name?.slice(0, 120) ?? null,
  });
  const c = changed[0] as { id: string; state: DecisionState; conversation_id: string | null };
  return { ok: true, item: { id: c.id, state: c.state, conversationId: c.conversation_id } };
}

/** Rule definitions for the page (plain data). */
export const RULE_LIST = Object.values(RULES);
