/**
 * How fast the team answers — PURE (Samer, 2026-10-12, the insights spec's team module). The read is
 * lib/insights/team-server.ts; tested in tests/insights-team.test.ts.
 *
 * Built from WHEN each side spoke (channel_messages for WhatsApp, channel_turns for Instagram and
 * Facebook — never the words):
 *   - a customer BURST starts at a customer message after anything else; its response is the first STAFF
 *     message after it. A bot reply is counted apart and is never a person's response.
 *   - raw minutes, and business minutes (Beirut: Mon–Fri 08:00–18:00, Sat 08:00–14:00, closed Sunday —
 *     the showroom's hours, lib/wasales/booking.ts).
 *   - per person who answered; a reply typed on the WhatsApp phone app has no name here and is shown as
 *     such, never guessed.
 */

import { beirutTime, beirutToUtc } from "@/lib/wasales/booking";

export interface TurnRow {
  conversation_id: string;
  at: string;
  direction: "in" | "out";
  author: "customer" | "staff" | "automation";
  staff_id: string | null;
  staff_name: string | null;
}

export interface TeamRows {
  turns: TurnRow[];
  /** Owned conversations. */
  owned: { conversation_id: string; owner_id: string; owner_name: string | null }[];
  alerts: { conversation_ref: string; status: string; created_at: string; kind: string }[];
}

export interface ResponderStats {
  key: string;
  name: string;
  answered: number;
  medianMinutes: number | null;
  p90Minutes: number | null;
  medianBusinessMinutes: number | null;
  within15: number;
  within60: number;
  sameDay: number;
}

export interface OwnerStats {
  ownerId: string;
  name: string;
  leads: number;
  waitingOnUs: number;
  noFollowUp: number;
}

export interface TeamReport {
  bursts: number;
  answered: number;
  overall: ResponderStats;
  people: ResponderStats[];
  /** Bursts the bot answered first (counted apart, never a person's speed). */
  botFirst: number;
  /** Conversations whose last word is the customer's, with no person answering yet. */
  unanswered: number;
  /** Open alerts older than the overdue line. */
  overdueAlerts: number;
  owners: OwnerStats[];
  noFollowUpDays: number;
  overdueHours: number;
}

export const PHONE_APP = "WhatsApp phone app (not attributed)";
const OPEN: Readonly<Record<number, [number, number] | null>> = { 0: null, 1: [480, 1080], 2: [480, 1080], 3: [480, 1080], 4: [480, 1080], 5: [480, 1080], 6: [480, 840] };

/** Minutes between two instants that fall inside the showroom's opening hours (Beirut). */
export function businessMinutes(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!(to > from)) return 0;
  let total = 0;
  let cursor = from;
  for (let guard = 0; guard < 400 && cursor < to; guard++) {
    const w = beirutTime(cursor);
    const window = OPEN[w.weekday];
    const dayStart = beirutToUtc(w.year, w.month, w.day, 0, 0);
    const nextDay = beirutToUtc(w.year, w.month, w.day + 1, 0, 0);
    if (window) {
      const open = dayStart + window[0] * 60_000;
      const close = dayStart + window[1] * 60_000;
      const a = Math.max(cursor, open);
      const b = Math.min(to, close);
      if (b > a) total += (b - a) / 60_000;
    }
    cursor = nextDay;
  }
  return Math.round(total);
}

function quantile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i];
}

function stats(key: string, name: string, items: readonly { raw: number; business: number; sameDay: boolean }[]): ResponderStats {
  const raw = items.map((i) => i.raw).sort((a, b) => a - b);
  const biz = items.map((i) => i.business).sort((a, b) => a - b);
  return {
    key,
    name,
    answered: items.length,
    medianMinutes: quantile(raw, 0.5),
    p90Minutes: quantile(raw, 0.9),
    medianBusinessMinutes: quantile(biz, 0.5),
    within15: items.filter((i) => i.raw <= 15).length,
    within60: items.filter((i) => i.raw <= 60).length,
    sameDay: items.filter((i) => i.sameDay).length,
  };
}

