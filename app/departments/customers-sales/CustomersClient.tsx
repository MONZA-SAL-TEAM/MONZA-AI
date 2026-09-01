"use client";

/**
 * Customers & Sales — the customer directory: look anyone up, see where new
 * enquiries come from, and open the full story on any customer.
 *
 * Server API this client speaks (GET /api/customers, exactly):
 *   { demo: true,  directory: CustomerDirectory }   — example data
 *   { demo: false, directory: null, notReady: "…" } — honest not-wired state
 *   401                                              — link to /login
 *
 * Honesty rules baked in (same school as the tracker and the garage board):
 *   - The directory is a fixed dataset; nothing reads the real clock, so
 *     server and client can never disagree at first paint. An added
 *     customer's first contact is the plain string "Today (example)".
 *   - Adding a customer updates THIS SCREEN ONLY and wears an
 *     "Added by you — example" tag; refreshing the page resets everything.
 *     Nothing is sent anywhere and nothing claims to be.
 *   - The plan and garage snapshots on each card mirror the other two boards
 *     exactly and link straight to them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import Link from "next/link";
import type {
  CustomerDirectory,
  CustomerSource,
  DirectoryCustomer,
  GarageSnapshot,
  PlanSnapshot,
} from "@/lib/customers/directory-data";
import { CUSTOMER_SOURCES } from "@/lib/customers/directory-data";

/* ------------------------------------------------------------- constants --- */

const DEMO_NOTE = "Example data — not connected to the Monza systems yet.";
const LOGIN_HREF = "/login?next=" + encodeURIComponent("/departments/customers-sales");

/** The four enquiry channels the sources rail counts — everything except
 *  "Longtime customer", in the chat's display order. */
const ENQUIRY_SOURCES: CustomerSource[] = [
  "Instagram",
  "Showroom walk-in",
  "Referral",
  "Website",
];

/* ------------------------------------------------- defensive api parsing --- */

function isSource(v: unknown): v is CustomerSource {
  return typeof v === "string" && (CUSTOMER_SOURCES as string[]).includes(v);
}

function asPlan(v: unknown): PlanSnapshot | undefined {
  if (v === undefined) return undefined;
  if (!v || typeof v !== "object") return undefined;
  const p = v as Partial<PlanSnapshot>;
  if (
    typeof p.paidCount !== "number" ||
    typeof p.totalCount !== "number" ||
    typeof p.monthlyUsd !== "number" ||
    (p.paidUsd !== undefined && typeof p.paidUsd !== "number") ||
    (p.behind !== undefined && typeof p.behind !== "boolean") ||
    (p.behindCount !== undefined && typeof p.behindCount !== "number")
  ) {
    return undefined;
  }
  return v as PlanSnapshot;
}

function asGarage(v: unknown): GarageSnapshot | undefined {
  if (v === undefined) return undefined;
  if (!v || typeof v !== "object") return undefined;
  const g = v as Partial<GarageSnapshot>;
  if (
    typeof g.jobNumber !== "string" ||
    typeof g.status !== "string" ||
    (g.neededPart !== undefined && typeof g.neededPart !== "string")
  ) {
    return undefined;
  }
  return v as GarageSnapshot;
}

function asCustomer(v: unknown): DirectoryCustomer | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Partial<DirectoryCustomer>;
  if (
    typeof c.name !== "string" ||
    typeof c.phone !== "string" ||
    typeof c.carLabel !== "string" ||
    typeof c.vin !== "string" ||
    typeof c.plate !== "string" ||
    !isSource(c.source) ||
    typeof c.firstContact !== "string" ||
    typeof c.isNewThisMonth !== "boolean"
  ) {
    return null;
  }
  return {
    name: c.name,
    phone: c.phone,
    carLabel: c.carLabel,
    vin: c.vin,
    plate: c.plate,
    source: c.source,
    firstContact: c.firstContact,
    isNewThisMonth: c.isNewThisMonth,
    plan: asPlan(c.plan),
    garage: asGarage(c.garage),
  };
}

