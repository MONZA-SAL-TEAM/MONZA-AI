import type { Metadata } from "next";
import Link from "next/link";
import { requireInsightsAccess } from "@/lib/auth-server";
import { colourMatrix } from "@/lib/insights/analysis";
import { readAnalysis } from "@/lib/insights/analysis-server";
import { stockByModel } from "@/lib/insights/crm";
import { readCrmStock } from "@/lib/insights/crm-server";
import { labHref } from "@/lib/insights/query";
import NotAllowed from "../NotAllowed";
import { InsightsNav, LinkedBars, PeriodChips, parseDays } from "../parts";
import "../../board.css";
import "../insights.css";

export const metadata: Metadata = { title: "Colours — Monza AI Insights" };
export const dynamic = "force-dynamic";

/**
 * /insights/colours — which exterior and interior colours people want per car, which they refuse, beside
 * the CRM's stock (read as the viewer). Shares are over the people who named a colour for that car;
 * the unknowns are shown apart, never in the denominator. "Strict" counts only colours the customer tied
 * to the car in their own words.
 */
export default async function ColoursPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireInsightsAccess("/insights/colours");
  if (!access.allowed) return <NotAllowed />;
  const sp = await searchParams;
  const days = parseDays(sp.days);
  const strict = sp.strict === "1";
  const [read, crm] = await Promise.all([readAnalysis(days), readCrmStock(access.user)]);
  const stock = crm.state === "ok" ? Object.fromEntries(stockByModel(crm.data)) : null;
  const rows = read.state === "ok" ? colourMatrix(read.rows.observations ?? [], read.people, read.personOf, strict, stock).filter((r) => r.known + r.unknown > 0 || (r.stockNow ?? 0) > 0) : [];

  return (
    <div className="board">
      <header className="board-head">
        <p className="eyebrow">Insights · Colours</p>
        <h1 className="h1">Colours: demand and stock</h1>
        <p className="lede">
          People who wanted or asked about each colour, per car — and how many of that colour the CRM has to sell now.{" "}
          {crm.state === "unavailable" ? "The CRM's stock could not be read just now." : crm.state === "not_connected" ? "The CRM is not connected here." : ""}
        </p>
      </header>
      <InsightsNav current="/insights/colours" />
      <div className="board-tools">
        <PeriodChips path="/insights/colours" days={days} extra={strict ? "&strict=1" : ""} />
        <div className="chips" role="group" aria-label="Which colours count">
          <Link className="chip" aria-pressed={!strict} href={`/insights/colours?days=${days}`}>
            Every colour tied to a car
          </Link>
          <Link className="chip" aria-pressed={strict} href={`/insights/colours?days=${days}&strict=1`}>
            Only when they named the car themselves
          </Link>
        </div>
      </div>
      {read.state !== "ok" ? (
        <p className="board-note board-warn">Monza AI&apos;s database could not be read here, so nothing is shown.</p>
      ) : rows.length === 0 ? (
        <p className="board-empty">No colour has been named yet in this period.</p>
      ) : (
        <ul className="ins-cars">
          {rows.map((r) => (
            <li key={r.code} className="ins-car">
              <div className="ins-car-head">
                <div>
                  <h3 className="ins-car-name">
                    <Link href={`/insights/models/${r.code}`}>{r.name}</Link>
                  </h3>
                  <p className="ins-car-sub">
                    {r.known} named a colour · {r.unknown} did not
                    {r.stockNow !== null ? ` · CRM stock ${r.stockNow} now${r.inbound ? `, ${r.inbound} on the way` : ""}` : ""}
                  </p>
                </div>
              </div>
              {r.exterior.length > 0 && (
                <div className="ins-table-wrap">
                  <table className="ins-table">
                    <thead>
                      <tr>
                        <th scope="col">Exterior</th>
                        <th scope="col">People</th>
                        <th scope="col">Share</th>
                        {r.stockNow !== null && <th scope="col">In stock</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {r.exterior.map((c) => (
                        <tr key={c.family}>
                          <th scope="row">{c.family.charAt(0).toUpperCase() + c.family.slice(1)}</th>
                          <td><Link href={labHref(c.q)}>{c.people}</Link></td>
                          <td>{c.share === null ? "—" : `${Math.round(c.share * 100)}%`}</td>
                          {r.stockNow !== null && <td className={c.stockNow === 0 && c.people > 0 ? "ins-short" : ""}>{c.stockNow}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {r.interior.length > 0 && (
                <>
                  <h4 className="cap">Interior</h4>
                  <LinkedBars items={r.interior} title="Interior" />
                </>
              )}
              {r.rejected.length > 0 && (
                <>
                  <h4 className="cap">Don&apos;t want</h4>
                  <LinkedBars items={r.rejected} title="Refused" />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
