import type { Metadata } from "next";
import Link from "next/link";
import { requireInsightsAccess } from "@/lib/auth-server";
import { readDecisionCenter, RULE_LIST, type DecisionItem } from "@/lib/insights/decisions-server";
import { describe, RULES, SLA, type Group } from "@/lib/insights/decisions";
import { assignableStaff } from "@/lib/leads/ownership-server";
import { longDate } from "@/lib/format";
import NotAllowed from "../NotAllowed";
import { DemandLevelsTable, InsightsNav } from "../parts";
import DecisionActions from "./DecisionActions";
import "../../board.css";
import "../insights.css";

export const metadata: Metadata = { title: "Decision Center — Monza AI Insights" };
export const dynamic = "force-dynamic";

/**
 * /insights/decisions — what needs a person today (Samer, 2026-10-13). Fixed rules over the facts already
 * recorded; each item has a next step, a person and a state, and closes itself when the condition is gone.
 * No price anywhere: stock and sales are units.
 */

const GROUPS: ReadonlyArray<[Group, string, string]> = [
  ["customers", "Customers waiting", "Buyers and alerts that need a person now."],
  ["stock", "Stock and demand", "What people ask for beside what the CRM has."],
  ["data", "Can the numbers be trusted?", "Gaps that make the figures incomplete."],
];
const STAGE_LABEL: Readonly<Record<string, string>> = { buying: "Want to buy", test_drive: "Test drive / visit", pricing: "Asked price or terms", interested: "Interested in a car", asking: "Asked a question", wrote: "Only wrote" };
const SEVERITY_LABEL = { critical: "Critical", high: "High", normal: "Normal" } as const;
const STATE_LABEL: Readonly<Record<string, string>> = { open: "Open", acknowledged: "Seen", escalated: "Escalated", resolved: "Done", dismissed: "Dismissed", cleared: "Cleared by itself" };
const when = (iso: string | null) => (iso ? `${longDate(iso.slice(0, 10))} ${iso.slice(11, 16)}` : "—");
const num = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n);

function Item({ it, staff }: { it: DecisionItem; staff: { id: string; name: string | null }[] }) {
  const rule = RULES[it.rule];
  const live = it.state === "open" || it.state === "acknowledged" || it.state === "escalated";
  return (
    <li className="ins-dec" data-severity={it.severity}>
      <div className="ins-dec-head">
        <span className="ins-dec-tag" data-severity={it.severity}>{SEVERITY_LABEL[it.severity]}</span>
        <p className="ins-dec-title">
          {rule.label}
          {it.personName ? ` — ${it.personName}` : ""}
        </p>
        <span className="ins-known">{STATE_LABEL[it.state] ?? it.state}</span>
      </div>
      <p className="ins-dec-meta">{describe(it.rule, it.facts, it.model)}</p>
      <p className="ins-dec-action">
        <strong>Next step:</strong> {rule.action} <span className="ins-known">({rule.who})</span>
      </p>
      <p className="ins-dec-meta">
        Since {when(it.firstSeen)}
        {it.dueAt ? ` · due ${when(it.dueAt)}` : ""}
        {it.assignedName ? ` · assigned to ${it.assignedName}` : " · nobody assigned"}
        {it.closedAt ? ` · closed ${when(it.closedAt)}${it.closedName ? ` by ${it.closedName}` : ""}` : ""}
      </p>
      <div className="ins-dec-tools">
        {it.threadId && (
          <Link className="btn quiet" href={`/inbox?open=${encodeURIComponent(it.threadId)}`}>
            Open the chat
          </Link>
        )}
        {it.personKey && (
          <Link className="btn quiet" href={`/insights/clients/${encodeURIComponent(it.personKey)}`}>
            Profile
          </Link>
        )}
        {it.model && !it.personKey && (
          <Link className="btn quiet" href={`/insights/models/${it.model}`}>
            The car
          </Link>
        )}
        {it.rule === "unowned_qualified" && (
          <Link className="btn quiet" href="/insights/customers">
            The list
          </Link>
        )}
      </div>
      <DecisionActions id={it.id} live={live} staff={staff} assignedTo={it.assignedTo} personItem={Boolean(it.personKey)} />
    </li>
  );
}

