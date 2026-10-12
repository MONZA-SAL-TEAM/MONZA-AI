import type { Metadata } from "next";
import { requireInsightsAccess } from "@/lib/auth-server";
import { readAliasDecisions } from "@/lib/insights/aliases-server";
import { aliasIndex } from "@/lib/wasales/aliases";
import { loadCatalog } from "@/lib/wasales/catalog";
import { engineCars } from "@/lib/wasales/engine";
import { MONZA_KNOWLEDGE } from "@/lib/wasales/knowledge";
import { longDate } from "@/lib/format";
import NotAllowed from "../NotAllowed";
import { InsightsNav } from "../parts";
import AliasForm from "./AliasForm";
import "../../board.css";
import "../insights.css";

export const metadata: Metadata = { title: "Car catalogue — Monza AI Insights" };
export const dynamic = "force-dynamic";

/**
 * /insights/catalogue — the eight cars as the reader knows them: official name, brand, powertrain, seats and
 * official colours (from Samer's workbook — the only source of car facts; scripts/sales-import-workbook.py),
 * the dictionary words that name each car, and the words managers approved or rejected for the insights
 * reader. Approving a word here never changes what the sales bot sends.
 */
export default async function CataloguePage() {
  const access = await requireInsightsAccess("/insights/catalogue");
  if (!access.allowed) return <NotAllowed />;
  const decisions = await readAliasDecisions(true);
  const index = aliasIndex(engineCars(MONZA_KNOWLEDGE, loadCatalog()));
  const models = MONZA_KNOWLEDGE.models.map((m) => ({ value: m.code, label: m.displayName }));
  const BUCKET: Readonly<Record<string, string>> = { EV: "Fully electric", EREV: "Range extender (EREV)", PHEV: "Plug-in hybrid" };

  return (
    <div className="board">
      <header className="board-head">
        <p className="eyebrow">Insights · Car catalogue</p>
        <h1 className="h1">The cars and the words for them</h1>
        <p className="lede">
          Car facts and official colours come from the workbook only — change them there and re-run the import, never here. The words below are how
          the insights reader recognises each car; a manager can approve a new one or reject a wrong one. That changes the insights only, never what
          the sales bot sends. Re-read the history (Connections and imports) for past messages to follow.
        </p>
      </header>
      <InsightsNav current="/insights/catalogue" />
      <section className="ins-panel">
        <h2 className="ins-h2">Approve or reject a word</h2>
        <AliasForm models={models} />
      </section>
      <ul className="ins-cars">
        {MONZA_KNOWLEDGE.models.map((m) => {
          const words = index.filter((a) => a.carId === m.catalogueId);
          const mine = decisions.filter((d) => d.model === m.code);
          return (
            <li key={m.code} className="ins-car">
              <div className="ins-car-head">
                <div>
                  <h3 className="ins-car-name">{m.displayName}</h3>
                  <p className="ins-car-sub">
                    {m.brand.toUpperCase()} · {BUCKET[m.bucket] ?? m.bucket}
                    {m.seatCount ? ` · ${m.seatOptions && m.seatOptions.length > 1 ? m.seatOptions.join(" or ") : m.seatCount} seats` : ""}
                  </p>
                </div>
              </div>
              <p className="ins-car-line">
                <span className="cap">Official colours</span> {(m.colourNames ?? []).join(", ") || "not stated in the workbook"}
              </p>
              <p className="ins-car-line" dir="auto">
                <span className="cap">Dictionary</span> {words.map((w) => w.text).join(" · ")}
              </p>
              {mine.length > 0 && (
                <ul className="ins-people">
                  {mine.map((d) => (
                    <li key={`${d.alias}-${d.at}`} dir="auto">
                      <strong>{d.alias}</strong> — {d.status} by {d.by_name ?? "staff"}, {longDate(d.at.slice(0, 10))}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
