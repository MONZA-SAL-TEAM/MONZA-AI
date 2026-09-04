"use client";

/**
 * The draft dock — where the local model's suggestion appears.
 *
 * IT MUST NEVER BE MISTAKEN FOR A SENT MESSAGE. That is the worst failure this
 * feature can have, so it is defended several ways at once, each of which
 * survives a different thing going wrong:
 *
 *   STRUCTURAL   the draft is NOT inside the bubble list. Messages are 78%-wide
 *                tails aligned to an edge; this is a full-width panel below
 *                them. Shape survives greyscale, low contrast, a screenshot,
 *                and a phone in sunlight — colour does not.
 *   WORDING      the badge says "Draft — not sent". Not "AI", not "Suggestion":
 *                people scan verbs, and "suggestion" is ambiguous about whether
 *                it already went.
 *   DASHED EDGE  every real message has a solid border or none.
 *   NO TIMESTAMP every real bubble ends "· 14:22 · delivered". This one ends
 *                "nothing has been sent". The ABSENCE of a status word where
 *                every sibling has one is itself information.
 *
 * Nothing here can send. "Use this" puts the text in the composer, where a
 * person still has to act.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { segmentsOf, type FlagSpan } from "@/lib/coach/verify";

/** What came back from POST /api/suggest. */
interface DraftPayload {
  reply: string;
  language: string;
  rightToLeft: boolean;
  needs: string[];
  slots: string[];
  note: string;
  level: "ok" | "check";
  flags: FlagSpan[];
  model: string;
  ms: number;
  anchorMessageId: string | null;
}

type DockState =
  | { kind: "idle" }
  | { kind: "generating" }
  | { kind: "ready"; draft: DraftPayload }
  | { kind: "failed"; message: string; fix?: string };

interface Props {
  conversationId: string;
  /** The id of the message a draft would answer; null when we spoke last. */
  anchorMessageId: string | null;
  /** Called with the draft text when the salesperson accepts it. */
  onUse: (text: string) => void;
}

/** Nudges offered under "Redraft". Moves first, tone second. */
const STEERS = [
  { label: "Answer + invite in", steer: "answer, then invite them to the showroom" },
  { label: "Answer + ask to call", steer: "answer, then ask if you can call them" },
  { label: "Buy time", steer: "say you are checking and will come back today" },
  { label: "Shorter", steer: "say the same thing in one sentence" },
  { label: "Warmer", steer: "keep the content, make the tone warmer" },
];

