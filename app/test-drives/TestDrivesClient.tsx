"use client";

/**
 * The test-drive calendar the sales bot books into (Samer's workbook, C Decisions,
 * 2026-09-17): Monday–Friday 10:00–17:00, Saturday 10:00–14:00, 30 minutes each,
 * never two customers in one slot. Staff see what is booked and can cancel,
 * which frees the slot for the next customer.
 */

import { useCallback, useEffect, useState } from "react";
import "../board.css";

interface Booking {
  id: string;
  slotAt: string;
  label: string;
  threadId: string;
  cars: string[];
  customerName: string | null;
  customerPhone: string | null;
  status: "booked" | "cancelled";
}

export default function TestDrivesClient() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sales/test-drives", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; bookings?: Booking[]; message?: string } | null;
      if (!res.ok || !json?.ok) {
        setProblem(json?.message ?? "The calendar could not be read just now.");
        return;
      }
      setProblem(null);
      setBookings(json.bookings ?? []);
    } catch {
      setProblem("The calendar could not be read just now.");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const cancel = async (id: string) => {
    if (!window.confirm("Cancel this test drive? The time becomes free for other customers.")) return;
    setBusy(id);
    try {
      const res = await fetch("/api/sales/test-drives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "cancel" }),
      });
      if (res.ok) await load();
      else setProblem("That booking could not be cancelled — try again.");
    } finally {
      setBusy(null);
    }
  };

  const shown = (bookings ?? []).filter((b) => showCancelled || b.status === "booked");
  const days = new Map<string, Booking[]>();
  for (const b of shown) {
    const day = b.label.split(",")[0];
    days.set(day, [...(days.get(day) ?? []), b]);
  }

  return (
    <main className="board">
      <header className="board-head">
        <div className="eyebrow">Follow-up</div>
        <h1 className="h1">Test drives</h1>
        <p className="lede">Booked by the sales bot, 30 minutes each, never two customers at the same time.</p>
      </header>

      <p className="board-note">
        Test drives can be booked Monday to Friday, 10:00–17:00, and Saturday, 10:00–14:00 (Beirut time).
        Cancelling one frees its time for the next customer.
      </p>

      {problem && <p className="board-warn">{problem}</p>}

      <div className="board-tools">
        <button type="button" className="chip" aria-pressed={showCancelled} onClick={() => setShowCancelled((v) => !v)}>
          Show cancelled
        </button>
      </div>

      {bookings === null && !problem && <p className="board-empty">Loading the calendar…</p>}
      {bookings !== null && shown.length === 0 && <p className="board-empty">No test drives booked from today.</p>}

      {[...days.entries()].map(([day, list]) => (
        <section key={day} aria-label={day}>
          <h2 className="rowcard-name" style={{ margin: "18px 0 8px" }}>{day}</h2>
          <ul className="rows">
            {list.map((b) => (
              <li key={b.id} className="rowcard" style={b.status === "cancelled" ? { opacity: 0.55 } : undefined}>
                <div className="rowcard-top">
                  <div>
                    <p className="rowcard-name">
                      {b.label.split(", ")[1]} · {b.customerName ?? "No name given"}
                    </p>
                    <p className="rowcard-sub">
                      {b.cars.length > 0 ? b.cars.join(", ") : "No car chosen"}
                      {b.customerPhone && (
                        <>
                          {" · "}
                          <a href={`tel:+${b.customerPhone}`}>+{b.customerPhone}</a>
                        </>
                      )}
                      {b.status === "cancelled" && " · Cancelled"}
                    </p>
                  </div>
                  <div className="rowcard-actions">
                    <a className="chip" href={`/inbox?open=${encodeURIComponent(b.threadId)}`}>
                      Open chat
                    </a>
                    {b.status === "booked" && (
                      <button type="button" className="chip" disabled={busy === b.id} onClick={() => void cancel(b.id)}>
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
