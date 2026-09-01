"use client";

/**
 * Garage & Vehicles — one board for the whole workshop and the yard.
 *
 * Server API this client speaks (GET /api/garage, exactly):
 *   { demo: true,  board: GarageBoard }         — example data
 *   { demo: false, board: null, notReady: "…" } — honest not-wired state
 *   401                                          — link to /login
 *
 * Honesty rules baked in (same school as the payment tracker):
 *   - The board is a fixed dataset; nothing reads the real clock, so server
 *     and client can never disagree at first paint.
 *   - Job cards move FORWARD only: waiting → working → (waiting for parts ⇄
 *     back to working) → ready → delivered. Delivered locks the card on this
 *     screen — muted, no actions — after a small confirm dialog.
 *   - Every status change and every added job card updates THIS SCREEN ONLY
 *     and wears an "example" tag; refreshing resets everything. Nothing is
 *     sent anywhere and nothing claims to be.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import Link from "next/link";
import type { GarageBoard, GarageJob, GarageJobStatus, LowPart, StockModel } from "@/lib/garage/board-data";

/* ------------------------------------------------------------- constants --- */

const DEMO_NOTE = "Example data — not connected to the Monza systems yet.";
const LOGIN_HREF = "/login?next=" + encodeURIComponent("/departments/garage-vehicles");

/** Plain-words labels for the status pills — the data stays machine-shaped. */
const STATUS_LABEL: Record<GarageJobStatus, string> = {
  waiting: "Waiting to start",
  working: "In progress",
  waiting_parts: "Waiting for parts",
  ready: "Ready for pickup",
  delivered: "Delivered",
};

/** Urgent things first, then the active work, then the queue, then done. */
const STATUS_RANK: Record<GarageJobStatus, number> = {
  waiting_parts: 0,
  working: 1,
  waiting: 2,
  ready: 3,
  delivered: 4,
};

/* ------------------------------------------------- defensive api parsing --- */

function isStatus(v: unknown): v is GarageJobStatus {
  return (
    v === "waiting" || v === "working" || v === "waiting_parts" || v === "ready" || v === "delivered"
  );
}

function asJob(v: unknown): GarageJob | null {
  if (!v || typeof v !== "object") return null;
  const j = v as Partial<GarageJob>;
  if (
    typeof j.jobNumber !== "string" ||
    typeof j.clientName !== "string" ||
    typeof j.carLabel !== "string" ||
    typeof j.vin !== "string" ||
    !isStatus(j.status) ||
    typeof j.latestUpdate !== "string" ||
    (j.neededPart !== undefined && typeof j.neededPart !== "string") ||
    typeof j.daysInGarage !== "number"
  ) {
    return null;
  }
  return v as GarageJob;
}

function asStock(v: unknown): StockModel | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Partial<StockModel>;
  if (typeof s.model !== "string" || typeof s.count !== "number" || typeof s.note !== "string") {
    return null;
  }
  return v as StockModel;
}

function asLowPart(v: unknown): LowPart | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Partial<LowPart>;
  if (
    typeof p.name !== "string" ||
    typeof p.partNumber !== "string" ||
    typeof p.inStock !== "number" ||
    typeof p.minLevel !== "number"
  ) {
    return null;
  }
  return v as LowPart;
}

function asBoard(v: unknown): GarageBoard | null {
  if (!v || typeof v !== "object") return null;
  const b = v as Partial<GarageBoard>;
  if (
    typeof b.periodLabel !== "string" ||
    !Array.isArray(b.jobs) ||
    !Array.isArray(b.stock) ||
    !Array.isArray(b.lowParts)
  ) {
    return null;
  }
  return {
    periodLabel: b.periodLabel,
    jobs: b.jobs.map(asJob).filter((j): j is GarageJob => j !== null),
    stock: b.stock.map(asStock).filter((s): s is StockModel => s !== null),
    lowParts: b.lowParts.map(asLowPart).filter((p): p is LowPart => p !== null),
  };
}

function sortJobs(jobs: GarageJob[]): GarageJob[] {
  return [...jobs].sort((a, b) => {
    const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (rank !== 0) return rank;
    const days = b.daysInGarage - a.daysInGarage; // longest-suffering first
    if (days !== 0) return days;
    return a.jobNumber.localeCompare(b.jobNumber);
  });
}

/* --------------------------------------------------------- small glyphs --- */

function BackGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

/** Same wrench drawing as the welcome card, so the card and its page match. */
function DeptGlyph() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
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