export default function DraftDock({
  conversationId,
  anchorMessageId,
  onUse,
}: Props) {
  const [state, setState] = useState<DockState>({ kind: "idle" });
  const [showSteers, setShowSteers] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Changing thread throws away everything: an in-flight request, the draft,
  // and the dismissal. A draft for one customer must never appear under
  // another's name.
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ kind: "idle" });
    setShowSteers(false);
    setDismissed(false);
  }, [conversationId]);

  // Abort on unmount too, so navigating away does not leave a request running.
  useEffect(() => () => abortRef.current?.abort(), []);

  const generate = useCallback(
    async (steer?: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setShowSteers(false);
      setState({ kind: "generating" });

      try {
        const res = await fetch("/api/suggest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId, ...(steer ? { steer } : {}) }),
          signal: controller.signal,
        });
        const body = (await res.json()) as
          | ({ ok: true } & DraftPayload)
          | { ok: false; reason: string; message?: string };

        if (!body.ok) {
          setState({
            kind: "failed",
            message: body.message ?? "The draft could not be written.",
            // The fix differs per failure, so it is shown literally rather than
            // described — "run this" beats "make sure Ollama is available".
            fix:
              body.reason === "not_running"
                ? "ollama serve"
                : body.reason === "model_missing"
                  ? "ollama pull gpt-oss:20b"
                  : undefined,
          });
          return;
        }
        setState({ kind: "ready", draft: body });
      } catch (e) {
        if (controller.signal.aborted) return; // the user stopped it, or moved on
        setState({
          kind: "failed",
          message: "Couldn't reach the drafting service on this machine.",
        });
      }
    },
    [conversationId]
  );

  if (dismissed) return null;

  /* ── Collapsed rail ────────────────────────────────────────────────────── */

  if (state.kind === "idle") {
    return (
      <div className="draft-dock">
        <button type="button" className="draft-rail" onClick={() => generate()}>
          <span aria-hidden="true">✦</span>
          <span>Suggest a reply</span>
          <span className="draft-rail-hint">
            {anchorMessageId ? "reads this conversation" : "writes a follow-up"}
          </span>
        </button>
      </div>
    );
  }

  /* ── The card ──────────────────────────────────────────────────────────── */

  const draft = state.kind === "ready" ? state.draft : null;
  // A draft written before a newer message arrived answers a question that is
  // no longer the last one.
  const stale =
    draft !== null &&
    draft.anchorMessageId !== null &&
    draft.anchorMessageId !== anchorMessageId;

  return (
    <div className="draft-dock">
      <section className="draft-card" data-stale={stale} aria-label="Suggested reply">
        <header className="draft-head">
          <span className="draft-badge">Draft — not sent</span>
          {draft && draft.level === "check" && (
            <span className="draft-badge-warn">Check the marked parts</span>
          )}
          <button
            type="button"
            className="draft-dismiss"
            aria-label="Dismiss the draft"
            onClick={() => setDismissed(true)}
          >
            ×
          </button>
        </header>

        {state.kind === "generating" && (
          <p className="draft-body draft-waiting">
            Writing… the local AI takes a few seconds, and longer the first time.
          </p>
        )}

        {state.kind === "failed" && (
          <div className="draft-body">
            <p className="draft-failed">{state.message}</p>
            {state.fix && <p className="draft-fix">{state.fix}</p>}
          </div>
        )}

        {draft && (
          <>
            {stale && (
              <p className="draft-stale-note">
                A new message arrived after this was written.
              </p>
            )}
            <p
              className="draft-body"
              dir={draft.rightToLeft ? "rtl" : "ltr"}
              lang={draft.language}
            >
              {draft.reply === "" ? (
                <span className="draft-waiting">
                  Nothing worth sending right now — see the note below.
                </span>
              ) : (
                segmentsOf(draft.reply, draft.flags).map((seg, i) =>
                  seg.flagged ? (
                    <mark className="draft-flag" key={i} title={seg.reason}>
                      {seg.text}
                    </mark>
                  ) : (
                    <span key={i}>{seg.text}</span>
                  )
                )
              )}
            </p>

            {draft.needs.length > 0 && (
              <ul className="draft-needs" aria-label="You must fill these in">
                {draft.needs.map((n) => (
                  <li className="draft-need" key={n}>
                    {n}
                  </li>
                ))}
              </ul>
            )}

            {draft.note && <p className="draft-note">{draft.note}</p>}
          </>
        )}

        <footer className="draft-meta">
          {state.kind === "generating"
            ? "nothing has been sent"
            : draft
              ? `nothing has been sent · ${draft.model} · ${(draft.ms / 1000).toFixed(1)}s`
              : "nothing has been sent"}
        </footer>

        <div className="draft-actions">
          {state.kind === "generating" ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                abortRef.current?.abort();
                setState({ kind: "idle" });
              }}
            >
              Stop
            </button>
          ) : (
            <>
              {draft && draft.reply !== "" && (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => onUse(draft.reply)}
                >
                  {draft.slots.length > 0 ? "Use it and fill in" : "Use this"}
                </button>
              )}
              {draft && draft.reply !== "" && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    void navigator.clipboard?.writeText(draft.reply);
                  }}
                >
                  Copy
                </button>
              )}
              <button
                type="button"
                className="btn quiet"
                onClick={() => setShowSteers((v) => !v)}
              >
                Redraft
              </button>
            </>
          )}
        </div>

        {showSteers && (
          <div className="draft-steer">
            {STEERS.map((s) => (
              <button
                type="button"
                className="chip"
                key={s.label}
                onClick={() => generate(s.steer)}
              >
                {s.label}
              </button>
            ))}
            <button type="button" className="chip" onClick={() => generate()}>
              Just try again
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
