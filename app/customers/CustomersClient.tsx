"use client";

/**
 * Customers — communication context.
 *
 * One row per person, expanding to everything you would want in your head
 * mid-conversation: the channels they are on, the threads you already have with
 * them, their car and its status, and whether anything is outstanding.
 *
 * Read-only by construction. There is no add, no edit, no delete and no notes
 * field — the customer master record belongs to the source system, and a second
 * editable copy of a person is how two systems start disagreeing about who
 * somebody is.
 *
 * `?open=<customerId>` expands a person directly, so the Inbox, the installment
 * board and the vehicle board can all link straight to the right row.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  CHANNEL_LABEL,
  VEHICLE_STATUS_LABEL,
  type Customer,
  type Installment,
  type Vehicle,
} from "@/lib/domain/types";
import { conversationsForCustomer } from "@/lib/inbox/filters";
import type { Conversation } from "@/lib/inbox/types";
import { customerMatches } from "@/lib/domain/source";
import { longDate, usd } from "@/lib/format";
import "../board.css";

interface Props {
  demo: boolean;
  sourceLabel: string;
  customers: Customer[];
  installments: Installment[];
  vehicles: Vehicle[];
  conversations: Conversation[];
}

export default function CustomersClient({
  demo,
  sourceLabel,
  customers,
  installments,
  vehicles,
  conversations,
}: Props) {
  const params = useSearchParams();
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  // A deep link from another screen expands the right person on arrival.
  const requested = params.get("open");
  useEffect(() => {
    if (requested) setOpenId(requested);
  }, [requested]);

  const visible = useMemo(
    () => customers.filter((c) => customerMatches(c, search)),
    [customers, search]
  );

  return (
    <main className="board">
      <header className="board-head">
        <div className="eyebrow">Communication</div>
        <h1 className="h1">Customers</h1>
        <p className="lede">
          Who you are talking to, and what you need to know while you talk.
        </p>
      </header>

      <p className="board-note">
        People, cars and plans are read from {sourceLabel.toLowerCase()} and cannot
        be changed here — Monza AI keeps the conversations, not the customer
        records.{demo && " Nothing here is real yet."}
      </p>

      <div className="board-tools">
        <input
          className="board-search"
          type="search"
          placeholder="Search by name, phone number or handle"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search customers"
        />
      </div>

      <p className="cap">
        Showing {visible.length} of {customers.length}
      </p>

      <ul className="rows">
        {visible.map((c) => {
          const isOpen = openId === c.id;
          const theirVehicles = vehicles.filter((v) => v.customerId === c.id);
          const outstanding = installments.filter(
            (i) => i.customerId === c.id && i.status !== "paid" && i.status !== "upcoming"
          );
          const threads = conversationsForCustomer(conversations, c.id);
          const overdue = outstanding.filter((i) => i.status === "overdue").length;

          return (
            <li className="rowcard" key={c.id}>
              <div className="rowcard-top">
                <div className="grow">
                  <p className="rowcard-name">{c.name}</p>
                  <p className="rowcard-sub">
                    {c.handles
                      .map((h) => `${CHANNEL_LABEL[h.channel]} ${h.address}`)
                      .join(" · ")}
                  </p>
                </div>
                <div className="rowcard-tags">
                  {overdue > 0 && (
                    <span className="tag urgent">{overdue} overdue</span>
                  )}
                  {threads.length > 0 && (
                    <span className="tag">
                      {threads.length === 1 ? "1 thread" : `${threads.length} threads`}
                    </span>
                  )}
                  <span className="tag">{c.origin}</span>
                </div>
              </div>

              {isOpen && (
                <div className="stack">
                  <p className="cap">
                    First contact {c.firstContact} · prefers{" "}
                    {CHANNEL_LABEL[c.preferredChannel]}
                  </p>

                  {theirVehicles.length > 0 && (
                    <div className="ctx-card">
                      <p className="ctx-title">Vehicles</p>
                      <ul className="ctx-list">
                        {theirVehicles.map((v) => (
                          <li key={v.id}>
                            {v.label}
                            {v.plate ? ` · ${v.plate}` : ""} ·{" "}
                            {VEHICLE_STATUS_LABEL[v.status]}
                            {v.awaitingPart ? ` — ${v.awaitingPart}` : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="ctx-card">
                    <p className="ctx-title">Outstanding installments</p>
                    {outstanding.length === 0 ? (
                      <p className="cap">Nothing outstanding.</p>
                    ) : (
                      <ul className="ctx-list">
                        {outstanding.map((i) => (
                          <li key={i.id}>
                            <span className={i.status === "overdue" ? "is-urgent" : ""}>
                              #{i.number} of {i.totalCount} · {usd(i.amountUsd)} ·{" "}
                              due {longDate(i.dueDate)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="cap">
                      As reported by the source system — not a balance Monza AI
                      keeps.
                    </p>
                  </div>

                  <div className="ctx-card">
                    <p className="ctx-title">Conversations</p>
                    {threads.length === 0 ? (
                      <p className="cap">No conversation yet.</p>
                    ) : (
                      <ul className="ctx-list">
                        {threads.map((t) => (
                          <li key={t.id}>
                            {CHANNEL_LABEL[t.channel]} · {t.lastMessage.text}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              <div className="rowcard-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setOpenId(isOpen ? null : c.id)}
                >
                  {isOpen ? "Hide details" : "Full details"}
                </button>
                <Link className="btn quiet" href="/inbox">
                  Open the inbox
                </Link>
              </div>
            </li>
          );
        })}

        {visible.length === 0 && (
          <li className="board-empty">Nobody matches that search.</li>
        )}
      </ul>
    </main>
  );
}