/** A small padlock — a delivered job card is closed on this screen. */
function LockGlyph() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

/** The inventory cube — heads the stock rail, echoing the old card's icon. */
function BoxGlyph() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

/* ---------------------------------------------------------- small pieces --- */

function StatusPill({ status }: { status: GarageJobStatus }) {
  const cls =
    status === "waiting_parts"
      ? "tag urgent"
      : status === "working" || status === "ready"
        ? "tag live"
        : "tag";
  const withDot = status === "working" || status === "waiting_parts";
  return (
    <span className={cls}>
      {withDot && <span className="dot" />}
      {STATUS_LABEL[status]}
    </span>
  );
}

function daysTag(days: number): string {
  if (days <= 0) return "In today";
  if (days === 1) return "1 day in";
  return `${days} days in`;
}

/* ------------------------------------------------------ add-job-card form --- */

interface AddFormState {
  name: string;
  car: string;
  vin: string;
  plate: string;
  issue: string;
}

const EMPTY_FORM: AddFormState = { name: "", car: "", vin: "", plate: "", issue: "" };

/* ---------------------------------------------------------------- the ui --- */

type Screen = "loading" | "login" | "error" | "notReady" | "ready";

/** A user-made change to one job card this session. Forward-only by design. */
interface JobOverride {
  status: GarageJobStatus;
  neededPart?: string;
  latestUpdate: string;
}

