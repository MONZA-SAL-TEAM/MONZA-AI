"use client";

/**
 * The unified inbox screen.
 *
 * Two columns: the conversation list (its filters sit above it as a chip
 * strip) and the thread with its customer context beside it. On a phone the
 * thread takes over the screen and a back button returns to the list.
 *
 * WhatsApp, Instagram and Facebook are rendered by the SAME components. The
 * channel is a chip on a row, not a different code path — which is the whole
 * point of the unified model and the thing that stops three channels becoming
 * three products.
 *
 * NOTHING IS SENT FROM HERE YET. The composer is deliberately inert until an
 * outbound channel is actually connected: it explains that, and offers the one
 * honest alternative — a prefilled WhatsApp link a person taps themselves.
 * Showing a Send button that silently does nothing would be worse than showing
 * no Send button.
 *
 * All filtering, sorting, counting and searching comes from lib/inbox/filters,
 * so the badge on a filter and the list it opens can never disagree.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import DraftDock from "./DraftDock";
import {
  applyFilter,
  countsByFilter,
  searchConversations,
  type Viewer,
} from "@/lib/inbox/filters";
import {
  FILTER_LABEL,
  INBOX_FILTERS,
  STATUS_LABEL,
  type Conversation,
  type InboxFilter,
  type InboxMessage,
} from "@/lib/inbox/types";
import {
  CHANNEL_LABEL,
  VEHICLE_STATUS_LABEL,
  type Customer,
  type Installment,
  type Vehicle,
} from "@/lib/domain/types";
import { firstName, longDate, messageTime, usd, waLink } from "@/lib/format";
import "./inbox.css";

interface Props {
  today: string;
  demo: boolean;
  sourceLabel: string;
  viewer: Viewer;
  staff: { id: string; name: string }[];
  conversations: Conversation[];
  messages: InboxMessage[];
  customers: Customer[];
  openInstallments: Installment[];
  vehicles: Vehicle[];
}

/** A small channel chip. One component, three channels — by design. */
function ChannelChip({ channel }: { channel: Conversation["channel"] }) {
  return (
    <span className={`chan chan-${channel}`}>{CHANNEL_LABEL[channel]}</span>
  );
}

