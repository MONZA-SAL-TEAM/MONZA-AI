import type { Metadata } from "next";
import Link from "next/link";
import { requireInsightsAccess } from "@/lib/auth-server";
import { carName, valueLabel } from "@/lib/insights/facts";
import { LAB_CHOICES, LAB_FIELDS } from "@/lib/insights/lab";
import { readLab } from "@/lib/insights/people-server";
import { parseInsightQuery, toSearch } from "@/lib/insights/query";
import { STAGE_LABEL } from "@/lib/wasales/signal";
import { longDate } from "@/lib/format";
import NotAllowed from "../NotAllowed";
import { InsightsNav } from "../parts";
import LabTools from "./LabTools";
import "../../board.css";
import "../insights.css";

export const metadata: Metadata = { title: "Research Lab — Monza AI Insights" };
export const dynamic = "force-dynamic";

/**
 * /insights/lab — ask any combination ("wants the Courage in black, budget $40–50k, lives in the Metn")
 * and get the people, with their profile one click away. Every count on every Insights page opens here.
 * Reads the per-person summary (insight_people); names and numbers are joined at read time.
 */
export default async function LabPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireInsightsAccess("/insights/lab");
  if (!access.allowed) return <NotAllowed />;
  const sp = await searchParams;
  const q = parseInsightQuery(sp);
  const read = await readLab(q);
  const asked = Object.keys(q).length > 0;
  const shown = read.state === "ok" ? read.people.slice(0, 300) : [];

  return (
    <div className="board">
      <header className="board-head">
        <p className="eyebrow">Insights · Research Lab</p>
        <h1 className="h1">Find the people</h1>
        <p className="lede">Combine anything below. Each person is listed once; open their profile for everything, or the chat itself.</p>
      </header>
      <InsightsNav current="/insights/lab" />

      <form className="ins-panel ins-lab-form" method="get" action="/insights/lab">
        <div className="ins-lab-grid">
          {LAB_FIELDS.map(([field, label]) => (
            <label key={field} className="ins-lab-field">
              <span className="cap">{label}</span>
              <select name={field} defaultValue={String((q as Record<string, unknown>)[field] ?? "")}>
                <option value="">Any</option>
                {(LAB_CHOICES[field] ?? []).map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label className="ins-lab-check">
            <input type="checkbox" name="waiting" value="1" defaultChecked={q.waiting === true} /> Waiting for a person
          </label>
          <label className="ins-lab-check">
            <input type="checkbox" name="tradeIn" value="1" defaultChecked={q.tradeIn === true} /> Has a trade-in
          </label>
          <label className="ins-lab-check">
            <input type="checkbox" name="owner" value="none" defaultChecked={q.owner === "none"} /> Nobody owns the lead
          </label>
        </div>
        <div className="rowcard-actions">
          <button type="submit" className="btn primary">
            Show the people
          </button>
          {asked && (
            <Link className="btn quiet" href="/insights/lab">
              Clear
            </Link>
          )}
        </div>
      </form>

      {read.state === "unavailable" && <p className="board-note board-warn">Monza AI&apos;s database could not be read here, so nothing is shown.</p>}
      {read.state === "empty" && (
        <p className="board-note">The per-person summaries have not been built yet. Rebuild them below — they are also rebuilt every night.</p>
      )}
      {read.state === "ok" && (
        <section className="section-head">
          <h2 className="ins-h2">
            {read.total} {read.total === 1 ? "person" : "people"}
            {read.total > shown.length ? ` — the ${shown.length} most recent shown; the CSV has up to 2,000` : ""}
          </h2>
          <p className="ins-known">Summaries rebuilt {read.refreshedAt ? longDate(read.refreshedAt.slice(0, 10)) : "never"}. Link to this question: /insights/lab{toSearch(q)}</p>
        </section>
      )}
      <LabTools people={read.state === "ok" ? read.people : []} />

      {shown.length > 0 && (
        <ul className="rows">
          {shown.map((p) => (
            <li key={p.key} className={`rowcard${p.waiting ? " urgent" : p.stage === "buying" ? " ready" : ""}`}>
              <div className="rowcard-top">
                <div>
                  <p className="rowcard-name">
                    <Link href={`/insights/clients/${encodeURIComponent(p.key)}`}>{p.name}</Link>
                  </p>
                  <p className="rowcard-sub">
                    {p.channels.join(", ")}
                    {p.phone ? ` · +${p.phone}` : ""} · {p.messages} messages · last {longDate(p.lastAt.slice(0, 10))}
                  </p>
                </div>
                <div className="rowcard-tags">
                  <span className={`tag${p.stage === "buying" ? " urgent" : ""}`}>{STAGE_LABEL[p.stage] ?? p.stage}</span>
                </div>
              </div>
              <p className="ins-client-line">
                <span className="cap">Cars</span> {p.models.length ? p.models.map(carName).join(", ") : "—"}
                {p.coloursWanted.length > 0 && (
                  <>
                    {" "}
                    <span className="cap">Colours</span> {p.coloursWanted.map((c) => c.split(":")[1]).join(", ")}
                  </>
                )}
                {p.budgetBand && (
                  <>
                    {" "}
                    <span className="cap">Budget</span> {valueLabel("budget", p.budgetBand)}
                  </>
                )}
                {p.city && (
                  <>
                    {" "}
                    <span className="cap">Where</span> {valueLabel("city", p.city)}
                  </>
                )}
                {p.timeline && (
                  <>
                    {" "}
                    <span className="cap">Buying</span> {valueLabel("timeline", p.timeline)}
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
