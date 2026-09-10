"use client";

/**
 * The unified inbox screen.
 *
 * Two columns: the conversation list (its filters sit above it as a chip
 * strip) and the thread with its customer context beside it. On a phone the
 * thread takes over the screen and a back button returns to the list.
 *
 * WhatsApp, Instagram and Facebook are rendered by the SAME components. The
 * channel is a chip on a row, not a different code path.
 *
 * ── LIVE ────────────────────────────────────────────────────────────────────
 * With accounts connected, the list is read from Meta by the server and
 * refreshed every minute, and an open thread is fetched from Meta and
 * refreshed every 15 seconds. Nothing is kept: the only copy of a conversation
 * is on Instagram and Facebook, where it always was (Samer, 2026-09-10).
 * Replies go out through Meta. While sending is switched off, pressing Send
 * says so rather than showing a tick the customer never earned.
 *
 * ── DEMO ────────────────────────────────────────────────────────────────────
 * Example threads, and nothing sends: the composer offers only a prefilled
 * WhatsApp link a person taps themselves.
 *
 * All filtering, sorting, counting and searching comes from lib/inbox/filters,
 * so the badge on a filter and the list it opens can never disagree.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import type { AccountStatus } from "@/lib/channels/live-map";
import { firstName, longDate, messageTime, usd, waLink } from "@/lib/format";
import "./inbox.css";

interface Props {
  today: string;
  demo: boolean;
  /**
   * Whether any channel account is connected — a DIFFERENT fact from `demo`,
   * which is about the source system. Real conversations must never be
   * labelled as examples just because the CRM is still the demo one.
   */
  channelsConnected: boolean;
  /** Conversations come live from Meta (and threads are fetched on open). */
  live: boolean;
  /** How each connected account's read went, so a failure is never shown as silence. */
  accountStatuses: AccountStatus[];
  sourceLabel: string;
  viewer: Viewer;
  staff: { id: string; name: string }[];
  conversations: Conversation[];
  messages: InboxMessage[];
  customers: Customer[];
  openInstallments: Installment[];
  vehicles: Vehicle[];
}

type ThreadResponse =
  | { ok: true; messages: InboxMessage[]; window: { open: boolean; text: string } }
  | { ok: false; message?: string };

interface LiveThread {
  messages: InboxMessage[];
  windowOpen: boolean;
  windowText: string;
  problem: string | null;
  loading: boolean;
}

const EMPTY_THREAD: LiveThread = {
  messages: [],
  windowOpen: false,
  windowText: "",
  problem: null,
  loading: true,
};

const THREAD_REFRESH_MS = 15_000;
const LIST_REFRESH_MS = 60_000;

/** A small channel chip. One component, three channels — by design. */
function ChannelChip({ channel }: { channel: Conversation["channel"] }) {
  return (
    <span className={`chan chan-${channel}`}>{CHANNEL_LABEL[channel]}</span>
  );
}

