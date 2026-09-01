"use client";

/**
 * Installments & Payments — the department page IS the payment tracker.
 *
 * Server API this client speaks (lib/tracker/contract.ts, exactly):
 *   GET /api/tracker → { demo: true,  month: TrackerMonth }        — example data
 *                    | { demo: false, month: null, notReady: "…" } — honest not-wired state
 *                    | 401                                          — link to /login
 *
 * Honesty rules baked in:
 *   - The demo month is a fixed dataset ("August 2026"); nothing reads the
 *     real clock, so server and client can never disagree at first paint.
 *   - Clicking "Paid" opens the Record-a-payment dialog (1 month, 2, 3, a
 *     custom amount, or everything remaining). A CONFIRMED recording only
 *     updates this screen and shows the message that WOULD go to the client —
 *     and it is final here: the card locks into a "Recorded" state that can
 *     only record MORE, never undo. Nothing is ever sent by the app: every
 *     send button is a wa.me link that opens WhatsApp with the text prefilled
 *     and a person taps send.
 *   - "Add customer" adds a card on this screen only — in-memory, reset on
 *     refresh — and says so. In the live system it would create the plan in
 *     the Monza CRM.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import Link from "next/link";
import type { PaymentRecord, TrackedPlan, TrackerMonth } from "@/lib/tracker/contract";
import {
  paidAmountUsd,
  paymentReceivedMessage,
  reminderMessage,
  totalAmountUsd,
  waLink,
} from "@/lib/tracker/contract";

/* ------------------------------------------------------------- constants --- */

const DEMO_NOTE = "Example data — not connected to the Monza systems yet.";
const LOGIN_HREF =
  "/login?next=" + encodeURIComponent("/departments/installments-payments");

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
    typeof p.monthlyAmountUsd !== "number" ||
    typeof p.paidCount !== "number" ||
    typeof p.totalCount !== "number" ||
    (p.paidUsd !== undefined && typeof p.paidUsd !== "number") ||
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

