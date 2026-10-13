import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminForPage } from "@/lib/auth-server";
import { readPerson } from "@/lib/access/admin-server";
import { eventLabel } from "@/lib/access/access";
import { sectionLabel } from "@/lib/insights/activity";
import { beirutDay } from "@/lib/insights/demand";
import { longDate } from "@/lib/format";
import AccessEditor from "./AccessEditor";
import "../../board.css";
import "../../insights/insights.css";

export const metadata: Metadata = { title: "Person — Team & access — Monza AI" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIODS: ReadonlyArray<[number, string]> = [
  [1, "Today"],
  [7, "7 days"],
  [30, "30 days"],
];
const clock = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const hours = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

/** /admin/[id] — one person: their access, where they are now, and what they did, minute by minute. */
export default async function PersonPage({ params, searchParams }: { params: { id: string }; searchParams: { days?: string } }) {
  const user = await requireAdminForPage(`/admin/${params.id}`);
  if (!UUID.test(params.id)) notFound();
  const days = PERIODS.some(([d]) => String(d) === searchParams.days) ? Number(searchParams.days) : 7;
  const read = await readPerson(user, params.id, days);
  if (!read) return <p className="board-note board-warn">This could not be read just now.</p>;
  const m = read.member;
  const name = m?.name ?? "Staff";
  const byDay = new Map<string, typeof read.events>();
  for (const e of read.events) {
    const d = beirutDay(e.at);
    (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(e);
  }

  return (
    <div className="board">
      <header className="board-head">
        <p className="eyebrow">
          <Link href="/admin">Team &amp; access</Link> · Person
        </p>
        <h1 className="h1">{name}</h1>
        <p className="lede">
          {m?.email ?? ""}
          {m?.crmRole ? ` · CRM role ${m.crmRole}` : ""}
          {m ? ` · ${m.presence === "active" ? `active now in ${sectionLabel(m.section ?? "other")}` : m.presence === "open" ? `app open, idle (${sectionLabel(m.section ?? "other")})` : "offline"}` : ""}
          {m?.device ? ` · ${m.device}` : ""}
        </p>
      </header>

      <AccessEditor userId={params.id} name={name} email={m?.email ?? null} initial={m?.access ?? null} isSelf={params.id === user.userId} />

      <div className="chips" role="group" aria-label="Period">
        {PERIODS.map(([d, label]) => (
          <Link key={d} className="chip" aria-pressed={days === d} href={`/admin/${params.id}?days=${d}`}>
            {label}
          </Link>
        ))}
      </div>

      <section className="ins-grid">
        <div className="ins-panel">
          <h2 className="ins-h2">Time in the app</h2>
          {read.days.length === 0 ? (
            <p className="ins-empty">No minute measured in this period.</p>
          ) : (
            <table className="ins-mini">
              <tbody>
                {read.days.map((d) => (
                  <tr key={d.day}>
                    <th scope="row">
                      {longDate(d.day)} · {clock(d.firstAt)}–{clock(d.lastAt)}
                    </th>
                    <td>
                      {hours(d.minutes)}
                      <span className="ins-known">
                        {" "}
                        ({Object.entries(d.sections).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${sectionLabel(k)} ${v}`).join(", ")})
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="ins-known">Time = the app open and used in the last 2 minutes. First and last minute in Beirut time.</p>
        </div>
        <div className="ins-panel">
          <h2 className="ins-h2">Access changes</h2>
          {read.log.length === 0 ? (
            <p className="ins-empty">Never changed.</p>
          ) : (
            <ul className="ins-people">
              {read.log.map((l, i) => {
                const a = l.after as { is_admin?: boolean; blocked?: boolean; preset?: string; pages?: string[]; actions?: string[] } | null;
                return (
                  <li key={i}>
                    {longDate(l.at.slice(0, 10))} {clock(l.at)} — {l.byName ?? "Someone"}:{" "}
                    {!a ? "back to the CRM role" : a.is_admin ? "admin" : a.blocked ? "blocked" : `${a.preset ?? "custom"} · ${a.pages?.length ?? 0} pages · ${a.actions?.length ?? 0} actions`}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="ins-panel">
        <h2 className="ins-h2">What they did</h2>
        {read.events.length === 0 ? (
          <p className="ins-empty">Nothing recorded in this period (recording started 13 October 2026).</p>
        ) : (
          [...byDay.entries()].map(([day, list]) => (
            <div key={day}>
              <h3 className="tile-label">{longDate(day)}</h3>
              <ul className="ins-people">
                {list.map((e, i) => (
                  <li key={i} data-kind={e.kind}>
                    <span className="ins-known">{clock(e.at)}</span> {eventLabel(e.kind, e.detail)}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
        <p className="ins-known">Sections opened, sign-ins, every button that changes something, and anything refused. Never which customer, never a message.</p>
      </section>
    </div>
  );
}
