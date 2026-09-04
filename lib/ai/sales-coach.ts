/**
 * The sales coach: a local model that DRAFTS a reply for a person to judge.
 *
 * It is not an agent, it has no tools, and it cannot send. It reads the thread
 * and the facts we hold, and proposes words. A human reads those words and
 * decides. That boundary is the entire safety story of this feature, and it is
 * enforced by the shape of the code: nothing in this module, or anything it
 * calls, can put a message into a conversation.
 *
 * Three mechanisms, in order of how much they carry:
 *
 *   1. THE SLOT. The prompt gives the model a third option besides knowing a
 *      price and inventing one: writing `[[price of the Free]]`. A slot is
 *      always correct, so the model is never cornered into guessing.
 *   2. THE GRAMMAR. The reply comes back as JSON constrained by a schema, so
 *      the four fields are always separable and the card is never parsing prose.
 *   3. THE VERIFIER. Whatever the prompt asked for, lib/coach/verify measures
 *      what actually came back and marks anything unsupported. It never edits
 *      the draft — a silently corrected draft is one nobody has read.
 */

import { chat, type OllamaResult } from "@/lib/ai/ollama";
import { buildBrief, type Brief, type BriefInput } from "@/lib/ai/sales-brief";
import {
  DRAFT_SCHEMA,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  isRightToLeft,
  slotsIn,
  type CoachDraft,
  type DraftLanguage,
} from "@/lib/coach/prompt";
import { verifyDraft, type FlagSpan, type VerifyLevel } from "@/lib/coach/verify";

export interface CoachSuccess {
  ok: true;
  draft: CoachDraft;
  /** Slots pulled out of the reply, for the "you must fill these in" chips. */
  slots: string[];
  rightToLeft: boolean;
  /** "ok" or "check" — a "reject" never reaches the caller as a success. */
  level: Exclude<VerifyLevel, "reject">;
  flags: FlagSpan[];
  model: string;
  ms: number;
  promptVersion: string;
  /** The message this draft answers; a newer one makes it stale. */
  anchorMessageId: string | null;
}

export type CoachResult =
  | CoachSuccess
  | { ok: false; reason: "empty_conversation" | "refused"; message: string }
  | {
      ok: false;
      reason: "ollama_failed";
      failure: Extract<OllamaResult, { ok: false }>["reason"];
    };

/* ── Parsing ─────────────────────────────────────────────────────────────── */

/**
 * Read the model's JSON.
 *
 * The grammar makes malformed JSON impossible in principle; this is defensive
 * anyway, because "impossible" depends on a runtime we do not control and the
 * failure mode without it is a stack trace behind a button someone just
 * pressed.
 */
export function parseDraft(raw: string): CoachDraft | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A model that wrapped its JSON in prose despite the grammar.
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;

  const language: DraftLanguage =
    o.language === "ar" || o.language === "fr" || o.language === "arabizi"
      ? o.language
      : "en";
  const reply = typeof o.reply === "string" ? o.reply.trim() : "";
  const needs = Array.isArray(o.needs)
    ? o.needs.filter((n): n is string => typeof n === "string" && n.trim() !== "")
    : [];
  const note = typeof o.note === "string" ? o.note.trim() : "";

  return { language, reply, needs, note };
}

/* ── Drafting ────────────────────────────────────────────────────────────── */

export interface DraftOptions {
  model?: string;
  timeoutMs?: number;
  /**
   * A nudge from the salesperson: "answer, then invite them in". Appended as
   * one imperative line AFTER the brief, never as a second system prompt —
   * a 20B given two system messages follows neither reliably.
   */
  steer?: string;
}

/**
 * Draft one reply.
 *
 * Never throws: every failure is a value with something the screen can say,
 * because this runs behind a button someone just pressed.
 */
export async function draftReply(
  input: BriefInput,
  opts: DraftOptions = {}
): Promise<CoachResult> {
  if (input.messages.length === 0) {
    return {
      ok: false,
      reason: "empty_conversation",
      message: "There is nothing to reply to yet.",
    };
  }

  const brief: Brief = buildBrief(input);
  const userTurn = opts.steer
    ? `${brief.text}\nINSTEAD: ${opts.steer}`
    : brief.text;

  const result = await chat({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userTurn },
    ],
    model: opts.model,
    timeoutMs: opts.timeoutMs,
    format: DRAFT_SCHEMA,
  });

  if (!result.ok) {
    return { ok: false, reason: "ollama_failed", failure: result.reason };
  }

  const draft = parseDraft(result.text);
  if (!draft) {
    return {
      ok: false,
      reason: "refused",
      message: "The local AI answered with something unusable. Try again.",
    };
  }

  const verdict = verifyDraft({
    reply: draft.reply,
    facts: brief.factStrings,
    customerText: brief.customerText,
    awaitingCustomer: brief.awaitingCustomer,
  });

  if (verdict.level === "reject") {
    return {
      ok: false,
      reason: "refused",
      message: verdict.rejection ?? "That draft was not usable.",
    };
  }

  return {
    ok: true,
    draft,
    slots: slotsIn(draft.reply),
    rightToLeft: isRightToLeft(draft.language),
    level: verdict.level,
    flags: verdict.flags,
    model: result.model,
    ms: result.ms,
    promptVersion: PROMPT_VERSION,
    anchorMessageId: brief.anchorMessageId,
  };
}
