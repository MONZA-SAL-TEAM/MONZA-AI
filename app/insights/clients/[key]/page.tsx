import type { Metadata } from "next";
import Link from "next/link";
import { requireInsightsAccess } from "@/lib/auth-server";
import { longDate } from "@/lib/format";
import { readClientProfile } from "@/lib/insights/profile-server";
import { channelLabel, type ClientProfile } from "@/lib/insights/profile";
import NotAllowed from "../../NotAllowed";
import { LostReason, SamePerson, Separate } from "./ProfileTools";
import { LOST_LABEL } from "@/lib/insights/outcomes";
import "../../../board.css";
import "../../insights.css";

export const metadata: Metadata = {
  title: "Client — Monza AI Insights",
};
export const dynamic = "force-dynamic";

/**
 * /insights/clients/[key] — one client, everything known (Samer, 2026-10-12): the cars and colours they
 * want and refuse, budget, timeline, purpose, city, financing, trade-in, other brands, concerns, the ad that
 * brought them, the car the CRM sold them, and the journey — as labels, never the words. Every message
 * entry opens the chat itself.
 */

const BRAND_LABEL: Readonly<Record<string, string>> = { voyah: "VOYAH", mhero: "MHERO", monza: "Monza S.A.L." };
const day = (iso: string | null) => (iso ? longDate(iso.slice(0, 10)) : "—");
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Beirut" });
const list = (xs: readonly string[]) => (xs.length > 0 ? xs.join(", ") : "—");

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="ins-client-line">
      <span className="cap">{label}</span> {children}
    </p>
  );
}

