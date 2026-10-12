import type { Metadata } from "next";
import Link from "next/link";
import { requireInsightsAccess } from "@/lib/auth-server";
import { modelsTable } from "@/lib/insights/analysis";
import { readAnalysis } from "@/lib/insights/analysis-server";
import { labHref } from "@/lib/insights/query";
import NotAllowed from "../NotAllowed";
import { InsightsNav, PeriodChips, parseDays } from "../parts";
import "../../board.css";
import "../insights.css";

export const metadata: Metadata = { title: "Models — Monza AI Insights" };
export const dynamic = "force-dynamic";

/** /insights/models — every car: how many people, as their main car or one of several, and what they asked. */
export default async function ModelsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireInsightsAccess("/insights/models");
  if (!access.allowed) return <NotAllowed />;
  const days = parseDays((await searchParams).days);
  const read = await readAnalysis(days);
  const rows = read.state === "ok" ? modelsTable(read.people, read.nowMs) : [];
  const lab = (q: Parameters<typeof labHref>[0]) => labHref({ ...q, ...([30, 90, 365].includes(days) ? { days } : {}) });

  return (
    <div className="board">
      <header className="board-head">
        <p className="eyebrow">Insights · Models</p>
        <h1 className="h1">The cars people want</h1>
        <p className="lede">
          Each person counted once per car. &quot;People&quot; named it or asked about it by context (its ad, the car being discussed); &quot;Named it&quot; is in their own
          words; &quot;From its ad&quot; is how they arrived, not a stated interest. &quot;Main car&quot; is the one they named most. Every number opens those people.
        </p>
      </header>
      <InsightsNav current="/insights/models" />
      <div className="board-tools">
        <PeriodChips path="/insights/models" days={days} />
      </div>
      {read.state !== "ok" ? (
        <p className="board-note board-warn">Monza AI&apos;s database could not be read here, so nothing is shown.</p>
      ) : (
        <section className="ins-panel">
          <div className="ins-table-wrap">
            <table className="ins-table">
              <thead>
                <tr>
                  <th scope="col">Car</th>
                  <th scope="col">People</th>
                  <th scope="col">Named it</th>
                  <th scope="col">From its ad</th>
                  <th scope="col">Main car</th>
                  <th scope="col">New in 30 days</th>
                  <th scope="col">Price</th>
                  <th scope="col">Test drive</th>
                  <th scope="col">Installments</th>
                  <th scope="col">Want to buy</th>
                  <th scope="col">Top colour</th>
                  <th scope="col">Top other brand</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.code}>
                    <th scope="row">
                      <Link href={`/insights/models/${r.code}${days !== 90 ? `?days=${days}` : ""}`}>{r.name}</Link>
                    </th>
                    <td><Link href={lab({ anyModel: r.code })}>{r.people}</Link></td>
                    <td><Link href={lab({ model: r.code })}>{r.named}</Link></td>
                    <td><Link href={lab({ adModel: r.code })}>{r.fromAd}</Link></td>
                    <td>{r.primary}</td>
                    <td>{r.newThisMonth}</td>
                    <td><Link href={lab({ anyModel: r.code, topic: "PRICE" })}>{r.price}</Link></td>
                    <td><Link href={lab({ anyModel: r.code, topic: "TEST_DRIVE" })}>{r.testDrive}</Link></td>
                    <td><Link href={lab({ anyModel: r.code, topic: "FINANCING" })}>{r.financing}</Link></td>
                    <td><Link href={lab({ anyModel: r.code, stage: "buying" })}>{r.buying}</Link></td>
                    <td>{r.topColour ? <Link href={labHref(r.topColour.q)}>{`${r.topColour.label} (${r.topColour.n})`}</Link> : "—"}</td>
                    <td>{r.topCompetitor ? <Link href={labHref(r.topCompetitor.q)}>{`${r.topCompetitor.label} (${r.topCompetitor.n})`}</Link> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
