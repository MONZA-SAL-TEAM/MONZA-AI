import type { Metadata } from "next";
import Link from "next/link";
import { requireInsightsAccess } from "@/lib/auth-server";
import { readAnalysis } from "@/lib/insights/analysis-server";
import { vehicleLanguage } from "@/lib/insights/language";
import { labHref } from "@/lib/insights/query";
import { aliasIndex } from "@/lib/wasales/aliases";
import { loadCatalog } from "@/lib/wasales/catalog";
import { engineCars } from "@/lib/wasales/engine";
import { readAliasDecisions, withAliasDecisions } from "@/lib/insights/aliases-server";
import { MONZA_KNOWLEDGE, modelByCatalogueId } from "@/lib/wasales/knowledge";
import NotAllowed from "../NotAllowed";
import { InsightsNav, PeriodChips, parseDays } from "../parts";
import "../../board.css";
import "../insights.css";

export const metadata: Metadata = { title: "How customers describe our cars — Monza AI Insights" };
export const dynamic = "force-dynamic";

const SCRIPT: Readonly<Record<string, string>> = { latin: "Latin letters", arabic: "Arabic", digits: "Number", misspelling: "Misspelling", retired: "Older word" };
const CHANNEL: Readonly<Record<string, string>> = { whatsapp: "WA", instagram: "IG", facebook: "FB" };

/**
 * /insights/language — the words customers use for each car (from OUR dictionary — the customer's own
 * text is never stored), kinds of car asked for with no model, and car names that could be ordinary words.
 */
export default async function LanguagePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireInsightsAccess("/insights/language");
  if (!access.allowed) return <NotAllowed />;
  const days = parseDays((await searchParams).days);
  const read = await readAnalysis(days);
  const cars = engineCars(MONZA_KNOWLEDGE, withAliasDecisions(loadCatalog(), await readAliasDecisions(true)));
  const v =
    read.state === "ok"
      ? vehicleLanguage(
          read.rows.observations ?? [],
          ((byConv) => (conv: string) => byConv.get(conv) ?? "unknown")(new Map(read.rows.signals.map((s) => [s.conversation_id, s.channel]))),
          read.personOf,
          aliasIndex(cars),
          (carId) => modelByCatalogueId(MONZA_KNOWLEDGE, carId)?.code ?? null,
          MONZA_KNOWLEDGE.models.map((m) => ({ code: m.code, name: m.displayName })),
          read.nowMs
        )
      : null;

  return (
    <div className="board">
      <header className="board-head">
        <p className="eyebrow">Insights · Vehicle language</p>
        <h1 className="h1">How customers describe our cars</h1>
        <p className="lede">
          Which word named each car — counted in people and messages, by channel. The words shown are Monza AI&apos;s own dictionary entries; what a
          customer typed is never stored. Open the people to read the chats.
        </p>
      </header>
      <InsightsNav current="/insights/language" />
      <div className="board-tools">
        <PeriodChips path="/insights/language" days={days} />
      </div>
      {!v ? (
        <p className="board-note board-warn">Monza AI&apos;s database could not be read here, so nothing is shown.</p>
      ) : (
        <>
          <section className="ins-panel">
            <h2 className="ins-h2">Kinds of car asked for</h2>
            {v.categories.length === 0 ? (
              <p className="ins-empty">Nobody asked for a kind of car yet in this period.</p>
            ) : (
              <div className="ins-table-wrap">
                <table className="ins-table">
                  <thead>
                    <tr>
                      <th scope="col">Kind</th>
                      <th scope="col">With no model named</th>
                      <th scope="col">Alongside a model</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.categories.map((c) => (
                      <tr key={c.key}>
                        <th scope="row">{c.label}</th>
                        <td><Link href={labHref(c.q)}>{c.onlyCategory}</Link></td>
                        <td>{c.withModel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="ins-known">&quot;With no model named&quot; is a kind of car, not interest in one model — it is never counted as demand for a specific car.</p>
          </section>
          <ul className="ins-cars">
            {v.models.map((m) => (
              <li key={m.code} className="ins-car">
                <div className="ins-car-head">
                  <div>
                    <h3 className="ins-car-name">
                      <Link href={`/insights/models/${m.code}`}>{m.name}</Link>
                    </h3>
                    <p className="ins-car-sub">
                      {m.people} people named it · {m.unresolvedPeople} wrote a word that could be it or an ordinary word (asked, never counted)
                    </p>
                  </div>
                </div>
                {m.expressions.length === 0 ? (
                  <p className="ins-empty">Nobody named it in this period.</p>
                ) : (
                  <div className="ins-table-wrap">
                    <table className="ins-table">
                      <thead>
                        <tr>
                          <th scope="col">Word</th>
                          <th scope="col">Kind</th>
                          <th scope="col">People</th>
                          <th scope="col">Messages</th>
                          <th scope="col">Where</th>
                        </tr>
                      </thead>
                      <tbody>
                        {m.expressions.map((e) => (
                          <tr key={e.key}>
                            <th scope="row" dir="auto">{e.text}</th>
                            <td>{SCRIPT[e.script]}</td>
                            <td><Link href={labHref(e.q)}>{e.people}</Link></td>
                            <td>{e.messages}</td>
                            <td>{Object.entries(e.channels).map(([ch, n]) => `${CHANNEL[ch] ?? ch} ${n}`).join(" · ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
