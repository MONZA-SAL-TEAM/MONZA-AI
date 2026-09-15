"use client";

/**
 * The Search Engine's SUGGESTED REPLY, above the composer of an open chat.
 *
 * It shows exactly what would go out — the sentences, the brochure or video
 * (name and size), the tappable choices — plus what is missing and anything
 * that stops it being sent. Nothing leaves until a person presses "Send this"
 * (Samer, 2026-09-15: "suggest only, never automatic").
 *
 * It refreshes when a new message arrives in the chat. Once a person writes
 * their own reply, the chat is theirs: the card says so and stays out of the
 * way, with "Suggest again" to bring it back.
 */

import { useCallback, useEffect, useState } from "react";
import "./suggestion.css";

interface Choice {
  title: string;
  payload: string;
}

type Part =
  | { kind: "text"; text: string; choices: Choice[]; style: string | null }
  | { kind: "file"; fileKind: "document" | "video"; name: string; bytes: number | null; url: string | null };

interface View {
  kind: "suggestion" | "handed_over" | "nothing_to_answer" | "unavailable";
  reason?: string;
  version?: string;
  outcome?: string;
  parts?: Part[];
  actions?: string[];
  gaps?: string[];
  blocked?: string[];
  canSend?: boolean;
  understood?: { intents: string[]; model: string | null; language: string };
  notes?: string[];
}

function size(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
}

function asView(json: unknown): View | null {
  if (!json || typeof json !== "object") return null;
  const v = json as View;
  return typeof v.kind === "string" ? v : null;
}

export default function SalesSuggestion({
  threadId,
  refreshKey,
  onSent,
  onUseText,
}: {
  threadId: string;
  /** Changes when the chat changes — the newest message id. */
  refreshKey: string;
  onSent: () => void;
  onUseText: (text: string) => void;
}) {
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch(`/api/sales/suggestion?thread=${encodeURIComponent(threadId)}`, {
          cache: "no-store",
          signal,
        });
        const json: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const message = json && typeof json === "object" ? (json as { message?: unknown }).message : null;
          setView({
            kind: "unavailable",
            reason: typeof message === "string" ? message : "Suggestions are unavailable right now.",
          });
          return;
        }
        setView(asView(json));
      } catch {
        if (!signal?.aborted) setView({ kind: "unavailable", reason: "Suggestions are unavailable right now." });
      }
    },
    [threadId]
  );

  useEffect(() => {
    const ctrl = new AbortController();
    setNote(null);
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load, refreshKey]);

  useEffect(() => {
    setDismissed(null);
    setDetailsOpen(false);
    setView(null);
  }, [threadId]);

  const send = useCallback(async () => {
    if (!view?.version || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/sales/suggestion/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ thread: threadId, version: view.version }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        sent?: number;
        view?: unknown;
      } | null;
      if (res.ok && json?.ok) {
        setNote(`Sent ${json.sent ?? 0} message${json.sent === 1 ? "" : "s"}.`);
        onSent();
        await load();
        return;
      }
      setNote(json?.message ?? "It was not sent.");
      const fresh = asView(json?.view);
      if (fresh) setView(fresh);
      if (res.status === 207) onSent();
    } catch {
      setNote("Could not reach MONZA AI — nothing was confirmed as sent. Check the chat before trying again.");
    } finally {
      setBusy(false);
    }
  }, [view, busy, threadId, onSent, load]);

  const resume = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/sales/suggestion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ thread: threadId, action: "resume" }),
      });
      const json: unknown = await res.json().catch(() => null);
      const fresh = asView(json);
      if (res.ok && fresh) setView(fresh);
      else setNote("Could not switch suggestions back on.");
    } finally {
      setBusy(false);
    }
  }, [threadId]);

  if (!view || view.kind === "nothing_to_answer") return null;

  if (view.kind === "unavailable") {
    return <p className="ss-line">Suggested reply: {view.reason}</p>;
  }

  if (view.kind === "handed_over") {
    return (
      <p className="ss-line">
        Suggestions are off in this chat — a person has replied.{" "}
        <button type="button" className="ss-link" disabled={busy} onClick={() => void resume()}>
          Suggest again
        </button>
        {note && <span className="ss-note"> {note}</span>}
      </p>
    );
  }

  if (view.outcome !== "ACTIONS" || !view.parts || view.parts.length === 0) {
    return <p className="ss-line">No suggestion for this message — {view.reason || "a person answers it."}</p>;
  }

  if (dismissed === view.version) {
    return (
      <p className="ss-line">
        Suggestion hidden.{" "}
        <button type="button" className="ss-link" onClick={() => setDismissed(null)}>
          Show it
        </button>
      </p>
    );
  }

  const texts = view.parts.filter((p): p is Extract<Part, { kind: "text" }> => p.kind === "text").map((p) => p.text);

  return (
    <section className="ss-card" aria-label="Suggested reply">
      <header className="ss-head">
        <span className="ss-title">Suggested reply</span>
        <span className="ss-sub">Prepared by the Search Engine — nothing is sent until you press Send.</span>
      </header>

      <ol className="ss-parts">
        {view.parts.map((p, i) =>
          p.kind === "file" ? (
            <li key={i} className="ss-file">
              <span className="ss-file-kind">{p.fileKind === "document" ? "PDF" : "Video"}</span>
              <span className="ss-file-name">{p.name}</span>
              <span className="ss-file-size">{size(p.bytes)}</span>
            </li>
          ) : (
            <li key={i} className="ss-text">
              <p>{p.text}</p>
              {p.choices.length > 0 && p.style !== "numbered" && (
                <div className="ss-choices">
                  {p.choices.map((c) => (
                    <span key={c.payload} className="ss-choice">
                      {c.title}
                    </span>
                  ))}
                </div>
              )}
            </li>
          )
        )}
      </ol>

      {view.gaps && view.gaps.length > 0 && (
        <p className="ss-gaps">Missing: {view.gaps.join(" · ")}</p>
      )}
      {view.blocked && view.blocked.length > 0 && (
        <ul className="ss-blocked">
          {view.blocked.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {view.notes && view.notes.length > 0 && <p className="ss-gaps">{view.notes.join(" ")}</p>}

      <div className="ss-actions">
        <button
          type="button"
          className="ss-send"
          disabled={!view.canSend || busy}
          title={view.canSend ? "Send exactly this, in this order" : (view.blocked ?? []).join(" ")}
          onClick={() => void send()}
        >
          {busy ? "Sending…" : "Send this"}
        </button>
        <button type="button" className="ss-btn" onClick={() => onUseText(texts.join("\n\n"))}>
          Copy text
        </button>
        <button type="button" className="ss-btn" onClick={() => setDismissed(view.version ?? null)}>
          Dismiss
        </button>
        <button
          type="button"
          className="ss-link ss-why"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((v) => !v)}
        >
          {detailsOpen ? "Hide why" : "Why this?"}
        </button>
      </div>

      {detailsOpen && (
        <div className="ss-details">
          <p>
            Understood: {view.understood?.intents.join(", ") || "—"}
            {view.understood?.model ? ` · model ${view.understood.model.replace(/_/g, " ")}` : ""}
            {view.understood?.language ? ` · ${view.understood.language}` : ""}
          </p>
          <ol>
            {(view.actions ?? []).map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ol>
        </div>
      )}

      {note && <p className="ss-note">{note}</p>}
    </section>
  );
}
