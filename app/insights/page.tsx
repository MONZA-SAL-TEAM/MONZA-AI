import type { Metadata } from "next";
import Link from "next/link";
import { requireInsightsAccess } from "@/lib/auth-server";
import { readInsightRows } from "@/lib/insights/insights-server";
import { buildPersonFacts, type PersonFacts } from "@/lib/insights/people";
import { executiveOverview, KPI_DEFINITIONS, type Kpi } from "@/lib/insights/overview";
import { leadsView } from "@/lib/insights/leads";
import { alertedPeople, phoneOfPerson } from "@/lib/insights/analysis-server";
import { readCrmOutcomes, readCrmStock } from "@/lib/insights/crm-server";
import { stockByModel, type CrmOutcome } from "@/lib/insights/crm";
import { labHref, matchesQuery, parseInsightQuery, toSearch, type InsightQuery } from "@/lib/insights/query";
import { LAB_CHOICES } from "@/lib/insights/lab";
import { longDate } from "@/lib/format";
import NotAllowed from "./NotAllowed";
import { InsightsNav, LinkedBars, Weekly } from "./parts";
import "../board.css";
import "./insights.css";

export const metadata: Metadata = { title: "Insights — Monza AI" };
export const dynamic = "force-dynamic";

/**
 * /insights — the Executive Overview (Samer, 2026-10-12): demand and commercial activity at a glance. Every
 * number is people (each once) unless it says messages, is compared with the equal period just before, and
 * opens exactly those people in the Research Lab. Filters are the Lab's own question.
 */

const DAY = 86_400_000;
const PERIODS: ReadonlyArray<[number, string]> = [
  [30, "30 days"],
  [90, "90 days"],
  [365, "12 months"],
  [0, "All time"],
];
const FILTERS: ReadonlyArray<[keyof InsightQuery, string]> = [
  ["brand", "Brand"],
  ["anyModel", "Car"],
  ["channel", "Channel"],
  ["language", "Language"],
  ["stage", "How far"],
  ["colour", "Colour"],
  ["customerType", "Customer type"],
  ["timeline", "Buying when"],
  ["firstTouch", "What brought them"],
];
const day = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso);