/** "$1,550" (or "$1,550.30" when cents matter) — no locale calls. */
function usd(n: number): string {
  const cents = Math.round(n * 100);
  const whole = Math.trunc(cents / 100);
  const frac = Math.abs(cents % 100);
  const grouped = String(Math.abs(whole)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = cents < 0 ? "-" : "";
  return frac === 0
    ? `${sign}$${grouped}`
    : `${sign}$${grouped}.${String(frac).padStart(2, "0")}`;
}

/** "August 2026" + 5 → "August 5, 2026". Falls back to plain words. */
function dueDateInMonth(monthLabel: string, day: number): string {
  const parts = monthLabel.trim().split(/\s+/);
  if (parts.length === 2) return `${parts[0]} ${day}, ${parts[1]}`;
  return `day ${day} of ${monthLabel}`;
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

/** Same calendar drawing as the department card, so the pages match. */
function DeptGlyph() {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      aria-hidden
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/** A generic chat bubble — stands for "message on WhatsApp", not the logo. */
function ChatGlyph() {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.3 8.7 8.7 0 0 1-3.9-.92L3 20l1.18-5.27A8.13 8.13 0 0 1 3.5 11.5 8.38 8.38 0 0 1 12 3.2a8.38 8.38 0 0 1 9 8.3z" />
    </svg>
  );
}

/** A small padlock — marks a recording as final on this screen. */
function LockGlyph() {
  return (
    <svg
      width={13}
      height={13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

/* -------------------------------------------------- record-payment maths --- */

/** "Rami Kanaan" → "Rami" — for the dialog's live summary line. */
function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** What's still owed on the plan in dollars — never below zero. */
function remainingUsdOf(p: TrackedPlan): number {
  return Math.max(0, totalAmountUsd(p) - paidAmountUsd(p));
}

/** Installments still unpaid on the plan — never below zero. */
function remainingCountOf(p: TrackedPlan): number {
  return Math.max(0, p.totalCount - p.paidCount);
}

/** How many installments cumulative dollars fully cover (cents-guarded).
 *  ALL payment math derives from this — never from per-recording floors —
 *  so banked partial amounts tip into a paid installment the moment the
 *  cumulative money reaches it. */
function coveredCountOf(paidUsd: number, monthly: number, total: number): number {
  return Math.min(total, Math.floor((paidUsd + 0.005) / monthly));
}

/** Dollars already banked toward the NEXT installment (e.g. a half-payment). */
function bankedUsdOf(p: TrackedPlan): number {
  return Math.max(
    0,
    Math.round((paidAmountUsd(p) - p.paidCount * p.monthlyAmountUsd) * 100) / 100
  );
}

interface PayOption {
  key: string;
  months: number;
  amountUsd: number;
  title: string;
  detail: string;
}

/**
 * The preset rows of the Record-a-payment dialog for a plan as it stands NOW
 * (prior same-session recordings included): 1–3 months (only as many as are
 * left) and "Everything remaining". Payments always land on the OLDEST unpaid
 * installment first, so "1 month" for Rami (5 of 20 paid) is installment #6.
 */
function payOptions(p: TrackedPlan): PayOption[] {
  const count = remainingCountOf(p);
  const first = p.paidCount + 1;
  const banked = bankedUsdOf(p);
  // Money already banked toward the next installment makes it cheaper to
  // finish — the option prices what is actually owed, not a flat month.
  const nextCost = Math.round((p.monthlyAmountUsd - banked) * 100) / 100;
  const opts: PayOption[] = [];
  for (let n = 1; n <= Math.min(3, count); n++) {
    opts.push({
      key: `m${n}`,
      months: n,
      amountUsd: Math.round((nextCost + (n - 1) * p.monthlyAmountUsd) * 100) / 100,
      title: n === 1 ? "1 month" : `${n} months`,
      detail:
        n === 1
          ? banked > 0
            ? `Finish installment #${first}`
            : `Installment #${first}`
          : `Installments #${first}–#${first + n - 1}`,
    });
  }
  if (count > 0) {
    opts.push({
      key: "all",
      months: count,
      amountUsd: remainingUsdOf(p),
      title: "Everything remaining",
      detail: count === 1 ? "1 payment" : `${count} payments`,
    });
  }
  return opts;
}

interface PendingPayment {
  months: number;
  amountUsd: number;
  /** Shown when the typed amount had to be clamped to the remaining balance. */
  note: string | null;
}

/**
 * Turn the custom-amount text into a recording: whole months covered =
 * floor(amount / monthly); the exact dollars are kept as typed (a remainder
 * stays banked toward the next installment). Amounts above the remaining
 * balance auto-clamp with a note; anything not a positive number is invalid.
 */
function resolveCustom(p: TrackedPlan, text: string): PendingPayment | null {
  const raw = Number(text);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const remUsd = remainingUsdOf(p);
  const remCount = remainingCountOf(p);
  let amount = Math.round(raw * 100) / 100;
  let note: string | null = null;
  if (amount >= remUsd) {
    if (amount > remUsd) note = `Capped at the remaining balance — ${usd(remUsd)}.`;
    // Clearing the balance clears every remaining installment.
    return { months: remCount, amountUsd: remUsd, note };
  }
  // Months newly covered = cumulative coverage after the money lands, minus
  // what was covered before — so banked halves add up across recordings.
  const covered = coveredCountOf(
    paidAmountUsd(p) + amount,
    p.monthlyAmountUsd,
    p.totalCount
  );
  const months = Math.min(remCount, Math.max(0, covered - p.paidCount));
  return { months, amountUsd: amount, note };
}

/* ----------------------------------------------------- add-customer form --- */

interface AddFormState {
  name: string;
  car: string;
  vin: string;
  phone: string;
  monthly: string;
  total: string;
  already: string;
  dueDay: string;
}

const EMPTY_FORM: AddFormState = {
  name: "",
  car: "",
  vin: "",
  phone: "",
  monthly: "",
  total: "",
  already: "0",
  dueDay: "5",
};

/* --------------------------------------------------------------- the ui --- */

type Screen = "loading" | "login" | "error" | "notReady" | "ready";

export default function TrackerClient() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [demo, setDemo] = useState(false);
  const [month, setMonth] = useState<TrackerMonth | null>(null);
  const [notReady, setNotReady] = useState(
    "The tracker reads live plans once the connection work is finished."
  );
  /**
   * Confirmed recordings this session — cumulative months + exact dollars per
   * plan. Screen-only, resets on refresh; a recording is FINAL here (no undo).
   */
  const [recorded, setRecorded] = useState<
    Record<string, { months: number; amountUsd: number }>
  >({});
  /** The latest confirmed recording per plan — drives the thank-you panel. */
  const [lastRecord, setLastRecord] = useState<Record<string, PaymentRecord>>({});
  /** Which plan the Record-a-payment dialog is open for, if any. */
  const [dlgPlanId, setDlgPlanId] = useState<string | null>(null);
  /** Search over client name, car and VIN — display filter only. */
  const [query, setQuery] = useState("");
  const [dlgChoice, setDlgChoice] = useState("m1");
  const [dlgCustom, setDlgCustom] = useState("");
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  /** Customers added in this session — screen-only, resets on refresh. */
  const [added, setAdded] = useState<TrackedPlan[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<AddFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A plain counter for added-plan ids — deterministic, no Date, no random. */
  const addSeq = useRef(1);

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
        // person's thumb (the status pill and totals still update).
        setMonth({ ...parsed, plans: sortPlans(parsed.plans) });
        setRecorded({});
        setLastRecord({});
        setDlgPlanId(null);
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

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const openDialog = useCallback((planId: string) => {
    setDlgChoice("m1");
    setDlgCustom("");
    setDlgPlanId(planId);
  }, []);

  const closeDialog = useCallback(() => setDlgPlanId(null), []);

  /**
   * Confirm the dialog's pending recording against the plan AS SHOWN (prior
   * same-session recordings included). Once stored it is final on this
   * screen — the card locks and the dialog can only ever record MORE.
   */
  const confirmPayment = useCallback(
    (plan: TrackedPlan, pending: PendingPayment) => {
      if (pending.amountUsd <= 0) return;
      const newPaidUsd = paidAmountUsd(plan) + pending.amountUsd;
      const newPaidCount = coveredCountOf(
        newPaidUsd,
        plan.monthlyAmountUsd,
        plan.totalCount
      );
      const complete =
        newPaidCount >= plan.totalCount ||
        newPaidUsd >= totalAmountUsd(plan) - 0.005;
      const rec: PaymentRecord = {
        monthsRecorded: Math.max(0, newPaidCount - plan.paidCount),
        amountUsd: pending.amountUsd,
        newPaidCount,
        complete,
        bankedUsd: complete
          ? 0
          : Math.max(
              0,
              Math.round((newPaidUsd - newPaidCount * plan.monthlyAmountUsd) * 100) / 100
            ),
      };
      setRecorded((prev) => {
        const cur = prev[plan.planId] ?? { months: 0, amountUsd: 0 };
        return {
          ...prev,
          [plan.planId]: {
            months: cur.months + rec.monthsRecorded,
            amountUsd: cur.amountUsd + pending.amountUsd,
          },
        };
      });
      setLastRecord((prev) => ({ ...prev, [plan.planId]: rec }));
      setDlgPlanId(null);
    },
    []
  );

  // Drive the native <dialog>: showModal gives focus trapping + Esc for free.
  // The guard covers engines where showModal throws (already-open, old WebKit).
  useEffect(() => {
    const d = dlgRef.current;
    if (!d) return;
    if (dlgPlanId !== null) {
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
    if (dlgPlanId === null) return;
    // The non-modal fallback gets no free Esc handling — cover it ourselves.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDlgPlanId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dlgPlanId]);

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

  /**
   * A plan with this session's confirmed recordings applied: payments land on
   * the OLDEST unpaid installment first, so paidCount grows by the recorded
   * months (clamped to the total) and paidUsd grows by the exact dollars.
   * This month reads "paid" only once the running count reaches THIS month's
   * installment number.
   */
  const withRecording = useCallback(
    (p: TrackedPlan): TrackedPlan => {
      const rec = recorded[p.planId];
      if (!rec) return p;
      const newPaidUsd = paidAmountUsd(p) + rec.amountUsd;
      const newPaidCount = coveredCountOf(
        newPaidUsd,
        p.monthlyAmountUsd,
        p.totalCount
      );
      return {
        ...p,
        paidCount: newPaidCount,
        paidUsd: newPaidUsd,
        thisMonth: {
          ...p.thisMonth,
          status:
            newPaidCount >= p.thisMonth.installmentNumber
              ? "paid"
              : p.thisMonth.status,
        },
      };
    },
    [recorded]
  );

  /** Your added customers first (newest on top), then the sorted month. */
  const basePlans = useMemo(
    () => [...added, ...(month ? month.plans : [])],
    [added, month]
  );

  const shownPlans = useMemo(
    () => basePlans.map(withRecording),
    [basePlans, withRecording]
  );

  /** Cards matching the search box; KPIs stay whole-month on purpose. */
  const visiblePlans = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shownPlans;
    return shownPlans.filter(
      (p) =>
        p.clientName.toLowerCase().includes(q) ||
        p.carLabel.toLowerCase().includes(q) ||
        p.vin.toLowerCase().includes(q)
    );
  }, [shownPlans, query]);

  const totals = useMemo(() => {
    let expected = 0;
    let collected = 0;
    let overdue = 0;
    for (const p of shownPlans) {
      expected += p.thisMonth.amountUsd;
      // Collected counts only THIS month's slice — money recorded for earlier
      // months shows in the card's progress bar, not in this tile.
      if (p.thisMonth.status === "paid") collected += p.thisMonth.amountUsd;
      if (p.thisMonth.status === "overdue") overdue += 1;
    }
    return { count: shownPlans.length, expected, collected, overdue };
  }, [shownPlans]);

  /* ----- add-customer form ----- */

  const setField = useCallback(
    (key: keyof AddFormState) =>
      (e: ChangeEvent<HTMLInputElement>) => {
        const value =
          key === "phone" ? e.target.value.replace(/\D/g, "") : e.target.value;
        setForm((f) => ({ ...f, [key]: value }));
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
      const phone = form.phone.replace(/\D/g, "");
      const monthly = Number(form.monthly);
      const total = Number(form.total);
      const already = Number(form.already === "" ? "0" : form.already);
      const dueDay = Number(form.dueDay === "" ? "5" : form.dueDay);

      if (!name) return setFormError("Please enter the customer's name.");
      if (!car) return setFormError("Please enter the car name.");
      if (!Number.isFinite(monthly) || monthly <= 0)
        return setFormError("Monthly payment must be a positive amount in USD.");
      if (!Number.isFinite(total) || !Number.isInteger(total) || total < 1)
        return setFormError("Total payments must be a whole number of 1 or more.");
      if (!Number.isFinite(already) || already < 0)
        return setFormError("Already paid must be zero or a positive amount.");
      if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)
        return setFormError("Due day must be between 1 and 31.");

      const paidCount = Math.min(total, Math.max(0, Math.floor(already / monthly)));
      const complete = paidCount >= total;
      const installmentNumber = Math.min(paidCount + 1, total);
      const monthLabel = month ? month.monthLabel : "";
      const plan: TrackedPlan = {
        planId: `ADD-${addSeq.current++}`,
        clientName: name,
        clientPhone: phone,
        vin,
        carLabel: car,
        monthlyAmountUsd: monthly,
        paidCount,
        totalCount: total,
        dueDay,
        paidUsd: already,
        thisMonth: {
          installmentNumber,
          dueDate: monthLabel ? dueDateInMonth(monthLabel, dueDay) : `day ${dueDay}`,
          // A finished plan owes nothing this month — a zero here keeps the
          // Expected/Collected tiles honest.
          amountUsd: complete ? 0 : monthly,
          status: complete ? "paid" : "due",
        },
      };
      setAdded((prev) => [plan, ...prev]);
      setForm(EMPTY_FORM);
      setFormError(null);
      setAddOpen(false);
    },
    [form, month]
  );

  /* ----- the four simple screens ----- */

  if (screen === "login") {
    return (
      <div className="trk-page">
        <div className="trk-empty">
          <p className="h2">Please sign in</p>
          <p className="cap">
            You need to be signed in to see Installments &amp; Payments.
          </p>
          <a className="btn primary" href={LOGIN_HREF}>
            Go to sign in
          </a>
        </div>
      </div>
    );
  }

  if (screen === "loading") {
    return (
      <div className="trk-page">
        <div className="trk-empty" aria-live="polite">
          <p className="cap">Loading the month…</p>
        </div>
      </div>
    );
  }

  if (screen === "error") {
    return (
      <div className="trk-page">
        <div className="trk-wrap">
          <div className="note urgent">Couldn&apos;t load Installments &amp; Payments.</div>
          <button className="btn" onClick={load} style={{ alignSelf: "flex-start" }}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (screen === "notReady" || !month) {
    return (
      <div className="trk-page">
        <div className="trk-wrap">
          <Link className="dept-back" href="/chat">
            <BackGlyph />
            Back to chat
          </Link>
          <header className="trk-head">
            <div className="trk-head-main">
              <span className="trk-icon">
                <DeptGlyph />
              </span>
              <div>
                <h1 className="h1">Installments &amp; Payments</h1>
                <p className="cap trk-sub">
                  Monthly installments per client — due dates, amounts, and progress.
                </p>
              </div>
            </div>
          </header>
          <div className="aurora" aria-hidden="true" />
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
    <div className="trk-page">
      <div className="trk-wrap">
        <Link className="dept-back" href="/chat">
          <BackGlyph />
          Back to chat
        </Link>

        <header className="trk-head">
          <div className="trk-head-main">
            <span className="trk-icon">
              <DeptGlyph />
            </span>
            <div className="grow">
              <div className="trk-title-row">
                <h1 className="h1">Installments &amp; Payments</h1>
                <span className="tag">{month.monthLabel}</span>
              </div>
              <p className="cap trk-sub">
                Prefer to ask?{" "}
                <Link className="trk-sub-link" href="/chat">
                  Open the chat
                </Link>
              </p>
            </div>
          </div>
          <button
            className="btn primary trk-add-btn"
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

        <div className="aurora" aria-hidden="true" />

        {demo && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="note">{DEMO_NOTE}</div>
            <p className="trk-foot">
              Plans with no payment due this month aren&apos;t shown here. Recording
              a payment or adding a customer only updates this example — refreshing
              the page resets it.
            </p>
          </div>
        )}

        {addOpen && (
          <section className="card trk-add" aria-label="Add a customer">
            <div className="trk-add-head">
              <h2 className="h2">Add a customer</h2>
              <button className="btn quiet" onClick={closeAdd}>
                Close
              </button>
            </div>
            <form className="trk-form" onSubmit={submitAdd} noValidate>
              <label className="trk-field">
                <span className="trk-label">Customer name *</span>
                <input
                  value={form.name}
                  onChange={setField("name")}
                  placeholder="e.g. Rami Kanaan"
                  autoFocus
                  required
                />
              </label>
              <label className="trk-field">
                <span className="trk-label">Car name *</span>
                <input
                  value={form.car}
                  onChange={setField("car")}
                  placeholder="e.g. Voyah Free 2025"
                  required
                />
              </label>
              <label className="trk-field">
                <span className="trk-label">VIN</span>
                <input
                  className="trk-vin-input"
                  value={form.vin}
                  onChange={setField("vin")}
                  placeholder="17 characters"
                  maxLength={17}
                  spellCheck={false}
                />
              </label>
              <label className="trk-field">
                <span className="trk-label">Phone (WhatsApp)</span>
                <input
                  value={form.phone}
                  onChange={setField("phone")}
                  placeholder="e.g. 9613123456"
                  inputMode="numeric"
                />
              </label>
              <label className="trk-field">
                <span className="trk-label">Monthly payment (USD) *</span>
                <input
                  value={form.monthly}
                  onChange={setField("monthly")}
                  placeholder="e.g. 1550"
                  inputMode="decimal"
                  required
                />
              </label>
              <label className="trk-field">
                <span className="trk-label">Total payments *</span>
                <input
                  value={form.total}
                  onChange={setField("total")}
                  placeholder="e.g. 12"
                  inputMode="numeric"
                  required
                />
              </label>
              <label className="trk-field">
                <span className="trk-label">Already paid (USD)</span>
                <input
                  value={form.already}
                  onChange={setField("already")}
                  inputMode="decimal"
                />
              </label>
              <label className="trk-field">
                <span className="trk-label">Due day (1–31)</span>
                <input
                  value={form.dueDay}
                  onChange={setField("dueDay")}
                  inputMode="numeric"
                />
              </label>
              {formError && (
                <p className="trk-form-err trk-span2" role="alert">
                  {formError}
                </p>
              )}
              <div className="trk-form-actions trk-span2">
                <button type="submit" className="btn primary">
                  Add customer
                </button>
                <button type="button" className="btn" onClick={closeAdd}>
                  Cancel
                </button>
              </div>
              <p className="cap trk-form-cap trk-span2">
                Added customers appear on this screen only and disappear on refresh. In
                the live system this creates the plan in the Monza CRM.
              </p>
            </form>
          </section>
        )}

        <div className="trk-kpis" aria-live="polite">
          <div className="trk-kpi trk-kpi--plans">
            <span className="trk-kpi-label">Plans</span>
            <span className="trk-kpi-value">{totals.count}</span>
          </div>
          <div className="trk-kpi">
            <span className="trk-kpi-label">Expected this month</span>
            <span className="trk-kpi-value">{usd(totals.expected)}</span>
          </div>
          <div className="trk-kpi">
            <span className="trk-kpi-label">Collected</span>
            <span className="trk-kpi-value">{usd(totals.collected)}</span>
          </div>
          <div className="trk-kpi" data-urgent={totals.overdue > 0}>
            <span className="trk-kpi-label">Overdue</span>
            <span className="trk-kpi-value">{totals.overdue}</span>
          </div>
        </div>

        {shownPlans.length > 0 && (
          <div className="trk-toolbar">
            <input
              type="search"
              className="trk-search"
              placeholder="Search client, car or VIN…"
              aria-label="Search plans by client name, car or VIN"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query.trim() !== "" && (
              <span className="cap trk-search-count">
                Showing {visiblePlans.length} of {shownPlans.length}
              </span>
            )}
          </div>
        )}

        {shownPlans.length === 0 ? (
          <div className="card trk-none">
            <p className="h2" style={{ margin: 0 }}>
              No plans this month
            </p>
            <p className="cap" style={{ margin: 0 }}>
              Use Add customer to put the first plan on the board.
            </p>
          </div>
        ) : visiblePlans.length === 0 ? (
          <div className="card trk-none">
            <p className="h2" style={{ margin: 0 }}>
              No clients match
            </p>
            <p className="cap" style={{ margin: 0 }}>
              Nothing matches &ldquo;{query.trim()}&rdquo; — try a shorter part of the
              name, car or VIN.
            </p>
          </div>
        ) : (
          <div className="trk-grid">
            {visiblePlans.map((p) => {
              const base = basePlans.find((b) => b.planId === p.planId) ?? p;
              const isAdded = added.some((a) => a.planId === p.planId);
              // Paid before this month view (demo data / a complete added
              // plan): locked look, no dialog — stays exactly as it is today.
              const alreadyPaid = base.thisMonth.status === "paid";
              const rec = recorded[p.planId];
              const record = lastRecord[p.planId];
              const planComplete = p.paidCount >= p.totalCount;
              const paidMoney = paidAmountUsd(p);
              const totalMoney = totalAmountUsd(p);
              const pct =
                totalMoney > 0
                  ? Math.max(0, Math.min(100, Math.round((paidMoney / totalMoney) * 100)))
                  : 0;
              const hasPhone = base.clientPhone.replace(/\D/g, "") !== "";
              const thanks = record ? paymentReceivedMessage(base, record) : null;
              const recSummary = rec
                ? `Recorded ${usd(rec.amountUsd)}` +
                  (rec.months > 0
                    ? ` · ${rec.months} payment${rec.months === 1 ? "" : "s"}`
                    : "")
                : null;

              return (
                <article className="card trk-card" key={p.planId} aria-label={p.clientName}>
                  <div className="trk-card-top">
                    <div className="grow">
                      <div className="trk-name-row">
                        <p className="trk-name">{p.clientName}</p>
                        {isAdded && <span className="tag">Added by you — example</span>}
                      </div>
                      <p className="cap trk-car">
                        {p.carLabel}
                        {p.vin !== "" && (
                          <>
                            {" · "}
                            <span className="trk-vin">{p.vin}</span>
                          </>
                        )}
                      </p>
                    </div>
                    <StatusTag status={p.thisMonth.status} />
                  </div>

                  <div className="trk-money">
                    <div className="trk-money-row">
                      <span className="trk-money-paid">
                        <strong>{usd(paidMoney)}</strong> paid of {usd(totalMoney)}
                      </span>
                      <span className="trk-money-count">
                        {p.paidCount} of {p.totalCount}
                      </span>
                    </div>
                    <div
                      className="trk-bar"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={pct}
                      aria-label={`${usd(paidMoney)} paid of ${usd(totalMoney)}`}
                    >
                      <div
                        className="trk-bar-fill"
                        data-urgent={p.thisMonth.status === "overdue"}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  <div className="trk-due-row">
                    {planComplete ||
                    (p.thisMonth.status === "paid" && p.thisMonth.amountUsd === 0) ? (
                      <span className="trk-due">Plan fully paid</span>
                    ) : (
                      <>
                        <span className="trk-due">Due {p.thisMonth.dueDate}</span>
                        <span className="trk-amount">{usd(p.thisMonth.amountUsd)}</span>
                      </>
                    )}
                  </div>

                  <div className="trk-actions">
                    {alreadyPaid ? (
                      <label
                        className="trk-paidbox"
                        data-locked="true"
                        title={
                          !isAdded
                            ? "Already recorded as paid in the example data."
                            : undefined
                        }
                      >
                        <input
                          type="checkbox"
                          checked
                          disabled
                          readOnly
                          aria-label={`${p.clientName} is already paid for ${month.monthLabel}`}
                        />
                        Paid
                      </label>
                    ) : rec ? (
                      planComplete ? (
                        <span className="trk-recorded" data-final="true">
                          <LockGlyph />
                          {recSummary}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="trk-recorded"
                          onClick={() => openDialog(p.planId)}
                          aria-haspopup="dialog"
                          title="Recorded — final on this screen. Click to record another payment."
                        >
                          <LockGlyph />
                          {recSummary}
                        </button>
                      )
                    ) : (
                      <label className="trk-paidbox">
                        <input
                          type="checkbox"
                          checked={false}
                          onChange={() => openDialog(p.planId)}
                          aria-haspopup="dialog"
                          aria-label={`Record a payment for ${p.clientName}`}
                        />
                        Paid
                      </label>
                    )}
                    {p.thisMonth.status !== "paid" &&
                      (hasPhone ? (
                        <a
                          className="btn trk-wa"
                          href={waLink(base, reminderMessage(base))}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ChatGlyph />
                          Send reminder on WhatsApp
                        </a>
                      ) : (
                        <span className="trk-hint">
                          Add a phone number later to send messages
                        </span>
                      ))}
                  </div>

                  {thanks && (
                    <div className="trk-msg">
                      <span className="eyebrow">Message ready to send</span>
                      <p className="trk-msg-text">{thanks}</p>
                      <div className="trk-msg-actions">
                        {hasPhone && (
                          <a
                            className="btn primary"
                            href={waLink(p, thanks)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Send on WhatsApp
                          </a>
                        )}
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
        )}

        <p className="trk-foot">
          Send buttons open WhatsApp with the message ready — you review it and tap send
          yourself. Fully automatic sending arrives when the WhatsApp Business API is
          connected.
        </p>

        {/* Record-a-payment dialog — native <dialog> for focus trap + Esc. */}
        <dialog
          ref={dlgRef}
          className="trk-dlg"
          aria-label="Record a payment"
          onClose={closeDialog}
          onClick={(e) => {
            // Backdrop click: the dialog element itself is the target only
            // when the click lands outside its content box.
            if (e.target === e.currentTarget) closeDialog();
          }}
        >
          {(() => {
            const plan = dlgPlanId
              ? shownPlans.find((s) => s.planId === dlgPlanId) ?? null
              : null;
            if (!plan) return null;
            const opts = payOptions(plan);
            const pending: PendingPayment | null =
              dlgChoice === "custom"
                ? resolveCustom(plan, dlgCustom)
                : (() => {
                    const o = opts.find((x) => x.key === dlgChoice);
                    return o
                      ? { months: o.months, amountUsd: o.amountUsd, note: null }
                      : null;
                  })();
            const totalUsd = totalAmountUsd(plan);
            const newPaidUsd = pending
              ? paidAmountUsd(plan) + pending.amountUsd
              : paidAmountUsd(plan);
            const newPaidCount = pending
              ? coveredCountOf(newPaidUsd, plan.monthlyAmountUsd, plan.totalCount)
              : plan.paidCount;
            // Banked toward the NEXT installment, cumulatively — includes any
            // half-payment that was already on the plan before this recording.
            const remainder = pending
              ? Math.max(
                  0,
                  Math.round(
                    (newPaidUsd - newPaidCount * plan.monthlyAmountUsd) * 100
                  ) / 100
                )
              : 0;
            const showRemainder =
              pending !== null && remainder >= 0.01 && newPaidCount < plan.totalCount;
            return (
              <div className="trk-dlg-body">
                <div className="trk-dlg-head">
                  <h2 className="h2">Record a payment</h2>
                  <p className="cap trk-dlg-sub">
                    {plan.clientName} · {plan.carLabel}
                  </p>
                </div>
                <div
                  className="trk-dlg-opts"
                  role="radiogroup"
                  aria-label="How much was paid"
                >
                  {opts.map((o) => (
                    <label
                      key={o.key}
                      className="trk-opt"
                      data-active={dlgChoice === o.key}
                    >
                      <input
                        type="radio"
                        name="trk-pay-choice"
                        checked={dlgChoice === o.key}
                        onChange={() => setDlgChoice(o.key)}
                      />
                      <span className="trk-opt-main">
                        <span className="trk-opt-title">{o.title}</span>
                        <span className="trk-opt-detail">{o.detail}</span>
                      </span>
                      <span className="trk-opt-money">{usd(o.amountUsd)}</span>
                    </label>
                  ))}
                  <label className="trk-opt" data-active={dlgChoice === "custom"}>
                    <input
                      type="radio"
                      name="trk-pay-choice"
                      checked={dlgChoice === "custom"}
                      onChange={() => setDlgChoice("custom")}
                    />
                    <span className="trk-opt-main">
                      <span className="trk-opt-title">Custom amount</span>
                      <span className="trk-opt-detail">USD received</span>
                    </span>
                    <span className="trk-opt-custom">
                      <span aria-hidden>$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={dlgCustom}
                        placeholder="0"
                        onChange={(e) =>
                          setDlgCustom(e.target.value.replace(/[^\d.]/g, ""))
                        }
                        onFocus={() => setDlgChoice("custom")}
                        aria-label="Custom amount in US dollars"
                      />
                    </span>
                  </label>
                </div>
                {pending?.note && <p className="trk-dlg-note">{pending.note}</p>}
                <p className="trk-dlg-sum" aria-live="polite">
                  {pending ? (
                    <>
                      After this, {firstNameOf(plan.clientName)} is {newPaidCount} of{" "}
                      {plan.totalCount} paid — {usd(newPaidUsd)} of {usd(totalUsd)}.
                      {showRemainder &&
                        ` Leaves ${usd(remainder)} toward installment #${
                          newPaidCount + 1
                        }.`}
                    </>
                  ) : (
                    <>Enter an amount to see where it lands.</>
                  )}
                </p>
                <div className="trk-dlg-actions">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={!pending || pending.amountUsd <= 0}
                    onClick={() => pending && confirmPayment(plan, pending)}
                  >
                    Confirm payment
                  </button>
                  <button type="button" className="btn" onClick={closeDialog}>
                    Cancel
                  </button>
                </div>
                <p className="cap trk-dlg-cap">
                  Once confirmed, this recording is final on this screen. In the live
                  system this records the payment in the Monza CRM.
                </p>
              </div>
            );
          })()}
        </dialog>
      </div>
    </div>
  );
}
