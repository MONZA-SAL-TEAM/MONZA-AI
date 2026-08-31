"use client";

/**
 * The chat — the product. Two panes: conversations on the left, the thread on
 * the right. Everything customer-facing is in plain words (rule 8): no
 * connector keys, no model ids, no database vocabulary.
 *
 * Server API this client speaks:
 *   GET  /api/status                       → is the CRM configured? (demo banner)
 *   GET  /api/conversations                → the signed-in user's conversations
 *   GET  /api/conversations/:id/messages   → messages of one conversation
 *                                            (rows may carry tables + followups)
 *   POST /api/chat  { conversationId?, message } → ChatTurnResponse from
 *                                            lib/chat/contract.ts — text,
 *                                            tables, followups, trace. Exactly
 *                                            those names.
 * Any 401 anywhere → a plain link to /login.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { AnswerTable, ChatTurnResponse, RecommendedChat } from "@/lib/chat/contract";
import { RECOMMENDED_CHATS } from "@/lib/chat/demo-answers";
import ToolTrace from "@/components/ToolTrace";
import DataTable from "@/components/DataTable";
import FollowupChips from "@/components/FollowupChips";

/* ---------------------------------------------------------------- types --- */

interface Conversation {
  id: string;
  title: string | null;
  updated_at?: string;
}

interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  tool_trace?: unknown;
  tables?: AnswerTable[];
  followups?: string[];
}

/* ------------------------------------------------- icons, one per key ----- */
/* Inline SVG only (no new dependencies). Keys never reach the screen; they
   only pick a picture. */

function ConnectorIcon({ k }: { k: RecommendedChat["key"] }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (k) {
    case "crm":
      return (
        <svg {...common}>
          <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
          <circle cx="10" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "installments":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      );
    case "garage":
      return (
        <svg {...common}>
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      );
    case "inventory":
      return (
        <svg {...common}>
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
      );
    case "finance":
      return (
        <svg {...common}>
          <line x1="12" y1="20" x2="12" y2="10" />
          <line x1="18" y1="20" x2="18" y2="4" />
          <line x1="6" y1="20" x2="6" y2="16" />
        </svg>
      );
  }
}