function Delta({ k }: { k: Kpi }) {
  if (k.value === null) return <span className="ins-known">unknown</span>;
  if (k.previous === null) return null;
  if (k.previous === 0) return <span className="ins-known">{k.value > 0 ? "new this period" : "—"}</span>;
  const d = Math.round(((k.value - k.previous) / k.previous) * 100);
  return (
    <span className={`ins-delta${d > 0 ? " is-up" : d < 0 ? " is-down" : ""}`} title={`Previous period: ${k.previous}`}>
      {d > 0 ? "▲" : d < 0 ? "▼" : "="} {Math.abs(d)}% vs {k.previous}
    </span>
  );
}

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireInsightsAccess("/insights");
  if (!access.allowed) return <NotAllowed />;
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");

  // The period: a preset, or a custom range (inclusive Beirut days are close enough to UTC days here).
  const nowMs = Date.now();
  const from = one("from");
  const to = one("to");
  const custom = day(from) && day(to) && from <= to;
  const days = custom ? 0 : [30, 90, 365, 0].includes(Number(one("days") || 90)) ? Number(one("days") || 90) : 90;
  const untilMs = custom ? Date.parse(`${to}T23:59:59Z`) : nowMs;
  const sinceMs = custom ? Date.parse(`${from}T00:00:00Z`) : days > 0 ? nowMs - days * DAY : 0;
  const q: InsightQuery = { ...parseInsightQuery(sp), days: undefined };
  const filterSearch = toSearch(q).replace(/^\?/, "");
  const periodSearch = custom ? `from=${from}&to=${to}` : `days=${days}`;

  const [read, crm, stockRead] = await Promise.all([readInsightRows(null), readCrmOutcomes(access.user), readCrmStock(access.user)]);
  if (read.state !== "ok") {
    return (
      <div className="board">
        <header className="board-head">
          <p className="eyebrow">Insights</p>
          <h1 className="h1">Executive overview</h1>
        </header>
        <InsightsNav current="/insights" />
        <p className="board-note board-warn">
          {read.state === "no_table" ? "The insights tables are not set up yet." : "Monza AI's database could not be read here, so nothing is shown — not zero."}
        </p>
      </div>
    );
  }
  const rows = read.rows;
  const all = buildPersonFacts(rows, read.extras);
  const firstEver = new Map(all.map((p) => [p.key, p.firstAt]));
  const phoneOf = phoneOfPerson(rows);
  const outcomeOf = crm.state === "ok" ? (p: PersonFacts): CrmOutcome | null => {
    const ph = phoneOf(p);
    return ph ? (crm.data[ph]?.outcome ?? null) : null;
  } : null;
  const span = sinceMs > 0 ? untilMs - sinceMs : untilMs - Math.min(...all.map((p) => Date.parse(p.firstAt)), untilMs);
  const window = { sinceMs: sinceMs || untilMs - span, untilMs };
  const prevWindow = { sinceMs: window.sinceMs - span, untilMs: window.sinceMs - 1 };
  const keep = (p: PersonFacts) => matchesQuery(p, q, nowMs, outcomeOf ?? undefined);
  const people = buildPersonFacts(rows, read.extras, window).filter(keep);
  const previous = sinceMs > 0 ? buildPersonFacts(rows, read.extras, prevWindow).filter(keep) : [];
  const leadByConv = new Map(rows.leadConversations.map((lc) => [lc.conversation_id, lc.lead_id]));
  const personOf = (conv: string) => (leadByConv.get(conv) ? `lead:${leadByConv.get(conv)}` : `chat:${conv}`);
  const keys = new Set(people.map((p) => p.key));
  const prevKeys = new Set(previous.map((p) => p.key));
  const inside = (at: string, w: { sinceMs: number; untilMs: number }) => {
    const t = Date.parse(at);
    return t >= w.sinceMs && t <= w.untilMs;
  };
  const signals = rows.signals.filter((s) => inside(s.at, window) && keys.has(personOf(s.conversation_id)));
  const previousSignals = rows.signals.filter((s) => inside(s.at, prevWindow) && prevKeys.has(personOf(s.conversation_id)));
  const overdueKeys = new Set(rows.alerts.filter((a) => a.status === "open" && nowMs - Date.parse(a.created_at) > 2 * 3_600_000).map((a) => personOf(a.conversation_ref)));
  const stock = stockRead.state === "ok" ? Object.fromEntries(stockByModel(stockRead.data)) : null;
  const o = executiveOverview({ people, previous, signals, previousSignals, firstEver, overdueKeys, outcomeOf, stock, window, nowMs });
  const funnel = leadsView({ people, alerted: alertedPeople(rows, personOf), phoneOf, crm: crm.state === "ok" ? { state: "ok", byPhone: crm.data } : crm, sinceMs: window.sinceMs, nowMs });
  // The Lab's "last message within N days" is the same people as "wrote in the period" for a preset period
  // ending now; a custom range opens the Lab without a period (it then shows the filters over all time).
  const lab = (extra: InsightQuery) => labHref({ ...q, ...extra, ...(!custom && [30, 90, 365].includes(days) ? { days } : {}) });
  if (!sinceMs) for (const k of o.kpis) k.previous = null; // all time has no period before it
  const href = (patch: string) => `/insights?${[patch, filterSearch].filter(Boolean).join("&")}`;

  return (
    <div className="board">
      <header className="board-head">
        <p className="eyebrow">Insights</p>
        <h1 className="h1">Executive overview</h1>
        <p className="lede">
          {longDate(new Date(window.sinceMs).toISOString().slice(0, 10))} – {longDate(new Date(untilMs).toISOString().slice(0, 10))}, compared with the
          same length before. A person is in the period when they wrote in it; each is counted once. CRM figures are what the CRM recorded for these
          people{crm.state === "unavailable" ? " — the CRM could not be read just now, so they show “unknown”" : crm.state === "not_connected" ? " — the CRM is not connected here" : ""}.
        </p>
      </header>
      <InsightsNav current="/insights" />

      <form className="ins-panel ins-filter" method="get" action="/insights">
        <div className="chips" role="group" aria-label="Period">
          {PERIODS.map(([d, label]) => (
            <Link key={d} className="chip" aria-pressed={!custom && days === d} href={href(`days=${d}`)}>
              {label}
            </Link>
          ))}
        </div>
        <div className="ins-lab-grid">
          <label className="ins-lab-field">
            <span className="cap">From</span>
            <input type="date" name="from" defaultValue={custom ? from : ""} />
          </label>
          <label className="ins-lab-field">
            <span className="cap">To</span>
            <input type="date" name="to" defaultValue={custom ? to : ""} />
          </label>
          {FILTERS.map(([field, label]) => (
            <label key={field} className="ins-lab-field">
              <span className="cap">{label}</span>
              <select name={field} defaultValue={String((q as Record<string, unknown>)[field] ?? "")}>
                <option value="">All</option>
                {(field === "brand" ? [{ value: "voyah", label: "VOYAH" }, { value: "mhero", label: "MHERO" }, { value: "monza", label: "Monza S.A.L." }] : (LAB_CHOICES[field === "anyModel" ? "anyModel" : field] ?? [])).map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {!custom && <input type="hidden" name="days" value={days} />}
        </div>
        <div className="rowcard-actions">
          <button type="submit" className="btn primary">
            Apply
          </button>
          {(filterSearch || custom) && (
            <Link className="btn quiet" href={`/insights?days=${custom ? 90 : days}`}>
              Clear filters
            </Link>
          )}
        </div>
      </form>

      <section className="ins-kpis" aria-label="Key figures">
        {o.kpis.map((k) => (
          <div key={k.key} className="ins-kpi" title={KPI_DEFINITIONS[k.key]}>
            <p className="tile-label">{k.label}</p>
            <p className="ins-kpi-value">{k.value === null ? "—" : k.q ? <Link href={lab(k.q)}>{k.value}</Link> : k.value}</p>
            <p className="ins-kpi-foot">
              <Delta k={k} />
              {k.foot ? <span className="ins-known"> · {k.foot}</span> : null}
            </p>
          </div>
        ))}
      </section>

      <section className="ins-grid">
        <div className="ins-panel">
          <Weekly values={o.newPerWeek} title="New leads" />
        </div>
        <div className="ins-panel">
          <Weekly values={o.messagesPerWeek} title="Customer messages" />
        </div>
        <div className="ins-panel">
          <Weekly values={o.buyingPerWeek} title="Chats saying they want to buy" />
        </div>
      </section>

      <section className="ins-panel">
        <h2 className="ins-h2">Demand by car</h2>
        <div className="ins-table-wrap">
          <table className="ins-table">
            <thead>
              <tr>
                <th scope="col">Car</th>
                <th scope="col">People (named or by context)</th>
                <th scope="col">Previous period</th>
                <th scope="col">Change</th>
                <th scope="col">CRM stock now</th>
              </tr>
            </thead>
            <tbody>
              {o.demand.map((d) => (
                <tr key={d.key}>
                  <th scope="row">
                    <Link href={`/insights/models/${d.key}`}>{d.label}</Link>
                  </th>
                  <td><Link href={lab(d.q)}>{d.n}</Link></td>
                  <td>{sinceMs > 0 ? d.previous : "—"}</td>
                  <td>{!sinceMs ? "—" : d.previous === 0 ? (d.n > 0 ? "new" : "—") : `${d.n >= d.previous ? "+" : ""}${Math.round(((d.n - d.previous) / d.previous) * 100)}%`}</td>
                  <td>{d.stockNow === null ? "unknown" : d.stockNow}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="ins-known">Change compares people with the equal period just before; a car nobody asked about before reads “new”, never an infinite growth.</p>
      </section>

      <section className="ins-panel">
        <h2 className="ins-h2">From first message to sale</h2>
        <div className="ins-funnel">
          {funnel.stages.map((s) => (
            <div key={s.def.key} className="ins-funnel-step" title={s.def.definition}>
              <p className="tile-label">{s.def.label}</p>
              <p className="ins-kpi-value">{s.n === null ? "—" : s.n}</p>
              <p className="ins-known">{s.fromPrevious === null ? "" : `${Math.round(s.fromPrevious * 100)}% of the step before`}</p>
            </div>
          ))}
        </div>
        <p className="ins-known">
          <Link href={`/insights/customers?days=${days || 0}`}>Customers and leads</Link> has each stage&apos;s definition, by car, channel and source, and who is ready now.
        </p>
      </section>

      <section className="ins-grid">
        <div className="ins-panel"><h2 className="ins-h2">Brands</h2><LinkedBars items={o.brands} title="Brands" of={o.kpis[0].value ?? undefined} /></div>
        <div className="ins-panel"><h2 className="ins-h2">Kinds of car</h2><LinkedBars items={o.types} title="Kinds of car" /></div>
        <div className="ins-panel">
          <h2 className="ins-h2">Colours wanted</h2>
          <LinkedBars items={o.colours} title="Colours" of={o.coverage.colour || undefined} />
          <p className="ins-known">Shares are of the {o.coverage.colour} people who named a colour.</p>
        </div>
        <div className="ins-panel"><h2 className="ins-h2">Channels</h2><LinkedBars items={o.channels} title="Channels" /></div>
        <div className="ins-panel"><h2 className="ins-h2">What brought them</h2><LinkedBars items={o.sources} title="Sources" /><p className="ins-known">&quot;Not tracked&quot; means we do not know — never &quot;organic&quot;.</p></div>
        <div className="ins-panel"><h2 className="ins-h2">Most asked</h2><LinkedBars items={o.questions} title="Questions" /></div>
        <div className="ins-panel"><h2 className="ins-h2">Concerns</h2><LinkedBars items={o.objections} title="Concerns" /></div>
        <div className="ins-panel"><h2 className="ins-h2">Languages</h2><LinkedBars items={o.languages} title="Languages" /></div>
        <div className="ins-panel">
          <h2 className="ins-h2">Budgets</h2>
          <LinkedBars items={o.budgets} title="Budgets" of={o.coverage.budget || undefined} />
          <p className="ins-known">Of the {o.coverage.budget} who said a budget.</p>
        </div>
        <div className="ins-panel">
          <h2 className="ins-h2">Buying when</h2>
          <LinkedBars items={o.timelines} title="Timelines" of={o.coverage.timeline || undefined} />
          <p className="ins-known">Of the {o.coverage.timeline} who said when.</p>
        </div>
        <div className="ins-panel">
          <h2 className="ins-h2">What the CRM recorded</h2>
          {o.outcomes ? <LinkedBars items={o.outcomes} title="CRM outcomes" /> : <p className="ins-empty">The CRM could not be read — unknown, not zero.</p>}
        </div>
      </section>
      <p className="ins-known">
        Hover a figure for its definition. Every bar and number opens those people in the <Link href="/insights/lab">Research Lab</Link>. Looking for the
        client list and car cards? <Link href={`/insights/clients?${periodSearch}`}>All clients</Link>.
      </p>
    </div>
  );
}
