import type { Metadata } from "next";
import Link from "next/link";
import { requireInsightsAccess } from "@/lib/auth-server";
import { readDemand } from "@/lib/insights/demand-server";
import { DIMENSIONS } from "@/lib/insights/demand";
import { demandTable } from "@/lib/insights/demand-view";
import { longDate } from "@/lib/format";
import NotAllowed from "../NotAllowed";
import { InsightsNav } from "../parts";
import DemandTools from "./DemandTools";
import "../../board.css";
import "../insights.css";

export const metadata: Metadata = { title: "Stored demand — Monza AI Insights" };
export const dynamic = "force-dynamic";

/**
 * /insights/demand — the demand record Monza keeps permanently, with NO client data (Samer, 2026-10-12):
 * month by month, how many people asked about each car, colour, question, budget band, city, other brand…
 * Counts only — no name, number or chat — and they stay when the chats are cleaned up or a person deleted.
 */

const ORDER = ["car_interest", "car_named", "car_context", "ad_car", "colour_wanted", "colour_interior", "colour_rejected", "colour_alternative", "colour_question", "topic", "category", "budget", "timeline", "city", "purpose", "financing", "competitor", "concern", "need", "trade_in", "mention", "language", "activity"];
const SHORT: Readonly<Record<string, string>> = {
  car_interest: "Cars (named or by context)", car_named: "Cars named", car_context: "Cars by context", ad_car: "Ads", colour_wanted: "Colours wanted", colour_interior: "Interior",
  colour_rejected: "Colours refused", colour_alternative: "Second-choice colours", colour_question: "Asked which colours", topic: "Questions", category: "Kinds of car", budget: "Budgets",
  timeline: "Buying when", city: "Cities", purpose: "Purpose", financing: "Paying", competitor: "Other brands", concern: "Concerns", need: "Looking for", trade_in: "Trade-ins",
  mention: "Words for the cars", language: "Languages", activity: "People who wrote",
};
const monthLabel = (m: string) => new Date(`${m}T00:00:00Z`).toLocaleString("en", { month: "short", year: "numeric", timeZone: "UTC" });

export default async function DemandPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireInsightsAccess("/insights/demand");
  if (!access.allowed) return <NotAllowed />;
  const sp = await searchParams;
  const dim = typeof sp.dim === "string" && ORDER.includes(sp.dim) ? sp.dim : "car_interest";
  const brand = typeof sp.brand === "string" && ["voyah", "mhero", "monza"].includes(sp.brand) ? sp.brand : null;
  const channel = typeof sp.channel === "string" && ["whatsapp", "instagram", "facebook"].includes(sp.channel) ? sp.channel : null;
  const read = await readDemand("month", null);
  const link = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const next = { dim, brand, channel, ...patch };
    for (const [k, v] of Object.entries(next)) if (v) q.set(k, v);
    return `/insights/demand?${q.toString()}`;
  };
  const table = read.state === "ok" ? demandTable(read.rows, dim, { brand, channel }) : null;
  const header = ["What", ...(table?.months.map(monthLabel) ?? []), "Total people-months"];
  const rows = (table?.lines ?? []).map((l) => [l.label, ...l.values, l.values.reduce((a, b) => a + b, 0)]);

  return (
    <div className="board">
      <header className="board-head">
        <p className="eyebrow">Insights · Stored demand</p>
        <h1 className="h1">The demand record</h1>
        <p className="lede">
          What people asked about — cars, colours, questions, budgets, cities, other brands — counted month by month and kept for good.{" "}
          <strong>No client data is stored here:</strong> no name, no number, no chat, nothing that points to a person. The counts stay when the chats are
          cleaned up after 12 months or a person is deleted. Stored every night; &quot;Store the record now&quot; brings it up to date.
        </p>
      </header>
      <InsightsNav current="/insights/demand" />

      {read.state !== "ok" ? (
        <p className="board-note board-warn">The stored record could not be read just now — this is not an empty record.</p>
      ) : (
        <>
          <div className="chips" role="group" aria-label="What">
            {ORDER.map((d) => (
              <Link key={d} className="chip" aria-pressed={dim === d} href={link({ dim: d })}>
                {SHORT[d]}
              </Link>
            ))}
          </div>
          <div className="board-tools">
            <div className="chips" role="group" aria-label="Brand">
              {[null, "voyah", "mhero", "monza"].map((b) => (
                <Link key={b ?? "all"} className="chip" aria-pressed={brand === b} href={link({ brand: b })}>
                  {b === null ? "All brands" : b === "monza" ? "Monza S.A.L." : b.toUpperCase()}
                </Link>
              ))}
            </div>
            <div className="chips" role="group" aria-label="Channel">
              {[null, "whatsapp", "instagram", "facebook"].map((c) => (
                <Link key={c ?? "all"} className="chip" aria-pressed={channel === c} href={link({ channel: c })}>
                  {c === null ? "All channels" : c === "whatsapp" ? "WhatsApp" : c === "instagram" ? "Instagram" : "Messenger"}
                </Link>
              ))}
            </div>
          </div>
          <DemandTools header={header} rows={rows} name={dim} />
          <section className="ins-panel">
            <h2 className="ins-h2">{SHORT[dim]}</h2>
            <p className="ins-known">{DIMENSIONS[dim]} — people per month (each person once a month).</p>
            {!table || table.lines.length === 0 ? (
              <p className="ins-empty">Nothing stored yet. Press &quot;Store the record now&quot;.</p>
            ) : (
              <div className="ins-table-wrap">
                <table className="ins-table">
                  <thead>
                    <tr>
                      <th scope="col"></th>
                      {table.months.map((m) => (
                        <th key={m} scope="col">{monthLabel(m)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.lines.map((l) => (
                      <tr key={l.key}>
                        <th scope="row" dir="auto">{l.label}</th>
                        {l.values.map((v, i) => (
                          <td key={i} title={`${l.messages[i]} messages`}>{v || ""}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="ins-known">
              With &quot;All brands&quot; or &quot;All channels&quot;, a person who wrote on two of them in the same month counts once on each. Stored from{" "}
              {read.firstDay ? longDate(read.firstDay) : "—"}; last stored {read.lastComputed ? longDate(read.lastComputed.slice(0, 10)) : "never"}.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
