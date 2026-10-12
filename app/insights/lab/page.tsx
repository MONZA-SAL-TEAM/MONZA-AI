import type { Metadata } from "next";
import Link from "next/link";
import { requireInsightsAccess } from "@/lib/auth-server";
import { channelDb } from "@/lib/channels/store";
import { carName, valueLabel } from "@/lib/insights/facts";
import { LAB_CHOICES, LAB_FIELDS } from "@/lib/insights/lab";
import { readLabBase, type LabPerson } from "@/lib/insights/people-server";
import { parseInsightQuery, toSearch, type InsightQuery } from "@/lib/insights/query";
import { GROUP_BY, runStudy, type Share, type Study } from "@/lib/insights/study";
import { STAGE_LABEL } from "@/lib/wasales/signal";
import { longDate } from "@/lib/format";
import NotAllowed from "../NotAllowed";
import { InsightsNav, Weekly } from "../parts";
import LabTools, { DeleteStudy } from "./LabTools";
import "../../board.css";
import "../insights.css";

export const metadata: Metadata = { title: "Research Lab — Monza AI Insights" };
export const dynamic = "force-dynamic";

/**
 * /insights/lab — ask any combination and get the people. Within a filter, several values mean ANY of
 * them; different filters must ALL hold. Group the result by one dimension, compare it with a saved study,
 * save it, export it. Everything runs on the per-person summaries and — as the viewer — the CRM; nothing
 * is generated text.
 */

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "—");

