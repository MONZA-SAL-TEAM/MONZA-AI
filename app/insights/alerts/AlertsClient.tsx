"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Verdict = "waiting" | "follow_up" | "answered" | "duplicate" | "unverified" | "historical";

interface Row {
  alertId: string;
  conversationId: string;
  threadId: string | null;
  name: string | null;
  channel: string;
  brand: string;
  verdict: Verdict;
  evidence: string;
  reasons: string[];
  class: string;
  classSource: "person" | "labels";
  owner: string | null;
  raisedAt: string;
  lastCustomerAt: string | null;
  lastPersonAt: string | null;
  waitingHours: number | null;
  inWindow: boolean | null;
  windowHoursLeft: number | null;
}

interface TestDrive {
  id: string;
  conversationId: string;
  status: string;
  statusLabel: string;
  slotAt: string | null;
  models: string[];
  vehicle: string | null;
  salespersonName: string | null;
  requestedAt: string;
  needs: "not_contacted" | "outcome_missing" | null;
  name: string | null;
  threadId: string | null;
}

interface Data {
  at: string;
  counts: Record<Verdict, number> & { total: number; chats: number };
  wouldClose: { answered: number; duplicate: number; intoTestDrive: number };
  autoApplies: boolean;
  waiting: { total: number; inWindow: number; outsideWindow: number; highIntent: number; highIntentInWindow: number; newCustomers: number; existingConversations: number; unowned: number; oldestHours: number };
  ownerLoad: { ownerId: string | null; ownerName: string; waiting: number; highIntentWaiting: number; overdue: number; oldestHours: number }[];
  rows: Row[];
  testDrives: TestDrive[];
  testDriveSummary: { open: number; notContacted: number; outcomeMissing: number; booked: number };
  vocab: {
    classes: { key: string; label: string }[];
    closeReasons: { key: string; label: string }[];
    nextActions: Record<string, string>;
    statuses: Record<string, string>;
    cars: { code: string; name: string }[];
    staff: { id: string; name: string | null }[];
  };
  rules: { id: string; staff_id: string; staff_name: string; brand: string | null; channel: string | null; weight: number; active: boolean }[];
}

const TABS: { key: Verdict; label: string; what: string }[] = [
  { key: "waiting", label: "Waiting for a reply", what: "The customer wrote last, in a chat whose both sides we can see. Answer these." },
  { key: "follow_up", label: "Answered, outcome open", what: "A person replied, but the call, the valuation or the sale still needs its outcome. A person closes these." },
  { key: "unverified", label: "Unverified", what: "Instagram and Facebook: a reply typed in their app is invisible here, so nobody can say. Not counted as waiting, not counted as answered." },
  { key: "historical", label: "Historical", what: "Silent for over 30 days and never answered. Review and close with a reason; nothing closes these automatically." },
  { key: "answered", label: "Answered", what: "A person's message is later than the alert. \"Apply\" closes these." },
  { key: "duplicate", label: "Duplicates", what: "A newer alert is open in the same chat; its reasons are kept on that one. \"Apply\" closes these." },
];

const EVIDENCE: Record<string, string> = {
  newer_alert_open: "A newer alert is open in this chat",
  person_replied_after: "A person replied after the alert",
  person_replied_outcome_open: "A person replied; the outcome is not recorded",
  customer_wrote_last: "The customer wrote last",
  our_side_not_visible: "Our side of this chat cannot be seen",
  silent_over_limit: "No message for over 30 days",
};