function asDirectory(v: unknown): CustomerDirectory | null {
  if (!v || typeof v !== "object") return null;
  const d = v as Partial<CustomerDirectory>;
  if (typeof d.periodLabel !== "string" || !Array.isArray(d.customers)) return null;
  return {
    periodLabel: d.periodLabel,
    customers: d.customers.map(asCustomer).filter((c): c is DirectoryCustomer => c !== null),
  };
}

/* --------------------------------------------------------- pure helpers --- */

/** "$7,750" — explicit locale so server and client always agree. */
function fmtUsd(n: number): string {
  return "$" + n.toLocaleString("en-US");
}

/** "9613100001" → "+961 3 100 001"; anything else is shown as typed. */
function fmtPhone(digits: string): string {
  if (/^961\d{7}$/.test(digits)) {
    return `+961 ${digits[3]} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  return digits;
}

/** "5 of 20 paid — 3 behind" / "7 of 12 paid — on track". */
function planLine(p: PlanSnapshot): string {
  const base = `${p.paidCount} of ${p.totalCount} paid`;
  if (p.behind) {
    const n = p.behindCount ?? 1;
    return `${base} — ${n} behind`;
  }
  return `${base} — on track`;
}

/** "$7,750 paid of $31,000". */
function planMoney(p: PlanSnapshot): string {
  const paid = p.paidUsd ?? p.paidCount * p.monthlyUsd;
  return `${fmtUsd(paid)} paid of ${fmtUsd(p.totalCount * p.monthlyUsd)}`;
}

/** "In the garage — GJ-2026-0142, waiting for a part". */
function garageLine(g: GarageSnapshot): string {
  const state =
    g.status === "Waiting for parts" ? "waiting for a part" : g.status.toLowerCase();
  return `In the garage — ${g.jobNumber}, ${state}`;
}

/* --------------------------------------------------------- small glyphs --- */

function BackGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

/** Same people drawing as the welcome card, so the card and its page match. */
function DeptGlyph() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="10" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/** Small bars — heads the "where customers come from" rail card. */
function BarsGlyph() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
      <line x1="12" y1="20" x2="12" y2="10" />
      <line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6" y1="20" x2="6" y2="16" />
    </svg>
  );
}

/** A little sparkle — heads the "new this month" rail card. */
function SparkGlyph() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </svg>
  );
}

/* -------------------------------------------------------- add-a-customer --- */

interface AddFormState {
  name: string;
  phone: string;
  car: string;
  vin: string;
  plate: string;
  source: CustomerSource;
}

const EMPTY_FORM: AddFormState = {
  name: "",
  phone: "",
  car: "",
  vin: "",
  plate: "",
  source: "Showroom walk-in",
};

/** A directory row plus the client-side key that makes lists stable. */
interface Row extends DirectoryCustomer {
  key: string;
  addedByYou?: boolean;
}

/* ---------------------------------------------------------------- the ui --- */

type Screen = "loading" | "login" | "error" | "notReady" | "ready";

export default function CustomersClient() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [demo, setDemo] = useState(false);
  const [directory, setDirectory] = useState<CustomerDirectory | null>(null);
  const [notReady, setNotReady] = useState(
    "The directory reads live customer records once the connection work is finished."
  );
  /** Customers added this session — screen-only, reset on refresh. */
  const [added, setAdded] = useState<Row[]>([]);
  /** Directory search — display filter only, KPIs stay whole-directory. */
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<AddFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  /** A plain counter for added-row keys — deterministic, no Date, no random. */
  const addSeq = useRef(1);

  const load = useCallback(async () => {
    setScreen("loading");
    try {
      const res = await fetch("/api/customers");
      if (res.status === 401) {
        setScreen("login");
        return;
      }
      if (!res.ok) {
        setScreen("error");
        return;
      }
      const raw: unknown = await res.json();
      const d = (raw && typeof raw === "object" ? raw : {}) as {
        demo?: unknown;
        directory?: unknown;
        notReady?: unknown;
      };
      const parsed = asDirectory(d.directory);
      if (parsed) {
        setDemo(d.demo === true);
        setDirectory(parsed);
        setAdded([]);
        setScreen("ready");
        return;
      }
      if (d.demo === false) {
        if (typeof d.notReady === "string" && d.notReady.trim() !== "") {
          setNotReady(d.notReady);
        }
        setScreen("notReady");
        return;
      }
      setScreen("error");
    } catch {
      setScreen("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* ----- derived views ----- */

  /** Your added customers first (newest on top), then the dataset's order —
   *  which is already newest-enquiry-first, so no date parsing anywhere. */
  const allRows = useMemo<Row[]>(() => {
    const base: Row[] = (directory ? directory.customers : []).map((c) => ({
      ...c,
      key: c.vin !== "" ? c.vin : c.name,
    }));
    return [...added, ...base];
  }, [added, directory]);

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allRows;
    const qFlat = q.replace(/\s/g, "");
    const qDigits = q.replace(/[^0-9]/g, "");
    return allRows.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.carLabel.toLowerCase().includes(q) ||
        c.vin.toLowerCase().includes(q) ||
        c.plate.toLowerCase().includes(q) ||
        (qFlat !== "" && c.plate.replace(/\s/g, "").toLowerCase().includes(qFlat)) ||
        (qDigits !== "" && c.phone.includes(qDigits))
    );
  }, [allRows, query]);

  /** Enquiry-source counts over the whole directory (added rows included) —
   *  the rail and the "Top source" KPI recompute live from these. */
  const sourceCounts = useMemo(() => {
    const counts = new Map<CustomerSource, number>();
    for (const s of ENQUIRY_SOURCES) counts.set(s, 0);
    for (const c of allRows) {
      if (c.source !== "Longtime customer") {
        counts.set(c.source, (counts.get(c.source) ?? 0) + 1);
      }
    }
    return counts;
  }, [allRows]);

  const kpis = useMemo(() => {
    const newThisMonth = allRows.filter((c) => c.isNewThisMonth).length;
    const inGarage = allRows.filter((c) => c.garage !== undefined).length;
    let topSource = "—";
    let best = 0;
    for (const s of ENQUIRY_SOURCES) {
      const n = sourceCounts.get(s) ?? 0;
      if (n > best) {
        best = n;
        topSource = s;
      }
    }
    return { customers: allRows.length, newThisMonth, topSource, inGarage };
  }, [allRows, sourceCounts]);

  const newThisMonthRows = useMemo(
    () => allRows.filter((c) => c.isNewThisMonth),
    [allRows]
  );

  const maxSourceCount = useMemo(() => {
    let m = 1;
    for (const s of ENQUIRY_SOURCES) m = Math.max(m, sourceCounts.get(s) ?? 0);
    return m;
  }, [sourceCounts]);

  /* ----- add-customer form ----- */

  const setField = useCallback(
    (key: keyof AddFormState) =>
      (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setForm((f) => ({ ...f, [key]: e.target.value }));
      },
    []
  );

  const closeAdd = useCallback(() => {
    setAddOpen(false);
    setFormError(null);
  }, []);

  const submitAdd = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const name = form.name.trim();
      const phoneRaw = form.phone.trim();
      const car = form.car.trim();
      const vin = form.vin.trim().toUpperCase();
      const plate = form.plate.trim().toUpperCase();

      if (!name) return setFormError("Please enter the customer's name.");
      if (phoneRaw !== "" && !/^[+\d][\d\s-]*$/.test(phoneRaw)) {
        return setFormError("Phone should be digits only — like 9613100011.");
      }

      const row: Row = {
        key: `added-${addSeq.current++}`,
        addedByYou: true,
        name,
        phone: phoneRaw.replace(/[^0-9]/g, ""),
        carLabel: car,
        vin,
        plate,
        source: form.source,
        // A plain string, on purpose — no real clock ever touches this screen.
        firstContact: "Today (example)",
        isNewThisMonth: true,
      };
      setAdded((prev) => [row, ...prev]);
      setForm(EMPTY_FORM);
      setFormError(null);
      setAddOpen(false);
    },
    [form]
  );

  /* ----- the four simple screens ----- */

  if (screen === "login") {
    return (
      <div className="cd-page">
        <div className="cd-empty">
          <p className="h2">Please sign in</p>
          <p className="cap">You need to be signed in to see Customers &amp; Sales.</p>
          <a className="btn primary" href={LOGIN_HREF}>
            Go to sign in
          </a>
        </div>
      </div>
    );
  }

  if (screen === "loading") {
    return (
      <div className="cd-page">
        <div className="cd-empty" aria-live="polite">
          <p className="cap">Loading the directory…</p>
        </div>
      </div>
    );
  }

  if (screen === "error") {
    return (
      <div className="cd-page">
        <div className="cd-wrap">
          <div className="note urgent">Couldn&apos;t load Customers &amp; Sales.</div>
          <button className="btn" onClick={load} style={{ alignSelf: "flex-start" }}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (screen === "notReady" || !directory) {
    return (
      <div className="cd-page">
        <div className="cd-wrap">
          <Link className="dept-back" href="/chat">
            <BackGlyph />
            Back to chat
          </Link>
          <header className="cd-head">
            <div className="cd-head-main">
              <span className="cd-icon">
                <DeptGlyph />
              </span>
              <div>
                <h1 className="h1">Customers &amp; Sales</h1>
                <p className="cap cd-sub">
                  Look up any customer, see where new enquiries come from, and open
                  the full story on anyone.
                </p>
              </div>
            </div>
          </header>
          <div className="card pad stack">
            <p className="h2" style={{ margin: 0 }}>
              Not connected yet
            </p>
            <p className="lede">{notReady}</p>
            <Link className="btn" href="/chat" style={{ alignSelf: "flex-start" }}>
              Ask in the chat instead
            </Link>
          </div>
        </div>
      </div>
    );
  }

  /* ----- the directory itself ----- */

  return (
    <div className="cd-page">
      <div className="cd-wrap">
        <Link className="dept-back" href="/chat">
          <BackGlyph />
          Back to chat
        </Link>

        <header className="cd-head">
          <div className="cd-head-main">
            <span className="cd-icon">
              <DeptGlyph />
            </span>
            <div className="grow">
              <div className="cd-title-row">
                <h1 className="h1">Customers &amp; Sales</h1>
                <span className="tag">{directory.periodLabel}</span>
              </div>
              <p className="cap cd-sub">
                Prefer to ask?{" "}
                <Link className="cd-sub-link" href="/chat">
                  Open the chat
                </Link>
              </p>
            </div>
          </div>
          <button
            className="btn primary cd-add-btn"
            onClick={() => {
              setAddOpen((v) => !v);
              setFormError(null);
            }}
            aria-expanded={addOpen}
          >
            <PlusGlyph />
            Add customer
          </button>
        </header>

        {demo && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="note">{DEMO_NOTE}</div>
            <p className="cd-foot">
              Adding a customer only updates this example — refreshing the page
              resets it.
            </p>
          </div>
        )}

        {addOpen && (
          <section className="card cd-add" aria-label="Add a customer">
            <div className="cd-add-head">
              <h2 className="h2">Add a customer</h2>
              <button className="btn quiet" onClick={closeAdd}>
                Close
              </button>
            </div>
            <form className="cd-form" onSubmit={submitAdd} noValidate>
              <label className="cd-field">
                <span className="cd-label">Name *</span>
                <input
                  value={form.name}
                  onChange={setField("name")}
                  placeholder="e.g. Dana Aoun"
                  autoFocus
                  required
                />
              </label>
              <label className="cd-field">
                <span className="cd-label">Phone</span>
                <input
                  value={form.phone}
                  onChange={setField("phone")}
                  placeholder="digits — e.g. 9613100011"
                  inputMode="numeric"
                />
              </label>
              <label className="cd-field">
                <span className="cd-label">Car</span>
                <input
                  value={form.car}
                  onChange={setField("car")}
                  placeholder="e.g. Voyah Free 2025"
                />
              </label>
              <label className="cd-field">
                <span className="cd-label">VIN</span>
                <input
                  className="cd-vin-input"
                  value={form.vin}
                  onChange={setField("vin")}
                  placeholder="17 characters"
                  maxLength={17}
                  spellCheck={false}
                />
              </label>
              <label className="cd-field">
                <span className="cd-label">Plate</span>
                <input
                  value={form.plate}
                  onChange={setField("plate")}
                  placeholder="e.g. B 123456"
                />
              </label>
              <label className="cd-field">
                <span className="cd-label">Source</span>
                <select value={form.source} onChange={setField("source")}>
                  {CUSTOMER_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <div className="cd-field cd-span2">
                <span className="cd-label">First contact</span>
                <p className="cd-static-value">Today (example)</p>
              </div>
              {formError && (
                <p className="cd-form-err cd-span2" role="alert">
                  {formError}
                </p>
              )}
              <div className="cd-form-actions cd-span2">
                <button type="submit" className="btn primary">
                  Add customer
                </button>
                <button type="button" className="btn" onClick={closeAdd}>
                  Cancel
                </button>
              </div>
              <p className="cap cd-form-cap cd-span2">
                New customers appear on this screen only and disappear on refresh.
                In the live system this creates the customer in the Monza CRM.
              </p>
            </form>
          </section>
        )}

        <div className="cd-kpis" aria-live="polite">
          <div className="cd-kpi">
            <span className="cd-kpi-label">Customers</span>
            <span className="cd-kpi-value">{kpis.customers}</span>
          </div>
          <div className="cd-kpi">
            <span className="cd-kpi-label">New this month</span>
            <span className="cd-kpi-value">{kpis.newThisMonth}</span>
          </div>
          <div className="cd-kpi">
            <span className="cd-kpi-label">Top source</span>
            <span className="cd-kpi-value cd-kpi-text">{kpis.topSource}</span>
          </div>
          <div className="cd-kpi">
            <span className="cd-kpi-label">In the garage</span>
            <span className="cd-kpi-value">{kpis.inGarage}</span>
          </div>
        </div>

        <div className="cd-cols">
          {/* ── The directory (left, wider) ─────────────────────────────── */}
          <section className="cd-dir" aria-label="Customer directory">
            <div className="cd-toolbar">
              <input
                type="search"
                className="cd-search"
                placeholder="Search name, phone, car, VIN or plate…"
                aria-label="Search customers by name, phone, car, VIN or plate"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query.trim() !== "" && (
                <span className="cap cd-search-count">
                  Showing {visibleRows.length} of {allRows.length}
                </span>
              )}
            </div>

            {visibleRows.length === 0 ? (
              <div className="card cd-none">
                <p className="h2" style={{ margin: 0 }}>
                  No customers match
                </p>
                <p className="cap" style={{ margin: 0 }}>
                  Nothing matches &ldquo;{query.trim()}&rdquo; — try a shorter part
                  of the name, phone, car, VIN or plate.
                </p>
              </div>
            ) : (
              <div className="cd-grid">
                {visibleRows.map((c) => (
                  <article
                    className="card cd-cust"
                    key={c.key}
                    data-added={c.addedByYou || undefined}
                    aria-label={`Customer ${c.name}`}
                  >
                    <div className="cd-cust-top">
                      <p className="cd-cust-name">{c.name}</p>
                      <div className="cd-cust-tags">
                        {c.isNewThisMonth && <span className="tag live">New</span>}
                        <span className="tag">{c.source}</span>
                      </div>
                    </div>

                    <p className="cap cd-cust-car">
                      {c.carLabel !== "" ? c.carLabel : "No car on file"}
                      {c.vin !== "" && (
                        <>
                          {" · "}
                          <span className="cd-vin">{c.vin}</span>
                        </>
                      )}
                      {c.plate !== "" && (
                        <>
                          {" "}
                          <span className="cd-plate">{c.plate}</span>
                        </>
                      )}
                    </p>

                    {(c.plan || c.garage) && (
                      <div className="cd-links">
                        {c.plan && (
                          <Link
                            className="cd-link"
                            data-urgent={c.plan.behind || undefined}
                            href="/departments/installments-payments"
                          >
                            {planLine(c.plan)}
                          </Link>
                        )}
                        {c.garage && (
                          <Link
                            className="cd-link"
                            data-urgent={c.garage.status === "Waiting for parts" || undefined}
                            href="/departments/garage-vehicles"
                          >
                            {garageLine(c.garage)}
                          </Link>
                        )}
                      </div>
                    )}

                    {c.addedByYou && (
                      <div className="cd-cust-meta">
                        <span className="tag">Added by you — example</span>
                      </div>
                    )}

                    <details className="cd-details">
                      <summary className="cd-details-summary">Full details</summary>
                      <dl className="cd-dl">
                        <div className="cd-dl-row">
                          <dt>Phone</dt>
                          <dd>{c.phone !== "" ? fmtPhone(c.phone) : "—"}</dd>
                        </div>
                        <div className="cd-dl-row">
                          <dt>First contact</dt>
                          <dd>{c.firstContact}</dd>
                        </div>
                        <div className="cd-dl-row">
                          <dt>Source</dt>
                          <dd>{c.source}</dd>
                        </div>
                        <div className="cd-dl-row">
                          <dt>Car</dt>
                          <dd>{c.carLabel !== "" ? c.carLabel : "—"}</dd>
                        </div>
                        <div className="cd-dl-row">
                          <dt>Plate</dt>
                          <dd>{c.plate !== "" ? <span className="cd-plate">{c.plate}</span> : "—"}</dd>
                        </div>
                        <div className="cd-dl-row">
                          <dt>VIN</dt>
                          <dd>{c.vin !== "" ? <span className="cd-vin">{c.vin}</span> : "—"}</dd>
                        </div>
                        {c.plan && (
                          <div className="cd-dl-row">
                            <dt>Payment plan</dt>
                            <dd>
                              {planLine(c.plan)} · {fmtUsd(c.plan.monthlyUsd)}/month ·{" "}
                              {planMoney(c.plan)}
                            </dd>
                          </div>
                        )}
                        {c.garage && (
                          <div className="cd-dl-row">
                            <dt>Garage</dt>
                            <dd>
                              {garageLine(c.garage)}
                              {c.garage.neededPart && <> · needs: {c.garage.neededPart}</>}
                            </dd>
                          </div>
                        )}
                      </dl>
                    </details>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* ── Sources + new-this-month rail (right) ───────────────────── */}
          <aside className="cd-rail" aria-label="Where new customers come from and who is new this month">
            <section className="card cd-rail-card" aria-label="Where new customers come from">
              <div className="cd-rail-head">
                <span className="cd-rail-icon">
                  <BarsGlyph />
                </span>
                <h2 className="h2">Where new customers come from</h2>
              </div>
              <ul className="cd-src-list">
                {ENQUIRY_SOURCES.map((s) => {
                  const n = sourceCounts.get(s) ?? 0;
                  return (
                    <li className="cd-src-row" key={s}>
                      <div className="cd-src-top">
                        <span className="cd-src-name">{s}</span>
                        <span className="cd-src-count">{n}</span>
                      </div>
                      <div className="cd-src-bar" aria-hidden>
                        <div
                          className="cd-src-fill"
                          style={{ width: `${Math.round((n / maxSourceCount) * 100)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="cd-foot cd-rail-foot">
                Counts cover the recent enquiries — longtime customers aren&apos;t
                a channel.
              </p>
            </section>

            <section className="card cd-rail-card" aria-label="New this month">
              <div className="cd-rail-head">
                <span className="cd-rail-icon">
                  <SparkGlyph />
                </span>
                <h2 className="h2">New this month</h2>
              </div>
              {newThisMonthRows.length === 0 ? (
                <p className="cap cd-src-none">No new customers yet this month.</p>
              ) : (
                <ul className="cd-new-list">
                  {newThisMonthRows.map((c) => (
                    <li className="cd-new-row" key={c.key}>
                      <span className="cd-new-name">{c.name}</span>
                      <span className="cd-new-date">{c.firstContact}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="cd-foot cd-rail-foot">
                Freshest first — the top name is the one to call today.
              </p>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
