"use client";

/**
 * "Clients to call" — the sales bot's alerts, at the top of the inbox list.
 *
 * Samer's workbook (C Decisions, 2026-09-17): "alert 70 70 85 85 to call the
 * client"; and Samer, 2026-09-17: "send a notification through MONZA AI and mark
 * the clients that need human response for our sales to answer them".
 *
 * Each alert says what the customer asked (or why the bot could not answer),
 * about which car, their name and number when they gave them, and opens the
 * chat. A NEW alert pops up here and, when the browser allows it, as a desktop
 * notification. The chats with an open alert are handed to the list, which marks
 * them "Needs a person". "Done" clears it for everyone.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { alertsHeadline } from "@/lib/wasales/alerts";
import "./suggestion.css";

export interface SalesAlertItem {
  id: string;
  kind: string;
  threadId: string;
  label: string;
  /** The alert's other reasons, as words ("Test drive", "Asked about installments"). */
  tagLabels?: string[];
  urgency?: "normal" | "qualified" | "hot" | "overdue";
  cars: string[];
  customerName: string | null;
  customerPhone: string | null;
  slotAt: string | null;
  reason: string | null;
  createdAt: string;
}

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

/** Open or closed is this person's choice on this device, and stays that way (Samer, 2026-09-19). */
const OPEN_KEY = "monza-ai:sales-alerts-open";

/** One line a salesperson reads: what, which car, who. */
function summary(a: SalesAlertItem): string {
  return [a.label, a.cars.join(", "), a.customerName ?? (a.customerPhone ? `+${a.customerPhone}` : null)]
    .filter(Boolean)
    .join(" · ");
}

export default function SalesAlerts({
  onOpen,
  onChange,
}: {
  onOpen: (threadId: string) => void;
  /** Every chat with an open alert, and why — for the "Needs a person" marks in the list. */
  onChange: (open: ReadonlyMap<string, string>) => void;
}) {
  const [alerts, setAlerts] = useState<SalesAlertItem[]>([]);
  // Closed by default: twenty alerts must never bury the conversations under them.
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(OPEN_KEY) === "1");
    } catch {
      /* private mode: closed */
    }
  }, []);
  // Shut, the list is still in the page (so it can glide): keep keyboards and screen readers out of it.
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (panel.current) panel.current.inert = !open;
  }, [open, alerts.length]);
  const toggle = useCallback(() => {
    setOpen((v) => {
      try {
        localStorage.setItem(OPEN_KEY, v ? "0" : "1");
      } catch {
        /* not remembered, still works */
      }
      return !v;
    });
  }, []);
  const [popup, setPopup] = useState<SalesAlertItem | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const announce = useCallback(
    (fresh: SalesAlertItem[]) => {
      if (fresh.length === 0) return;
      setPopup(fresh[0]);
      if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") return;
      for (const a of fresh.slice(0, 3)) {
        try {
          const n = new Notification("Client needs a salesperson", { body: summary(a), tag: `sales-${a.id}` });
          n.onclick = () => {
            window.focus();
            onOpen(a.threadId);
            n.close();
          };
        } catch {
          // Some browsers refuse notifications outside a service worker; the pop-up still shows.
        }
      }
    },
    [onOpen]
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sales/alerts", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { alerts?: SalesAlertItem[] };
      const list = Array.isArray(json.alerts) ? json.alerts : [];
      // The first read is what was already waiting; only later ones are announced.
      if (seen.current === null) {
        seen.current = new Set(list.map((a) => a.id));
      } else {
        const fresh = list.filter((a) => !seen.current?.has(a.id));
        for (const a of fresh) seen.current.add(a.id);
        announce(fresh);
      }
      setAlerts(list);
      const byThread = new Map<string, string>();
      for (const a of list) if (!byThread.has(a.threadId)) byThread.set(a.threadId, a.label);
      onChangeRef.current(byThread);
    } catch {
      // Offline for a moment: keep what is shown.
    }
  }, [announce]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!popup) return;
    const t = setTimeout(() => setPopup(null), 12_000);
    return () => clearTimeout(t);
  }, [popup]);

  const done = async (id: string) => {
    setBusy(id);
    try {
      const res = await fetch("/api/sales/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "done" }),
      });
      if (res.ok) {
        const list = alerts.filter((a) => a.id !== id);
        setAlerts(list);
        const byThread = new Map<string, string>();
        for (const a of list) if (!byThread.has(a.threadId)) byThread.set(a.threadId, a.label);
        onChangeRef.current(byThread);
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {popup && (
        <div className="sa-popup" role="status" aria-live="polite">
          <div className="sa-popup-text">
            <strong>Client needs a salesperson</strong>
            <span>{summary(popup)}</span>
          </div>
          <button
            type="button"
            className="sa-btn sa-done"
            onClick={() => {
              onOpen(popup.threadId);
              setPopup(null);
            }}
          >
            Open chat
          </button>
          <button type="button" className="sa-btn" aria-label="Dismiss" onClick={() => setPopup(null)}>
            ✕
          </button>
        </div>
      )}
      {alerts.length > 0 && (
        <div className="sa-strip" role="region" aria-label="Clients to call" data-open={open}>
          <button type="button" className="sa-toggle" aria-expanded={open} aria-controls="sa-panel" onClick={toggle}>
            <span className="sa-count">{alerts.length}</span>
            <span className="sa-title">{alerts.length === 1 ? "needs a salesperson" : "need a salesperson"}</span>
            {(() => {
              const { hot, overdue } = alertsHeadline(alerts);
              return (
                <span className="sa-chips">
                  {overdue > 0 && <span className="sa-urgent" data-urgency="overdue">{overdue} waiting</span>}
                  {hot > 0 && <span className="sa-urgent" data-urgency="hot">{hot} ready to buy</span>}
                </span>
              );
            })()}
            <span className="sa-hint">{open ? "Hide" : "Show"}</span>
            <svg className="sa-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {/* Always in the page so it can glide open and shut; hidden from keyboards and screen readers while shut. */}
          <div className="sa-panel" id="sa-panel" aria-hidden={!open} ref={panel}>
            <ul className="sa-list">
              {alerts.map((a) => (
                <li key={a.id} className="sa-item" data-kind={a.kind}>
                  <div className="sa-main">
                    {(a.urgency === "hot" || a.urgency === "overdue") && (
                      <span className="sa-urgent" data-urgency={a.urgency}>{a.urgency === "overdue" ? "Kept waiting" : "Ready to buy"}</span>
                    )}
                    <span className="sa-kind">{a.label}</span>
                    {(a.tagLabels ?? []).map((t) => (
                      <span key={t} className="sa-tag">{t}</span>
                    ))}
                    {a.cars.length > 0 && <span className="sa-cars">{a.cars.join(", ")}</span>}
                    {a.reason && <span className="sa-cars">{a.reason}</span>}
                    <span className="sa-who">
                      {a.customerName ?? "No name given"}
                      {a.customerPhone && (
                        <>
                          {" · "}
                          <a href={`tel:+${a.customerPhone}`}>+{a.customerPhone}</a>
                        </>
                      )}
                    </span>
                    <span className="sa-when">{ago(a.createdAt)}</span>
                  </div>
                  <div className="sa-actions">
                    <button type="button" className="sa-btn" onClick={() => onOpen(a.threadId)}>
                      Open chat
                    </button>
                    <button type="button" className="sa-btn sa-done" disabled={busy === a.id} onClick={() => void done(a.id)}>
                      Done
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
