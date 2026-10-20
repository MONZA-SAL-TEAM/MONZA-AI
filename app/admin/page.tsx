import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminForPage } from "@/lib/auth-server";
import { readTeam, type TeamMember } from "@/lib/access/admin-server";
import { PAGES, PRESETS, type PresetKey } from "@/lib/access/access";
import { sectionLabel } from "@/lib/insights/activity";
import { listReplyTemplates } from "@/lib/channels/wa-templates-server";
import TemplatesAdmin from "./TemplatesAdmin";
import "../board.css";
import "../insights/insights.css";

export const metadata: Metadata = { title: "Team & access — Monza AI" };
export const dynamic = "force-dynamic";

/**
 * /admin — Team & access (Samer, 2026-10-13): every account, who is online and where, and what each may open and
 * do in MONZA AI. Admins only. The CRM's roles are not changed here.
 */

const ago = (iso: string | null, now: number) => {
  if (!iso) return "never";
  const m = Math.round((now - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
};

function accessSummary(m: TeamMember): string {
  const a = m.access;
  if (!a) return "Not set — the CRM role decides";
  if (a.isAdmin) return "Admin — everything";
  if (a.blocked) return "Blocked from MONZA AI";
  const preset = a.preset && a.preset in PRESETS ? PRESETS[a.preset as PresetKey].label : "Custom";
  return `${preset}: ${a.pages.length} of ${PAGES.length} pages, ${a.actions.length} actions`;
}

export default async function AdminPage() {
  const user = await requireAdminForPage("/admin");
  const [read, templates] = await Promise.all([readTeam(user), listReplyTemplates(false)]);
  const now = Date.now();
  const online = read.state === "ok" ? read.members.filter((m) => m.presence !== "offline") : [];

  return (
    <div className="board">
      <header className="board-head">
        <p className="eyebrow">System · Team &amp; access</p>
        <h1 className="h1">Who may do what — and who is here</h1>
        <p className="lede">
          Every account from the CRM&apos;s staff list. Set what each person may open and do in MONZA AI; the CRM app and its roles are not changed.
          Someone you have not set works as before (their CRM role decides). Changes are in force within 15 seconds, everywhere, on the server.
          Tracking shows sections and actions — never which customer.
        </p>
      </header>

      {read.state !== "ok" ? (
        <p className="board-note board-warn">The team could not be read just now — this is not an empty team.</p>
      ) : (
        <>
          {read.crm !== "ok" && <p className="board-note board-warn">The CRM&apos;s staff list could not be read as you, so only people already seen in MONZA AI are listed.</p>}
          <section className="ins-kpis" aria-label="Now">
            <div className="ins-kpi">
              <p className="tile-label">Online now</p>
              <p className="ins-kpi-value">{online.length}</p>
              <p className="ins-kpi-foot ins-known">{online.filter((m) => m.presence === "active").length} active, {online.filter((m) => m.presence === "open").length} with the app open but idle</p>
            </div>
            <div className="ins-kpi">
              <p className="tile-label">Accounts</p>
              <p className="ins-kpi-value">{read.members.length}</p>
              <p className="ins-kpi-foot ins-known">{read.members.filter((m) => m.access).length} with access set · {read.members.filter((m) => m.access?.blocked).length} blocked</p>
            </div>
            <div className="ins-kpi">
              <p className="tile-label">Time in the app today</p>
              <p className="ins-kpi-value">{Math.round(read.members.reduce((a, m) => a + m.minutesToday, 0) / 6) / 10} h</p>
              <p className="ins-kpi-foot ins-known">everyone together</p>
            </div>
          </section>

          <section className="ins-panel">
            <h2 className="ins-h2">Everyone</h2>
            <div className="ins-table-wrap">
              <table className="ins-table">
                <thead>
                  <tr>
                    <th scope="col">Person</th>
                    <th scope="col">Now</th>
                    <th scope="col">Last seen</th>
                    <th scope="col">Signed in</th>
                    <th scope="col">Today</th>
                    <th scope="col">CRM role</th>
                    <th scope="col">MONZA AI access</th>
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  {read.members.map((m) => (
                    <tr key={m.id}>
                      <th scope="row">
                        <Link href={`/admin/${m.id}`}>{m.name}</Link>
                        {m.jobTitle ? <span className="ins-known"> · {m.jobTitle}</span> : null}
                        {m.crmActive === false ? <span className="ins-known"> · inactive in the CRM</span> : null}
                      </th>
                      <td>
                        <span className="ins-health">
                          <span className="ins-health-dot" data-tone={m.presence === "active" ? "good" : undefined} aria-hidden="true" />
                          <span>{m.presence === "active" ? `Active · ${sectionLabel(m.section ?? "other")}` : m.presence === "open" ? `Open, idle · ${sectionLabel(m.section ?? "other")}` : "Offline"}</span>
                        </span>
                        {m.device && m.presence !== "offline" ? <span className="ins-known"> · {m.device}</span> : null}
                      </td>
                      <td>{ago(m.lastSeen, now)}</td>
                      <td>{ago(m.lastSignIn, now)}</td>
                      <td>
                        {m.minutesToday} min · {m.actionsToday} actions
                      </td>
                      <td>{m.crmRole ?? "—"}</td>
                      <td className="ins-wrap">{accessSummary(m)}</td>
                      <td>
                        <Link className="btn quiet" href={`/admin/${m.id}`}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="ins-known">
              &quot;Active&quot; = the app open and used in the last 2 minutes; &quot;Open, idle&quot; = open on screen but not touched. Measured from 13 October 2026.
            </p>
          </section>
          {templates ? <TemplatesAdmin templates={templates} /> : <p className="board-note board-warn">The WhatsApp templates could not be read just now.</p>}
        </>
      )}
    </div>
  );
}
