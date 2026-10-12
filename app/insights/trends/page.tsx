import type { Metadata } from "next";
import Link from "next/link";
import { requireInsightsAccess } from "@/lib/auth-server";
import { channelDb } from "@/lib/channels/store";
import { readInsightRows } from "@/lib/insights/insights-server";
import { buildPersonFacts, type PersonFacts } from "@/lib/insights/people";
import { phoneOfPerson } from "@/lib/insights/analysis-server";
import { readCrmOutcomes } from "@/lib/insights/crm-server";
import type { CrmOutcome } from "@/lib/insights/crm";
import { marketTrends, type Growth, type SpendRow } from "@/lib/insights/trends";
import { labHref } from "@/lib/insights/query";
import NotAllowed from "../NotAllowed";
import { InsightsNav, Weekly } from "../parts";
import SpendForm from "./SpendForm";
import "../../board.css";
import "../insights.css";

export const metadata: Metadata = { title: "Market trends — Monza AI Insights" };
export const dynamic = "force-dynamic";

/**
 * /insights/trends — the last 12 months: new leads, demand per car, colours and channels month by month;
 * which cars and questions are gaining or losing (equal windows, a zero baseline reads "new"); and cost per
 * lead from the ad spend a manager entered — never estimated.
 */

const money = (n: number | null) => (n === null ? "—" : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
const monthLabel = (m: string) => new Date(`${m}T00:00:00Z`).toLocaleString("en", { month: "short", year: "2-digit", timeZone: "UTC" });

function GrowthTable({ title, rows, link }: { title: string; rows: readonly Growth[]; link?: (key: string) => string }) {
  return (
    <div className="ins-panel">
      <h2 className="ins-h2">{title}</h2>
      {rows.length === 0 ? (
        <p className="ins-empty">Not enough to compare yet.</p>
      ) : (
        <div className="ins-table-wrap">
          <table className="ins-table">
            <thead>
              <tr>
                <th scope="col"></th>
                <th scope="col">Now</th>
                <th scope="col">Before</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.key}>
                  <th scope="row">{link ? <Link href={link(g.key)}>{g.label}</Link> : g.label}</th>
                  <td>{g.now}</td>
                  <td>{g.before}</td>
                  <td className={g.change !== null && g.change < 0 ? "ins-short" : ""}>{g.change === null ? (g.now > 0 ? "new" : "—") : `${g.change >= 0 ? "+" : ""}${Math.round(g.change * 100)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default async function TrendsPage() {
  const access = await requireInsightsAccess("/insights/trends");
  if (!access.allowed) return <NotAllowed />;
  const sb = channelDb();
  const [read, crm, spendRead] = await Promise.all([
    readInsightRows(null),
    readCrmOutcomes(access.user),
    sb ? sb.from("insight_ad_spend").select("id, month, brand, channel, amount, by_name, at").order("month", { ascending: false }).limit(500) : Promise.resolve({ data: null, error: true }),
  ]);
  if (read.state !== "ok") {
    return (
      <div className="board">
        <header className="board-head"><p className="eyebrow">Insights · Market trends</p><h1 className="h1">Market trends</h1></header>
        <InsightsNav current="/insights/trends" />
        <p className="board-note board-warn">Monza AI&apos;s database could not be read here, so nothing is shown — not zero.</p>
      </div>
    );
  }
  const nowMs = Date.now();
  const people = buildPersonFacts(read.rows, read.extras);
  const firstEver = new Map(people.map((p) => [p.key, p.firstAt]));
  const leadByConv = new Map(read.rows.leadConversations.map((lc) => [lc.conversation_id, lc.lead_id]));
  const personOf = (conv: string) => (leadByConv.get(conv) ? `lead:${leadByConv.get(conv)}` : `chat:${conv}`);
  const phoneOf = phoneOfPerson(read.rows);
  const outcomeOf = crm.state === "ok" ? (p: PersonFacts): CrmOutcome | null => { const ph = phoneOf(p); return ph ? (crm.data[ph]?.outcome ?? null) : null; } : null;
  const spendRows = ((spendRead.data ?? []) as (SpendRow & { id: string; by_name: string | null; at: string })[]).map((r) => ({ ...r, amount: Number(r.amount) }));
  const t = marketTrends({ people, signals: read.rows.signals, observations: read.rows.observations ?? [], personOf, firstEver, spend: spendRows, outcomeOf, nowMs });
  const labels = t.months.map(monthLabel);
  const caption = (title: string) => `${title}, people per month, ${labels[0]} – ${labels[labels.length - 1]}`;
  const thisMonth = new Date(nowMs).toISOString().slice(0, 7);

  return (
    <div className="board">
      <header className="board-head">
        <p className="eyebrow">Insights · Market trends</p>
        <h1 className="h1">Market trends</h1>
        <p className="lede">
          The last 12 months, people counted once per month. &quot;Gaining or losing&quot; compares equal windows (the last 30 or 90 days with the same length
          before). Interest counts a car named or asked about by context. Use it to see what to investigate before ordering stock — not as a forecast.
        </p>
      </header>
      <InsightsNav current="/insights/trends" />

      <section className="ins-grid">
        <div className="ins-panel"><Weekly values={t.newLeads} title="New leads" caption={caption("New leads")} /></div>
        <div className="ins-panel"><Weekly values={t.activePeople} title="People who wrote" caption={caption("People who wrote")} /></div>
        {t.channels.map((c) => (
          <div key={c.key} className="ins-panel"><Weekly values={c.series} title={c.key} caption={caption(c.key === "whatsapp" ? "WhatsApp" : c.key === "instagram" ? "Instagram" : "Messenger")} /></div>
        ))}
      </section>

      <section className="section-head"><h2 className="ins-h2">Demand per car, month by month</h2></section>
      <section className="ins-grid">
        {t.demand.map((d) => (
          <div key={d.code} className="ins-panel">
            <h3 className="ins-h2"><Link href={`/insights/models/${d.code}`}>{d.name}</Link></h3>
            <Weekly values={d.series} title={d.name} caption={caption(d.name)} />
          </div>
        ))}
      </section>

      <section className="ins-grid">
        <GrowthTable title="Cars: last 30 days vs the 30 before" rows={t.growth30} link={(k) => labHref({ anyModel: k, days: 30 })} />
        <GrowthTable title="Cars: last 90 days vs the 90 before" rows={t.growth90} link={(k) => labHref({ anyModel: k, days: 90 })} />
        <GrowthTable title="Questions gaining (30 days)" rows={t.topicsRising} link={(k) => labHref({ topic: k, days: 30 })} />
        <GrowthTable title="Questions losing (30 days)" rows={t.topicsFalling} link={(k) => labHref({ topic: k, days: 30 })} />
      </section>

      <section className="section-head"><h2 className="ins-h2">Colours wanted, month by month</h2></section>
      <section className="ins-grid">
        {t.colours.map((c) => (
          <div key={c.key} className="ins-panel">
            <Weekly values={c.series} title={c.key} caption={caption(c.key.charAt(0).toUpperCase() + c.key.slice(1))} />
          </div>
        ))}
        {t.colours.length === 0 && <p className="ins-empty">Nobody has named a colour yet.</p>}
      </section>

      <section className="ins-panel">
        <h2 className="ins-h2">Ad spend and cost per lead</h2>
        <p className="ins-known">
          Enter what each ad account actually spent (USD). A lead is a new person that month, on that brand (and channel), who arrived from an ad.
          Without a figure, no cost is shown — it is never estimated.
        </p>
        <SpendForm month={thisMonth} />
        {spendRead.error ? (
          <p className="ins-empty">Ad spend could not be read just now.</p>
        ) : t.spend.length === 0 ? (
          <p className="ins-empty">No spend entered yet.</p>
        ) : (
          <div className="ins-table-wrap">
            <table className="ins-table">
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Brand</th>
                  <th scope="col">Channel</th>
                  <th scope="col">Spend</th>
                  <th scope="col">Ad leads</th>
                  <th scope="col">Per lead</th>
                  <th scope="col">Qualified</th>
                  <th scope="col">Per qualified</th>
                  <th scope="col">Sales (CRM)</th>
                  <th scope="col">Per sale</th>
                </tr>
              </thead>
              <tbody>
                {t.spend.map((s) => (
                  <tr key={`${s.month}-${s.brand}-${s.channel}`}>
                    <th scope="row">{monthLabel(s.month)}</th>
                    <td>{s.brand.toUpperCase()}</td>
                    <td>{s.channel}</td>
                    <td>{money(s.amount)}</td>
                    <td>{s.adLeads}</td>
                    <td>{money(s.costPerLead)}</td>
                    <td>{s.qualified}</td>
                    <td>{money(s.costPerQualified)}</td>
                    <td>{s.won === null ? "—" : s.won}</td>
                    <td>{money(s.costPerSale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
