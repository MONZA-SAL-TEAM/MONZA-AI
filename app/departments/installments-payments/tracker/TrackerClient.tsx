"use client";

/**
 * The Payment tracker — one card per payment plan for the month.
 *
 * Server API this client speaks (lib/tracker/contract.ts, exactly):
 *   GET /api/tracker → { demo: true,  month: TrackerMonth }        — example data
 *                    | { demo: false, month: null, notReady: "…" } — honest not-wired state
 *                    | 401                                          — link to /login
 *
 * Honesty rules baked in:
 *   - The demo month is a fixed dataset ("August 2026"); nothing reads the
 *     real clock, so server and client can never disagree at first paint.
 *   - Ticking "Paid" only updates this screen and shows the message that
 *     WOULD go to the client. Nothing is ever sent by the app: every send
 *     button is a wa.me link that opens WhatsApp with the text prefilled and
 *     a person taps send.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { TrackedPlan, TrackerMonth } from "@/lib/tracker/contract";
import { reminderMessage, thankYouMessage, waLink } from "@/lib/tracker/contract";

/* ------------------------------------------------------------- constants --- */

const DEMO_NOTE = "Example data — not connected to the Monza systems yet.";
const LOGIN_HREF =
  "/login?next=" + encodeURIComponent("/departments/installments-payments/tracker");

/* ------------------------------------------------- defensive api parsing --- */

function asPlan(v: unknown): TrackedPlan | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Partial<TrackedPlan>;
  const tm = p.thisMonth as Partial<TrackedPlan["thisMonth"]> | undefined;
  if (
    typeof p.planId !== "string" ||
    typeof p.clientName !== "string" ||
    typeof p.clientPhone !== "string" ||
    typeof p.vin !== "string" ||
    typeof p.carLabel !== "string" ||
    typeof p.paidCount !== "number" ||
    typeof p.totalCount !== "number" ||
    !tm ||
    typeof tm.installmentNumber !== "number" ||
    typeof tm.dueDate !== "string" ||
    typeof tm.amountUsd !== "number" ||
    (tm.status !== "paid" && tm.status !== "due" && tm.status !== "overdue")
  ) {
    return null;
  }
  return v as TrackedPlan;
}

function asMonth(v: unknown): TrackerMonth | null {
  if (!v || typeof v !== "object") return null;
  const m = v as Partial<TrackerMonth>;
  if (typeof m.monthLabel !== "string" || !Array.isArray(m.plans)) return null;
  const plans = m.plans.map(asPlan).filter((p): p is TrackedPlan => p !== null);
  return { monthLabel: m.monthLabel, plans };
}

/** Overdue first, then due, then paid; earlier due-day first within a group. */
const STATUS_RANK: Record<TrackedPlan["thisMonth"]["status"], number> = {
  overdue: 0,
  due: 1,
  paid: 2,
};

function sortPlans(plans: TrackedPlan[]): TrackedPlan[] {
  return [...plans].sort((a, b) => {
    const rank = STATUS_RANK[a.thisMonth.status] - STATUS_RANK[b.thisMonth.status];
    if (rank !== 0) return rank;
    const day = (a.dueDay ?? 0) - (b.dueDay ?? 0);
    if (day !== 0) return day;
    return a.clientName.localeCompare(b.clientName);
  });
}

