import type { Metadata } from "next";
import Link from "next/link";
import { requireInsightsAccess } from "@/lib/auth-server";
import { alertedPeople, phoneOfPerson, readAnalysis } from "@/lib/insights/analysis-server";
import { readCrmOutcomes } from "@/lib/insights/crm-server";
import { leadsView, STAGES, type Breakdown } from "@/lib/insights/leads";
import { attachNames } from "@/lib/insights/people-server";
import { labHref } from "@/lib/insights/query";
import { carName } from "@/lib/insights/facts";
import { longDate } from "@/lib/format";
import { STAGE_LABEL } from "@/lib/wasales/signal";
import { LOST_LABEL } from "@/lib/insights/outcomes";
import NotAllowed from "../NotAllowed";
import { InsightsNav, PeriodChips, parseDays } from "../parts";
import "../../board.css";
import "../insights.css";

export const metadata: Metadata = { title: "Customers & leads — Monza AI Insights" };
export const dynamic = "force-dynamic";

/**
 * /insights/customers — how many people, how far each got, who is ready now and who is being neglected.
 * Messages say what people ASKED; the test-drive calendar and the CRM say what HAPPENED. The two are
 * shown apart and never added together.
 */

const pct = (n: number | null, of: number | null) => (n === null || !of ? "—" : `${Math.round((n / of) * 100)}%`);
const SOURCE: Readonly<Record<string, string>> = { messages: "their words", monza_ai: "Monza AI", crm: "the CRM" };