export function buildTeamReport(rows: TeamRows, now: string, opts: { noFollowUpDays?: number; overdueHours?: number } = {}): TeamReport {
  const noFollowUpDays = opts.noFollowUpDays ?? 3;
  const overdueHours = opts.overdueHours ?? 2;
  const nowMs = Date.parse(now);
  const byConv = new Map<string, TurnRow[]>();
  for (const t of rows.turns) (byConv.get(t.conversation_id) ?? byConv.set(t.conversation_id, []).get(t.conversation_id)!).push(t);

  const responses: { key: string; name: string; raw: number; business: number; sameDay: boolean }[] = [];
  let bursts = 0;
  let botFirst = 0;
  let unanswered = 0;
  const lastStaffAt = new Map<string, number>();
  const waitingOnUs = new Set<string>();

  for (const [conv, list] of byConv) {
    const turns = [...list].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    let burstAt: string | null = null;
    let botSeen = false;
    for (const t of turns) {
      if (t.author === "customer") {
        if (burstAt === null) {
          burstAt = t.at;
          botSeen = false;
          bursts++;
        }
        continue;
      }
      if (t.author === "automation") {
        if (burstAt !== null && !botSeen) {
          botFirst++;
          botSeen = true;
        }
        continue;
      }
      // A person.
      lastStaffAt.set(conv, Math.max(lastStaffAt.get(conv) ?? 0, Date.parse(t.at)));
      if (burstAt !== null) {
        const raw = Math.round((Date.parse(t.at) - Date.parse(burstAt)) / 60_000);
        const b = beirutTime(Date.parse(burstAt));
        const a = beirutTime(Date.parse(t.at));
        const key = t.staff_id ?? (t.staff_name ? `name:${t.staff_name}` : "phone-app");
        const name = t.staff_name ?? (t.staff_id ? "Staff" : PHONE_APP);
        responses.push({ key, name, raw, business: businessMinutes(burstAt, t.at), sameDay: a.year === b.year && a.month === b.month && a.day === b.day });
        burstAt = null;
      }
    }
    if (burstAt !== null) {
      unanswered++;
      waitingOnUs.add(conv);
    }
  }

  const byPerson = new Map<string, typeof responses>();
  for (const r of responses) (byPerson.get(r.key) ?? byPerson.set(r.key, []).get(r.key)!).push(r);
  const people = [...byPerson.entries()]
    .map(([key, items]) => stats(key, items[items.length - 1].name, items))
    .sort((a, b) => b.answered - a.answered || a.name.localeCompare(b.name));

  const owners = new Map<string, OwnerStats>();
  for (const o of rows.owned) {
    const s = owners.get(o.owner_id) ?? { ownerId: o.owner_id, name: o.owner_name ?? "Staff", leads: 0, waitingOnUs: 0, noFollowUp: 0 };
    s.leads++;
    if (waitingOnUs.has(o.conversation_id)) s.waitingOnUs++;
    const last = lastStaffAt.get(o.conversation_id);
    if (!last || nowMs - last > noFollowUpDays * 86_400_000) s.noFollowUp++;
    owners.set(o.owner_id, s);
  }

  const overdueAlerts = rows.alerts.filter((a) => a.status === "open" && nowMs - Date.parse(a.created_at) > overdueHours * 3_600_000).length;

  return {
    bursts,
    answered: responses.length,
    overall: stats("all", "Everyone", responses),
    people,
    botFirst,
    unanswered,
    overdueAlerts,
    owners: [...owners.values()].sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name)),
    noFollowUpDays,
    overdueHours,
  };
}

/* ── Sales hand-offs (Samer, 2026-10-12 master prompt, part 12) ─────────────────────────────── */

export interface HandoffRow {
  kind: string;
  created: number;
  open: number;
  /** Hand-offs a person replied to after the alert. */
  answered: number;
  medianMinutes: number | null;
  medianBusinessMinutes: number | null;
  /** Hand-offs whose chat has an owner. */
  owned: number;
}

/**
 * Every sales alert is a hand-off from the bot to a person. Its response is the first PERSON's message in
 * that chat after the alert was raised (a bot reply never counts). Grouped by the alert's kind.
 */
export function handoffs(rows: { alerts: { conversation_ref: string; status: string; created_at: string; kind: string }[]; turns: readonly TurnRow[]; ownedConvs: ReadonlySet<string> }): HandoffRow[] {
  const staffTurns = new Map<string, number[]>();
  for (const t of rows.turns) if (t.author === "staff") (staffTurns.get(t.conversation_id) ?? staffTurns.set(t.conversation_id, []).get(t.conversation_id)!).push(Date.parse(t.at));
  for (const list of staffTurns.values()) list.sort((a, b) => a - b);
  const byKind = new Map<string, { created: number; open: number; owned: number; mins: number[]; biz: number[] }>();
  for (const a of rows.alerts) {
    const g = byKind.get(a.kind) ?? byKind.set(a.kind, { created: 0, open: 0, owned: 0, mins: [], biz: [] }).get(a.kind)!;
    g.created++;
    if (a.status === "open") g.open++;
    if (rows.ownedConvs.has(a.conversation_ref)) g.owned++;
    const at = Date.parse(a.created_at);
    const reply = (staffTurns.get(a.conversation_ref) ?? []).find((t) => t >= at);
    if (reply !== undefined) {
      g.mins.push(Math.round((reply - at) / 60_000));
      g.biz.push(businessMinutes(a.created_at, new Date(reply).toISOString()));
    }
  }
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
  };
  return [...byKind.entries()]
    .map(([kind, g]) => ({ kind, created: g.created, open: g.open, answered: g.mins.length, medianMinutes: median(g.mins), medianBusinessMinutes: median(g.biz), owned: g.owned }))
    .sort((a, b) => b.created - a.created);
}
