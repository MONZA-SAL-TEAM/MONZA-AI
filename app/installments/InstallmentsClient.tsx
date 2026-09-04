"use client";

/**
 * Installment follow-up.
 *
 * The question this screen answers is "who should hear from us about a
 * payment, and what should we say" — not "what is owed". Amounts and statuses
 * are shown exactly as the source system reports them, and the counters are
 * counts of those rows, never a recomputation of them.
 *
 * The message a person is about to send is rendered from the SAME template an
 * automation would use (lib/automations/templates.ts), so what you send by hand
 * today and what the automation sends tomorrow are the same words.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Customer, Installment } from "@/lib/domain/types";
import { eventsForInstallment } from "@/lib/automations/events";
import { renderTemplate } from "@/lib/automations/templates";
import { longDate, messageTime, usd, waLink } from "@/lib/format";
import { searchIntent, numberContains, textContains } from "@/lib/search";
import "../board.css";

interface SentReminder {
  conversationId: string;
  automationId: string;
  at: string;
  text: string;
}

interface Props {
  today: string;
  demo: boolean;
  sourceLabel: string;
  installments: Installment[];
  customers: Customer[];
  sentReminders: SentReminder[];
}

type Lens = "needs_attention" | "overdue" | "due" | "upcoming" | "paid";

const LENS_LABEL: Record<Lens, string> = {
  needs_attention: "Needs a word",
  overdue: "Overdue",
  due: "Due now",
  upcoming: "Coming up",
  paid: "Recently paid",
};

/** Which template describes this installment's situation. */
function templateFor(i: Installment, today: string): string | null {
  const event = eventsForInstallment(i, today)[0];
  if (!event) return null;
  switch (event.kind) {
    case "installment.due_soon":
      return "installment.reminder.upcoming";
    case "installment.due_today":
      return "installment.reminder.due_today";
    case "installment.overdue":
      return "installment.followup.overdue";
    case "installment.paid":
      return "installment.confirmation.paid";
    default:
      return null;
  }
}

