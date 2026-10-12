"use client";

/**
 * Insights — the cars and the clients, from what the sales bot understood (Samer, 2026-10-12: "the
 * full insight of all clients and cars").
 *
 * Read-only. Every figure is a count of labels the bot recorded per message (car, question, colour,
 * stage); no message text is read or shown — the chat itself is one click away in the inbox.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { longDate } from "@/lib/format";
import { clientsCsv, WEEKS, type CarInsight, type ClientInsight, type Count, type InsightFilter, type Insights } from "@/lib/insights/insights";
import type { InsightsRead } from "@/lib/insights/insights-server";
import type { CarStock } from "@/lib/insights/crm";
import type { MetaRunView } from "@/lib/insights/meta-backfill";
import "../board.css";
import "./insights.css";

const PERIODS: readonly { days: number; label: string }[] = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "12 months" },
  { days: 0, label: "All time" },
];
const BRANDS: readonly { key: string | null; label: string }[] = [
  { key: null, label: "All brands" },
  { key: "voyah", label: "VOYAH" },
  { key: "mhero", label: "MHERO" },
  { key: "monza", label: "Monza S.A.L." },
];
const CHANNELS: readonly { key: string | null; label: string }[] = [
  { key: null, label: "All channels" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "instagram", label: "Instagram" },
  { key: "facebook", label: "Messenger" },
];
const CHANNEL_LABEL: Readonly<Record<string, string>> = { whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Messenger" };
const BRAND_LABEL: Readonly<Record<string, string>> = { voyah: "VOYAH", mhero: "MHERO", monza: "Monza S.A.L." };
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
  BUYING: "Wants to buy",
  OVERDUE: "Kept waiting",
  VISIT: "Wants to visit",
};

const day = (iso: string) => longDate(iso.slice(0, 10));
/** "Pearl Black 43% (9)": a share only over people who named a colour — unknowns are never in the denominator. */
const share = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}% (${n})` : `(${n})`);

function href(f: InsightFilter, patch: Partial<Pick<InsightFilter, "days" | "brand" | "channel" | "model">>): string {
  const next = { ...f, ...patch };
  const q = new URLSearchParams();
  if (next.days !== 90) q.set("days", String(next.days));
  if (next.brand) q.set("brand", next.brand);
  if (next.channel) q.set("channel", next.channel);
  if (next.model) q.set("model", next.model);
  const s = q.toString();
  return s ? `/insights?${s}` : "/insights";
}

/* ── Charts: one hue, thin marks, labels in text ink, a tooltip on every mark ── */

function Bars({ items, title }: { items: readonly Count[]; title: string }) {
  const max = Math.max(1, ...items.map((i) => i.n));
  if (items.length === 0) return <p className="ins-empty">Nothing yet.</p>;
  return (
    <ul className="ins-bars" aria-label={title}>
      {items.map((i) => (
        <li key={i.key} title={`${i.label}: ${i.n}`}>
          <span className="ins-bar-label">{i.label}</span>
          <span className="ins-bar-track">
            <span className="ins-bar-fill" style={{ width: `${Math.max(2, (i.n / max) * 100)}%` }} />
          </span>
          <span className="ins-bar-value">{i.n}</span>
        </li>
      ))}
    </ul>
  );
}

function Columns({ labels, values, title, unit }: { labels: readonly string[]; values: readonly number[]; title: string; unit: string }) {
  const max = Math.max(1, ...values);
  const W = 360;
  const H = 96;
  const gap = 4;
  const bw = (W - gap * (values.length - 1)) / values.length;
  return (
    <figure className="ins-columns">
      <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={`${title}: ${values.join(", ")} ${unit} per week`}>
        <line x1="0" y1={H + 0.5} x2={W} y2={H + 0.5} className="ins-axis" />
        {values.map((v, i) => {
          const h = v === 0 ? 0 : Math.max(3, (v / max) * (H - 8));
          const x = i * (bw + gap);
          return (
            <g key={i}>
              <rect x={x} y={H - h} width={bw} height={h} rx="3" className="ins-col" />
              <title>{`Week of ${labels[i]}: ${v} ${unit}`}</title>
              {(i === 0 || i === values.length - 1 || i === Math.floor(values.length / 2)) && (
                <text x={x + bw / 2} y={H + 13} textAnchor="middle" className="ins-tick">
                  {labels[i]}
                </text>
              )}
              {v === max && v > 0 && (
                <text x={x + bw / 2} y={H - h - 3} textAnchor="middle" className="ins-tick ins-tick-strong">
                  {v}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption>{title}, per week, last {WEEKS} weeks</figcaption>
    </figure>
  );
}

function Spark({ values }: { values: readonly number[] }) {
  const max = Math.max(1, ...values);
  return (
    <span className="ins-spark" aria-hidden="true">
      {values.map((v, i) => (
        <span key={i} style={{ height: `${v === 0 ? 2 : Math.max(8, (v / max) * 100)}%` }} />
      ))}
    </span>
  );
}

/* ── Sections ──────────────────────────────────────────────────────────── */

/** The CRM's stock beside the demand: read as the viewer, never stored. */
export type StockView = { state: "ok"; byModel: Record<string, CarStock> } | { state: "not_connected" } | { state: "unavailable" };

function StockLine({ stock, code }: { stock: StockView; code: string }) {
  if (stock.state === "not_connected") return null;
  if (stock.state === "unavailable") return <p className="ins-car-line"><span className="cap">CRM stock</span> could not be read just now</p>;
  const s = stock.byModel[code];
  if (!s) return <p className="ins-car-line"><span className="cap">CRM stock</span> none now</p>;
  return (
    <p className="ins-car-line">
      <span className="cap">CRM stock</span> {s.now} now{s.colours.length > 0 ? ` (${s.colours.map((c) => `${c.key} ${c.n}`).join(", ")})` : ""}
      {s.inbound > 0 ? ` · ${s.inbound} on the way` : ""}
    </p>
  );
}

function CarCard({ car, f, stock }: { car: CarInsight; f: InsightFilter; stock: StockView }) {
  const selected = f.model === car.code;
  return (
    <li className={`ins-car${selected ? " is-selected" : ""}`}>
      <div className="ins-car-head">
        <div>
          <h3 className="ins-car-name">{car.name}</h3>
          <p className="ins-car-sub">
            {car.people} {car.people === 1 ? "person" : "people"} · {car.messages} {car.messages === 1 ? "message" : "messages"}
          </p>
        </div>
        <Spark values={car.weekly} />
      </div>
      <dl className="ins-car-stats">
        <div><dt>Price</dt><dd>{car.price}</dd></div>
        <div><dt>Test drive</dt><dd>{car.testDrive}</dd></div>
        <div><dt>Installments</dt><dd>{car.financing}</dd></div>
        <div><dt>Availability</dt><dd>{car.stock}</dd></div>
        <div><dt>Wants to buy</dt><dd className={car.buying > 0 ? "is-hot" : ""}>{car.buying}</dd></div>
      </dl>
      {car.colours.length > 0 && (
        <p className="ins-car-line">
          <span className="cap">Exterior</span> {car.colours.map((c) => `${c.label} ${share(c.n, car.colourKnown)}`).join(" · ")}
          <span className="ins-known"> of {car.colourKnown} who named a colour</span>
        </p>
      )}
      {car.interior.length > 0 && (
        <p className="ins-car-line">
          <span className="cap">Interior</span> {car.interior.map((c) => `${c.label} (${c.n})`).join(" · ")}
        </p>
      )}
      {car.rejected.length > 0 && (
        <p className="ins-car-line">
          <span className="cap">Not wanted</span> {car.rejected.map((c) => `${c.label} (${c.n})`).join(" · ")}
        </p>
      )}
      <StockLine stock={stock} code={car.code} />
      {car.questions.length > 0 && (
        <p className="ins-car-line">
          <span className="cap">Questions</span> {car.questions.map((q) => `${q.label} (${q.n})`).join(" · ")}
        </p>
      )}
      <div className="rowcard-actions">
        <Link className="btn quiet" href={href(f, { model: selected ? null : car.code })}>
          {selected ? "Show everyone" : "Only this car's clients"}
        </Link>
      </div>
    </li>
  );
}

function ClientRow({ c }: { c: ClientInsight }) {
  return (
    <li className={`rowcard${c.waiting ? " urgent" : c.stage === "buying" ? " ready" : ""}`}>
      <div className="rowcard-top">
        <div>
          <p className="rowcard-name">{c.name}</p>
          <p className="rowcard-sub">
            {CHANNEL_LABEL[c.channel] ?? c.channel} · {BRAND_LABEL[c.brand] ?? c.brand}
            {c.phone ? ` · +${c.phone}` : ""} · {c.messages} {c.messages === 1 ? "message" : "messages"} · {c.language}
          </p>
        </div>
        <div className="rowcard-tags">
          <span className={`tag${c.stage === "buying" ? " urgent" : ""}`}>{c.stageLabel}</span>
          {c.waiting && <span className="tag">{ALERT_LABEL[c.waiting] ?? c.waiting} — waiting</span>}
        </div>
      </div>
      <p className="ins-client-line">
        <span className="cap">Cars</span> {c.cars.length > 0 ? c.cars.join(", ") : "none named"}
        {c.colours.length > 0 && (
          <>
            {" "}
            <span className="cap">Colours</span> {c.colours.join(", ")}
          </>
        )}
        {(c.rejectedColours.length > 0 || c.rejectedCars.length > 0) && (
          <>
            {" "}
            <span className="cap">Doesn&apos;t want</span> {[...c.rejectedCars, ...c.rejectedColours].join(", ")}
          </>
        )}
      </p>
      <p className="ins-client-line">
        <span className="cap">Asked about</span> {c.topics.length > 0 ? c.topics.join(", ") : "—"}
      </p>
      {(c.budget || c.timeline || c.city || c.purpose.length > 0) && (
        <p className="ins-client-line">
          {c.budget && <><span className="cap">Budget</span> {c.budget} </>}
          {c.timeline && <><span className="cap">Buying</span> {c.timeline} </>}
          {c.city && <><span className="cap">Where</span> {c.city} </>}
          {c.purpose.length > 0 && <><span className="cap">For</span> {c.purpose.join(", ")}</>}
        </p>
      )}
      {(c.otherBrands.length > 0 || c.concerns.length > 0 || c.tradeIn.length > 0) && (
        <p className="ins-client-line">
          {c.otherBrands.length > 0 && <><span className="cap">Other brands</span> {c.otherBrands.join(", ")} </>}
          {c.tradeIn.length > 0 && <><span className="cap">Trade-in</span> {c.tradeIn.join(", ")} </>}
          {c.concerns.length > 0 && <><span className="cap">Concerns</span> {c.concerns.join(", ")}</>}
        </p>
      )}
      <p className="ins-client-line">
        <span className="cap">First</span> {day(c.firstAt)} <span className="cap">Last</span> {day(c.lastAt)}
      </p>
      <div className="rowcard-actions">
        <Link className="btn" href={`/insights/clients/${encodeURIComponent(c.id)}`}>
          Full profile
        </Link>
        {c.threadId ? (
          <Link className="btn quiet" href={`/inbox?open=${encodeURIComponent(c.threadId)}`}>
            Open the chat
          </Link>
        ) : (
          <Link className="btn quiet" href="/inbox">
            Open the inbox
          </Link>
        )}
      </div>
    </li>
  );
}

function Told({ title, items, known }: { title: string; items: readonly Count[]; known: number }) {
  return (
    <div className="ins-panel">
      <h2 className="ins-h2">{title}</h2>
      {items.length === 0 ? <p className="ins-empty">Nobody has said yet.</p> : <Bars items={items.slice(0, 10)} title={title} />}
      {known > 0 && <p className="ins-known">people, of {known} who said</p>}
    </div>
  );
}

const CODE_LABEL: Readonly<Record<string, string>> = {
  empty_first_page: "Meta answered with nothing — unknown, not empty (check the key and permissions)",
  usage_over_75: "Paused: Meta's rate limit is over 75% used — continues tonight",
  call_budget: "Paused after 60 calls — continues next run",
  "meta_4": "Meta's app rate limit — continues later",
  "meta_17": "Meta's account rate limit — continues later",
  "meta_32": "Meta's page rate limit — continues later",
  "meta_613": "Meta's call limit — continues later",
  "meta_-2_2534084": "Meta timed out listing this account (-2 / 2534084)",
  no_token: "No key for this account",
  no_page: "No Facebook Page registered for this brand",
  not_connected: "Not connected",
};

/** Instagram and Facebook: read the past once (labels only), then every night. */
function MetaHistory({ runs }: { runs: readonly MetaRunView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  async function go(accountId: string, dry: boolean) {
    setBusy(accountId);
    const say = (text: string) => setNotes((n) => ({ ...n, [accountId]: text }));
    let totals = { threads: 0, messages: 0, matched: 0, signals: 0 };
    try {
      for (let round = 0; round < (dry ? 1 : 25); round++) {
        const res = await fetch(`/api/insights/backfill?account=${encodeURIComponent(accountId)}${dry ? "&dry=1" : ""}`, { method: "POST" });
        const b = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; state?: string; code?: string | null; threads?: number; messages?: number; matchedExisting?: number; signals?: number } | null;
        if (!res.ok || !b?.ok) {
          say(b?.message ?? "Could not read just now.");
          break;
        }
        totals = { threads: totals.threads + (b.threads ?? 0), messages: totals.messages + (b.messages ?? 0), matched: totals.matched + (b.matchedExisting ?? 0), signals: totals.signals + (b.signals ?? 0) };
        const where = b.state === "done" ? "Finished." : b.code ? (CODE_LABEL[b.code] ?? `Stopped: ${b.code}`) : "Still reading…";
        say(
          dry
            ? `Count only (nothing written): ${totals.threads} conversations, ${totals.messages} messages, ${totals.matched} already recorded. ${b.state === "done" ? "" : "More pages exist."}`
            : `${totals.threads} conversations, ${totals.signals} customer messages recorded. ${where}`
        );
        if (dry || b.state !== "running") break;
      }
      if (!dry) router.refresh();
    } catch {
      say("The read could not run — check the connection.");
    } finally {
      setBusy(null);
    }
  }
  if (runs.length === 0) return null;
  return (
    <section className="ins-panel ins-rebuild">
      <h2 className="ins-h2">Instagram and Facebook history</h2>
      <p className="lede">
        Past chats are read once from Meta and then every night. Only the labels are kept — car, colour, budget, city — never the words. Try
        &quot;Count first&quot; on one account before reading.
      </p>
      <ul className="rows">
        {runs.map((r) => (
          <li key={r.accountId} className="rowcard">
            <div className="rowcard-top">
              <div>
                <p className="rowcard-name">{r.label}</p>
                <p className="rowcard-sub">
                  {CHANNEL_LABEL[r.channel] ?? r.channel} · {BRAND_LABEL[r.brand] ?? r.brand} ·{" "}
                  {r.state === "not_started" ? "not read yet" : r.state === "done" ? "history read; refreshed nightly" : r.state === "blocked" ? (CODE_LABEL[r.code ?? ""] ?? `stopped: ${r.code ?? "unknown"}`) : "reading"}
                  {r.threads > 0 ? ` · ${r.threads} conversations, ${r.signals} customer messages` : ""}
                </p>
              </div>
            </div>
            <div className="rowcard-actions">
              <button type="button" className="btn" disabled={busy !== null} onClick={() => void go(r.accountId, true)}>
                Count first
              </button>
              <button type="button" className="btn primary" disabled={busy !== null || r.state === "done"} onClick={() => void go(r.accountId, false)}>
                {busy === r.accountId ? "Reading…" : r.state === "blocked" || r.state === "running" ? "Continue" : "Read history"}
              </button>
              {notes[r.accountId] && <span className="ins-note">{notes[r.accountId]}</span>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function InsightsClient({ read, filter, stock, metaRuns }: { read: InsightsRead; filter: InsightFilter; stock: StockView; metaRuns: readonly MetaRunView[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [shown, setShown] = useState(100);

  const ins: Insights | null = read.state === "ok" ? read.insights : null;
  const clients = useMemo(() => {
    if (!ins) return [];
    const q = search.trim().toLowerCase();
    return ins.clients.filter((c) => (!stage || c.stage === stage) && (!q || `${c.name} ${c.phone ?? ""} ${c.cars.join(" ")} ${c.topics.join(" ")} ${c.city ?? ""} ${c.budget ?? ""} ${c.otherBrands.join(" ")}`.toLowerCase().includes(q)));
  }, [ins, search, stage]);

  async function rebuild() {
    setRebuilding(true);
    setNote(null);
    try {
      // Each call reads for ~45 s; keep calling until the history is read.
      let total = { conversations: 0, signals: 0, observations: 0 };
      for (let round = 0; round < 40; round++) {
        const res = await fetch(`/api/insights/rebuild${round === 0 ? "?restart=1" : ""}`, { method: "POST" });
        const body = (await res.json().catch(() => null)) as { ok?: boolean; done?: boolean; message?: string; conversations?: number; signals?: number; observations?: number } | null;
        if (!res.ok || !body?.ok) {
          setNote(body?.message ?? "The history could not be read.");
          break;
        }
        total = { conversations: total.conversations + (body.conversations ?? 0), signals: total.signals + (body.signals ?? 0), observations: total.observations + (body.observations ?? 0) };
        setNote(`Read ${total.conversations} conversations: ${total.signals} customer messages, ${total.observations} facts${body.done ? "." : " — still reading…"}`);
        if (body.done) break;
      }
      router.refresh();
    } catch {
      setNote("The rebuild could not run — check the connection.");
    } finally {
      setRebuilding(false);
    }
  }

  function downloadCsv() {
    const blob = new Blob([clientsCsv(clients)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `monza-ai-clients-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="board">
      <header className="board-head">
        <p className="eyebrow">Insights</p>
        <h1 className="h1">Clients and cars</h1>
        <p className="lede">
          What people ask about, which cars, which colours, and how far each client has come — counted from what the sales bot understood in every
          message. Never the words themselves: the chat is one click away.
        </p>
      </header>

      {read.state === "no_table" && (
        <p className="board-note board-warn">The signals table is not set up yet (migration 020). Nothing is recorded until it is applied.</p>
      )}
      {read.state === "unavailable" && <p className="board-note board-warn">Monza AI&apos;s database could not be read here, so nothing is shown.</p>}

      <div className="board-tools">
        <div className="chips" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <Link key={p.days} className="chip" aria-pressed={filter.days === p.days} href={href(filter, { days: p.days })}>
              {p.label}
            </Link>
          ))}
        </div>
        <div className="chips" role="group" aria-label="Brand">
          {BRANDS.map((b) => (
            <Link key={b.label} className="chip" aria-pressed={(filter.brand ?? null) === b.key} href={href(filter, { brand: b.key })}>
              {b.label}
            </Link>
          ))}
        </div>
        <div className="chips" role="group" aria-label="Channel">
          {CHANNELS.map((c) => (
            <Link key={c.label} className="chip" aria-pressed={(filter.channel ?? null) === c.key} href={href(filter, { channel: c.key })}>
              {c.label}
            </Link>
          ))}
        </div>
      </div>

      {ins && (
        <>
          <section className="tiles" aria-label="Totals">
            <div className="tile"><p className="tile-label">Clients who wrote</p><p className="tile-value">{ins.totals.people}</p><p className="tile-foot">{ins.totals.messages} messages read</p></div>
            <div className="tile"><p className="tile-label">Named a car</p><p className="tile-value">{ins.totals.interested}</p><p className="tile-foot">of {ins.totals.people}</p></div>
            <div className="tile"><p className="tile-label">Want to buy</p><p className={`tile-value${ins.totals.hot > 0 ? " urgent" : ""}`}>{ins.totals.hot}</p><p className="tile-foot">said so in their own words</p></div>
            <div className="tile"><p className="tile-label">Waiting for a person</p><p className={`tile-value${ins.totals.waiting > 0 ? " urgent" : ""}`}>{ins.totals.waiting}</p><p className="tile-foot">open in the inbox now</p></div>
          </section>

          <section className="ins-grid" aria-label="Over time and by topic">
            <div className="ins-panel">
              <Columns labels={ins.weekly.labels} values={ins.weekly.messages} title="Messages" unit="messages" />
            </div>
            <div className="ins-panel">
              <Columns labels={ins.weekly.labels} values={ins.weekly.people} title="Clients who wrote" unit="clients" />
            </div>
            <div className="ins-panel">
              <h2 className="ins-h2">What they ask about</h2>
              <Bars items={ins.topics.slice(0, 12)} title="Questions" />
            </div>
            <div className="ins-panel">
              <h2 className="ins-h2">How far they got</h2>
              <Bars items={ins.stages} title="Stages" />
              <h2 className="ins-h2">Where they write from</h2>
              <Bars items={ins.channels} title="Channels" />
              <h2 className="ins-h2">In which language</h2>
              <Bars items={ins.languages} title="Languages" />
            </div>
          </section>

          <section className="section-head">
            <h2 className="ins-h2">The cars</h2>
            <p className="lede">Who asked about each car, what they asked, and which colours. The small bars are people per week.</p>
          </section>
          <ul className="ins-cars">
            {ins.cars.map((car) => (
              <CarCard key={car.code} car={car} f={filter} stock={stock} />
            ))}
          </ul>

          <section className="section-head">
            <h2 className="ins-h2">What clients tell us</h2>
            <p className="lede">From their own words: each person counted once, and each share is only over the people who said it — never everyone.</p>
          </section>
          <section className="ins-grid" aria-label="What clients tell us">
            <Told title="Budget" items={ins.profile.budget} known={ins.profile.known.budget} />
            <Told title="Buying when" items={ins.profile.timeline} known={ins.profile.known.timeline} />
            <Told title="Where they live" items={ins.profile.city} known={ins.profile.known.city} />
            <Told title="What it's for" items={ins.profile.purpose} known={ins.profile.known.purpose} />
            <Told title="Other brands" items={ins.profile.competitors} known={ins.profile.known.competitor} />
            <Told title="Concerns" items={ins.profile.concerns} known={ins.profile.known.concern} />
            <Told title="Paying" items={ins.profile.financing} known={ins.profile.known.financing} />
            <Told title="Looking for" items={ins.profile.needs} known={ins.profile.known.need} />
          </section>

          <section className="section-head">
            <h2 className="ins-h2">The clients</h2>
            <p className="lede">
              {ins.clients.length} {ins.clients.length === 1 ? "person" : "people"}
              {filter.model ? ` who named the selected car` : ""}, the ones closest to buying first.
            </p>
          </section>
          <div className="board-tools">
            <input className="board-search" type="search" placeholder="Search a name, number, car, city or question…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search clients" />
            <div className="chips" role="group" aria-label="Stage">
              <button type="button" className="chip" aria-pressed={stage === null} onClick={() => setStage(null)}>
                Everyone
              </button>
              {ins.stages.filter((s) => s.n > 0).map((s) => (
                <button key={s.key} type="button" className="chip" aria-pressed={stage === s.key} onClick={() => setStage(stage === s.key ? null : s.key)}>
                  {s.label} ({s.n})
                </button>
              ))}
            </div>
            <button type="button" className="btn" onClick={downloadCsv} disabled={clients.length === 0}>
              Download CSV
            </button>
          </div>
          {clients.length === 0 ? (
            <p className="board-empty">Nobody matches. Try a wider period or clear the search.</p>
          ) : (
            <>
              <ul className="rows">
                {clients.slice(0, shown).map((c) => (
                  <ClientRow key={c.id} c={c} />
                ))}
              </ul>
              {clients.length > shown && (
                <button type="button" className="btn" onClick={() => setShown(shown + 100)}>
                  Show {Math.min(100, clients.length - shown)} more
                </button>
              )}
            </>
          )}
        </>
      )}

      {read.state !== "unavailable" && (
        <section className="ins-panel ins-rebuild">
          <h2 className="ins-h2">Fill in the past</h2>
          <p className="lede">
            Signals are recorded from now on for every message. WhatsApp keeps the last 12 months of messages, so the past can be read through the
            reader once and recorded too. Instagram and Facebook are read from Meta below.
          </p>
          <div className="rowcard-actions">
            <button type="button" className="btn primary" onClick={() => void rebuild()} disabled={rebuilding || read.state === "no_table"}>
              {rebuilding ? "Reading the history…" : "Rebuild from WhatsApp history"}
            </button>
            {note && <span className="ins-note">{note}</span>}
          </div>
        </section>
      )}
      {read.state === "ok" && <MetaHistory runs={metaRuns} />}
    </div>
  );
}