/** "$1,550" — no locale calls, so it renders the same everywhere. */
function usd(n: number): string {
  return "$" + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/* --------------------------------------------------------- small pieces --- */

function StatusTag({ status }: { status: TrackedPlan["thisMonth"]["status"] }) {
  if (status === "paid") {
    return (
      <span className="tag live">
        <span className="dot" />
        Paid
      </span>
    );
  }
  if (status === "overdue") {
    return (
      <span className="tag urgent">
        <span className="dot" />
        Overdue
      </span>
    );
  }
  return <span className="tag">Due</span>;
}

function BackGlyph() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

/* --------------------------------------------------------------- the ui --- */

type Screen = "loading" | "login" | "error" | "notReady" | "ready";

export default function TrackerClient() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [demo, setDemo] = useState(false);
  const [month, setMonth] = useState<TrackerMonth | null>(null);
  const [notReady, setNotReady] = useState(
    "The tracker reads live plans once the connection work is finished."
  );
  /** Plans ticked "Paid" in this session — screen-only, resets on refresh. */
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setScreen("loading");
    try {
      const res = await fetch("/api/tracker");
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
        month?: unknown;
        notReady?: unknown;
      };
      const parsed = asMonth(d.month);
      if (parsed) {
        setDemo(d.demo === true);
        // Sort once here so the order is stable for the whole session — a card
        // ticked "Paid" keeps its place instead of jumping away from under the
        // person's thumb (the status tag and totals still update).
        setMonth({ ...parsed, plans: sortPlans(parsed.plans) });
        setTicked({});
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

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const toggle = useCallback((planId: string) => {
    setTicked((prev) => ({ ...prev, [planId]: !prev[planId] }));
  }, []);

  const copyMessage = useCallback(async (planId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(planId);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedId(null), 1600);
    } catch {
      /* clipboard unavailable — the text is on screen to select by hand */
    }
  }, []);

  /** A plan with this session's tick applied: status paid, one more counted. */
  const withTick = useCallback(
    (p: TrackedPlan): TrackedPlan => {
      if (p.thisMonth.status === "paid" || !ticked[p.planId]) return p;
      return {
        ...p,
        paidCount: p.paidCount + 1,
        thisMonth: { ...p.thisMonth, status: "paid" },
      };
    },
    [ticked]
  );

  const shownPlans = useMemo(
    () => (month ? month.plans.map(withTick) : []),
    [month, withTick]
  );

  const totals = useMemo(() => {
    let expected = 0;
    let paid = 0;
    let overdue = 0;
    for (const p of shownPlans) {
      expected += p.thisMonth.amountUsd;
      if (p.thisMonth.status === "paid") paid += 1;
      if (p.thisMonth.status === "overdue") overdue += 1;
    }
    return { count: shownPlans.length, expected, paid, overdue };
  }, [shownPlans]);

  /* ----- the four simple screens ----- */

  if (screen === "login") {
    return (
      <div className="empty" style={{ flex: 1 }}>
        <p className="h2">Please sign in</p>
        <p className="cap">You need to be signed in to see the payment tracker.</p>
        <a className="btn primary" href={LOGIN_HREF}>
          Go to sign in
        </a>
      </div>
    );
  }

  if (screen === "loading") {
    return (
      <div className="empty" style={{ flex: 1 }} aria-live="polite">
        <p className="cap">Loading the month…</p>
      </div>
    );
  }

  if (screen === "error") {
    return (
      <div className="dept-page">
        <div className="dept-wrap">
          <div className="note urgent">Couldn&apos;t load the payment tracker.</div>
          <button className="btn" onClick={load} style={{ alignSelf: "flex-start" }}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (screen === "notReady" || !month) {
    return (
      <div className="dept-page">
        <div className="dept-wrap">
          <Link className="dept-back" href="/departments/installments-payments">
            <BackGlyph />
            Installments &amp; Payments
          </Link>
          <header className="trk-head">
            <h1 className="h1">Payment tracker</h1>
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

  /* ----- the tracker itself ----- */

  return (
    <div className="dept-page">
      <div className="dept-wrap">
        <Link className="dept-back" href="/departments/installments-payments">
          <BackGlyph />
          Installments &amp; Payments
        </Link>

        <header className="trk-head">
          <div className="trk-title-row">
            <h1 className="h1">Payment tracker</h1>
            <span className="tag">{month.monthLabel}</span>
          </div>
          <p className="cap trk-totals" aria-live="polite">
            <strong>{totals.count}</strong> plans · <strong>{usd(totals.expected)}</strong>{" "}
            expected this month · <strong>{totals.paid}</strong> paid ·{" "}
            <strong>{totals.overdue}</strong> overdue
          </p>
        </header>

        {demo && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="note">{DEMO_NOTE}</div>
            <p className="trk-foot">
              Showing the 8 plans with a payment this month; 11 plans are active in total. Ticking Paid here only updates this example — refreshing the page resets it.
            </p>
          </div>
        )}

        <div className="trk-list">
          {shownPlans.map((p) => {
            const base = month.plans.find((b) => b.planId === p.planId) ?? p;
            const alreadyPaid = base.thisMonth.status === "paid";
            const tickedNow = !alreadyPaid && p.thisMonth.status === "paid";
            const pct =
              p.totalCount > 0
                ? Math.max(0, Math.min(100, Math.round((p.paidCount / p.totalCount) * 100)))
                : 0;
            const thanks = tickedNow ? thankYouMessage(p) : null;

            return (
              <article className="card trk-card" key={p.planId} aria-label={p.clientName}>
                <div className="row-between" style={{ alignItems: "flex-start" }}>
                  <div className="grow">
                    <p className="trk-name">{p.clientName}</p>
                    <p className="cap trk-car">
                      {p.carLabel} · <span className="trk-vin">{p.vin}</span>
                    </p>
                  </div>
                  <StatusTag status={p.thisMonth.status} />
                </div>

                <div className="trk-progress">
                  <span className="cap">
                    {p.paidCount} of {p.totalCount} payments paid
                  </span>
                  <div className="trk-bar" aria-hidden>
                    <div className="trk-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>

                <div className="trk-due-row">
                  <span className="trk-due">Due {p.thisMonth.dueDate}</span>
                  <span className="trk-amount">{usd(p.thisMonth.amountUsd)}</span>
                </div>

                <div className="trk-actions">
                  <label
                    className="trk-paidbox"
                    data-locked={alreadyPaid}
                    title={
                      alreadyPaid
                        ? "Already recorded as paid in the example data."
                        : undefined
                    }
                  >
                    <input
                      type="checkbox"
                      checked={alreadyPaid || tickedNow}
                      disabled={alreadyPaid}
                      onChange={() => toggle(p.planId)}
                      aria-label={`Mark ${p.clientName} as paid for ${month.monthLabel}`}
                    />
                    Paid
                  </label>
                  {p.thisMonth.status !== "paid" && (
                    <a
                      className="btn"
                      href={waLink(base, reminderMessage(base))}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Send reminder on WhatsApp
                    </a>
                  )}
                </div>

                {thanks && (
                  <div className="trk-msg">
                    <span className="eyebrow">Message ready to send</span>
                    <p className="trk-msg-text">{thanks}</p>
                    <div className="trk-msg-actions">
                      <a
                        className="btn primary"
                        href={waLink(p, thanks)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Send on WhatsApp
                      </a>
                      <button className="btn" onClick={() => copyMessage(p.planId, thanks)}>
                        {copiedId === p.planId ? "Copied" : "Copy message"}
                      </button>
                    </div>
                    <p className="cap trk-msg-cap">
                      In the live system this records the payment in the CRM and prepares
                      this message automatically.
                    </p>
                  </div>
                )}
              </article>
            );
          })}
        </div>

        <p className="trk-foot">
          Send buttons open WhatsApp with the message ready — you review it and tap send
          yourself. Fully automatic sending arrives when the WhatsApp Business API is
          connected.
        </p>
      </div>
    </div>
  );
}