export default function InboxClient({
  today,
  demo,
  channelsConnected,
  live,
  accountStatuses,
  sourceLabel,
  viewer,
  staff,
  conversations,
  messages,
  customers,
  openInstallments,
  vehicles,
}: Props) {
  const router = useRouter();
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [search, setSearch] = useState("");
  // What the salesperson is about to send. A draft they accept lands here, so
  // there is somewhere to edit it and fill in any [[slots]] before it goes.
  const [composerText, setComposerText] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const [liveThread, setLiveThread] = useState<LiveThread>(EMPTY_THREAD);
  const [sending, setSending] = useState(false);
  const [sendNote, setSendNote] = useState<string | null>(null);

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
  const openThreadId = open?.id ?? null;

  const problems = useMemo(
    () => accountStatuses.filter((s) => s.state !== "ok"),
    [accountStatuses]
  );
  const allFailed =
    live && accountStatuses.length > 0 && problems.length === accountStatuses.length;

  // The list is re-read from Meta by the server every minute.
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => router.refresh(), LIST_REFRESH_MS);
    return () => clearInterval(t);
  }, [live, router]);

  const loadThread = useCallback(async (id: string, signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/channels/thread?id=${encodeURIComponent(id)}`, {
        cache: "no-store",
        signal,
      });
      const json = (await res.json().catch(() => null)) as ThreadResponse | null;
      if (res.ok && json && json.ok) {
        setLiveThread({
          messages: json.messages,
          windowOpen: json.window.open,
          windowText: json.window.text,
          problem: null,
          loading: false,
        });
      } else {
        // Keep what was already on screen; say what went wrong.
        setLiveThread((prev) => ({
          ...prev,
          loading: false,
          problem:
            (json && !json.ok && json.message) ||
            "Could not load this conversation from Meta.",
        }));
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setLiveThread((prev) => ({
        ...prev,
        loading: false,
        problem: "Could not reach Monza AI. Check the connection.",
      }));
    }
  }, []);

  // An open live thread is fetched from Meta, then refreshed while it stays open.
  useEffect(() => {
    if (!live || !openThreadId) return;
    setLiveThread(EMPTY_THREAD);
    setSendNote(null);
    const ctrl = new AbortController();
    void loadThread(openThreadId, ctrl.signal);
    const t = setInterval(() => void loadThread(openThreadId, ctrl.signal), THREAD_REFRESH_MS);
    return () => {
      ctrl.abort();
      clearInterval(t);
    };
  }, [live, openThreadId, loadThread]);

  const thread = useMemo(() => {
    if (!open) return [];
    return live ? liveThread.messages : messages.filter((m) => m.conversationId === open.id);
  }, [live, liveThread.messages, messages, open]);

  /**
   * The message a draft would answer: the last one, if it came from the
   * customer. Null when we spoke last, which is a follow-up rather than a
   * reply.
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

  async function sendReply() {
    if (!open || sending) return;
    const text = composerText.trim();
    if (text === "") return;
    setSending(true);
    setSendNote(null);
    try {
      const res = await fetch("/api/channels/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: open.id, text }),
      });
      const json = (await res.json().catch(() => null)) as {
        delivered?: boolean;
        message?: string;
      } | null;
      if (res.ok && json?.delivered) {
        setComposerText("");
        setSendNote("Sent.");
        void loadThread(open.id);
      } else {
        // Not sent: the text stays in the box so nothing is lost.
        setSendNote(json?.message ?? "It was not sent.");
      }
    } catch {
      setSendNote("Could not reach Monza AI — nothing was sent.");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="inbox" data-thread-open={open !== null}>
      {/* ── Conversation list, with its filters above it ──────────────── */}
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
            placeholder="Search name, brand or message"
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

        {!channelsConnected ? (
          <p className="inbox-note">
            Example conversations — no channel is connected yet. Customer
            details come from {sourceLabel.toLowerCase()}.
          </p>
        ) : (
          <div className="inbox-note">
            <p>
              Live from Instagram and Facebook. Monza AI shows these
              conversations and keeps no copy of them.
              {demo && ` Customer details beside them come from ${sourceLabel.toLowerCase()}.`}
            </p>
            {problems.length > 0 && (
              <ul style={{ margin: "0.4rem 0 0 1rem" }}>
                {problems.map((s) => (
                  <li key={s.id}>
                    <strong>{s.label}:</strong> {s.problem}
                  </li>
                ))}
              </ul>
            )}
          </div>
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
                  {live && (
                    <span className="tag truncate">
                      {c.channelAddress.split(" → ")[1] ?? ""}
                    </span>
                  )}
                  {c.unreadCount > 0 && (
                    <span className="tag urgent">{c.unreadCount} unread</span>
                  )}
                  {!live &&
                    (c.assignedToName ? (
                      <span className="tag mine">{c.assignedToName}</span>
                    ) : (
                      <span className="tag">Unassigned</span>
                    ))}
                  {c.hasAutomatedMessage && <span className="tag">Automated</span>}
                </div>
              </button>
            </li>
          ))}
          {visible.length === 0 && (
            <li className="inbox-empty">
              {search
                ? "Nothing matches that search."
                : allFailed
                  ? "Could not load conversations from Meta — see the note above."
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
                  {!live &&
                    (open.assignedToName ? ` · ${open.assignedToName}` : " · Unassigned")}
                </p>
              </div>
              {open.customerId && (
                <Link className="btn" href={`/customers?open=${open.customerId}`}>
                  Customer
                </Link>
              )}
            </header>

            <div className="thread-body">
              <ol className="bubbles">
                {live && liveThread.loading && thread.length === 0 && (
                  <li className="cap">Loading from Meta…</li>
                )}
                {live && liveThread.problem && (
                  <li className="cap is-urgent">{liveThread.problem}</li>
                )}
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

                {!customer && live && (
                  <div className="ctx-card">
                    <p className="cap">
                      Not linked to a Monza customer yet. Instagram and Facebook
                      do not share phone numbers, so this person is matched once
                      they give one.
                    </p>
                  </div>
                )}

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
                is sticky, so a draft is always within thumb reach. */}
            <div className="thread-foot">
              {/* Suggested drafts read the example threads only; on a live
                  thread they would draft from the wrong conversation. */}
              {!live && (
                <DraftDock
                  conversationId={open.id}
                  anchorMessageId={anchorMessageId}
                  onUse={(text) => {
                    setComposerText(text);
                    composerRef.current?.focus();
                  }}
                />
              )}

              <footer className="thread-compose">
                <textarea
                  ref={composerRef}
                  className="composer"
                  rows={2}
                  placeholder={live ? "Write a reply…" : "Write a reply, or use a suggested draft…"}
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
                  ) : live ? (
                    <button
                      type="button"
                      className="btn primary"
                      disabled={
                        sending || composerText.trim() === "" || !liveThread.windowOpen
                      }
                      onClick={() => void sendReply()}
                    >
                      {sending ? "Sending…" : "Send"}
                    </button>
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
                  {!live && (
                    <Link className="btn quiet" href="/integrations">
                      Connect a channel
                    </Link>
                  )}
                </div>
                <p className="cap" role="status">
                  {live && open.channel !== "whatsapp"
                    ? (sendNote ??
                      (liveThread.loading ? "Checking the conversation…" : liveThread.windowText))
                    : "Nothing is sent from Monza AI — opening WhatsApp fills this in and you tap send."}
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
