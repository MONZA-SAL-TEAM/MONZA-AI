"use client";

/**
 * The chat — the product. Two panes: conversations on the left, the thread on
 * the right. Everything staff-facing is in plain words (rule 8): no connector
 * keys, no model ids, no database vocabulary.
 *
 * Server API this client speaks (defensively — it tolerates both camelCase and
 * snake_case field spellings):
 *   GET  /api/status                       → is the CRM configured? (demo banner)
 *   GET  /api/conversations                → the signed-in user's conversations
 *   GET  /api/conversations/:id/messages   → messages of one conversation
 *   POST /api/chat  { conversationId?, message } → assistant reply + tool trace
 * Any 401 anywhere → a plain link to /login.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import ToolTrace from "@/components/ToolTrace";

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
}

const SUGGESTIONS = [
  "Which customers have overdue installments over $2,000?",
  "Which cars are waiting for repair, and do we have the parts for them?",
  "How much did we collect this month?",
  "What can I ask?",
];

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
        const d: unknown = await res.json();
        const o = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
        const convId = o.conversationId ?? o.conversation_id;
        if (typeof convId === "string" && convId !== activeId) setActiveId(convId);

        // The chat API returns { conversationId, text, trace } — read exactly
        // that. (The first build read fields the API never sent, so every
        // successful answer rendered as a failure.)
        const content = typeof o.text === "string" ? o.text : "";
        const trace = Array.isArray(o.trace) ? o.trace : [];
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: content || "I couldn't put an answer together for that.", tool_trace: trace },
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
        <p className="cap">You need to be signed in to ask Monza AI.</p>
        <a className="btn primary" href="/login">
          Go to sign in
        </a>
      </div>
    );
  }

  return (
    <div className="chat-wrap" style={{ flex: 1, display: "flex", minHeight: 0, position: "relative" }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .chat-side {
          width: 260px; flex: none; display: flex; flex-direction: column;
          border-right: 1px solid var(--line); background: var(--panel);
          min-height: 0;
        }
        .chat-side-toggle { display: none; }
        @media (max-width: 760px) {
          .chat-side {
            position: absolute; inset: 0 auto 0 0; z-index: 20;
            box-shadow: var(--shadow);
            transform: translateX(-105%);
            transition: transform .18s ease;
          }
          .chat-side[data-open="true"] { transform: translateX(0); }
          .chat-side-toggle { display: inline-flex; }
        }
        @keyframes monza-pulse { 0%,100% { opacity: .45; } 50% { opacity: 1; } }
        .thinking { animation: monza-pulse 1.4s ease-in-out infinite; color: var(--ink-3); font-size: var(--t-sm); }
      ` }} />

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
            <div className="note">Example data — not connected to the Monza systems yet.</div>
          </div>
        )}
        {loadError && (
          <div style={{ padding: "10px 16px 0" }}>
            <div className="note urgent">{loadError}</div>
          </div>
        )}

        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
          {messages.length === 0 && !sending ? (
            <div className="empty">
              <p className="h2">Ask the Monza systems anything</p>
              <p className="cap" style={{ maxWidth: 420 }}>
                Plain questions, real answers — and under every answer you&apos;ll see exactly which
                systems were checked.
              </p>
              <div className="row" style={{ flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 8 }}>
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="btn" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="stack" style={{ maxWidth: 780, margin: "0 auto" }}>
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={m.id ?? i} style={{ display: "flex", justifyContent: "flex-end" }}>
                    <div className="bubble from-staff">{m.content}</div>
                  </div>
                ) : (
                  <div key={m.id ?? i} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                    <div
                      className="bubble from-assistant"
                      style={{ alignSelf: "flex-start", borderBottomRightRadius: 14, borderBottomLeftRadius: 4, whiteSpace: "normal" }}
                    >
                      <MarkdownLite text={m.content} />
                    </div>
                    <ToolTrace trace={m.tool_trace} />
                  </div>
                )
              )}
              {sending && <div className="thinking">Checking the systems…</div>}
            </div>
          )}
        </div>

        {/* composer */}
        <div style={{ borderTop: "1px solid var(--line)", padding: "12px 16px", background: "var(--panel)" }}>
          <div className="row" style={{ alignItems: "flex-end", maxWidth: 780, margin: "0 auto" }}>
            <textarea
              ref={textareaRef}
              rows={2}
              value={input}
              placeholder="Ask about customers, payments, the garage, cars, or parts…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onComposerKeyDown}
              style={{ resize: "none" }}
              aria-label="Your question"
            />
            <button
              className="btn primary"
              onClick={() => send(input)}
              disabled={sending || input.trim() === ""}
              style={{ flex: "none" }}
            >
              Send
            </button>
          </div>
          <p className="cap" style={{ maxWidth: 780, margin: "6px auto 0", color: "var(--ink-3)", fontSize: "var(--t-xs)" }}>
            Ctrl+Enter to send
          </p>
        </div>
      </section>
    </div>
  );
}
