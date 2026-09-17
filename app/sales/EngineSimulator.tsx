"use client";

/**
 * The Search Engine simulator — the right rail of /sales.
 *
 * It runs the REAL runner (lib/wasales/flow.ts runTurn) — the same engine,
 * templates and send policy a webhook handler would call — and threads the
 * same SearchEngineState through the conversation, so what appears here is
 * production behaviour rather than a description of it.
 *
 * For every message it shows what the engine understood (normalized text,
 * language, intents, model and where it came from, colour), how the state
 * moved (before, pending questions, after), the ordered actions and exactly
 * which brochure, video or fact each would use, the content gaps, the
 * messages as the channel would carry them, and every reason the send policy
 * blocks them. It never claims anything was sent: nothing is.
 *
 * Hydration-safe: no Date.now and no random. Message times start at a fixed
 * instant and advance by the gap chosen, so the sales-context expiry can be
 * tried on purpose.
 */

import { useCallback, useMemo, useState } from "react";
import type { WaCar } from "@/lib/wasales/matcher";
import { folderMedia, libraryMedia, type LibraryFile } from "@/lib/wasales/catalog";
import { SAMPLE_MESSAGES } from "@/lib/wasales/catalog-data";
import {
  DEFAULT_SALES_CONTEXT_TTL_HOURS,
  freshState,
  type SearchEngineState,
} from "@/lib/wasales/context";
import {
  MONZA_KNOWLEDGE,
  readinessReport,
  type SalesBrand,
  type SalesChannel,
} from "@/lib/wasales/knowledge";
import { isCustomerFacing, type EngineAction } from "@/lib/wasales/actions";
import type { EngineDeps, ModelSource, Understanding } from "@/lib/wasales/engine";
import { runTurn, type TurnResult } from "@/lib/wasales/flow";
import { actionLabel, type OutboundPart } from "@/lib/wasales/templates";

/* ── The accounts a message can arrive at ────────────────────────────────── */

interface Account {
  id: string;
  label: string;
  /** From the account's verified id — never from what the customer wrote. */
  brand: SalesBrand;
  channel: SalesChannel;
}

const ACCOUNTS: readonly Account[] = [
  { id: "ig-voyah", label: "Instagram · @voyahlebanon", brand: "voyah", channel: "instagram" },
  { id: "fb-voyah", label: "Messenger · Voyah Lebanon", brand: "voyah", channel: "facebook" },
  { id: "ig-mhero", label: "Instagram · @mherolebanon", brand: "mhero", channel: "instagram" },
  { id: "fb-mhero", label: "Messenger · M HERO Lebanon", brand: "mhero", channel: "facebook" },
  { id: "ig-monza", label: "Instagram · @monzasal.official", brand: "monza", channel: "instagram" },
  { id: "fb-monza", label: "Messenger · Monza SAL", brand: "monza", channel: "facebook" },
  { id: "wa-monza", label: "WhatsApp · +961 70 708 585", brand: "monza", channel: "whatsapp" },
];

/** How long after the previous message the next one arrives. */
const GAPS: readonly { label: string; ms: number }[] = [
  { label: "A minute later", ms: 60_000 },
  { label: "3 hours later", ms: 3 * 3_600_000 },
  { label: "2 days later", ms: 48 * 3_600_000 },
  { label: "4 days later", ms: 96 * 3_600_000 },
];

/** The first simulated message's time. Fixed, so every run is reproducible. */
const START = Date.parse("2026-09-14T09:00:00.000Z");

const RULES = [
  "Brand comes from the account the message arrived at — never from the words. Another brand's car gets the contact number, never its material.",
  "Whenever a model becomes active, its brochure goes FIRST. The same model never gets it twice unless the customer asks for it.",
  "Asked something that needs a model (“hp?”, “price?”, “more info?”) without one? The question waits and the customer picks a model; then: brochure → the answers → colour choices.",
  "Facts are sent only when approved. Missing, unapproved, empty or zero values get “For more information, please call 70 70 85 85.”",
  "Price, installments, test drives, discounts, trade-ins, service, parts and complaints get the number: a person answers those.",
  "Only colours with a video are offered; a colour already named is never asked again.",
  "Returning customers are answered too. A bare “hi” in an old conversation with no live context is left to a person.",
  "Scams, vendor pitches, Meta notices, echoes, receipts and reactions are never answered.",
  "Nothing is sent from here: live sending is off (CLAUDE.md rule 24) and no channel can send files yet.",
];

