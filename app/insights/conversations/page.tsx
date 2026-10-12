import type { Metadata } from "next";
import Link from "next/link";
import { requireInsightsAccess } from "@/lib/auth-server";
import { conversationsView } from "@/lib/insights/analysis";
import { readAnalysis } from "@/lib/insights/analysis-server";
import { labHref } from "@/lib/insights/query";
import NotAllowed from "../NotAllowed";
import { InsightsNav, LinkedBars, PeriodChips, parseDays } from "../parts";
import "../../board.css";
import "../insights.css";

export const metadata: Metadata = { title: "Conversations — Monza AI Insights" };
export const dynamic = "force-dynamic";

/** /insights/conversations — what people ask, by car; their concerns and needs; what is rising. */
export default async function ConversationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireInsightsAccess("/insights/conversations");
  if (!access.allowed) return <NotAllowed />;
  const days = parseDays((await searchParams).days);
  const read = await readAnalysis(days);
  // Rising compares the last 30 days with the 30 before, so it always reads 60 days.
  const recent = days === 0 || days >= 60 ? read : await readAnalysis(90);
  const v = read.state === "ok" ? conversationsView(read.people, recent.state === "ok" ? recent.rows.signals : read.rows.signals, read.personOf, read.nowMs) : null;

  return (
    <div className="board">
      <header className="board-head">
        <p className="eyebrow">Insights · Conversations</p>
        <h1 className="h1">What people ask</h1>
        <p className="lede">Questions, concerns and needs, counted in people. Rising: asked by at least 5 people in the last 30 days, and more than the 30 before.</p>
      </header>
      <InsightsNav current="/insights/conversations" />
      <div className="board-tools">
        <PeriodChips path="/insights/conversations" days={days} />
      </div>
      {!v ? (
        <p className="board-note board-warn">Monza AI&apos;s database could not be read here, so nothing is shown.</p>
      ) : (
        <>
          <section className="ins-grid">
            <div className="ins-panel">
              <h2 className="ins-h2">Questions</h2>
              <LinkedBars items={v.questions} title="Questions" limit={16} />
            </div>
            <div className="ins-panel">
              <h2 className="ins-h2">Rising</h2>
              {v.rising.length === 0 ? (
                <p className="ins-empty">Nothing is rising with at least 5 people.</p>
              ) : (
                <ul className="ins-bars">
                  {v.rising.map((r) => (
                    <li key={r.key}>
                      <Link className="ins-bar-label ins-bar-link" href={labHref(r.q)}>
                        {r.label}
                      </Link>
                      <span className="ins-known">{r.before} → </span>
                      <span className="ins-bar-value">{r.now}</span>
                    </li>
                  ))}
                </ul>
              )}
              <h2 className="ins-h2">Concerns</h2>
              <LinkedBars items={v.concerns} title="Concerns" />
              <h2 className="ins-h2">Looking for</h2>
              <LinkedBars items={v.needs} title="Needs" />
            </div>
          </section>
          <section className="section-head">
            <h2 className="ins-h2">By car</h2>
          </section>
          <section className="ins-grid">
            {v.byModel.map((m) => (
              <div key={m.code} className="ins-panel">
                <h2 className="ins-h2">
                  <Link href={`/insights/models/${m.code}`}>{m.name}</Link>
                </h2>
                <LinkedBars items={m.questions} title={`${m.name} questions`} />
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
