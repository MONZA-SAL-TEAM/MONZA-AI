import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInsightsAccess } from "@/lib/auth-server";
import { modelDetail } from "@/lib/insights/analysis";
import { alertedPeople, phoneOfPerson, readAnalysis } from "@/lib/insights/analysis-server";
import { readCrmOutcomes, readCrmStock } from "@/lib/insights/crm-server";
import { stockByModel } from "@/lib/insights/crm";
import { leadsView } from "@/lib/insights/leads";
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
  const [read, crm, stockRead] = await Promise.all([readAnalysis(days), readCrmOutcomes(access.user), readCrmStock(access.user)]);

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
  const its = read.people.filter((p) => p.models.includes(code) || p.contextModels.includes(code));
  const funnel = leadsView({ people: its, alerted: alertedPeople(read.rows, read.personOf), phoneOf: phoneOfPerson(read.rows), crm: crm.state === "ok" ? { state: "ok", byPhone: crm.data } : crm, sinceMs: days > 0 ? read.nowMs - days * 86_400_000 : 0, nowMs: read.nowMs });
  const stock = stockRead.state === "ok" ? (stockByModel(stockRead.data).get(code as never) ?? { now: 0, inbound: 0, reserved: 0, subDealer: 0, colours: [] }) : null;
  const unavailable = stock ? d.exterior.filter((c) => !stock.colours.some((s) => s.key === c.key)) : [];
  return (
    <div className="board">
      <header className="board-head">
        <p className="eyebrow">
          <Link href="/insights/models">Models</Link> · {d.name}
        </p>
        <h1 className="h1">{d.name}</h1>
        <p className="lede">
          <Link href={labHref({ anyModel: code })}>{d.people} people</Link> — <Link href={labHref({ model: code })}>{d.named} named it</Link>, {d.byContext} asked about it by
          context · <Link href={labHref({ adModel: code })}>{d.fromAd} came from its ad</Link> · {d.primary} as their main car, {d.secondary} as one of several ·{" "}
          {d.newThisMonth} new in 30 days · {d.activeRecently} wrote in the last 14 days · {d.returning} returning
        </p>
      </header>
      <InsightsNav current="/insights/models" />
      <div className="board-tools">
        <PeriodChips path={`/insights/models/${code}`} days={days} />
      </div>
      <section className="ins-panel">
        <h2 className="ins-h2">From first message to sale, for this car</h2>
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
          CRM stock now: {stock === null ? "unknown (the CRM could not be read)" : `${stock.now} to sell, ${stock.inbound} on the way${stock.colours.length ? ` — ${stock.colours.map((c) => `${c.key} ${c.n}`).join(", ")}` : ""}`}.
          {unavailable.length > 0 && <> Wanted but none in stock: {unavailable.map((c) => `${c.label} (${c.n} people)`).join(", ")}.</>}
        </p>
      </section>
      <section className="ins-grid">
        <div className="ins-panel">
          <Weekly values={d.weekly} title="People who named it" />
        </div>
        <div className="ins-panel">
          <h2 className="ins-h2">Topics about this car</h2>
          <LinkedBars items={d.topics} title="Topics" of={d.people} limit={20} />
        </div>
        <div className="ins-panel">
          <h2 className="ins-h2">Channels</h2>
          <LinkedBars items={d.channels} title="Channels" of={d.people} />
          <h2 className="ins-h2">Languages</h2>
          <LinkedBars items={d.languages} title="Languages" of={d.people} />
        </div>
        <div className="ins-panel">
          <h2 className="ins-h2">What they asked for</h2>
          <LinkedBars items={d.asks} title="Asks" of={d.people} />
        </div>
        <div className="ins-panel">
          <h2 className="ins-h2">Exterior colours</h2>
          <LinkedBars items={d.exterior} title="Exterior colours" of={d.colourKnown} />
          {d.colourKnown > 0 && <p className="ins-known">shares of the {d.colourKnown} who named a colour</p>}
          <h2 className="ins-h2">Second choices</h2>
          <LinkedBars items={d.alternatives} title="Alternative colours" />
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