export default async function DecisionsPage() {
  const access = await requireInsightsAccess("/insights/decisions");
  if (!access.allowed) return <NotAllowed />;
  const [read, staff] = await Promise.all([readDecisionCenter(access.user), assignableStaff(access.user).catch(() => [])]);

  return (
    <div className="board">
      <header className="board-head">
        <p className="eyebrow">Insights · Decision Center</p>
        <h1 className="h1">What needs attention today</h1>
        <p className="lede">
          Found by fixed rules over what customers wrote, the alerts, the test-drive calendar and the CRM — never guessed, never a price. Each item has a
          next step and a person; it closes itself when the condition is gone, and every action is recorded.
        </p>
      </header>
      <InsightsNav current="/insights/decisions" />

      {read.state !== "ok" ? (
        <p className="board-note board-warn">The Decision Center could not be read just now — this is not an empty list.</p>
      ) : (
        <>
          <section className="ins-kpis ins-morning" aria-label="The five morning numbers">
            <div className="ins-kpi" title="Qualified people (a car AND a buying question) who wrote in the last 14 days and are waiting for us or have no salesperson.">
              <p className="tile-label">1 · Buyers needing action</p>
              <p className="ins-kpi-value">{read.morning.buyersNeedingAction}</p>
              <p className="ins-kpi-foot ins-known">qualified, last {SLA.activeDays} days</p>
            </div>
            <div className="ins-kpi" title={`Buyers waiting more than ${SLA.replyMinutes / 60} business hours, test drives not booked, and alerts open more than ${SLA.alertHours} h that were not answered.`}>
              <p className="tile-label">2 · Overdue replies and follow-ups</p>
              <p className="ins-kpi-value">{read.morning.overdue}</p>
              <p className="ins-kpi-foot ins-known">open now</p>
            </div>
            <div className="ins-kpi">
              <p className="tile-label">3 · From chat to sale, by car</p>
              {read.morning.conversionKnown ? (
                <table className="ins-mini">
                  <tbody>
                    {read.morning.conversion.slice(0, 5).map((c) => (
                      <tr key={c.code}>
                        <th scope="row">{c.label}</th>
                        <td>{c.won === null ? "—" : `${c.won} of ${c.people}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="ins-kpi-foot ins-known">Unknown — no chat of the last 90 days is linked to a CRM sale (the CRM has almost no customer mobiles). Not zero.</p>
              )}
            </div>
            <div className="ins-kpi">
              <p className="tile-label">4 · Buyers vs cars in stock</p>
              <table className="ins-mini">
                <tbody>
                  {read.morning.demandVsStock.slice(0, 6).map((d) => (
                    <tr key={d.code}>
                      <th scope="row">{d.label}</th>
                      <td>
                        {d.intent} vs {d.inStock === null ? "—" : d.inStock}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="ins-kpi-foot ins-known">qualified buyers ({SLA.demandDays} days) vs in stock now</p>
            </div>
            <div className="ins-kpi">
              <p className="tile-label">5 · Pipeline and how long it is quiet</p>
              <table className="ins-mini">
                <tbody>
                  {read.morning.pipeline.filter((p) => p.people > 0).map((p) => (
                    <tr key={p.stage}>
                      <th scope="row">{STAGE_LABEL[p.stage]}</th>
                      <td>
                        {p.people} · {p.medianDaysQuiet ?? "—"} d
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="ins-kpi-foot ins-known">people (90 days) · median days since they last wrote</p>
            </div>
          </section>

          {GROUPS.map(([group, title, sub]) => {
            const its = read.items.filter((i) => RULES[i.rule].group === group);
            return (
              <section key={group} className="ins-panel">
                <h2 className="ins-h2">
                  {title} <span className="ins-known">({its.length})</span>
                </h2>
                <p className="ins-known">{sub}</p>
                {its.length === 0 ? (
                  <p className="ins-empty">{group === "stock" && read.crm !== "ok" ? "The CRM could not be read as you, so stock was not checked — unknown, not fine." : "Nothing needs attention here right now."}</p>
                ) : (
                  <ul className="ins-dec-list">
                    {its.slice(0, 60).map((it) => (
                      <Item key={it.id} it={it} staff={staff} />
                    ))}
                  </ul>
                )}
                {its.length > 60 && <p className="ins-known">{its.length - 60} more, less urgent — they show as these are done.</p>}
              </section>
            );
          })}

          <section className="ins-panel">
            <h2 className="ins-h2">Demand, stock and sales by car</h2>
            <p className="ins-known">
              People who wrote in the last 90 days, each once per column; stock and units sold from the CRM, read as you. No price.
            </p>
            <DemandLevelsTable levels={read.levels} />
            <p className="ins-known">
              The four levels are evidence, not a funnel: an ad click is exposure; naming the car is interest; asking to buy is intent; a booking or an order
              is commitment. &quot;—&quot; means the CRM could not be read — unknown, not zero. &quot;Months of stock&quot; is blank when nothing sold in 90 days.
              {read.salesKnown ? "" : " Sales could not be read from the CRM just now."}
            </p>
          </section>

          <section className="ins-grid">
            <div className="ins-panel">
              <h2 className="ins-h2">Is acting on it working? (30 days)</h2>
              <table className="ins-mini">
                <tbody>
                  <tr><th scope="row">Items opened</th><td>{read.effectiveness.opened}</td></tr>
                  <tr><th scope="row">Done by a person</th><td>{read.effectiveness.resolved}</td></tr>
                  <tr><th scope="row">Cleared by themselves</th><td>{read.effectiveness.cleared}</td></tr>
                  <tr><th scope="row">Dismissed</th><td>{read.effectiveness.dismissed}</td></tr>
                  <tr><th scope="row">Median hours to close</th><td>{num(read.effectiveness.medianHoursToClose)}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="ins-panel">
              <h2 className="ins-h2">Closed in the last 7 days</h2>
              {read.recentlyClosed.length === 0 ? (
                <p className="ins-empty">Nothing closed yet.</p>
              ) : (
                <ul className="ins-dec-list">
                  {read.recentlyClosed.slice(0, 10).map((it) => (
                    <Item key={it.id} it={it} staff={[]} />
                  ))}
                </ul>
              )}
            </div>
          </section>

          <details className="ins-panel">
            <summary className="ins-h2">The rules</summary>
            <div className="ins-table-wrap">
              <table className="ins-table">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">When it appears</th>
                    <th scope="col">Next step</th>
                    <th scope="col">Who</th>
                  </tr>
                </thead>
                <tbody>
                  {RULE_LIST.map((r) => (
                    <tr key={r.key}>
                      <th scope="row">{r.label}</th>
                      <td className="ins-wrap">{r.trigger}</td>
                      <td className="ins-wrap">{r.action}</td>
                      <td>{r.who}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
