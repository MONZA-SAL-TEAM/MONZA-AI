import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInsightsAccess } from "@/lib/auth-server";
import { modelDetail } from "@/lib/insights/analysis";
import { readAnalysis } from "@/lib/insights/analysis-server";
import { labHref } from "@/lib/insights/query";
import { MODEL_CODES } from "@/lib/wasales/knowledge";
import NotAllowed from "../../NotAllowed";
import { InsightsNav, LinkedBars, PeriodChips, Weekly, parseDays } from "../../parts";
import "../../../board.css";
import "../../insights.css";

export const metadata: Metadata = { title: "Model — Monza AI Insights" };
export const dynamic = "force-dynamic";

/** /insights/models/[code] — one car: who, which colours, what they ask, what else they look at. */
export default async function ModelPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { code } = await params;
  if (!(MODEL_CODES as readonly string[]).includes(code)) notFound();
  const access = await requireInsightsAccess(`/insights/models/${code}`);
  if (!access.allowed) return <NotAllowed />;
  const days = parseDays((await searchParams).days);
  const read = await readAnalysis(days);

  if (read.state !== "ok") {
    return (
      <div className="board">
        <header className="board-head">
          <p className="eyebrow">Insights · Models</p>
          <h1 className="h1">{code}</h1>
        </header>
        <p className="board-note board-warn">Monza AI&apos;s database could not be read here, so nothing is shown.</p>
      </div>
    );
  }
  const d = modelDetail(code, read.people, read.rows.signals, read.personOf, read.nowMs);
  return (
    <div className="board">
      <header className="board-head">
        <p className="eyebrow">
          <Link href="/insights/models">Models</Link> · {d.name}
        </p>
        <h1 className="h1">{d.name}</h1>
        <p className="lede">
          <Link href={labHref({ model: code })}>{d.people} people</Link> · {d.primary} as their main car, {d.secondary} as one of several · {d.newThisMonth} new in
          30 days
        </p>
      </header>
      <InsightsNav current="/insights/models" />
      <div className="board-tools">
        <PeriodChips path={`/insights/models/${code}`} days={days} />
      </div>
      <section className="ins-grid">
        <div className="ins-panel">
          <Weekly values={d.weekly} title="People who named it" />
        </div>
        <div className="ins-panel">
          <h2 className="ins-h2">What they asked for</h2>
          <LinkedBars items={d.asks} title="Asks" of={d.people} />
        </div>
        <div className="ins-panel">
          <h2 className="ins-h2">Exterior colours</h2>
          <LinkedBars items={d.exterior} title="Exterior colours" of={d.colourKnown} />
          {d.colourKnown > 0 && <p className="ins-known">shares of the {d.colourKnown} who named a colour</p>}
          <h2 className="ins-h2">Interior</h2>
          <LinkedBars items={d.interior} title="Interior colours" />
          <h2 className="ins-h2">Colours they don&apos;t want</h2>
          <LinkedBars items={d.rejected} title="Refused colours" />
        </div>
        <div className="ins-panel">
          <h2 className="ins-h2">Their questions</h2>
          <LinkedBars items={d.questions} title="Questions" />
          <h2 className="ins-h2">Concerns</h2>
          <LinkedBars items={d.concerns} title="Concerns" />
        </div>
        <div className="ins-panel">
          <h2 className="ins-h2">Also asked about</h2>
          <LinkedBars items={d.alsoAsked} title="Other Monza cars" />
          <h2 className="ins-h2">Compared with</h2>
          <LinkedBars items={d.compared} title="Compared" />
          <h2 className="ins-h2">Other brands</h2>
          <LinkedBars items={d.competitors} title="Other brands" />
        </div>
        <div className="ins-panel">
          <h2 className="ins-h2">Budget</h2>
          <LinkedBars items={d.budget} title="Budget" />
          <h2 className="ins-h2">Buying when</h2>
          <LinkedBars items={d.timeline} title="Timeline" />
          <h2 className="ins-h2">Where they live</h2>
          <LinkedBars items={d.city} title="City" />
        </div>
      </section>
    </div>
  );
}