export default function InboxClient({
  today,
  demo,
  sourceLabel,
  viewer,
  staff,
  conversations,
  messages,
  customers,
  openInstallments,
  vehicles,
}: Props) {
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [search, setSearch] = useState("");
  // What the salesperson is about to send. A draft they accept lands here, so
  // there is somewhere to edit it and fill in any [[slots]] before it goes.
  const [composerText, setComposerText] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [openId, setOpenId] = useState<string | null>(
    conversations.length > 0 ? null : null
  );

  const counts = useMemo(
    () => countsByFilter(conversations, viewer),
    [conversations, viewer]
  );

  const visible = useMemo(() => {
    const filtered = applyFilter(conversations, filter, viewer);
    return searchConversations(filtered, search);
  }, [conversations, filter, viewer, search]);

  const open = useMemo(
    () => visible.find((c) => c.id === openId) ?? null,
    [visible, openId]
  );

  const thread = useMemo(
    () => (open ? messages.filter((m) => m.conversationId === open.id) : []),
    [messages, open]
  );

  /**
   * The message a draft would answer: the last one, if it came from the
   * customer. Null when we spoke last, which is a follow-up rather than a
   * reply. The dock compares this to the draft's own anchor to notice that a
   * newer message has arrived and the draft has gone stale — an id, because a
   * count is unchanged by a delete plus an insert.
   */
  const anchorMessageId = useMemo(() => {
    const last = thread[thread.length - 1];
    return last && last.direction === "in" ? last.id : null;
  }, [thread]);

  // Switching conversations must never carry one customer's half-written reply
  // into another's thread.
  useEffect(() => {
    setComposerText("");
  }, [openId]);

  const customer = useMemo(
    () => (open ? customers.find((c) => c.id === open.customerId) ?? null : null),
    [customers, open]
  );

  const customerInstallments = useMemo(
    () =>
      open
        ? openInstallments.filter((i) => i.customerId === open.customerId)
        : [],
    [openInstallments, open]
  );

  const customerVehicles = useMemo(
    () => (open ? vehicles.filter((v) => v.customerId === open.customerId) : []),
    [vehicles, open]
  );

  return (
    <main className="inbox" data-thread-open={open !== null}>
      {/* ── Conversation list, with its filters above it ────────────────
       * The filters are a horizontal strip rather than a third vertical rail:
       * the app shell already contributes one, and a rail inside a rail inside
       * a rail left the messages themselves about 120px wide. */}
      <section className="inbox-list" aria-label="Conversations">
        <div className="inbox-list-head">
          <div className="row-between">
            <h1 className="h2">Inbox</h1>
            <span className="cap">
              {visible.length} of {conversations.length}
            </span>
          </div>
          <input
            className="inbox-search"
            type="search"
            placeholder="Search name, number or message"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search conversations"
          />
          <nav className="inbox-filters" aria-label="Filters">
            {INBOX_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                className="inbox-filter"
                aria-pressed={filter === f}
                onClick={() => {
                  setFilter(f);
                  setOpenId(null);
                }}
              >
                <span>{FILTER_LABEL[f]}</span>
                <span className="inbox-count">{counts[f]}</span>
              </button>
            ))}
          </nav>
        </div>

        {demo && (
          <p className="inbox-note">
            Example conversations — no channel is connected yet. Customer
            details come from {sourceLabel.toLowerCase()}.
          </p>
        )}

        <ul className="inbox-threads">
          {visible.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="thread-row"
                aria-current={open?.id === c.id ? "true" : undefined}
                onClick={() => setOpenId(c.id)}
              >
                <div className="row-between">
                  <span className="thread-name truncate">{c.customerName}</span>
                  <span className="cap">{messageTime(c.lastMessage.at, today)}</span>
                </div>
                <div className="thread-preview truncate">
                  {c.lastMessage.direction === "out" && (
                    <span className="thread-you">
                      {c.lastMessage.author === "automation" ? "Auto: " : "You: "}
                    </span>
                  )}
                  {c.lastMessage.text}
                </div>
                <div className="row thread-meta">
                  <ChannelChip channel={c.channel} />
                  {c.unreadCount > 0 && (
                    <span className="tag urgent">{c.unreadCount} unread</span>
                  )}
                  {c.assignedToName ? (
                    <span className="tag mine">{c.assignedToName}</span>
                  ) : (
                    <span className="tag">Unassigned</span>
                  )}
                  {c.hasAutomatedMessage && <span className="tag">Automated</span>}
                </div>
              </button>
            </li>
          ))}
          {visible.length === 0 && (
            <li className="inbox-empty">
              {search
                ? "Nothing matches that search."
                : "Nothing in this filter right now."}
            </li>
          )}
        </ul>
      </section>

      {/* ── Thread + context ────────────────────────────────────────────── */}
      <section className="inbox-thread" aria-label="Conversation">
        {!open ? (
          <div className="inbox-placeholder">
            <p className="lede">Choose a conversation to read it.</p>
          </div>
        ) : (
          <>
            <header className="thread-head">
              <button
                type="button"
                className="btn quiet thread-back"
                onClick={() => setOpenId(null)}
              >
                ← Back
              </button>
              <div className="grow">
                <div className="row">
                  <h2 className="h2 truncate">{open.customerName}</h2>
                  <ChannelChip channel={open.channel} />
                </div>
                <p className="cap truncate">
                  {open.channelAddress} · {STATUS_LABEL[open.status]}
                  {open.assignedToName ? ` · ${open.assignedToName}` : " · Unassigned"}
                </p>
              </div>
              <Link className="btn" href={`/customers?open=${open.customerId}`}>
                Customer
              </Link>
            </header>

            <div className="thread-body">
              <ol className="bubbles">
                {thread.map((m) => (
                  <li
                    key={m.id}
                    className={`bubble bubble-${m.direction}`}
                    data-author={m.author}
                  >
                    <p className="bubble-text">{m.text}</p>
                    <p className="bubble-meta">
                      {m.author === "automation"
                        ? `Sent automatically · ${m.automationId}`
                        : m.author === "staff"
                          ? `${m.staffName ?? "Monza"}`
                          : firstName(open.customerName)}
                      {" · "}
                      {messageTime(m.at, today)}
                      {m.direction === "out" && ` · ${m.status}`}
                    </p>
                  </li>
                ))}
              </ol>

              {/* Context from the SOURCE systems, never owned here. */}
              <aside className="thread-context" aria-label="Customer context">
                <h3 className="eyebrow">Context</h3>

                {customer && (
                  <div className="ctx-card">
                    <p className="ctx-title">Reachable on</p>
                    <ul className="ctx-list">
                      {customer.handles.map((h) => (
                        <li key={`${h.channel}-${h.address}`}>
                          {CHANNEL_LABEL[h.channel]} · {h.address}
                        </li>
                      ))}
                    </ul>
                    <p className="cap">
                      First contact {customer.firstContact} · {customer.origin}
                    </p>
                  </div>
                )}

                {customerVehicles.map((v) => (
                  <div className="ctx-card" key={v.id}>
                    <p className="ctx-title">{v.label}</p>
                    <p className="cap">
                      {v.plate ? `${v.plate} · ` : ""}
                      {VEHICLE_STATUS_LABEL[v.status]}
                      {v.awaitingPart ? ` — ${v.awaitingPart}` : ""}
                    </p>
                    {v.jobReference && <p className="cap">Job {v.jobReference}</p>}
                  </div>
                ))}

                {customerInstallments.length > 0 && (
                  <div className="ctx-card">
                    <p className="ctx-title">Outstanding installments</p>
                    <ul className="ctx-list">
                      {customerInstallments.map((i) => (
                        <li key={i.id}>
                          <span className={i.status === "overdue" ? "is-urgent" : ""}>
                            #{i.number} of {i.totalCount} · {usd(i.amountUsd)} ·{" "}
                            {longDate(i.dueDate)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="cap">
                      Reported by the source system — Monza AI does not keep a
                      balance of its own.
                    </p>
                  </div>
                )}

                {customerInstallments.length === 0 && customer && (
                  <div className="ctx-card">
                    <p className="ctx-title">Installments</p>
                    <p className="cap">Nothing outstanding.</p>
                  </div>
                )}
              </aside>
            </div>

            {/* The dock and the composer are ONE footer. On a phone that footer
                is sticky, so a draft is always within thumb reach — and the
                page cannot scroll it away. */}
            <div className="thread-foot">
              <DraftDock
                conversationId={open.id}
                anchorMessageId={anchorMessageId}
                onUse={(text) => {
                  setComposerText(text);
                  composerRef.current?.focus();
                }}
              />

              {/* Honest composer: nothing sends until a channel is connected.
                  It exists so an accepted draft has somewhere to LAND and be
                  edited — the slots in it have to be filled in by a person. */}
              <footer className="thread-compose">
                <textarea
                  ref={composerRef}
                  className="composer"
                  rows={2}
                  placeholder="Write a reply, or use a suggested draft…"
                  value={composerText}
                  onChange={(e) => setComposerText(e.target.value)}
                  aria-label="Your reply"
                />
                <div className="row">
                  {open.channel === "whatsapp" ? (
                    <a
                      className="btn primary"
                      href={waLink(open.channelAddress, composerText)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open in WhatsApp
                    </a>
                  ) : (
                    <span className="btn" aria-disabled="true">
                      {CHANNEL_LABEL[open.channel]} replies are not connected yet
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn"
                    disabled={composerText === ""}
                    onClick={() => {
                      void navigator.clipboard?.writeText(composerText);
                    }}
                  >
                    Copy
                  </button>
                  <Link className="btn quiet" href="/integrations">
                    Connect a channel
                  </Link>
                </div>
                <p className="cap">
                  Nothing is sent from Monza AI — opening WhatsApp fills this in
                  and you tap send.
                </p>
              </footer>
            </div>
          </>
        )}
      </section>

      {/* Assignment is a Monza AI concept, so the staff list is ours too. */}
      <p className="visually-hidden">
        Team: {staff.map((s) => s.name).join(", ")}
      </p>
    </main>
  );
}