function ArrowGlyph() {
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
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

/* ------------------------------------------- tiny markdown-lite renderer --- */
/* Dependency-free by design: **bold**, bullet lines, and simple pipe tables.
   Anything else renders as plain wrapped text. */

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<strong key={k++}>{m[1]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.length > 1 && t.startsWith("|") && t.endsWith("|");
}

function isTableSeparator(line: string): boolean {
  return isTableRow(line) && /^[\s|:\-]+$/.test(line.trim());
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

const cellStyle = {
  padding: "4px 10px",
  borderBottom: "1px solid var(--line-soft)",
  textAlign: "left" as const,
  whiteSpace: "nowrap" as const,
};

function MarkdownLite({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={key++} style={{ margin: "4px 0", paddingLeft: 20 }}>
          {items.map((item, j) => (
            <li key={j}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (isTableRow(line)) {
      const rows: string[][] = [];
      let hasHeader = false;
      while (i < lines.length && isTableRow(lines[i])) {
        if (isTableSeparator(lines[i])) {
          if (rows.length === 1) hasHeader = true;
        } else {
          rows.push(splitTableRow(lines[i]));
        }
        i++;
      }
      const header = hasHeader ? rows[0] : null;
      const body = hasHeader ? rows.slice(1) : rows;
      blocks.push(
        <div key={key++} style={{ overflowX: "auto", margin: "6px 0" }}>
          <table style={{ borderCollapse: "collapse", fontSize: "var(--t-sm)" }}>
            {header && (
              <thead>
                <tr>
                  {header.map((cell, j) => (
                    <th key={j} style={{ ...cellStyle, fontWeight: 620, borderBottom: "1px solid var(--line)" }}>
                      {renderInline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {body.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} style={cellStyle}>
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (line.trim() === "") {
      blocks.push(<div key={key++} style={{ height: 8 }} />);
      i++;
      continue;
    }

    blocks.push(<div key={key++}>{renderInline(line)}</div>);
    i++;
  }

  return <>{blocks}</>;
}

/* -------------------------------------------------- defensive api parsing --- */

function asConversations(data: unknown): Conversation[] {
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { conversations?: unknown[] }).conversations)
      ? (data as { conversations: unknown[] }).conversations
      : [];
  return list
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
    .filter((c) => typeof c.id === "string")
    .map((c) => ({
      id: c.id as string,
      title: typeof c.title === "string" ? c.title : null,
      updated_at: typeof c.updated_at === "string" ? c.updated_at : undefined,
    }));
}

/** Keep only well-formed AnswerTable objects (stored rows can be old/partial). */
function asTables(v: unknown): AnswerTable[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (t): t is AnswerTable =>
      typeof t === "object" &&
      t !== null &&
      typeof (t as AnswerTable).title === "string" &&
      Array.isArray((t as AnswerTable).columns) &&
      (t as AnswerTable).columns.every((c) => typeof c === "string") &&
      Array.isArray((t as AnswerTable).rows) &&
      (t as AnswerTable).rows.every((r) => Array.isArray(r))
  );
}

function asFollowups(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((q): q is string => typeof q === "string" && q.trim() !== "").slice(0, 4);
}

function asMessages(data: unknown): ChatMessage[] {
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { messages?: unknown[] }).messages)
      ? (data as { messages: unknown[] }).messages
      : [];
  return list
    .filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      id: typeof m.id === "string" ? m.id : undefined,
      role: m.role as "user" | "assistant",
      content: typeof m.content === "string" ? m.content : "",
      tool_trace: m.tool_trace ?? m.toolTrace ?? [],
      tables: asTables(m.tables),
      followups: asFollowups(m.followups),
    }));
}

/* ---------------------------------------------------------------- the ui --- */

export default function ChatClient() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const guard = useCallback((res: Response): boolean => {
    if (res.status === 401) {
      setNeedsLogin(true);
      return false;
    }
    return res.ok;
  }, []);

  const refreshConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      if (!guard(res)) return;
      setConversations(asConversations(await res.json()));
    } catch {
      /* the list is a convenience; the thread still works */
    }
  }, [guard]);

  useEffect(() => {
    refreshConversations();
    (async () => {
      try {
        const res = await fetch("/api/status");
        if (res.status === 401) {
          setNeedsLogin(true);
          return;
        }
        if (!res.ok) return;
        const d: unknown = await res.json();
        if (d && typeof d === "object") {
          const o = d as Record<string, unknown>;
          const configured =
            o.crmConfigured ?? o.crm_configured ?? (o.demo != null ? !o.demo : undefined);
          if (configured === false) setDemoMode(true);
        }
      } catch {
        /* no status → no banner; the chat still renders */
      }
    })();
  }, [refreshConversations]);

  const openConversation = useCallback(
    async (id: string) => {
      setActiveId(id);
      setSideOpen(false);
      setLoadError(null);
      try {
        const res = await fetch(`/api/conversations/${id}/messages`);
        if (!guard(res)) {
          if (res.status !== 401) setLoadError("Couldn't open that conversation.");
          return;
        }
        setMessages(asMessages(await res.json()));
      } catch {
        setLoadError("Couldn't open that conversation.");
      }
    },
    [guard]
  );

  const newChat = useCallback(() => {
    setActiveId(null);
    setMessages([]);
    setLoadError(null);
    setSideOpen(false);
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    // Follow the conversation down — but the welcome screen starts at the top.
    if (messages.length === 0 && !sending) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending]);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || sending) return;
      setInput("");
      setLoadError(null);
      setMessages((prev) => [...prev, { role: "user", content: question }]);
      setSending(true);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: activeId, message: question }),
        });
        if (res.status === 401) {
          setNeedsLogin(true);
          return;
        }
        if (!res.ok) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: "Something went wrong answering that. Please try again." },
          ]);
          return;
        }

        // The response is ChatTurnResponse (lib/chat/contract.ts): read
        // conversationId, text, tables, followups, trace — exactly those names.
        const raw: unknown = await res.json();
        const d = (raw && typeof raw === "object" ? raw : {}) as Partial<ChatTurnResponse>;
        if (typeof d.conversationId === "string" && d.conversationId !== activeId) {
          setActiveId(d.conversationId);
        }
        const content = typeof d.text === "string" ? d.text : "";
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: content || "I couldn't put an answer together for that.",
            tool_trace: Array.isArray(d.trace) ? d.trace : [],
            tables: asTables(d.tables),
            followups: asFollowups(d.followups),
          },
        ]);
        refreshConversations();
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Couldn't reach the assistant. Check your connection and try again." },
        ]);
      } finally {
        setSending(false);
      }
    },
    [activeId, sending, refreshConversations]
  );

  const onComposerKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        send(input);
      }
    },
    [input, send]
  );

  if (needsLogin) {
    return (
      <div className="empty" style={{ flex: 1 }}>
        <p className="h2">Please sign in</p>
        <p className="cap">You need to be signed in to use the Monza assistant.</p>
        <a className="btn primary" href="/login">
          Go to sign in
        </a>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0, position: "relative" }}>
      {/* left: conversations */}
      <aside className="chat-side" data-open={sideOpen}>
        <div className="row-between" style={{ padding: "12px 14px", borderBottom: "1px solid var(--line-soft)" }}>
          <span className="eyebrow">Conversations</span>
          <button className="btn quiet" onClick={newChat} style={{ padding: "4px 10px" }}>
            New chat
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {conversations.length === 0 ? (
            <p className="cap" style={{ padding: "14px 16px", color: "var(--ink-3)" }}>
              No conversations yet. Ask your first question.
            </p>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                className="convo"
                aria-selected={c.id === activeId}
                onClick={() => openConversation(c.id)}
              >
                <span className="convo-name truncate" style={{ display: "block" }}>
                  {c.title || "Untitled conversation"}
                </span>
                {c.updated_at && (
                  <span className="convo-meta">{new Date(c.updated_at).toLocaleDateString()}</span>
                )}
              </button>
            ))
          )}
        </div>
      </aside>

      {/* right: the thread */}
      <section style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div className="row" style={{ padding: "10px 16px 0" }}>
          <button className="btn quiet chat-side-toggle" onClick={() => setSideOpen((v) => !v)}>
            {sideOpen ? "Hide conversations" : "Conversations"}
          </button>
        </div>

        {demoMode && (
          <div style={{ padding: "10px 16px 0" }}>
            <div className="note">Preview with example data — your real account isn&apos;t connected yet.</div>
          </div>
        )}
        {loadError && (
          <div style={{ padding: "10px 16px 0" }}>
            <div className="note urgent">{loadError}</div>
          </div>
        )}

        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
          {messages.length === 0 && !sending ? (
            <div className="chat-welcome">
              <p className="h1">Hi! How can we help with your Monza?</p>
              <p className="lede" style={{ maxWidth: 460 }}>
                Tap a question to start, or type your own below. We can help with your car, your
                payments, and the Voyah and MHERO range.
              </p>
              <div className="welcome-grid">
                {RECOMMENDED_CHATS.map((rc) => (
                  <section key={rc.key} className="reco-card" aria-label={rc.label}>
                    <div className="reco-head">
                      <span className="reco-icon">
                        <ConnectorIcon k={rc.key} />
                      </span>
                      <span className="reco-label">{rc.label}</span>
                    </div>
                    <p className="reco-blurb">{rc.blurb}</p>
                    <div className="reco-qs">
                      {rc.questions.map((q) => (
                        <button
                          key={q}
                          type="button"
                          className="reco-q"
                          onClick={() => send(q)}
                          disabled={sending}
                        >
                          <span className="grow">{q}</span>
                          <ArrowGlyph />
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          ) : (
            <div className="chat-thread">
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={m.id ?? i} className="chat-msg-user">
                    <div className="chat-bubble user">{m.content}</div>
                  </div>
                ) : (
                  <div key={m.id ?? i} className="chat-msg-ai">
                    <div className="chat-bubble ai">
                      <MarkdownLite text={m.content} />
                    </div>
                    {(m.tables ?? []).map((t, ti) => (
                      <DataTable key={ti} table={t} />
                    ))}
                    <ToolTrace trace={m.tool_trace} />
                    <FollowupChips followups={m.followups ?? []} onPick={send} disabled={sending} />
                  </div>
                )
              )}
              {sending && (
                <div className="chat-msg-ai" aria-live="polite">
                  <div className="chat-bubble ai" aria-label="Getting your answer">
                    <span className="dots">
                      <span />
                      <span />
                      <span />
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* composer */}
        <div className="composer-bar">
          <div className="composer">
            <textarea
              ref={textareaRef}
              rows={2}
              value={input}
              placeholder="Ask about your car, your payments, or our models…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onComposerKeyDown}
              aria-label="Your question"
            />
            <button
              className="btn primary"
              onClick={() => send(input)}
              disabled={sending || input.trim() === ""}
            >
              Send
            </button>
          </div>
          <p className="composer-hint">Ctrl+Enter to send</p>
        </div>
      </section>
    </div>
  );
}
