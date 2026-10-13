import type { Metadata } from "next";
import Link from "next/link";
import { requireInsightsAccess } from "@/lib/auth-server";
import { readEmployees } from "@/lib/insights/activity-server";
import { TASK_LABEL, type TaskKind } from "@/lib/insights/activity";
import { longDate } from "@/lib/format";
import NotAllowed from "../NotAllowed";
import { InsightsNav } from "../parts";
import "../../board.css";
import "../insights.css";

export const metadata: Metadata = { title: "Employees — Monza AI Insights" };
export const dynamic = "force-dynamic";

/**
 * /insights/employees — time each person actively uses MONZA AI and the tasks the records say they did
 * (Samer, 2026-10-13). Owner and managers only, like all of Insights.
 */

const PERIODS: ReadonlyArray<[number, string]> = [
  [1, "Today"],
  [7, "7 days"],
  [30, "30 days"],
  [90, "90 days"],
];
const TASKS = Object.keys(TASK_LABEL) as TaskKind[];
const hours = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireInsightsAccess("/insights/employees");
  if (!access.allowed) return <NotAllowed />;
  const raw = Number((await searchParams).days ?? 7);
  const days = PERIODS.some(([d]) => d === raw) ? raw : 7;
  const read = await readEmployees(days);

  return (
    <div className="board">
      <header className="board-head">
        <p className="eyebrow">Insights · Employees</p>
        <h1 className="h1">Time in the app and work done</h1>
        <p className="lede">
          <strong>Time</strong> is time actively using MONZA AI: the window open and used in the last two minutes, counted a minute at a time. It is not
          hours worked — calls, the showroom and the WhatsApp phone app are work outside the app. <strong>Tasks</strong> are what the records show each
          person did. Staff should know this is measured.
        </p>
      </header>
      <InsightsNav current="/insights/employees" />
      <div className="chips" role="group" aria-label="Period">
        {PERIODS.map(([d, label]) => (
          <Link key={d} className="chip" aria-pressed={days === d} href={`/insights/employees?days=${d}`}>
            {label}
          </Link>
        ))}
      </div>

      {read.state !== "ok" ? (
        <p className="board-note board-warn">This could not be read just now — it is not an empty team.</p>
      ) : (
        <>
          <section className="ins-panel">
            <h2 className="ins-h2">By person</h2>
            {read.employees.length === 0 ? (
              <p className="ins-empty">Nobody yet. Time is counted from {read.firstDay ? longDate(read.firstDay) : "the first minute after this update"} — earlier use was never measured.</p>
            ) : (
              <div className="ins-table-wrap">
                <table className="ins-table">
                  <thead>
                    <tr>
                      <th scope="col">Person</th>
                      <th scope="col">Time in the app</th>
                      <th scope="col">Days used</th>
                      <th scope="col">Usual day</th>
                      <th scope="col" title="Median Beirut time of the first and the last minute in the app">Usually from – to</th>
                      <th scope="col">Where</th>
                      <th scope="col">Tasks</th>
                      <th scope="col" title="Tasks per hour in the app (shown from 30 minutes)">Tasks / hour</th>
                    </tr>
                  </thead>
                  <tbody>
                    {read.employees.map((e) => (
                      <tr key={e.key}>
                        <th scope="row">{e.name}</th>
                        <td>{e.activeMinutes ? hours(e.activeMinutes) : "—"}</td>
                        <td>{e.daysActive || "—"}</td>
                        <td>{e.minutesPerActiveDay === null ? "—" : hours(e.minutesPerActiveDay)}</td>
                        <td>{e.typicalStart && e.typicalEnd ? `${e.typicalStart} – ${e.typicalEnd}` : "—"}</td>
                        <td className="ins-wrap">{e.sections.slice(0, 3).map((s) => `${s.label} ${hours(s.minutes)}`).join(" · ") || "—"}</td>
                        <td>{e.tasksTotal}</td>
                        <td>{e.tasksPerHour ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="ins-known">
              &quot;—&quot; for time means the person did tasks but no minute in the app was measured (time is counted from{" "}
              {read.firstDay ? longDate(read.firstDay) : "this update"}).
            </p>
          </section>

          <section className="ins-panel">
            <h2 className="ins-h2">Tasks done</h2>
            <div className="ins-table-wrap">
              <table className="ins-table">
                <thead>
                  <tr>
                    <th scope="col">Person</th>
                    {TASKS.map((t) => (
                      <th key={t} scope="col">{TASK_LABEL[t]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {read.employees.map((e) => (
                    <tr key={e.key}>
                      <th scope="row">{e.name}</th>
                      {TASKS.map((t) => (
                        <td key={t}>{e.tasks[t] ?? 0}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="ins-known">
              {read.notAttributed === null ? "Replies typed in the WhatsApp phone app could not be counted." : `${read.notAttributed} WhatsApp replies in this period were typed in the WhatsApp phone app — they carry no name, so they belong to nobody here.`}{" "}
              Replying from the MONZA AI inbox puts each reply under the person who sent it.
            </p>
          </section>

          <section className="ins-panel">
            <h2 className="ins-h2">Minutes in the app, day by day</h2>
            {read.daily.rows.length === 0 ? (
              <p className="ins-empty">No minutes measured yet.</p>
            ) : (
              <div className="ins-table-wrap">
                <table className="ins-table">
                  <thead>
                    <tr>
                      <th scope="col">Person</th>
                      {read.daily.days.map((d) => (
                        <th key={d} scope="col">{d.slice(5)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {read.daily.rows.map((r) => (
                      <tr key={r.staffId}>
                        <th scope="row">{r.name}</th>
                        {r.minutes.map((m, i) => (
                          <td key={i}>{m || ""}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