/* ── Wording for the panel ───────────────────────────────────────────────── */

const SOURCE_LABEL: Readonly<Record<ModelSource, string>> = {
  payload: "a tapped button",
  text: "the message",
  choice: "the answer to “which model?”",
  referral: "the ad it came from",
  state: "the conversation so far",
  none: "nowhere",
};

function code(label: string): string {
  return label.replace(/_/g, " ");
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "size unknown";
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

function stateLine(s: SearchEngineState): string {
  const parts = [
    s.activeModel ? code(s.activeModel) : "no model",
    `colour ${s.selectedColour ?? "—"}`,
    `awaiting ${s.awaiting}`,
    `activation #${s.modelActivationId}`,
  ];
  if (s.brochureSentForCurrentActivation) parts.push("brochure sent");
  if (s.colourPromptSentForCurrentActivation) parts.push("colours asked");
  return parts.join(" · ");
}

function modelLine(u: Understanding): string {
  if (u.model) {
    const words = u.modelMatchedText ? ` (“${u.modelMatchedText}”)` : "";
    return `${code(u.model)} — from ${SOURCE_LABEL[u.modelSource]}${words}`;
  }
  if (u.modelCandidates.length > 1) return `Which one? ${u.modelCandidates.map(code).join(" or ")}`;
  if (u.switchedOff) return `${code(u.switchedOff)} — switched off on this page`;
  if (u.crossBrand.length > 0) return `Another brand's: ${u.crossBrand.map(code).join(", ")}`;
  return "Unknown";
}

function colourLine(u: Understanding): string {
  const c = u.colour;
  switch (c.kind) {
    case "one":
      return `${c.name} (from ${c.source === "payload" ? "a tapped button" : c.source === "choice" ? "the numbered answer" : "the message"})`;
    case "unavailable":
      return `“${c.requested}” — no video of it`;
    case "several":
      return `Several: ${c.ids.join(", ")}`;
    case "no_preference":
      return "No preference (“any”)";
    case "none":
      return "—";
  }
}

function intentLines(u: Understanding): string[] {
  const lines = u.reading.hits.map(
    (h) => `${h.intent} ← “${h.matched}”${h.fuzzy ? " (typo tolerated)" : ""}${h.weak ? " (weak)" : ""}`
  );
  for (const intent of u.intents) {
    if (!u.reading.hits.some((h) => h.intent === intent)) {
      lines.push(intent === "UNKNOWN" ? "UNKNOWN — nothing recognised" : `${intent} (from the colour)`);
    }
  }
  return lines.length > 0 ? lines : ["—"];
}

function usedLines(actions: readonly EngineAction[]): string[] {
  const out: string[] = [];
  for (const a of actions) {
    if (a.type === "SEND_BROCHURE") out.push(`Brochure: ${a.asset.name} (${formatBytes(a.asset.bytes)})`);
    if (a.type === "SEND_COLOUR_VIDEO") out.push(`Video: ${a.asset.name} (${formatBytes(a.asset.bytes)})`);
    if (a.type === "SEND_FACTS" || a.type === "SEND_COMPARISON") {
      for (const r of a.rows) out.push(`${code(r.model)} ${code(r.fact)}: ${r.confirmed ? r.value : "not confirmed yet"} — workbook`);
    }
    if (a.type === "SEND_GLOBAL_INFO") out.push(`${code(a.key)}: ${a.value}`);
  }
  return out.length > 0 ? out : ["—"];
}

/* ── Pieces ──────────────────────────────────────────────────────────────── */

function PlanView({
  plan,
  latest,
  onChoice,
}: {
  plan: readonly OutboundPart[];
  latest: boolean;
  onChoice: (title: string, payload: string) => void;
}) {
  if (plan.length === 0) return null;
  return (
    <div className="ws-eng-plan">
      {plan.map((part, i) =>
        part.kind === "file" ? (
          <span className="ws-file" data-doc={part.fileKind === "document" ? "true" : undefined} key={i}>
            <span className="ws-file-label">{part.fileKind === "document" ? "PDF" : "Video"}</span>
            <span className="ws-file-name">{part.name}</span>
            <span className="ws-file-name">{formatBytes(part.bytes)}</span>
          </span>
        ) : (
          <div key={i}>
            <p className="ws-turn-text ws-eng-msg">{part.text}</p>
            {part.choices.length > 0 && (
              <div className="chip-row ws-colour-answers">
                {part.choices.map((c) => (
                  <button
                    key={c.payload}
                    type="button"
                    className="chip"
                    disabled={!latest}
                    title={c.payload}
                    onClick={() => onChoice(c.title, c.payload)}
                  >
                    {c.title}
                  </button>
                ))}
                {part.style && <span className="cap ws-eng-style">{part.style.replace("_", " ")}</span>}
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}

function TurnView({
  turn,
  latest,
  onChoice,
}: {
  turn: SimTurn;
  latest: boolean;
  onChoice: (title: string, payload: string) => void;
}) {
  const d = turn.result.decision;
  const u = d.understanding;
  const policy = turn.result.policy;
  const who =
    d.outcome === "EXCLUDED"
      ? "Excluded — never answered"
      : d.outcome === "NO_AUTOMATIC_ACTION"
        ? "No automatic action — a person replies"
        : policy.wouldSend
          ? "Would send"
          : "Would send — blocked, preview only";
  const actionBlocks = policy.verdicts.filter((v) => v.blocked.length > 0);

  return (
    <>
      <li className="ws-turn ws-turn-customer">
        <span className="ws-turn-who">Customer</span>
        <p className="ws-turn-text">
          {turn.payload ? `[tapped] ${turn.said}` : turn.said || "(no words)"}
        </p>
      </li>
      <li className="ws-turn ws-turn-monza" data-send={d.outcome === "ACTIONS"} data-outcome={d.outcome}>
        <span className="ws-turn-who">{who}</span>
        {d.reasons.length > 0 && <p className="ws-turn-text">{d.reasons.join(" ")}</p>}

        {d.actions.length > 0 && (
          <ol className="ws-eng-actions" aria-label="Ordered actions">
            {d.actions.map((a, i) => (
              <li key={i} data-internal={!isCustomerFacing(a)}>
                {actionLabel(a)}
              </li>
            ))}
          </ol>
        )}

        <PlanView plan={turn.result.plan} latest={latest} onChoice={onChoice} />

        <details className="ws-eng-details" open={latest}>
          <summary>What the engine understood</summary>
          <dl className="ws-eng-kv">
            <dt>Normalized</dt>
            <dd>{u.reading.normalized || "—"}</dd>
            <dt>Language</dt>
            <dd>{u.reading.language}</dd>
            <dt>Intents</dt>
            <dd>
              <ul>
                {intentLines(u).map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </dd>
            <dt>Model</dt>
            <dd>{modelLine(u)}</dd>
            <dt>Colour</dt>
            <dd>{colourLine(u)}</dd>
            <dt>Before</dt>
            <dd>
              {stateLine(d.previousState)}
              {d.expired ? " — sales context EXPIRED, reset before reading" : ""}
            </dd>
            <dt>Pending</dt>
            <dd>
              {(d.previousState.pendingIntents.join(", ") || "none") +
                " → " +
                (d.nextState.pendingIntents.join(", ") || "none")}
            </dd>
            <dt>After</dt>
            <dd>{stateLine(d.nextState)}</dd>
            <dt>Would use</dt>
            <dd>
              <ul>
                {usedLines(d.actions).map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </dd>
            <dt>Gaps</dt>
            <dd>{d.gaps.length > 0 ? d.gaps.map((g) => g.detail).join(" · ") : "—"}</dd>
            <dt>Blocked</dt>
            <dd className="ws-eng-blocked">
              <ul>
                {policy.blocked.map((b) => (
                  <li key={b}>{b}</li>
                ))}
                {actionBlocks.map((v, i) => (
                  <li key={`a${i}`}>
                    {actionLabel(v.action)}: {v.blocked.join("; ")}
                  </li>
                ))}
                {policy.blocked.length === 0 && actionBlocks.length === 0 && <li>Nothing</li>}
              </ul>
            </dd>
          </dl>
        </details>
      </li>
    </>
  );
}

/* ── The simulator ───────────────────────────────────────────────────────── */

interface SimTurn {
  said: string;
  payload: string | null;
  at: string;
  result: TurnResult;
}

export default function EngineSimulator({
  catalog,
  libraryFiles,
  autoSend,
}: {
  /** The catalogue as edited on this page: switched-off cars and library colours included. */
  catalog: readonly WaCar[];
  /** Every file in the shared library. */
  libraryFiles: readonly LibraryFile[];
  /** The page's master switch. */
  autoSend: boolean;
}) {
  const [accountId, setAccountId] = useState<string>(ACCOUNTS[0].id);
  const [conversationIsNew, setConversationIsNew] = useState(true);
  const [windowOpen, setWindowOpen] = useState(true);
  const [humanLock, setHumanLock] = useState(false);
  const [fromFolder, setFromFolder] = useState(false);
  const [gapMs, setGapMs] = useState(GAPS[0].ms);
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<SimTurn[]>([]);
  const [state, setState] = useState<SearchEngineState>(freshState);

  const account = ACCOUNTS.find((a) => a.id === accountId) ?? ACCOUNTS[0];

  const media = useMemo(
    () => (fromFolder ? folderMedia : libraryMedia(libraryFiles)),
    [fromFolder, libraryFiles]
  );

  const deps: EngineDeps = useMemo(
    () => ({
      knowledge: MONZA_KNOWLEDGE,
      catalog,
      media,
      ttlHours: DEFAULT_SALES_CONTEXT_TTL_HOURS,
    }),
    [catalog, media]
  );

  const readiness = useMemo(() => readinessReport(MONZA_KNOWLEDGE, catalog, media), [catalog, media]);

  const reset = useCallback(() => {
    setTurns([]);
    setState(freshState());
    setText("");
  }, []);

  const send = useCallback(
    (said: string, payload: string | null, fresh = false) => {
      const trimmed = said.trim();
      if (trimmed === "" && !payload) return;
      const history = fresh ? [] : turns;
      const at =
        history.length === 0
          ? START
          : Date.parse(history[history.length - 1].at) + gapMs;
      const result = runTurn(
        {
          text: payload ? "" : trimmed,
          payload,
          brand: account.brand,
          conversationIsNew: history.length === 0 ? conversationIsNew : false,
          now: new Date(at).toISOString(),
        },
        fresh ? freshState() : state,
        deps,
        {
          channel: account.channel,
          autoSendEnabled: autoSend,
          replyWindowOpen: windowOpen,
          humanLock,
          liveSending: false,
          attachmentsSupported: false,
        }
      );
      setTurns([...history, { said: trimmed, payload, at: new Date(at).toISOString(), result }]);
      setState(result.decision.nextState);
      setText("");
    },
    [turns, gapMs, account, conversationIsNew, state, deps, autoSend, windowOpen, humanLock]
  );

  return (
    <aside className="ws-sim" aria-label="Search Engine simulator">
      <h2 className="eyebrow ws-col-title">Try an incoming message</h2>
      <div className="card ws-sim-card">
        <div className="ws-sim-controls">
          <label className="ws-field">
            <span className="ws-label">Arrives at</span>
            <select
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                reset();
              }}
              aria-label="The account the message arrives at"
            >
              {ACCOUNTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label className="ws-field">
            <span className="ws-label">Next message</span>
            <select
              value={gapMs}
              onChange={(e) => setGapMs(Number(e.target.value))}
              aria-label="How long after the previous message the next one arrives"
            >
              {GAPS.map((g) => (
                <option key={g.ms} value={g.ms}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="ws-sim-checks">
          <label className="ws-check">
            <input
              type="checkbox"
              checked={conversationIsNew}
              onChange={(e) => {
                setConversationIsNew(e.target.checked);
                reset();
              }}
            />
            Brand-new conversation
          </label>
          <label className="ws-check">
            <input type="checkbox" checked={windowOpen} onChange={(e) => setWindowOpen(e.target.checked)} />
            Inside the 24-hour window
          </label>
          <label className="ws-check">
            <input type="checkbox" checked={humanLock} onChange={(e) => setHumanLock(e.target.checked)} />
            A person has taken over
          </label>
          <label className="ws-check">
            <input
              type="checkbox"
              checked={fromFolder}
              onChange={(e) => {
                setFromFolder(e.target.checked);
                reset();
              }}
            />
            Count the sales folder, not the library
          </label>
        </div>

        <label className="ws-field">
          <span className="ws-label">Customer message</span>
          <textarea
            className="ws-sim-text"
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(text, null);
              }
            }}
            placeholder="hp?"
            aria-label="The incoming customer message to test"
          />
        </label>

        <div className="ws-run-row">
          <button className="btn primary ws-run" onClick={() => send(text, null)}>
            {turns.length === 0 ? "Run the engine" : "Send"}
          </button>
          {turns.length > 0 && (
            <button type="button" className="btn quiet" onClick={reset}>
              Start over
            </button>
          )}
        </div>

        <p className="cap">
          {fromFolder
            ? "Counting the sales folder as if every file were uploaded — for spotting gaps, not for judging what can be sent."
            : "Counting what is really in the shared library."}{" "}
          The sales context is forgotten {DEFAULT_SALES_CONTEXT_TTL_HOURS} hours after the last message.
        </p>

        {turns.length > 0 && (
          <ol className="ws-convo" aria-live="polite">
            {turns.map((turn, i) => (
              <TurnView
                key={i}
                turn={turn}
                latest={i === turns.length - 1}
                onChoice={(title, payload) => send(title, payload)}
              />
            ))}
          </ol>
        )}

        <div className="ws-chips">
          <span className="ws-label">Patterns from the first-message study</span>
          <div className="chip-row">
            {SAMPLE_MESSAGES.map((s) => (
              <button
                key={s.label}
                type="button"
                className="chip"
                onClick={() => send(s.text, s.payload ?? null, true)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <details className="card ws-ready">
        <summary className="eyebrow">Content readiness</summary>
        {readiness.problems.length > 0 && (
          <ul className="ws-warning-list ws-ready-problems">
            {readiness.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <div className="ws-ready-model">
          <h4>Everyone</h4>
          <ul>
            {readiness.global.map((g) => (
              <li key={g.key}>
                {code(g.key)}: {g.status === "OK" ? g.value : g.status}
              </li>
            ))}
          </ul>
        </div>
        {readiness.models.map((m) => (
          <div className="ws-ready-model" key={m.code}>
            <h4>
              {m.displayName} <span className="cap">· {m.brand.toUpperCase()}</span>
            </h4>
            <p className="cap">
              Brochure: {m.brochure ? `${m.brochure.name} (${formatBytes(m.brochure.bytes)})` : "none"} · Colours with
              video: {m.colours.filter((c) => c.videos.length > 0).map((c) => c.name).join(", ") || "none"} · Facts
              approved: {m.facts.filter((f) => f.status === "OK").length}/{m.facts.length}
            </p>
            {m.gaps.length > 0 && (
              <ul>
                {m.gaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </details>

      <div className="card ws-rules">
        <h3 className="eyebrow ws-rules-title">The rules</h3>
        <ul className="ws-rules-list">
          {RULES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
