import type { Metadata } from "next";
import Link from "next/link";
import { requireInsightsAccess } from "@/lib/auth-server";
import { channelsView } from "@/lib/insights/analysis";
import { readAnalysis } from "@/lib/insights/analysis-server";
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
  const read = await readAnalysis(days);
  const views = read.state === "ok" ? channelsView(read.people) : [];

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
