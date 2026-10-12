import type { Metadata } from "next";
import Link from "next/link";
import { requireInsightsAccess } from "@/lib/auth-server";
import { readTeamReport } from "@/lib/insights/team-server";
import type { ResponderStats } from "@/lib/insights/team";
import NotAllowed from "../NotAllowed";
import { InsightsNav } from "../parts";
import "../../board.css";
import "../insights.css";

export const metadata: Metadata = {
  title: "Team — Monza AI Insights",
};
export const dynamic = "force-dynamic";

/**
 * /insights/team — how fast the team answers, and who owns which leads (Samer, 2026-10-12). From WHEN
 * each side spoke, never the words. Business minutes follow the showroom's hours (closed Sunday).
 */

const PERIODS = [7, 30, 90] as const;

function minutes(m: number | null): string {
  if (m === null) return "—";
  if (m < 60) return `${m} min`;
  if (m < 60 * 24) return `${Math.round((m / 60) * 10) / 10} h`;
  return `${Math.round((m / 1440) * 10) / 10} days`;
}
const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : "—");

function Row({ s }: { s: ResponderStats }) {
  return (
    <tr>
      <th scope="row">{s.name}</th>
      <td>{s.answered}</td>
      <td>{minutes(s.medianMinutes)}</td>
      <td>{minutes(s.medianBusinessMinutes)}</td>
      <td>{minutes(s.p90Minutes)}</td>
      <td>{pct(s.within15, s.answered)}</td>
      <td>{pct(s.within60, s.answered)}</td>
      <td>{pct(s.sameDay, s.answered)}</td>
    </tr>
  );
}

export default async function TeamPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireInsightsAccess("/insights/team");
  if (!access.allowed) return <NotAllowed />;
  const sp = await searchParams;
  const asked = Number(typeof sp.days === "string" ? sp.days : 30);
  const days = (PERIODS as readonly number[]).includes(asked) ? asked : 30;
  const read = await readTeamReport(days);

  return (
    <div className="board">
      <header className="board-head">
        <p className="eyebrow">
          <Link href="/insights">Insights</Link> · Team
        </p>
        <h1 className="h1">How fast we answer</h1>
        <p className="lede">
          From the moment a customer writes to the first reply by a person. Bot replies are counted apart. Business time counts only the
          showroom&apos;s hours (Mon–Fri 8–6, Sat 8–2, closed Sunday). Instagram and Facebook replies count from when they are sent from Monza AI
          or read in the nightly history.
        </p>
      </header>
      <InsightsNav current="/insights/team" />
      <div className="board-tools">
        <div className="chips" role="group" aria-label="Period">
          {PERIODS.map((d) => (
            <Link key={d} className="chip" aria-pressed={days === d} href={d === 30 ? "/insights/team" : `/insights/team?days=${d}`}>
              {d} days
            </Link>
          ))}
        </div>
      </div>

      {read.state === "unavailable" ? (
        <p className="board-note board-warn">Monza AI&apos;s database could not be read here, so nothing is shown.</p>
      ) : (
        <>
          <section className="tiles" aria-label="At a glance">
            <div className="tile"><p className="tile-label">Typical first reply</p><p className="tile-value">{minutes(read.report.overall.medianMinutes)}</p><p className="tile-foot">{minutes(read.report.overall.medianBusinessMinutes)} in business time</p></div>
            <div className="tile"><p className="tile-label">Answered within an hour</p><p className="tile-value">{pct(read.report.overall.within60, read.report.overall.answered)}</p><p className="tile-foot">of {read.report.answered} answered</p></div>
            <div className="tile"><p className="tile-label">Waiting on us</p><p className={`tile-value${read.report.unanswered > 0 ? " urgent" : ""}`}>{read.report.unanswered}</p><p className="tile-foot">chats whose last word is the customer&apos;s</p></div>
            <div className="tile"><p className="tile-label">Overdue alerts</p><p className={`tile-value${read.report.overdueAlerts > 0 ? " urgent" : ""}`}>{read.report.overdueAlerts}</p><p className="tile-foot">open for over {read.report.overdueHours} hours</p></div>
          </section>

          <section className="ins-panel">
            <h2 className="ins-h2">Who answered</h2>
            {read.report.people.length === 0 ? (
              <p className="ins-empty">No replies by a person in this period.</p>
            ) : (
              <div className="ins-table-wrap">
                <table className="ins-table">
                  <thead>
                    <tr>
                      <th scope="col">Person</th>
                      <th scope="col">Replies</th>
                      <th scope="col">Typical</th>
                      <th scope="col">Business time</th>
                      <th scope="col">Slowest 10%</th>
                      <th scope="col">≤ 15 min</th>
                      <th scope="col">≤ 1 hour</th>
                      <th scope="col">Same day</th>
                    </tr>
                  </thead>
                  <tbody>
                    {read.report.people.map((s) => (
                      <Row key={s.key} s={s} />
                    ))}
                    <Row s={read.report.overall} />
                  </tbody>
                </table>
              </div>
            )}
            <p className="ins-known">
              {read.report.bursts} times a customer wrote; {read.report.botFirst} first answered by the bot. Replies typed on the WhatsApp phone app
              carry no name.
            </p>
          </section>

          <section className="ins-panel">
            <h2 className="ins-h2">Owned leads</h2>
            {read.report.owners.length === 0 ? (
              <p className="ins-empty">Nobody has taken a lead yet. Use &quot;Take this lead&quot; in the inbox.</p>
            ) : (
              <div className="ins-table-wrap">
                <table className="ins-table">
                  <thead>
                    <tr>
                      <th scope="col">Owner</th>
                      <th scope="col">Leads</th>
                      <th scope="col">Waiting on us</th>
                      <th scope="col">No follow-up in {read.report.noFollowUpDays} days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {read.report.owners.map((o) => (
                      <tr key={o.ownerId}>
                        <th scope="row">{o.name}</th>
                        <td>{o.leads}</td>
                        <td>{o.waitingOnUs}</td>
                        <td>{o.noFollowUp}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