function CrmCars({ p }: { p: ClientProfile }) {
  const crm = p.crm;
  if (crm.state === "not_connected") return <p className="ins-empty">The CRM is not connected here.</p>;
  if (crm.state === "unavailable") return <p className="ins-empty">The CRM could not be read just now, so this is unknown — not empty.</p>;
  if (crm.data.length === 0) return <p className="ins-empty">No car in the CRM for this mobile number{p.phone ? "" : " (no mobile number is known)"}.</p>;
  return (
    <ul className="rows">
      {crm.data.map((c, i) => (
        <li key={i} className="rowcard">
          <p className="rowcard-name">{c.carLabel || "A car"}</p>
          <p className="rowcard-sub">
            {[c.exterior ? `Exterior ${c.exterior}` : null, c.interior ? `Interior ${c.interior}` : null, c.orderStatus ? `Order ${c.orderStatus.replace(/_/g, " ")}` : null, c.carStatus ? `Car ${c.carStatus.replace(/_/g, " ")}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="ins-client-line">
            <span className="cap">Ordered</span> {day(c.at)} {c.deliveredAt && <><span className="cap">Delivered</span> {day(c.deliveredAt)}</>}
          </p>
        </li>
      ))}
    </ul>
  );
}

export default async function ClientProfilePage({ params }: { params: Promise<{ key: string }> }) {
  const { key: raw } = await params;
  const key = decodeURIComponent(raw);
  const access = await requireInsightsAccess(`/insights/clients/${encodeURIComponent(key)}`);
  if (!access.allowed) return <NotAllowed />;
  const read = await readClientProfile(key, access.user);

  if (read.state !== "ok") {
    return (
      <div className="board">
        <header className="board-head">
          <p className="eyebrow">
            <Link href="/insights">Insights</Link> · Client
          </p>
          <h1 className="h1">{read.state === "not_found" ? "This client was not found" : "This client could not be read"}</h1>
          <p className="lede">{read.state === "not_found" ? "The link may be old, or the person was deleted." : "Monza AI's database could not be read here, so nothing is shown."}</p>
        </header>
      </div>
    );
  }

  const p = read.profile;
  const firstChat = p.threads.find((t) => t.threadId)?.threadId ?? null;
  return (
    <div className="board">
      <header className="board-head">
        <p className="eyebrow">
          <Link href="/insights">Insights</Link> · Client
        </p>
        <h1 className="h1">{p.name}</h1>
        <p className="lede">
          {p.typeLabel} · {p.stageLabel}
          {p.phone ? ` · +${p.phone}` : ""}
          {p.language ? ` · writes in ${p.language}` : ""}
        </p>
        <div className="rowcard-actions">
          {firstChat ? (
            <Link className="btn primary" href={`/inbox?open=${encodeURIComponent(firstChat)}`}>
              Open the chat
            </Link>
          ) : (
            <Link className="btn" href="/inbox">
              Open the inbox
            </Link>
          )}
          {p.waiting && <span className="tag urgent">Waiting for a person: {p.waiting.replace(/_/g, " ").toLowerCase()}</span>}
        </div>
      </header>

      <section className="tiles" aria-label="At a glance">
        <div className="tile"><p className="tile-label">Messages</p><p className="tile-value">{p.messages}</p><p className="tile-foot">on {p.activeDays} {p.activeDays === 1 ? "day" : "days"}</p></div>
        <div className="tile"><p className="tile-label">First message</p><p className="tile-value ins-tile-date">{day(p.firstAt)}</p><p className="tile-foot">{p.firstTouch ? p.firstTouch.label : "How they found us: not tracked"}</p></div>
        <div className="tile"><p className="tile-label">Last message</p><p className="tile-value ins-tile-date">{day(p.lastAt)}</p><p className="tile-foot">{p.threads.map((t) => `${channelLabel(t.channel)} · ${BRAND_LABEL[t.brand] ?? t.brand}`).join(" / ")}</p></div>
      </section>

      <section className="ins-grid" aria-label="Decisions about this person">
        <div className="ins-panel">
          <h2 className="ins-h2">Their chats</h2>
          <ul className="ins-people">
            {p.threads.map((t) => (
              <li key={t.conversationId}>
                {channelLabel(t.channel)} · {BRAND_LABEL[t.brand] ?? t.brand} <span className="ins-known">{day(t.firstAt)} – {day(t.lastAt)}</span>{" "}
                {t.threadId && <Link href={`/inbox?open=${encodeURIComponent(t.threadId)}`}>Open</Link>}{" "}
                {p.threads.length > 1 && <Separate conversation={t.conversationId} />}
              </li>
            ))}
          </ul>
          <SamePerson person={p.key} />
          {p.identityHistory.length > 0 && (
            <p className="ins-known">
              {p.identityHistory.map((h) => `${h.action === "merge" ? "Joined" : "Separated"} by ${h.by ?? "staff"} on ${day(h.at)}`).join(" · ")}
            </p>
          )}
        </div>
        <div className="ins-panel">
          <h2 className="ins-h2">Lost?</h2>
          {(() => {
            const current = p.lostHistory[0] && p.lostHistory[0].reason !== "cleared" ? p.lostHistory[0].reason : null;
            return (
              <>
                <p className="ins-client-line">
                  {current ? <>Recorded as lost: <strong>{LOST_LABEL[current] ?? current}</strong></> : "Not recorded as lost. A quiet lead is never assumed lost."}
                </p>
                <LostReason person={p.key} current={current} />
              </>
            );
          })()}
          {p.lostHistory.length > 0 && (
            <p className="ins-known">
              {p.lostHistory.map((h) => `${h.reason === "cleared" ? "Cleared" : LOST_LABEL[h.reason] ?? h.reason} — ${h.by ?? "staff"}, ${day(h.at)}`).join(" · ")}
            </p>
          )}
        </div>
      </section>

      <section className="ins-grid" aria-label="What they want">
        <div className="ins-panel">
          <h2 className="ins-h2">The cars</h2>
          <Line label="Main">{p.models.primary ?? "—"}</Line>
          <Line label="Also">{list(p.models.secondary)}</Line>
          <Line label="Compared">{list(p.models.compared)}</Line>
          <Line label="Doesn't want">{list(p.models.rejected)}</Line>
        </div>
        <div className="ins-panel">
          <h2 className="ins-h2">Colours</h2>
          <Line label="Wants">{list(p.colours.wants)}</Line>
          <Line label="Asked about">{list(p.colours.asked)}</Line>
          <Line label="Would accept">{list(p.colours.alternatives)}</Line>
          {p.colours.askedWhich && <Line label="Also">Asked which colours exist</Line>}
          <Line label="Interior">{list(p.colours.interior)}</Line>
          <Line label="Doesn't want">{list(p.colours.rejects)}</Line>
          {p.colours.anyColour && <Line label="Flexible">Said any colour is fine</Line>}
        </div>
        <div className="ins-panel">
          <h2 className="ins-h2">About them</h2>
          {p.facts.length === 0 ? (
            <p className="ins-empty">Nothing said yet about budget, timing, city or purpose.</p>
          ) : (
            p.facts.map((f) => (
              <Line key={f.kind} label={f.label}>
                {f.items.join(" · ")}
              </Line>
            ))
          )}
        </div>
        <div className="ins-panel">
          <h2 className="ins-h2">Their car, from the CRM</h2>
          <CrmCars p={p} />
        </div>
      </section>

      <section className="section-head">
        <h2 className="ins-h2">The journey</h2>
        <p className="lede">Every message as what it was about — never the words. Open the chat to read it.</p>
      </section>
      {p.journey.length === 0 ? (
        <p className="board-empty">Nothing recorded yet.</p>
      ) : (
        <ul className="rows ins-journey">
          {p.journey.map((j, i) => (
            <li key={i} className={`rowcard${j.kind === "alert" ? " urgent" : j.kind === "crm" ? " ready" : ""}`}>
              <div className="rowcard-top">
                <div>
                  <p className="rowcard-name">{j.title}</p>
                  <p className="rowcard-sub">
                    {day(j.at)} · {time(j.at)}
                    {j.channel ? ` · ${channelLabel(j.channel)}` : j.kind === "crm" ? " · CRM" : ""}
                  </p>
                </div>
                {j.threadId && (
                  <Link className="btn quiet" href={`/inbox?open=${encodeURIComponent(j.threadId)}`}>
                    Open
                  </Link>
                )}
              </div>
              {j.details.length > 0 && <p className="ins-client-line">{j.details.join(" · ")}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