function Mini({ title, items, of }: { title: string; items: readonly Share[]; of: number }) {
  if (items.length === 0) return null;
  const max = Math.max(1, ...items.map((i) => i.n));
  return (
    <div className="ins-panel">
      <h2 className="ins-h2">{title}</h2>
      <ul className="ins-bars">
        {items.slice(0, 10).map((i) => (
          <li key={i.key} title={`${i.label}: ${i.n}`}>
            <span className="ins-bar-label">{i.label}</span>
            <span className="ins-bar-track">
              <span className="ins-bar-fill" style={{ width: `${Math.max(2, (i.n / max) * 100)}%` }} />
            </span>
            <span className="ins-bar-value">
              {i.n} <span className="ins-known">{pct(i.n, of)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Summary({ s, crm, label }: { s: Study; crm: string; label?: string }) {
  return (
    <>
      <section className="tiles" aria-label={label ?? "The study"}>
        <div className="tile"><p className="tile-label">{label ?? "People"}</p><p className="tile-value">{s.total}</p><p className="tile-foot">{pct(s.total, s.base)} of all {s.base} people</p></div>
        <div className="tile"><p className="tile-label">Know their budget</p><p className="tile-value">{s.coverage.budget}</p><p className="tile-foot">{pct(s.coverage.budget, s.total)} of them</p></div>
        <div className="tile"><p className="tile-label">Know their colour</p><p className="tile-value">{s.coverage.colour}</p><p className="tile-foot">{pct(s.coverage.colour, s.total)} · timeline {pct(s.coverage.timeline, s.total)}</p></div>
        <div className="tile"><p className="tile-label">Have an owner</p><p className="tile-value">{s.coverage.owner}</p><p className="tile-foot">{pct(s.coverage.owner, s.total)} · city known {pct(s.coverage.city, s.total)}</p></div>
      </section>
      <section className="ins-grid">
        <div className="ins-panel">
          <Weekly values={s.firstWrote} title="When they first wrote" />
        </div>
        {s.groups && <Mini title="Grouped" items={s.groups} of={s.total} />}
        <Mini title="Cars (named or by context)" items={s.models} of={s.total} />
        <Mini title="Colours wanted" items={s.colours} of={s.total} />
        <Mini title="How far they got" items={s.stages} of={s.total} />
        <Mini title="Channels" items={s.channels} of={s.total} />
        {s.outcomes ? <Mini title="What the CRM recorded" items={s.outcomes} of={s.total} /> : (
          <div className="ins-panel"><h2 className="ins-h2">What the CRM recorded</h2><p className="ins-empty">{crm === "unavailable" ? "The CRM could not be read just now — unknown, not zero." : "The CRM is not connected here."}</p></div>
        )}
      </section>
    </>
  );
}

function PersonRow({ p }: { p: LabPerson }) {
  return (
    <li className={`rowcard${p.waiting ? " urgent" : p.stage === "buying" ? " ready" : ""}`}>
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
        <span className="cap">Cars</span> {[...new Set([...p.models, ...p.contextModels])].map(carName).join(", ") || "—"}
        {p.adModel ? <> <span className="cap">Ad</span> {carName(p.adModel)}</> : null}
        {p.coloursWanted.length > 0 && <> <span className="cap">Colours</span> {p.coloursWanted.map((c) => c.split(":")[1]).join(", ")}</>}
        {p.budgetBand && <> <span className="cap">Budget</span> {valueLabel("budget", p.budgetBand)}</>}
        {p.city && <> <span className="cap">Where</span> {valueLabel("city", p.city)}</>}
        {p.timeline && <> <span className="cap">Buying</span> {valueLabel("timeline", p.timeline)}</>}
      </p>
    </li>
  );
}

export default async function LabPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireInsightsAccess("/insights/lab");
  if (!access.allowed) return <NotAllowed />;
  const sp = await searchParams;
  const q: InsightQuery = parseInsightQuery(sp);
  const groupBy = typeof sp.groupBy === "string" && GROUP_BY.some(([k]) => k === sp.groupBy) ? sp.groupBy : null;
  const compareRaw = typeof sp.compare === "string" ? sp.compare : null;
  const qB = compareRaw ? parseInsightQuery(new URLSearchParams(compareRaw)) : null;
  const asked = Object.keys(q).length > 0;
  const search = toSearch(q).replace(/^\?/, "");

  const sb = channelDb();
  const [read, saved] = await Promise.all([
    readLabBase(access.user),
    sb ? sb.from("insight_saved_queries").select("id, name, query, created_by_name, created_at").order("created_at", { ascending: false }).limit(100) : Promise.resolve({ data: null, error: true }),
  ]);
  const now = Date.now();
  const study = read.state === "ok" ? runStudy(read.base.people, q, now, read.base.outcomeOf, groupBy) : null;
  const studyB = read.state === "ok" && qB ? runStudy(read.base.people, qB, now, read.base.outcomeOf, groupBy) : null;
  const shown = (study?.matched ?? []).slice(0, 300) as LabPerson[];
  const value = (field: string) => {
    const v = (q as Record<string, unknown>)[field];
    if (field === "testDriveBooked") return v === undefined ? [] : [v ? "1" : "0"];
    if (field === "days") return v ? [String(v)] : [];
    return typeof v === "string" ? v.split(",") : [];
  };
  const savedRows = (saved.data ?? []) as { id: string; name: string; query: string; created_by_name: string | null; created_at: string }[];

  return (
    <div className="board">
      <header className="board-head">
        <p className="eyebrow">Insights · Research Lab</p>
        <h1 className="h1">Find and study the people</h1>
        <p className="lede">
          Combine anything below. Several values in one filter mean <strong>any of them</strong>; different filters must <strong>all</strong> hold.
          Hold Ctrl (⌘ on a Mac) to pick several. Each person is counted once.
        </p>
      </header>
      <InsightsNav current="/insights/lab" />

      <form className="ins-panel ins-lab-form" method="get" action="/insights/lab">
        <div className="ins-lab-grid">
          {LAB_FIELDS.map(([field, label, many]) => (
            <label key={field} className="ins-lab-field">
              <span className="cap">{label}</span>
              <select name={field} multiple={Boolean(many)} size={many ? 3 : undefined} defaultValue={many ? value(field) : (value(field)[0] ?? "")}>
                {!many && <option value="">Any</option>}
                {(LAB_CHOICES[field] ?? []).map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label className="ins-lab-field">
            <span className="cap">Group the result by</span>
            <select name="groupBy" defaultValue={groupBy ?? ""}>
              <option value="">No grouping</option>
              {GROUP_BY.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="ins-lab-check">
            <input type="checkbox" name="waiting" value="1" defaultChecked={q.waiting === true} /> Waiting for a person
          </label>
          <label className="ins-lab-check">
            <input type="checkbox" name="tradeIn" value="1" defaultChecked={q.tradeIn === true} /> Has a trade-in
          </label>
          <label className="ins-lab-check">
            <input type="checkbox" name="owner" value="none" defaultChecked={q.owner === "none"} /> Nobody owns the lead
          </label>
          {compareRaw && <input type="hidden" name="compare" value={compareRaw} />}
        </div>
        <div className="rowcard-actions">
          <button type="submit" className="btn primary">
            Show the people
          </button>
          {(asked || groupBy || compareRaw) && (
            <Link className="btn quiet" href="/insights/lab">
              Clear
            </Link>
          )}
        </div>
      </form>

      {read.state === "unavailable" && <p className="board-note board-warn">Monza AI&apos;s database could not be read here, so nothing is shown.</p>}
      {read.state === "empty" && <p className="board-note">The per-person summaries have not been built yet. Rebuild them below — they are also rebuilt every night.</p>}

      {study && read.state === "ok" && (
        <>
          <p className="ins-known">
            Summaries rebuilt {read.base.refreshedAt ? longDate(read.base.refreshedAt.slice(0, 10)) : "never"}. Link to this question: /insights/lab{search ? `?${search}` : ""}
          </p>
          {studyB ? (
            <div className="ins-compare">
              <div>
                <h2 className="ins-h2">This question</h2>
                <Summary s={study} crm={read.base.crm} label="This question" />
              </div>
              <div>
                <h2 className="ins-h2">
                  Compared with <Link href={`/insights/lab?${compareRaw}`}>the saved study</Link>
                </h2>
                <Summary s={studyB} crm={read.base.crm} label="Compared with" />
              </div>
            </div>
          ) : (
            <Summary s={study} crm={read.base.crm} />
          )}
        </>
      )}

      <LabTools people={(study?.matched ?? []).slice(0, 5000) as LabPerson[]} query={[search, groupBy ? `groupBy=${groupBy}` : ""].filter(Boolean).join("&")} />

      <section className="ins-panel">
        <h2 className="ins-h2">Saved studies</h2>
        {saved.error ? (
          <p className="ins-empty">Saved studies could not be read just now.</p>
        ) : savedRows.length === 0 ? (
          <p className="ins-empty">None yet. Ask a question above, name it and save it — it re-runs on today&apos;s data every time.</p>
        ) : (
          <ul className="ins-people">
            {savedRows.map((r) => (
              <li key={r.id} className="ins-saved">
                <Link href={`/insights/lab?${r.query}`}>{r.name}</Link>{" "}
                <span className="ins-known">
                  {r.created_by_name ?? "staff"} · {longDate(r.created_at.slice(0, 10))}
                </span>{" "}
                <Link className="btn quiet" href={`/insights/lab?${search}${groupBy ? `&groupBy=${groupBy}` : ""}&compare=${encodeURIComponent(r.query)}`}>
                  Compare with this question
                </Link>{" "}
                <DeleteStudy id={r.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {shown.length > 0 && (
        <>
          <section className="section-head">
            <h2 className="ins-h2">
              {study?.total} {study?.total === 1 ? "person" : "people"}
              {study && study.total > shown.length ? ` — the ${shown.length} most recent shown; the CSV has them` : ""}
            </h2>
          </section>
          <ul className="rows">
            {shown.map((p) => (
              <PersonRow key={p.key} p={p} />
            ))}
          </ul>
        </>
      )}
      {study && study.total === 0 && asked && <p className="board-empty">Nobody matches. Remove a filter, or pick more values in one.</p>}
    </div>
  );
}
