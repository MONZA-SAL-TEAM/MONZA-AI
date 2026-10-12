import type { Metadata } from "next";
import { requireInsightsAccess } from "@/lib/auth-server";
import { qualityView } from "@/lib/insights/analysis";
import { readAnalysis } from "@/lib/insights/analysis-server";
import { readQualityExtras } from "@/lib/insights/quality-server";
import { longDate } from "@/lib/format";
import NotAllowed from "../NotAllowed";
import { InsightsNav, PeriodChips, parseDays } from "../parts";
import "../../board.css";
import "../insights.css";

export const metadata: Metadata = { title: "Data quality — Monza AI Insights" };
export const dynamic = "force-dynamic";

const SOURCE_LABEL: Readonly<Record<string, string>> = { webhook: "Read as messages arrived", whatsapp_rebuild: "WhatsApp history, read again", meta_backfill: "Instagram / Facebook history" };
const day = (iso: string | null) => (iso ? longDate(iso.slice(0, 10)) : "never");

/**
 * /insights/quality — how much the figures can be trusted: how many people we know each thing about, how
 * colours were tied to cars, which reader read them, and where each history read stands.
 */
export default async function QualityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireInsightsAccess("/insights/quality");
  if (!access.allowed) return <NotAllowed />;
  const days = parseDays((await searchParams).days, 0);
  const [read, extras] = await Promise.all([readAnalysis(days), readQualityExtras()]);
  const q =
    read.state === "ok"
      ? qualityView(read.people, read.rows.observations ?? [], (p) => p.channels.includes("whatsapp") || (p.leadId !== null && read.rows.leads.some((l) => l.id === p.leadId && Boolean(l.phone))))
      : null;

  return (
    <div className="board">
      <header className="board-head">
        <p className="eyebrow">Insights · Data quality</p>
        <h1 className="h1">How much we know</h1>
        <p className="lede">
          Every share here is of the people who wrote in the period. A person who wrote on Instagram and on WhatsApp counts twice unless a mobile number
          links them — names never do.
        </p>
      </header>
      <InsightsNav current="/insights/quality" />
      <p className="ins-links">
        <a className="btn" href="/insights/review">
          Facts to review — confirm, correct or remove
        </a>
        <a className="btn quiet" href="/insights/connections">
          Connections and imports
        </a>
      </p>
      <div className="board-tools">
        <PeriodChips path="/insights/quality" days={days} />
      </div>
      {!q ? (
        <p className="board-note board-warn">Monza AI&apos;s database could not be read here, so nothing is shown.</p>
      ) : (
        <section className="ins-grid">
          <div className="ins-panel">
            <h2 className="ins-h2">People we know this about</h2>
            <div className="ins-table-wrap">
              <table className="ins-table">
                <tbody>
                  {q.coverage.map((c) => (
                    <tr key={c.key}>
                      <th scope="row">{c.label}</th>
                      <td>{c.n}</td>
                      <td>{Math.round(c.share * 100)}%</td>
                    </tr>
                  ))}
                  <tr>
                    <th scope="row">Linked by a phone number</th>
                    <td>{q.linkedByPhone}</td>
                    <td>{q.people ? Math.round((q.linkedByPhone / q.people) * 100) : 0}%</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="ins-known">of {q.people} people</p>
          </div>
          <div className="ins-panel">
            <h2 className="ins-h2">How colours were tied to a car</h2>
            <div className="ins-table-wrap">
              <table className="ins-table">
                <tbody>
                  {q.byBinding.map((b) => (
                    <tr key={b.key}>
                      <th scope="row">{b.label}</th>
                      <td>{b.n}</td>
                      <td>{q.colourFacts ? Math.round((b.n / q.colourFacts) * 100) : 0}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="ins-known">{q.unboundColours} of {q.colourFacts} colours are tied to no car; the Colours page can count only the certain ones.</p>
          </div>
          {extras && (
            <>
              <div className="ins-panel">
                <h2 className="ins-h2">Where the labels came from</h2>
                <div className="ins-table-wrap">
                  <table className="ins-table">
                    <tbody>
                      {extras.sources.map((s) => (
                        <tr key={s.key}>
                          <th scope="row">{SOURCE_LABEL[s.key] ?? s.key}</th>
                          <td>{s.n}</td>
                        </tr>
                      ))}
                      {extras.readerVersions.map((r) => (
                        <tr key={r.version}>
                          <th scope="row">Reader version {r.version}{r.version === extras.current ? " (current)" : " (older — rebuild)"}</th>
                          <td>{r.n}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="ins-known">
                  WhatsApp history: {extras.whatsappRebuild.state ?? "not read yet"} ({day(extras.whatsappRebuild.updatedAt)}). Per-person summary: {extras.peopleRows} people,
                  rebuilt {day(extras.peopleRefreshedAt)}.
                </p>
              </div>
              <div className="ins-panel">
                <h2 className="ins-h2">Instagram and Facebook history</h2>
                <div className="ins-table-wrap">
                  <table className="ins-table">
                    <tbody>
                      {extras.metaRuns.map((r) => (
                        <tr key={r.accountId}>
                          <th scope="row">{r.label}</th>
                          <td>{r.state.replace("_", " ")}</td>
                          <td>{r.code ?? ""}</td>
                          <td>{r.threads} chats</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="ins-known">The Instagram-login keys for VOYAH and MHERO expire around 11–13 November 2026 and must be regenerated.</p>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