const day = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}` : "—");
const wait = (h: number | null) => (h === null ? "—" : h < 48 ? `${h} h` : `${Math.floor(h / 24)} days`);

export default function AlertsClient() {
  const [data, setData] = useState<Data | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [tab, setTab] = useState<Verdict>("waiting");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/insights/alerts", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setProblem(body.message ?? "The alerts could not be read just now.");
        return;
      }
      setProblem(null);
      setData(body as Data);
      setPicked(new Set());
    } catch {
      setProblem("The alerts could not be read just now.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const post = useCallback(
    async (payload: Record<string, unknown>, url = "/api/insights/alerts") => {
      setBusy(true);
      setNote(null);
      try {
        const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.ok) setNote(body.message ?? "It could not be saved.");
        else {
          if (body.result) {
            const r = body.result;
            setNote(`Done: ${r.closedAnswered} answered and ${r.closedDuplicates} duplicates closed, ${r.testDriveRequests} test-drive requests created (${r.closedIntoTestDrive} alerts moved to them), ${r.assigned} leads assigned${r.failed ? `, ${r.failed} could not be changed` : ""}.`);
          } else if (typeof body.closed === "number") setNote(`${body.closed} closed.`);
          await load();
        }
      } catch {
        setNote("It could not be saved.");
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  const rows = useMemo(() => (data ? data.rows.filter((r) => r.verdict === tab).sort((a, b) => (b.waitingHours ?? 0) - (a.waitingHours ?? 0) || a.raisedAt.localeCompare(b.raisedAt)) : []), [data, tab]);

  if (problem) return <p className="board-note board-warn">{problem} This is not an empty list.</p>;
  if (!data) return <p className="board-note">Reading the alerts…</p>;

  const c = data.counts;
  const closes = data.wouldClose.answered + data.wouldClose.duplicate + data.wouldClose.intoTestDrive;
  const current = TABS.find((t) => t.key === tab)!;
  const allPicked = rows.length > 0 && rows.every((r) => picked.has(r.alertId));

  return (
    <>
      <section className="ins-kpis" aria-label="The alerts now">
        <div className="ins-kpi">
          <p className="tile-label">Open alerts now</p>
          <p className="ins-kpi-value">{c.total}</p>
          <p className="ins-kpi-foot ins-known">in {c.chats} chats</p>
        </div>
        <div className="ins-kpi" title="The customer wrote last, in a chat whose both sides we can see, and the conversation is not spam or a supplier's pitch.">
          <p className="tile-label">Genuinely waiting</p>
          <p className="ins-kpi-value">{data.waiting.total}</p>
          <p className="ins-kpi-foot ins-known">
            {data.waiting.inWindow} can still be answered free · {data.waiting.highIntent} high intent
          </p>
        </div>
        <div className="ins-kpi">
          <p className="tile-label">Nobody responsible</p>
          <p className="ins-kpi-value">{data.waiting.unowned}</p>
          <p className="ins-kpi-foot ins-known">of the {data.waiting.total} waiting</p>
        </div>
        <div className="ins-kpi" title="Instagram and Facebook chats where our own replies cannot be seen.">
          <p className="tile-label">Unverified</p>
          <p className="ins-kpi-value">{c.unverified}</p>
          <p className="ins-kpi-foot ins-known">not counted as waiting or answered</p>
        </div>
        <div className="ins-kpi">
          <p className="tile-label">Test drives needing action</p>
          <p className="ins-kpi-value">{data.testDriveSummary.notContacted + data.testDriveSummary.outcomeMissing}</p>
          <p className="ins-kpi-foot ins-known">
            {data.testDriveSummary.open} in progress · {data.testDriveSummary.booked} booked
          </p>
        </div>
      </section>

      <section className="ins-panel" aria-label="Apply the evidence">
        <h2 className="ins-h2">Set the alerts right</h2>
        <p className="ins-known">
          From the evidence read at {day(data.at)}: <strong>{data.wouldClose.answered}</strong> alerts a person already answered and{" "}
          <strong>{data.wouldClose.duplicate}</strong> second alerts in the same chat would close, and <strong>{data.wouldClose.intoTestDrive}</strong> answered
          test-drive alerts would become test-drive requests marked &ldquo;customer contacted&rdquo;. {c.total} open → {c.total - closes} open. Nothing waiting,
          unverified or historical is closed. Every change is recorded with your name and can be seen on the alert.
        </p>
        <p className="ins-known">
          Each night the same check runs by itself: {data.autoApplies ? "it is switched ON and closes these two kinds only." : "it is switched OFF and only reports (ALERT_RECONCILE_MODE is not \"apply\")."}
        </p>
        <div className="ins-dec-tools">
          <button type="button" className="btn" disabled={busy || closes === 0} onClick={() => void post({ action: "apply" })}>
            Apply to {closes} alerts
          </button>
          <button type="button" className="btn quiet" disabled={busy} onClick={() => void load()}>
            Read again
          </button>
          {note && <span className="ins-note" role="status">{note}</span>}
        </div>
      </section>

      <section className="ins-panel" aria-label="By salesperson">
        <h2 className="ins-h2">Waiting customers, by who is responsible</h2>
        {data.ownerLoad.length === 0 ? (
          <p className="ins-empty">Nobody is waiting.</p>
        ) : (
          <div className="ins-table-wrap">
            <table className="ins-table">
              <thead>
                <tr>
                  <th scope="col">Responsible</th>
                  <th scope="col">Waiting</th>
                  <th scope="col">High intent</th>
                  <th scope="col">Over 24 h</th>
                  <th scope="col">Longest wait</th>
                </tr>
              </thead>
              <tbody>
                {data.ownerLoad.map((o) => (
                  <tr key={o.ownerId ?? "nobody"}>
                    <th scope="row">{o.ownerName}</th>
                    <td>{o.waiting}</td>
                    <td>{o.highIntentWaiting}</td>
                    <td>{o.overdue}</td>
                    <td>{wait(o.oldestHours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="ins-panel" aria-label="The alerts">
        <div className="ins-nav" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? "btn" : "btn quiet"} onClick={() => { setTab(t.key); setPicked(new Set()); }}>
              {t.label} · {c[t.key]}
            </button>
          ))}
        </div>
        <p className="ins-known">{current.what}</p>
        {(tab === "historical" || tab === "unverified" || tab === "follow_up" || tab === "waiting") && rows.length > 0 ? (
          <div className="ins-dec-tools">
            <label>
              <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.alertId)))} /> All {rows.length}
            </label>
            <select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason for closing">
              <option value="">Reason for closing…</option>
              {data.vocab.closeReasons.map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </select>
            <button type="button" className="btn" disabled={busy || picked.size === 0 || !reason} onClick={() => void post({ action: "close", ids: [...picked], reason })}>
              Close {picked.size} with this reason
            </button>
          </div>
        ) : null}
        {rows.length === 0 ? (
          <p className="ins-empty">None.</p>
        ) : (
          <div className="ins-table-wrap">
            <table className="ins-table">
              <thead>
                <tr>
                  <th scope="col" aria-label="Pick" />
                  <th scope="col">Customer</th>
                  <th scope="col">Channel</th>
                  <th scope="col">About</th>
                  <th scope="col">Conversation is</th>
                  <th scope="col">Responsible</th>
                  <th scope="col">Customer last wrote</th>
                  <th scope="col">We last wrote</th>
                  <th scope="col">Waiting</th>
                  <th scope="col">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 300).map((r) => (
                  <tr key={r.alertId}>
                    <td>
                      <input type="checkbox" aria-label="Pick this alert" checked={picked.has(r.alertId)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(r.alertId)) n.delete(r.alertId); else n.add(r.alertId); return n; })} />
                    </td>
                    <th scope="row">{r.threadId ? <Link href={`/inbox?open=${encodeURIComponent(r.threadId)}`}>{r.name ?? "Open the chat"}</Link> : (r.name ?? "—")}</th>
                    <td>{r.channel} · {r.brand}</td>
                    <td>{r.reasons.join(", ")}</td>
                    <td>
                      <select value={r.class} disabled={busy} aria-label="Conversation class" onChange={(e) => void post({ action: "class", conversationId: r.conversationId, class: e.target.value })}>
                        {data.vocab.classes.map((k) => (
                          <option key={k.key} value={k.key}>{k.label}</option>
                        ))}
                      </select>
                      {r.classSource === "person" ? <span className="ins-known"> set by a person</span> : null}
                    </td>
                    <td>{r.owner ?? <span className="ins-known">Nobody</span>}</td>
                    <td>{day(r.lastCustomerAt)}</td>
                    <td>{day(r.lastPersonAt)}</td>
                    <td>
                      {wait(r.waitingHours)}
                      {r.inWindow === true ? <span className="ins-known"> · free reply, {r.windowHoursLeft} h left</span> : r.inWindow === false ? <span className="ins-known"> · template only</span> : null}
                    </td>
                    <td className="ins-known">{EVIDENCE[r.evidence] ?? r.evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 300 ? <p className="ins-known">Showing the first 300 of {rows.length}.</p> : null}
          </div>
        )}
      </section>

      <TestDrives data={data} busy={busy} post={post} />
      <Rules data={data} busy={busy} post={post} />
    </>
  );
}

type Post = (payload: Record<string, unknown>, url?: string) => Promise<void>;

function TestDrives({ data, busy, post }: { data: Data; busy: boolean; post: Post }) {
  const [booking, setBooking] = useState<string | null>(null);
  const [slot, setSlot] = useState("");
  const [car, setCar] = useState("");
  const [who, setWho] = useState("");
  const [next, setNext] = useState("");
  const send = (id: string, to: string, extra: Record<string, unknown> = {}) => post({ id, to, ...extra }, "/api/sales/test-drives/requests");
  return (
    <section className="ins-panel" aria-label="Test-drive requests">
      <h2 className="ins-h2">Test-drive requests</h2>
      <p className="ins-known">
        A request is created when a customer asks for a drive. {data.testDriveSummary.notContacted} not contacted yet · {data.testDriveSummary.outcomeMissing}{" "}
        booked drives past their time with no outcome · {data.testDriveSummary.booked} booked.
      </p>
      {data.testDrives.length === 0 ? (
        <p className="ins-empty">No request in progress. They appear here after &ldquo;Apply&rdquo;, and for every new request from then on.</p>
      ) : (
        <div className="ins-table-wrap">
          <table className="ins-table">
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col">Asked</th>
                <th scope="col">Status</th>
                <th scope="col">Booked for</th>
                <th scope="col">Move to</th>
              </tr>
            </thead>
            <tbody>
              {data.testDrives.slice(0, 200).map((d) => (
                <tr key={d.id}>
                  <th scope="row">{d.threadId ? <Link href={`/inbox?open=${encodeURIComponent(d.threadId)}`}>{d.name ?? "Open the chat"}</Link> : (d.name ?? "—")}</th>
                  <td>{day(d.requestedAt)}</td>
                  <td>
                    {d.statusLabel}
                    {d.needs === "not_contacted" ? <span className="ins-known"> · nobody has contacted them</span> : d.needs === "outcome_missing" ? <span className="ins-known"> · outcome not recorded</span> : null}
                  </td>
                  <td>{d.slotAt ? `${day(d.slotAt)} · ${d.vehicle ?? ""} · ${d.salespersonName ?? ""}` : "—"}</td>
                  <td>
                    {booking === d.id ? (
                      <span className="ins-dec-tools">
                        <input type="datetime-local" value={slot} onChange={(e) => setSlot(e.target.value)} aria-label="Date and time" />
                        <select value={car} onChange={(e) => setCar(e.target.value)} aria-label="Car">
                          <option value="">Car…</option>
                          {data.vocab.cars.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
                        </select>
                        <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Salesperson">
                          <option value="">Salesperson…</option>
                          {data.vocab.staff.map((s) => <option key={s.id} value={s.id}>{s.name ?? "Unnamed"}</option>)}
                        </select>
                        <button type="button" className="btn" disabled={busy || !slot || !car || !who} onClick={() => { void send(d.id, "booked", { slotAt: new Date(slot).toISOString(), vehicle: car, salespersonId: who }); setBooking(null); }}>Save booking</button>
                        <button type="button" className="btn quiet" onClick={() => setBooking(null)}>Cancel</button>
                      </span>
                    ) : d.status === "booked" ? (
                      <span className="ins-dec-tools">
                        <select value={next} onChange={(e) => setNext(e.target.value)} aria-label="What happens next">
                          <option value="">After the drive…</option>
                          {Object.entries(data.vocab.nextActions).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                        </select>
                        <button type="button" className="btn" disabled={busy || !next} onClick={() => void send(d.id, "completed", { nextAction: next })}>Completed</button>
                        <button type="button" className="btn quiet" disabled={busy} onClick={() => void send(d.id, "no_show")}>No-show</button>
                        <button type="button" className="btn quiet" disabled={busy} onClick={() => void send(d.id, "cancelled")}>Cancelled</button>
                      </span>
                    ) : (
                      <span className="ins-dec-tools">
                        {d.status === "requested" ? <button type="button" className="btn quiet" disabled={busy} onClick={() => void send(d.id, "contacted")}>Contacted</button> : null}
                        {d.status !== "awaiting_confirmation" ? <button type="button" className="btn quiet" disabled={busy} onClick={() => void send(d.id, "awaiting_confirmation")}>Awaiting confirmation</button> : null}
                        <button type="button" className="btn" disabled={busy} onClick={() => { setBooking(d.id); setSlot(""); setCar(d.models[0] ?? ""); setWho(""); }}>Book…</button>
                        <button type="button" className="btn quiet" disabled={busy} onClick={() => void send(d.id, "declined")}>Declined</button>
                        <button type="button" className="btn quiet" disabled={busy} onClick={() => void send(d.id, "not_interested")}>No longer interested</button>
                        <button type="button" className="btn quiet" disabled={busy} onClick={() => void send(d.id, "duplicate")}>Duplicate</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Rules({ data, busy, post }: { data: Data; busy: boolean; post: Post }) {
  const [who, setWho] = useState("");
  const [brand, setBrand] = useState("");
  const [channel, setChannel] = useState("");
  const [weight, setWeight] = useState("1");
  return (
    <section className="ins-panel" aria-label="Automatic assignment">
      <h2 className="ins-h2">Who gets new leads</h2>
      <p className="ins-known">
        A waiting sales conversation with nobody responsible goes to the person in this list carrying the least open work for their share. A rule for a
        brand or a channel wins over a general one. With no rule, nobody is assigned automatically. An existing customer&apos;s own salesperson cannot be
        looked up automatically yet — a manager assigns those in the chat.
      </p>
      {data.rules.length > 0 ? (
        <div className="ins-table-wrap">
          <table className="ins-table">
            <thead>
              <tr>
                <th scope="col">Salesperson</th>
                <th scope="col">Brand</th>
                <th scope="col">Channel</th>
                <th scope="col">Share</th>
                <th scope="col" aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {data.rules.map((r) => (
                <tr key={r.id}>
                  <th scope="row">{r.staff_name}</th>
                  <td>{r.brand ?? "Any"}</td>
                  <td>{r.channel ?? "Any"}</td>
                  <td>{r.weight}</td>
                  <td><button type="button" className="btn quiet" disabled={busy} onClick={() => void post({ action: "rule_remove", id: r.id })}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="ins-empty">No rule: nobody is assigned automatically.</p>
      )}
      <div className="ins-dec-tools">
        <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Salesperson">
          <option value="">Salesperson…</option>
          {data.vocab.staff.map((s) => <option key={s.id} value={s.id}>{s.name ?? "Unnamed"}</option>)}
        </select>
        <select value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Brand">
          <option value="">Any brand</option>
          <option value="voyah">VOYAH</option>
          <option value="mhero">MHERO</option>
          <option value="monza">MONZA</option>
        </select>
        <select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel">
          <option value="">Any channel</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="instagram">Instagram</option>
          <option value="facebook">Facebook</option>
        </select>
        <select value={weight} onChange={(e) => setWeight(e.target.value)} aria-label="Share">
          {[1, 2, 3].map((n) => <option key={n} value={n}>Share {n}</option>)}
        </select>
        <button type="button" className="btn" disabled={busy || !who} onClick={() => void post({ action: "rule", staffId: who, brand: brand || null, channel: channel || null, weight: Number(weight) })}>Add to the rotation</button>
      </div>
    </section>
  );
}
