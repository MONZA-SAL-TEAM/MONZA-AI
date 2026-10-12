import type { Metadata } from "next";
import Link from "next/link";
import { requireInsightsAccess } from "@/lib/auth-server";
import { channelsView } from "@/lib/insights/analysis";
import { alertedPeople, phoneOfPerson, readAnalysis } from "@/lib/insights/analysis-server";
import { readCrmOutcomes } from "@/lib/insights/crm-server";
import { leadsView } from "@/lib/insights/leads";
import { readTeamReport } from "@/lib/insights/team-server";
import { labHref } from "@/lib/insights/query";
import NotAllowed from "../NotAllowed";
import { InsightsNav, LinkedBars, PeriodChips, parseDays } from "../parts";
import "../../board.css";
import "../insights.css";

export const metadata: Metadata = { title: "Channels — Monza AI Insights" };
export const dynamic = "force-dynamic";

const LABEL: Readonly<Record<string, string>> = { whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Messenger" };

/**
 * /insights/channels — WhatsApp, Instagram and Messenger side by side. A person who wrote on two channels
 * counts on both (chats are linked only by a mobile number, never by a name).
 */
export default async function ChannelsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireInsightsAccess("/insights/channels");
  if (!access.allowed) return <NotAllowed />;
  const days = parseDays((await searchParams).days);
  const [read, crm, team] = await Promise.all([readAnalysis(days), readCrmOutcomes(access.user), readTeamReport(days > 0 ? days : 365)]);
  const views = read.state === "ok" ? channelsView(read.people) : [];
  const funnelOf = (ch: string) =>
    read.state === "ok"
      ? leadsView({ people: read.people.filter((p) => p.channels.includes(ch)), alerted: alertedPeople(read.rows, read.personOf), phoneOf: phoneOfPerson(read.rows), crm: crm.state === "ok" ? { state: "ok", byPhone: crm.data } : crm, sinceMs: days > 0 ? read.nowMs - days * 86_400_000 : 0, nowMs: read.nowMs })
      : null;
  const mins = (m: number | null) => (m === null ? "—" : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 6) / 10} h` : `${Math.round(m / 144) / 10} days`);

  return (
    <div className="board">
      <header className="board-head">
        <p className="eyebrow">Insights · Channels</p>
        <h1 className="h1">Where people write from</h1>
        <p className="lede">
          People per channel, how many are close to buying (asked the price, a test drive, or said they want to buy), the cars and colours, the
          language, and what brought them. &quot;Not tracked&quot; means we do not know — never &quot;organic&quot;.
        </p>
      </header>
      <InsightsNav current="/insights/channels" />
      <div className="board-tools">
        <PeriodChips path="/insights/channels" days={days} />
      </div>
      {read.state !== "ok" ? (
        <p className="board-note board-warn">Monza AI&apos;s database could not be read here, so nothing is shown.</p>
      ) : (
        <section className="ins-grid">
          {views.map((v) => (
            <div key={v.channel} className="ins-panel">
              <h2 className="ins-h2">{LABEL[v.channel] ?? v.channel}</h2>
              <p className="ins-client-line">
                <Link href={labHref({ channel: v.channel })}>{v.people} people</Link> · {v.highIntent} close to buying
              </p>
              {(() => {
                const f = funnelOf(v.channel);
                const n = (k: string) => f?.stages.find((s) => s.def.key === k)?.n;
                const t = team.state === "ok" ? team.byChannel[v.channel] : null;
                return (
                  <dl className="ins-car-stats ins-pipe-stats">
                    <div><dt>Qualified</dt><dd>{n("qualified") ?? "—"}</dd></div>
                    <div><dt>Handed to Sales</dt><dd>{n("handoff") ?? "—"}</dd></div>
                    <div><dt>Test drive booked</dt><dd>{n("test_drive_booked") ?? "—"}</dd></div>
                    <div><dt>Bought (CRM)</dt><dd>{n("won") ?? "—"}</dd></div>
                    <div><dt>First reply</dt><dd>{t ? mins(t.overall.medianMinutes) : "—"}</dd></div>
                  </dl>
                );
              })()}
              <h3 className="cap">Cars</h3>
              <LinkedBars items={v.models} title="Cars" />
              <h3 className="cap">Colours</h3>
              <LinkedBars items={v.colours} title="Colours" />
              <h3 className="cap">Language</h3>
              <LinkedBars items={v.languages} title="Languages" />
              <h3 className="cap">What brought them</h3>
              <LinkedBars items={v.firstTouch} title="First touch" />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