export default function GarageClient() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [demo, setDemo] = useState(false);
  const [board, setBoard] = useState<GarageBoard | null>(null);
  const [notReady, setNotReady] = useState(
    "The board reads live job cards and stock once the connection work is finished."
  );
  /** Status changes made this session — screen-only, reset on refresh. */
  const [overrides, setOverrides] = useState<Record<string, JobOverride>>({});
  /** Job cards added this session — screen-only, reset on refresh. */
  const [added, setAdded] = useState<GarageJob[]>([]);
  /** Jobs search — display filter only, KPIs stay whole-board. */
  const [query, setQuery] = useState("");
  /** Find-a-vehicle search in the stock rail. */
  const [vehicleQuery, setVehicleQuery] = useState("");
  /** Which card's "which part?" inline prompt is open, if any. */
  const [partPromptFor, setPartPromptFor] = useState<string | null>(null);
  const [partText, setPartText] = useState("");
  /** Which job the Mark-delivered confirm dialog is open for, if any. */
  const [deliverFor, setDeliverFor] = useState<string | null>(null);
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<AddFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  /** A plain counter for added-job numbers — deterministic, no Date, no random. */
  const addSeq = useRef(1);

  const load = useCallback(async () => {
    setScreen("loading");
    try {
      const res = await fetch("/api/garage");
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
        board?: unknown;
        notReady?: unknown;
      };
      const parsed = asBoard(d.board);
      if (parsed) {
        setDemo(d.demo === true);
        // Sort once here so the order is stable for the whole session — an
        // advanced card keeps its place instead of jumping away from under
        // the person's thumb (the pill and KPIs still update).
        setBoard({ ...parsed, jobs: sortJobs(parsed.jobs) });
        setOverrides({});
        setAdded([]);
        setPartPromptFor(null);
        setDeliverFor(null);
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

  /* ----- forward-only lifecycle moves ----- */

  const advance = useCallback(
    (jobNumber: string, status: GarageJobStatus, latestUpdate: string, neededPart?: string) => {
      setOverrides((prev) => ({
        ...prev,
        [jobNumber]: { status, latestUpdate, ...(neededPart ? { neededPart } : {}) },
      }));
      setPartPromptFor(null);
      setPartText("");
    },
    []
  );

  const startWork = useCallback(
    (j: GarageJob) => advance(j.jobNumber, "working", "Work started — the car is on a lift."),
    [advance]
  );

  const markReady = useCallback(
    (j: GarageJob) =>
      advance(j.jobNumber, "ready", "Work finished — the car is ready for pickup."),
    [advance]
  );

  const markWaitingParts = useCallback(
    (j: GarageJob, part: string) => {
      const p = part.trim();
      if (!p) return;
      advance(j.jobNumber, "waiting_parts", `Blocked until the ${p.toLowerCase()} arrives.`, p);
    },
    [advance]
  );

  const resumeWork = useCallback(
    (j: GarageJob) =>
      advance(j.jobNumber, "working", "Part arrived — back on the lift and moving again."),
    [advance]
  );

  const confirmDelivered = useCallback(
    (jobNumber: string) => {
      advance(jobNumber, "delivered", "Delivered back to the client — job card closed here.");
      setDeliverFor(null);
    },
    [advance]
  );

  // Drive the native <dialog>: showModal gives focus trapping + Esc for free.
  // The guard covers engines where showModal throws (already-open, old WebKit).
  useEffect(() => {
    const d = dlgRef.current;
    if (!d) return;
    if (deliverFor !== null) {
      if (!d.open) {
        try {
          d.showModal();
        } catch {
          d.setAttribute("open", "");
        }
      }
    } else if (d.open) {
      d.close();
    }
    if (deliverFor === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDeliverFor(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [deliverFor]);

  /* ----- derived views ----- */

  /** A job with this session's change applied. neededPart is carried only
   *  while the card is actually waiting for a part. */
  const withOverride = useCallback(
    (j: GarageJob): GarageJob => {
      const o = overrides[j.jobNumber];
      if (!o) return j;
      return {
        ...j,
        status: o.status,
        latestUpdate: o.latestUpdate,
        neededPart: o.status === "waiting_parts" ? (o.neededPart ?? j.neededPart) : undefined,
      };
    },
    [overrides]
  );

  /** Your added cards first (newest on top), then the sorted board. */
  const baseJobs = useMemo(() => [...added, ...(board ? board.jobs : [])], [added, board]);
  const shownJobs = useMemo(() => baseJobs.map(withOverride), [baseJobs, withOverride]);

  const visibleJobs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shownJobs;
    return shownJobs.filter(
      (j) =>
        j.jobNumber.toLowerCase().includes(q) ||
        j.clientName.toLowerCase().includes(q) ||
        j.carLabel.toLowerCase().includes(q) ||
        j.vin.toLowerCase().includes(q)
    );
  }, [shownJobs, query]);

  const kpis = useMemo(() => {
    let open = 0;
    let waitingParts = 0;
    for (const j of shownJobs) {
      if (j.status !== "delivered") open += 1;
      if (j.status === "waiting_parts") waitingParts += 1;
    }
    const carsInStock = (board?.stock ?? []).reduce((s, m) => s + m.count, 0);
    const lowParts = (board?.lowParts ?? []).filter((p) => p.inStock < p.minLevel).length;
    return { open, waitingParts, carsInStock, lowParts };
  }, [shownJobs, board]);

  const visibleStock = useMemo(() => {
    const q = vehicleQuery.trim().toLowerCase();
    const stock = board?.stock ?? [];
    if (!q) return stock;
    return stock.filter(
      (m) => m.model.toLowerCase().includes(q) || m.note.toLowerCase().includes(q)
    );
  }, [board, vehicleQuery]);

  /* ----- add-job-card form ----- */

  const setField = useCallback(
    (key: keyof AddFormState) => (e: ChangeEvent<HTMLInputElement>) => {
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
      const car = form.car.trim();
      const vin = form.vin.trim().toUpperCase();
      const plate = form.plate.trim().toUpperCase();
      const issue = form.issue.trim();

      if (!name) return setFormError("Please enter the client's name.");
      if (!car) return setFormError("Please enter the car.");
      if (!issue) return setFormError("Please describe what's wrong in a few words.");

      const job: GarageJob = {
        // 9xxx numbers so an added example can never collide with the dataset.
        jobNumber: `GJ-2026-9${String(addSeq.current++).padStart(3, "0")}`,
        clientName: name,
        carLabel: plate ? `${car} — ${plate}` : car,
        vin,
        status: "waiting",
        latestUpdate: `Booked in: ${issue}`,
        daysInGarage: 0,
      };
      setAdded((prev) => [job, ...prev]);
      setForm(EMPTY_FORM);
      setFormError(null);
      setAddOpen(false);
    },
    [form]
  );

  /* ----- the four simple screens ----- */

  if (screen === "login") {
    return (
      <div className="gv-page">
        <div className="gv-empty">
          <p className="h2">Please sign in</p>
          <p className="cap">You need to be signed in to see Garage &amp; Vehicles.</p>
          <a className="btn primary" href={LOGIN_HREF}>
            Go to sign in
          </a>
        </div>
      </div>
    );
  }

  if (screen === "loading") {
    return (
      <div className="gv-page">
        <div className="gv-empty" aria-live="polite">
          <p className="cap">Loading the board…</p>
        </div>
      </div>
    );
  }

  if (screen === "error") {
    return (
      <div className="gv-page">
        <div className="gv-wrap">
          <div className="note urgent">Couldn&apos;t load Garage &amp; Vehicles.</div>
          <button className="btn" onClick={load} style={{ alignSelf: "flex-start" }}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (screen === "notReady" || !board) {
    return (
      <div className="gv-page">
        <div className="gv-wrap">
          <Link className="dept-back" href="/chat">
            <BackGlyph />
            Back to chat
          </Link>
          <header className="gv-head">
            <div className="gv-head-main">
              <span className="gv-icon">
                <DeptGlyph />
              </span>
              <div>
                <h1 className="h1">Garage &amp; Vehicles</h1>
                <p className="cap gv-sub">
                  Open jobs, cars waiting for parts, cars in stock, and parts running low.
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

  /* ----- the board itself ----- */

  return (
    <div className="gv-page">
      <div className="gv-wrap">
        <Link className="dept-back" href="/chat">
          <BackGlyph />
          Back to chat
        </Link>

        <header className="gv-head">
          <div className="gv-head-main">
            <span className="gv-icon">
              <DeptGlyph />
            </span>
            <div className="grow">
              <div className="gv-title-row">
                <h1 className="h1">Garage &amp; Vehicles</h1>
                <span className="tag">{board.periodLabel}</span>
              </div>
              <p className="cap gv-sub">
                Prefer to ask?{" "}
                <Link className="gv-sub-link" href="/chat">
                  Open the chat
                </Link>
              </p>
            </div>
          </div>
          <button
            className="btn primary gv-add-btn"
            onClick={() => {
              setAddOpen((v) => !v);
              setFormError(null);
            }}
            aria-expanded={addOpen}
          >
            <PlusGlyph />
            Add job card
          </button>
        </header>

        {demo && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="note">{DEMO_NOTE}</div>
            <p className="gv-foot">
              Starting work, marking parts, delivering, or adding a job card only
              updates this example — refreshing the page resets it.
            </p>
          </div>
        )}

        {addOpen && (
          <section className="card gv-add" aria-label="Add a job card">
            <div className="gv-add-head">
              <h2 className="h2">Add a job card</h2>
              <button className="btn quiet" onClick={closeAdd}>
                Close
              </button>
            </div>
            <form className="gv-form" onSubmit={submitAdd} noValidate>
              <label className="gv-field">
                <span className="gv-label">Client name *</span>
                <input
                  value={form.name}
                  onChange={setField("name")}
                  placeholder="e.g. Rami Kanaan"
                  autoFocus
                  required
                />
              </label>
              <label className="gv-field">
                <span className="gv-label">Car *</span>
                <input
                  value={form.car}
                  onChange={setField("car")}
                  placeholder="e.g. Voyah Free 2025"
                  required
                />
              </label>
              <label className="gv-field">
                <span className="gv-label">VIN</span>
                <input
                  className="gv-vin-input"
                  value={form.vin}
                  onChange={setField("vin")}
                  placeholder="17 characters"
                  maxLength={17}
                  spellCheck={false}
                />
              </label>
              <label className="gv-field">
                <span className="gv-label">Plate</span>
                <input value={form.plate} onChange={setField("plate")} placeholder="e.g. B 123456" />
              </label>
              <label className="gv-field gv-span2">
                <span className="gv-label">What&apos;s wrong *</span>
                <input
                  value={form.issue}
                  onChange={setField("issue")}
                  placeholder="e.g. knocking sound from the front left"
                  required
                />
              </label>
              {formError && (
                <p className="gv-form-err gv-span2" role="alert">
                  {formError}
                </p>
              )}
              <div className="gv-form-actions gv-span2">
                <button type="submit" className="btn primary">
                  Add job card
                </button>
                <button type="button" className="btn" onClick={closeAdd}>
                  Cancel
                </button>
              </div>
              <p className="cap gv-form-cap gv-span2">
                New cards start as &ldquo;Waiting to start&rdquo;, appear on this screen
                only, and disappear on refresh. In the live system this opens the job
                card in the Monza CRM.
              </p>
            </form>
          </section>
        )}

        <div className="gv-kpis" aria-live="polite">
          <div className="gv-kpi">
            <span className="gv-kpi-label">Open jobs</span>
            <span className="gv-kpi-value">{kpis.open}</span>
          </div>
          <div className="gv-kpi" data-urgent={kpis.waitingParts > 0}>
            <span className="gv-kpi-label">Waiting for parts</span>
            <span className="gv-kpi-value">{kpis.waitingParts}</span>
          </div>
          <div className="gv-kpi">
            <span className="gv-kpi-label">Cars on the books</span>
            <span className="gv-kpi-value">{kpis.carsInStock}</span>
          </div>
          <div className="gv-kpi" data-urgent={kpis.lowParts > 0}>
            <span className="gv-kpi-label">Parts running low</span>
            <span className="gv-kpi-value">{kpis.lowParts}</span>
          </div>
        </div>

        <div className="gv-cols">
          {/* ── Jobs board (left, wider) ─────────────────────────────────── */}
          <section className="gv-jobs" aria-label="Garage jobs">
            <div className="gv-toolbar">
              <input
                type="search"
                className="gv-search"
                placeholder="Search job number, client, car or VIN…"
                aria-label="Search jobs by job number, client, car or VIN"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query.trim() !== "" && (
                <span className="cap gv-search-count">
                  Showing {visibleJobs.length} of {shownJobs.length}
                </span>
              )}
            </div>

            {visibleJobs.length === 0 ? (
              <div className="card gv-none">
                <p className="h2" style={{ margin: 0 }}>
                  No jobs match
                </p>
                <p className="cap" style={{ margin: 0 }}>
                  Nothing matches &ldquo;{query.trim()}&rdquo; — try a shorter part of
                  the job number, name, car or VIN.
                </p>
              </div>
            ) : (
              <div className="gv-grid">
                {visibleJobs.map((j) => {
                  const touched = overrides[j.jobNumber] !== undefined;
                  const isAdded = added.some((a) => a.jobNumber === j.jobNumber);
                  const closed = j.status === "delivered";
                  const promptOpen = partPromptFor === j.jobNumber;
                  return (
                    <article
                      className="card gv-job"
                      key={j.jobNumber}
                      data-closed={closed || undefined}
                      data-touched={touched || isAdded || undefined}
                      aria-label={`Job ${j.jobNumber} — ${j.clientName}`}
                    >
                      <div className="gv-job-top">
                        <span className="gv-job-no">{j.jobNumber}</span>
                        <StatusPill status={j.status} />
                      </div>

                      <div className="gv-job-who">
                        <p className="gv-job-name">{j.clientName}</p>
                        <p className="cap gv-job-car">
                          {j.carLabel}
                          {j.vin !== "" && (
                            <>
                              {" · "}
                              <span className="gv-vin">{j.vin}</span>
                            </>
                          )}
                        </p>
                      </div>

                      <p className="gv-job-update">{j.latestUpdate}</p>

                      <div className="gv-job-meta">
                        {j.status === "waiting_parts" && j.neededPart && (
                          <span className="gv-part-chip">
                            Needs: {j.neededPart}
                          </span>
                        )}
                        <span className="gv-days">{daysTag(j.daysInGarage)}</span>
                        {(touched || isAdded) && (
                          <span className="tag">
                            {isAdded && !touched ? "Added by you — example" : "Updated by you — example"}
                          </span>
                        )}
                      </div>

                      {!closed && (
                        <div className="gv-job-actions">
                          {j.status === "waiting" && (
                            <button className="btn primary gv-act" onClick={() => startWork(j)}>
                              Start work
                            </button>
                          )}
                          {j.status === "working" && !promptOpen && (
                            <>
                              <button className="btn primary gv-act" onClick={() => markReady(j)}>
                                Mark ready
                              </button>
                              <button
                                className="btn gv-act"
                                onClick={() => {
                                  setPartPromptFor(j.jobNumber);
                                  setPartText("");
                                }}
                              >
                                Waiting for parts…
                              </button>
                            </>
                          )}
                          {j.status === "working" && promptOpen && (
                            <form
                              className="gv-part-prompt"
                              onSubmit={(e) => {
                                e.preventDefault();
                                markWaitingParts(j, partText);
                              }}
                            >
                              <input
                                value={partText}
                                onChange={(e) => setPartText(e.target.value)}
                                placeholder="Which part is it waiting for?"
                                aria-label="Which part is this job waiting for?"
                                autoFocus
                              />
                              <div className="gv-part-prompt-actions">
                                <button
                                  type="submit"
                                  className="btn primary gv-act"
                                  disabled={partText.trim() === ""}
                                >
                                  Mark waiting
                                </button>
                                <button
                                  type="button"
                                  className="btn gv-act"
                                  onClick={() => setPartPromptFor(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            </form>
                          )}
                          {j.status === "waiting_parts" && (
                            <button className="btn primary gv-act" onClick={() => resumeWork(j)}>
                              Part arrived — resume work
                            </button>
                          )}
                          {j.status === "ready" && (
                            <button
                              className="btn primary gv-act"
                              onClick={() => setDeliverFor(j.jobNumber)}
                              aria-haspopup="dialog"
                            >
                              Mark delivered
                            </button>
                          )}
                        </div>
                      )}

                      {closed && (
                        <div className="gv-job-closed">
                          <LockGlyph />
                          Job card closed on this screen
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Stock + parts rail (right) ───────────────────────────────── */}
          <aside className="gv-rail" aria-label="Cars on the books and parts running low">
            <section className="card gv-rail-card" aria-label="Cars on the books">
              <div className="gv-rail-head">
                <span className="gv-rail-icon">
                  <BoxGlyph />
                </span>
                <h2 className="h2">Cars on the books</h2>
              </div>
              <input
                type="search"
                className="gv-search gv-rail-search"
                placeholder="Find a vehicle — try “Dream”…"
                aria-label="Find a vehicle by model"
                value={vehicleQuery}
                onChange={(e) => setVehicleQuery(e.target.value)}
              />
              {visibleStock.length === 0 ? (
                <p className="cap gv-stock-none">
                  None in stock that match &ldquo;{vehicleQuery.trim()}&rdquo; — ask the
                  team in the{" "}
                  <Link className="gv-sub-link" href="/chat">
                    chat
                  </Link>
                  .
                </p>
              ) : (
                <ul className="gv-stock-list">
                  {visibleStock.map((m) => (
                    <li className="gv-stock-row" key={m.model}>
                      <div className="gv-stock-main">
                        <span className="gv-stock-model">{m.model}</span>
                        <span className="cap gv-stock-note">{m.note}</span>
                      </div>
                      <span className="gv-stock-count">{m.count}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="gv-foot gv-rail-foot">
                Counts cover every car on the books — sold and delivered included.
              </p>
            </section>

            <section className="card gv-rail-card" aria-label="Parts running low">
              <div className="gv-rail-head">
                <span className="gv-rail-icon" data-urgent={kpis.lowParts > 0}>
                  <BoxGlyph />
                </span>
                <h2 className="h2">Parts running low</h2>
              </div>
              <ul className="gv-parts-list">
                {board.lowParts.map((p) => {
                  const below = p.inStock < p.minLevel;
                  return (
                    <li className="gv-part-row" key={p.partNumber} data-urgent={below || undefined}>
                      <div className="gv-part-main">
                        <span className="gv-part-name">{p.name}</span>
                        <span className="gv-part-no">{p.partNumber}</span>
                      </div>
                      <span className="gv-part-qty" data-out={p.inStock === 0 || undefined}>
                        {p.inStock === 0 ? "Out" : p.inStock}
                        <span className="gv-part-min"> / min {p.minLevel}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="gv-foot gv-rail-foot">
                Ordering happens with the parts team — this list just keeps it visible.
              </p>
            </section>
          </aside>
        </div>

        {/* Mark-delivered confirm — native <dialog> for focus trap + Esc. */}
        <dialog
          ref={dlgRef}
          className="gv-dlg"
          aria-label="Mark delivered"
          onClose={() => setDeliverFor(null)}
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeliverFor(null);
          }}
        >
          {(() => {
            const job = deliverFor
              ? shownJobs.find((s) => s.jobNumber === deliverFor) ?? null
              : null;
            if (!job) return null;
            return (
              <div className="gv-dlg-body">
                <h2 className="h2">Mark delivered?</h2>
                <p className="cap gv-dlg-sub">
                  {job.jobNumber} · {job.clientName} · {job.carLabel}
                </p>
                <p className="gv-dlg-text">
                  This closes the job card on this screen — it locks and can&apos;t be
                  reopened here.
                </p>
                <div className="gv-dlg-actions">
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => confirmDelivered(job.jobNumber)}
                  >
                    Mark delivered
                  </button>
                  <button type="button" className="btn" onClick={() => setDeliverFor(null)}>
                    Cancel
                  </button>
                </div>
                <p className="cap gv-dlg-cap">
                  In the live system this closes the job card in the Monza CRM.
                </p>
              </div>
            );
          })()}
        </dialog>
      </div>
    </div>
  );
}
