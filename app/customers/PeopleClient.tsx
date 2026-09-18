"use client";

/**
 * Customers — the REAL people Monza is talking to (Samer, 2026-09-18: "all my
 * customers need to be tracked; this needs to be somewhat a database for my
 * company, my clients and ads").
 *
 * One row per person, from MONZA AI's own records: their name and number, the
 * channels they wrote on, the ad or post that brought them, the cars they
 * asked about, and whether the sales bot marked them as waiting for a person.
 * Read-only: nothing here edits a person, and no message text is shown — the
 * chat itself is one click away in the inbox.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { CHANNEL_LABEL } from "@/lib/domain/types";
import { longDate } from "@/lib/format";
import { peopleCsv, personMatches, summarisePeople, type Person } from "@/lib/leads/people";
import "../board.css";

type Filter = "all" | "waiting" | "ads" | "untracked";

const FILTERS: readonly { key: Filter; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "waiting", label: "Waiting for a person" },
  { key: "ads", label: "Came from an ad" },
  { key: "untracked", label: "Not tracked" },
];

const ALERT_LABEL: Readonly<Record<string, string>> = {
  PRICE: "Asked for the price",
  FINANCING: "Asked about installments",
  TEST_DRIVE: "Test drive",
  STOCK: "Asked about availability",
  DISCOUNT: "Asked about offers",
  TRADE_IN: "Trade-in",
  NEEDS_PERSON: "Needs a person",
  CALLBACK: "Asked to be called",
  HUMAN: "Asked for a person",
  QUESTION: "Question for the team",
  LEAD: "Follow up the lead",
};

const day = (iso: string | null) => (iso ? longDate(iso.slice(0, 10)) : "—");
const PAGE = 100;

export default function PeopleClient({ people }: { people: Person[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [source, setSource] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);

  const summary = useMemo(() => summarisePeople(people), [people]);

  const visible = useMemo(
    () =>
      people.filter((p) => {
        if (filter === "waiting" && p.alerts.length === 0) return false;
        if (filter === "ads" && p.source !== "Ad click") return false;
        if (filter === "untracked" && p.source !== "Not tracked") return false;
        if (source && (p.sourceDetail ? `${p.source}: ${p.sourceDetail}` : p.source) !== source) return false;
        return personMatches(p, search);
      }),
    [people, filter, source, search]
  );

  const download = () => {
    // The list as filtered, so "everyone from the Courage ad" is one click.
    const blob = new Blob(["﻿" + peopleCsv(visible)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `monza-customers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="board">
      <header className="board-head">
        <div className="eyebrow">Communication</div>
        <h1 className="h1">Customers</h1>
        <p className="lede">Everyone Monza is talking to, where they came from, and what they asked about.</p>
      </header>

      <p className="board-note">
        These are real people, from Monza AI&apos;s own records: everyone with a WhatsApp, Instagram or Facebook chat
        since the channel was connected. Nothing here can be edited, and no message text is shown. Their cars and
        payment plans will appear once the CRM is connected — they are never invented.
      </p>

      <div className="rowcard-tags" role="group" aria-label="Totals">
        <span className="tag">{summary.people} people</span>
        <span className={summary.waiting > 0 ? "tag urgent" : "tag"}>{summary.waiting} waiting for a person</span>
        <span className="tag">{summary.fromAds} came from an ad</span>
        <span className="tag">{summary.notTracked} not tracked</span>
      </div>

      {(summary.sources.length > 0 || summary.cars.length > 0) && (
        <div className="ctx-card">
          {summary.sources.length > 0 && (
            <>
              <p className="ctx-title">Where they came from</p>
              <div className="rowcard-tags">
                {summary.sources.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    className="chip"
                    aria-pressed={source === s.label}
                    onClick={() => {
                      setSource(source === s.label ? null : s.label);
                      setShown(PAGE);
                    }}
                  >
                    {s.label} · {s.people}
                  </button>
                ))}
              </div>
              <p className="cap">
                &ldquo;Not tracked&rdquo; means Meta sent no ad or post with the first message — we do not know, so it
                is never counted as organic.
              </p>
            </>
          )}
          {summary.cars.length > 0 && (
            <>
              <p className="ctx-title">Cars they asked about</p>
              <div className="rowcard-tags">
                {summary.cars.map((c) => (
                  <button key={c.car} type="button" className="chip" onClick={() => setSearch(c.car)}>
                    {c.car} · {c.people}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="board-tools">
        <input
          className="board-search"
          type="search"
          placeholder="Search by name, phone number, ad or car"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setShown(PAGE);
          }}
          aria-label="Search customers"
        />
      </div>
      <div className="rowcard-tags" role="group" aria-label="Filter">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className="chip"
            aria-pressed={filter === f.key}
            onClick={() => {
              setFilter(f.key);
              setShown(PAGE);
            }}
          >
            {f.label}
          </button>
        ))}
        <button type="button" className="chip" onClick={download} disabled={visible.length === 0}>
          Download this list (CSV)
        </button>
      </div>

      <p className="cap">
        Showing {Math.min(shown, visible.length)} of {visible.length}
        {visible.length !== people.length ? ` (of ${people.length} people)` : ""}
      </p>

      <ul className="rows">
        {visible.slice(0, shown).map((p) => {
          const isOpen = openId === p.id;
          const channels = [...new Set(p.threads.map((t) => t.channel))];
          const unread = p.threads.reduce((n, t) => n + t.unread, 0);
          const newest = p.threads[0];
          return (
            <li className={p.alerts.length > 0 ? "rowcard urgent" : "rowcard"} key={p.id}>
              <div className="rowcard-top">
                <div className="grow">
                  <p className="rowcard-name">{p.name}</p>
                  <p className="rowcard-sub">
                    {[p.phone ? `+${p.phone}` : null, channels.map((c) => CHANNEL_LABEL[c]).join(" · "), `last active ${day(p.lastSeenAt)}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="rowcard-tags">
                  {p.alerts.length > 0 && <span className="tag urgent">{ALERT_LABEL[p.alerts[0].kind] ?? "Needs a person"}</span>}
                  {unread > 0 && <span className="tag">{unread} unread</span>}
                  {p.interests.map((car) => (
                    <span className="tag" key={car}>
                      {car}
                    </span>
                  ))}
                  <span className="tag">{p.sourceDetail ? `${p.source}: ${p.sourceDetail}` : p.source}</span>
                </div>
              </div>

              {isOpen && (
                <div className="stack">
                  <p className="cap">
                    First contact {day(p.firstSeenAt)} · last active {day(p.lastSeenAt)}
                  </p>
                  <div className="ctx-card">
                    <p className="ctx-title">Where they came from</p>
                    <p className="cap">
                      {p.source}
                      {p.sourceDetail ? ` — ${p.sourceDetail}` : ""}
                      {p.sourceRef ? ` (Meta id ${p.sourceRef})` : ""}
                    </p>
                  </div>
                  <div className="ctx-card">
                    <p className="ctx-title">Waiting for a person</p>
                    {p.alerts.length === 0 ? (
                      <p className="cap">Nothing open.</p>
                    ) : (
                      <ul className="ctx-list">
                        {p.alerts.map((a, i) => (
                          <li key={`${a.threadId}-${i}`}>
                            <span className="is-urgent">{ALERT_LABEL[a.kind] ?? a.kind}</span>
                            {a.reason ? ` — ${a.reason}` : ""} · {day(a.createdAt)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="ctx-card">
                    <p className="ctx-title">Chats</p>
                    <ul className="ctx-list">
                      {p.threads.map((t) => (
                        <li key={t.threadId}>
                          <Link href={`/inbox?open=${encodeURIComponent(t.threadId)}`}>
                            {CHANNEL_LABEL[t.channel]} · {t.brand.toUpperCase()}
                          </Link>{" "}
                          · last message {day(t.lastMessageAt)}
                          {t.unread > 0 ? ` · ${t.unread} unread` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <p className="cap">Cars owned and payment plans: not connected yet (they live in the CRM).</p>
                </div>
              )}

              <div className="rowcard-actions">
                <button type="button" className="btn" onClick={() => setOpenId(isOpen ? null : p.id)}>
                  {isOpen ? "Hide details" : "Full details"}
                </button>
                {newest && (
                  <Link className="btn quiet" href={`/inbox?open=${encodeURIComponent(newest.threadId)}`}>
                    Open the chat
                  </Link>
                )}
              </div>
            </li>
          );
        })}

        {visible.length === 0 && <li className="board-empty">Nobody matches that.</li>}
      </ul>

      {visible.length > shown && (
        <button type="button" className="btn" onClick={() => setShown(shown + PAGE)}>
          Show {Math.min(PAGE, visible.length - shown)} more
        </button>
      )}
    </main>
  );
}