function BreakdownTable({ title, rows }: { title: string; rows: readonly Breakdown[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="ins-panel">
      <h2 className="ins-h2">{title}</h2>
      <div className="ins-table-wrap">
        <table className="ins-table">
          <thead>
            <tr>
              <th scope="col"></th>
              <th scope="col">People</th>
              <th scope="col">Qualified</th>
              <th scope="col">Test drive booked</th>
              <th scope="col">Bought (CRM)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.label}</th>
                <td><Link href={labHref(r.q)}>{r.people}</Link></td>
                <td>{r.qualified} <span className="ins-known">{pct(r.qualified, r.people)}</span></td>
                <td><Link href={labHref({ ...r.q, testDriveBooked: true })}>{r.booked}</Link></td>
                <td>{r.won === null ? "—" : r.won}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireInsightsAccess("/insights/customers");
  if (!access.allowed) return <NotAllowed />;
  const days = parseDays((await searchParams).days);
  const [read, crm] = await Promise.all([readAnalysis(days), readCrmOutcomes(access.user)]);

  if (read.state !== "ok") {
    return (
      <div className="board">
        <header className="board-head">
          <p className="eyebrow">Insights · Customers &amp; leads</p>
          <h1 className="h1">Customers and leads</h1>
        </header>
        <InsightsNav current="/insights/customers" />
        <p className="board-note board-warn">Monza AI&apos;s database could not be read here, so nothing is shown.</p>
      </div>
    );
  }
  const v = leadsView({
    people: read.people,
    alerted: alertedPeople(read.rows, read.personOf),
    phoneOf: phoneOfPerson(read.rows),
    crm: crm.state === "ok" ? { state: "ok", byPhone: crm.data } : crm,
    sinceMs: days > 0 ? read.nowMs - days * 86_400_000 : 0,
    nowMs: read.nowMs,
  });
  const [ready, neglected] = await Promise.all([attachNames(v.readyNow), attachNames(v.neglected)]);
  const lab = labHref;

  return (
    <div className="board">
      <header className="board-head">
        <p className="eyebrow">Insights · Customers &amp; leads</p>
        <h1 className="h1">Customers and leads</h1>
        <p className="lede">
          People who wrote in the period ({days === 0 ? "all time" : `last ${days} days`}, by message date), each counted once. Messages say what they
          asked; the test-drive calendar and the CRM say what happened.
          {v.crm === "unavailable" ? " The CRM could not be read just now — its figures show —, never 0." : v.crm === "not_connected" ? " The CRM is not connected here." : ""}
        </p>
      </header>
      <InsightsNav current="/insights/customers" />
      <div className="board-tools">
        <PeriodChips path="/insights/customers" days={days} />
      </div>

      <section className="tiles" aria-label="At a glance">
        <div className="tile"><p className="tile-label">People</p><p className="tile-value"><Link href={lab({})}>{v.people}</Link></p><p className="tile-foot">{v.newInPeriod} first wrote in the period</p></div>
        <div className="tile"><p className="tile-label">Returning</p><p className="tile-value"><Link href={lab({ customerType: "returning" })}>{v.returning}</Link></p><p className="tile-foot">back after 30+ quiet days</p></div>
        <div className="tile"><p className="tile-label">Existing customers</p><p className="tile-value">{v.existingCustomers ?? "—"}</p><p className="tile-foot">bought, per the CRM (same mobile)</p></div>
        <div className="tile"><p className="tile-label">Waiting for a person</p><p className={`tile-value${v.waiting ? " urgent" : ""}`}><Link href={lab({ waiting: true })}>{v.waiting}</Link></p><p className="tile-foot">{v.unowned} qualified leads have no owner</p></div>
      </section>

      <section className="ins-panel">
        <h2 className="ins-h2">From first message to sale</h2>
        <div className="ins-table-wrap">
          <table className="ins-table">
            <thead>
              <tr>
                <th scope="col">Stage</th>
                <th scope="col">People</th>
                <th scope="col">Of the stage before</th>
                <th scope="col">Of everyone</th>
                <th scope="col">From</th>
                <th scope="col">Who is counted</th>
              </tr>
            </thead>
            <tbody>
              {v.stages.map((s) => (
                <tr key={s.def.key}>
                  <th scope="row">{s.def.label}</th>
                  <td>{s.n === null ? "—" : s.q ? <Link href={lab(s.q)}>{s.n}</Link> : s.n}</td>
                  <td>{s.fromPrevious === null ? "—" : `${Math.round(s.fromPrevious * 100)}%`}</td>
                  <td>{pct(s.n, v.people)}</td>
                  <td>{SOURCE[s.def.source]}</td>
                  <td className="ins-wrap">{s.def.definition}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="ins-known">
          Every percentage is of the people in this period. A stage from the CRM shows — when the CRM cannot be read. Median days from first message to
          a CRM order: {v.medianDaysToOrder ?? "—"}. Cancelled orders: {v.lost ?? "—"}. No CRM order: {v.outcomeUnknown ?? "—"} (not "lost" — the
          outcome is simply not recorded).
        </p>
      </section>

      <section className="tiles" aria-label="What we know about them">
        <div className="tile"><p className="tile-label">Know their budget</p><p className="tile-value">{v.knownBudget}</p><p className="tile-foot">{pct(v.knownBudget, v.people)} of people</p></div>
        <div className="tile"><p className="tile-label">Know their colour</p><p className="tile-value">{v.knownColour}</p><p className="tile-foot">{pct(v.knownColour, v.people)}</p></div>
        <div className="tile"><p className="tile-label">Know when they buy</p><p className="tile-value">{v.knownTimeline}</p><p className="tile-foot">{pct(v.knownTimeline, v.people)}</p></div>
        <div className="tile"><p className="tile-label">Several cars / chats</p><p className="tile-value">{v.multipleModels}</p><p className="tile-foot">named 2+ cars · {v.multipleChats} wrote on 2+ chats</p></div>
      </section>

      <section className="ins-panel">
        <h2 className="ins-h2">Why leads were lost</h2>
        {v.lostReasons.length === 0 ? (
          <p className="ins-empty">No lost lead recorded yet. Record one on a client&apos;s profile; a quiet lead is never assumed lost.</p>
        ) : (
          <ul className="ins-bars">
            {v.lostReasons.map((r) => (
              <li key={r.key}>
                <Link className="ins-bar-label ins-bar-link" href={lab({ lostReason: r.key })}>
                  {LOST_LABEL[r.key] ?? r.key}
                </Link>
                <span className="ins-bar-track">
                  <span className="ins-bar-fill" style={{ width: `${Math.max(2, (r.n / Math.max(...v.lostReasons.map((x) => x.n))) * 100)}%` }} />
                </span>
                <span className="ins-bar-value">{r.n}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="ins-known">Recorded by a person from a fixed list (the CRM keeps no reason). Study: <Link href={lab({ brochureThenQuiet: true })}>got a brochure, then went quiet</Link> · <Link href={lab({ colourSwitched: true })}>changed their colour</Link>.</p>
      </section>

      <section className="ins-grid">
        <BreakdownTable title="By car (named or by context)" rows={v.byModel} />
        <BreakdownTable title="By channel" rows={v.byChannel} />
        <BreakdownTable title="By what brought them" rows={v.bySource} />
      </section>

      <section className="ins-grid">
        <div className="ins-panel">
          <h2 className="ins-h2">Ready now</h2>
          <p className="ins-known">Said they want to buy or asked for a test drive, and have no CRM order yet. Newest first.</p>
          {ready.length === 0 ? <p className="ins-empty">Nobody right now.</p> : (
            <ul className="ins-people">
              {ready.map((p) => (
                <li key={p.key}>
                  <Link href={`/insights/clients/${encodeURIComponent(p.key)}`}>{p.name}</Link>{" "}
                  <span className="ins-known">
                    {STAGE_LABEL[p.stage]} · {[...p.models, ...p.contextModels].map(carName).join(", ") || "no car"} · {longDate(p.lastAt.slice(0, 10))}
                    {p.ownerId ? "" : " · no owner"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="ins-panel">
          <h2 className="ins-h2">Being neglected</h2>
          <p className="ins-known">Waiting for a person, or a qualified lead with no owner — quiet for more than a day.</p>
          {neglected.length === 0 ? <p className="ins-empty">Nobody right now.</p> : (
            <ul className="ins-people">
              {neglected.map((p) => (
                <li key={p.key}>
                  <Link href={`/insights/clients/${encodeURIComponent(p.key)}`}>{p.name}</Link>{" "}
                  <span className="ins-known">
                    {p.waiting ? "waiting" : "no owner"} · last message {longDate(p.lastAt.slice(0, 10))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <p className="ins-known">
        Stage definitions: {STAGES.map((s) => s.label).join(" → ")}. A lead with no message for 30 days and no sale is inactive ({v.inactive}), not lost.
      </p>
    </div>
  );
}