export default function InstallmentsClient({
  today,
  demo,
  sourceLabel,
  installments,
  customers,
  sentReminders,
}: Props) {
  const [lens, setLens] = useState<Lens>("needs_attention");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const customerById = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers]
  );

  /* Counters are COUNTS OF REPORTED ROWS. Nothing here re-derives a status. */
  const counts = useMemo(() => {
    const by = (s: Installment["status"]) =>
      installments.filter((i) => i.status === s).length;
    return {
      overdue: by("overdue"),
      due: by("due"),
      upcoming: by("upcoming"),
      paid: by("paid"),
      overdueUsd: installments
        .filter((i) => i.status === "overdue")
        .reduce((sum, i) => sum + i.amountUsd, 0),
    };
  }, [installments]);

  const inLens = useMemo(() => {
    const ordering: Record<Installment["status"], number> = {
      overdue: 0,
      due: 1,
      upcoming: 2,
      paid: 3,
    };
    const chosen = installments.filter((i) => {
      switch (lens) {
        case "needs_attention":
          // Anything a person could act on today: late, due, or close enough
          // that a reminder template exists for it.
          return (
            i.status === "overdue" ||
            i.status === "due" ||
            (i.status === "upcoming" && templateFor(i, today) !== null)
          );
        case "paid":
          return i.status === "paid";
        default:
          return i.status === lens;
      }
    });
    return chosen.sort((a, b) => {
      const byStatus = ordering[a.status] - ordering[b.status];
      if (byStatus !== 0) return byStatus;
      if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
  }, [installments, lens, today]);

  const visible = useMemo(() => {
    const intent = searchIntent(search);
    if (intent.kind === "empty") return inLens;
    if (intent.kind === "number_too_short") return [];
    return inLens.filter((i) => {
      const c = customerById.get(i.customerId);
      if (!c) return false;
      return intent.kind === "number"
        ? numberContains(c.phone, intent.digits)
        : textContains(c.name, intent.text);
    });
  }, [inLens, search, customerById]);

  // "Recently paid" is capped: this is a follow-up board, not a statement.
  const shown = lens === "paid" ? visible.slice(0, 12) : visible;

  return (
    <main className="board">
      <header className="board-head">
        <div className="eyebrow">Follow-up</div>
        <h1 className="h1">Installments</h1>
        <p className="lede">
          Who to remind, who to thank, and what was already sent.
        </p>
      </header>

      <p className="board-note">
        Every amount and status below is read from {sourceLabel.toLowerCase()} and
        shown exactly as reported. Monza AI does not keep a balance of its own,
        and nothing on this screen records a payment.
        {demo && " Nothing here is real yet."}
      </p>

      <div className="tiles">
        <div className="tile">
          <p className="tile-label">Overdue</p>
          <p className="tile-value urgent">{counts.overdue}</p>
          <p className="tile-foot">{usd(counts.overdueUsd)} across them</p>
        </div>
        <div className="tile">
          <p className="tile-label">Due now</p>
          <p className="tile-value">{counts.due}</p>
          <p className="tile-foot">This month, not yet late</p>
        </div>
        <div className="tile">
          <p className="tile-label">Coming up</p>
          <p className="tile-value">{counts.upcoming}</p>
          <p className="tile-foot">Later instalments on these plans</p>
        </div>
        <div className="tile">
          <p className="tile-label">Reminders sent</p>
          <p className="tile-value">{sentReminders.length}</p>
          <p className="tile-foot">By automations, in the inbox</p>
        </div>
      </div>

      <div className="board-tools">
        <input
          className="board-search"
          type="search"
          placeholder="Search by name or phone number"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search installments"
        />
        <div className="chips">
          {(Object.keys(LENS_LABEL) as Lens[]).map((l) => (
            <button
              key={l}
              type="button"
              className="chip"
              aria-pressed={lens === l}
              onClick={() => {
                setLens(l);
                setOpenId(null);
              }}
            >
              {LENS_LABEL[l]}
            </button>
          ))}
        </div>
      </div>

      <p className="cap">
        Showing {shown.length} of {inLens.length}
      </p>

      <ul className="rows">
        {shown.map((i) => {
          const customer = customerById.get(i.customerId);
          const templateId = templateFor(i, today);
          const message =
            customer && templateId
              ? renderTemplate(templateId, {
                  customerName: customer.name,
                  event: eventsForInstallment(i, today)[0],
                })
              : null;
          const isOpen = openId === i.id;

          return (
            <li
              key={i.id}
              className={`rowcard${i.status === "overdue" ? " urgent" : ""}`}
            >
              <div className="rowcard-top">
                <div className="grow">
                  <p className="rowcard-name">
                    {customer?.name ?? "Unknown customer"}
                  </p>
                  <p className="rowcard-sub">
                    Installment {i.number} of {i.totalCount} · {usd(i.amountUsd)} ·
                    due {longDate(i.dueDate)}
                  </p>
                </div>
                <div className="rowcard-tags">
                  <span
                    className={`tag${
                      i.status === "overdue"
                        ? " urgent"
                        : i.status === "paid"
                          ? " live"
                          : ""
                    }`}
                  >
                    {i.status === "overdue"
                      ? "Overdue"
                      : i.status === "due"
                        ? "Due"
                        : i.status === "paid"
                          ? "Paid"
                          : "Upcoming"}
                  </span>
                  {i.receiptRef && <span className="tag">{i.receiptRef}</span>}
                </div>
              </div>

              {isOpen && message && (
                <>
                  <p className="preview">{message}</p>
                  <p className="cap">
                    Nothing is sent from here. Opening WhatsApp fills this in —
                    a person taps send.
                  </p>
                </>
              )}

              <div className="rowcard-actions">
                {message && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setOpenId(isOpen ? null : i.id)}
                  >
                    {isOpen ? "Hide message" : "Show message"}
                  </button>
                )}
                {isOpen && message && customer?.phone && (
                  <a
                    className="btn primary"
                    href={waLink(customer.phone, message)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in WhatsApp
                  </a>
                )}
                <Link className="btn quiet" href={`/customers?open=${i.customerId}`}>
                  Customer
                </Link>
              </div>
            </li>
          );
        })}

        {shown.length === 0 && (
          <li className="board-empty">
            {search
              ? "Nobody matches that search."
              : "Nothing needs a word right now."}
          </li>
        )}
      </ul>

      {sentReminders.length > 0 && (
        <>
          <div className="section-head">
            <h2 className="h2">Already sent</h2>
            <p className="cap">
              Reminders an automation has sent. Every one of these is in the
              inbox thread too.
            </p>
          </div>
          <ul className="rows">
            {sentReminders.map((r) => (
              <li className="rowcard" key={`${r.conversationId}-${r.at}`}>
                <div className="rowcard-top">
                  <p className="rowcard-sub grow">{r.text}</p>
                  <span className="tag">{messageTime(r.at, today)}</span>
                </div>
                <div className="rowcard-actions">
                  <Link className="btn quiet" href="/automations">
                    {r.automationId}
                  </Link>
                  <Link className="btn quiet" href="/inbox">
                    Open the thread
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
