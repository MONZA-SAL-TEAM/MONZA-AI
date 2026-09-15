/**
 * The server side of sales suggestions in the inbox — SERVER ONLY.
 *
 *   suggestionFor(thread)       read the chat, run the engine, say what it
 *                               would send and whether it could
 *   sendSuggestion(thread, v)   a PERSON pressed Send on version v: check it is
 *                               still the same suggestion, claim it, send it
 *                               part by part, remember what went
 *   resumeSuggestions(thread)   "Suggest again" after a person replied
 *
 * Nothing here runs from the webhook. Every entry point is called by a staff
 * route (app/api/sales/suggestion), so an inbound message can never cause an
 * outbound one without a person (CLAUDE.md rule 24).
 */

import { channelsSendLive } from "@/lib/env";
import { decodeThreadId } from "@/lib/channels/live-map";
import { listAccounts, recordWhatsAppSent, type StoredAccount } from "@/lib/channels/store";
import { readThreadForStaff, suggestionTarget } from "@/lib/channels/live";
import { libraryMedia, loadCatalog, type LibraryFile } from "@/lib/wasales/catalog";
import { listLibraryFiles } from "@/lib/wasales/library-server";
import { colourNameFrom } from "@/lib/wasales/media-paths";
import { MONZA_KNOWLEDGE, salesBrandOf, type SalesChannel } from "@/lib/wasales/knowledge";
import { salesContextTtlHours } from "@/lib/wasales/context";
import { isCustomerFacing } from "@/lib/wasales/actions";
import { actionLabel, type OutboundPart } from "@/lib/wasales/templates";
import type { EngineDeps } from "@/lib/wasales/engine";
import type { WaCar } from "@/lib/wasales/matcher";
import { executePlan } from "@/lib/wasales/executor";
import {
  afterSend,
  freshSaved,
  suggestForThread,
  SUGGESTION_AUTOMATION_PREFIX,
  type SavedSuggestion,
  type Suggestion,
  type ThreadFacts,
} from "@/lib/wasales/suggest";
import { loadSuggestion, saveSuggestion } from "@/lib/wasales/suggestion-store";

/** What the inbox card shows. Template wording and file names — never customer words. */
export interface SuggestionView {
  kind: "suggestion" | "handed_over" | "nothing_to_answer";
  reason?: string;
  version?: string;
  outcome?: "ACTIONS" | "NO_AUTOMATIC_ACTION" | "EXCLUDED";
  parts?: OutboundPart[];
  /** The ordered actions, as staff read them ("SEND COURAGE BROCHURE"). */
  actions?: string[];
  /** What is missing ("MISSING APPROVED FACT: COURAGE / RANGE"). */
  gaps?: string[];
  /** Everything that stops it being sent. Empty when it can go. */
  blocked?: string[];
  canSend?: boolean;
  understood?: { intents: string[]; model: string | null; language: string };
  /** Said when the library or the memory could not be read. */
  notes?: string[];
}

type Failure = { ok: false; status: number; problem: string };

interface Loaded {
  ok: true;
  account: StoredAccount;
  brand: string;
  channel: SalesChannel;
  ref: string;
  facts: ThreadFacts;
  saved: SavedSuggestion;
  memoryOk: boolean;
  deps: EngineDeps;
  notes: string[];
}

function channelOf(channel: string): SalesChannel | null {
  return channel === "instagram" || channel === "facebook" || channel === "whatsapp" ? channel : null;
}

/** The catalogue plus any colour that exists only in the library (as /sales shows it). */
function withLibraryColours(catalog: WaCar[], files: readonly LibraryFile[]): WaCar[] {
  return catalog.map((car) => {
    const extra = [
      ...new Set(
        files
          .filter((f) => f.carId === car.id && f.kind === "video" && f.colourId)
          .map((f) => f.colourId as string)
      ),
    ].filter((id) => !car.colours.some((c) => c.id === id));
    if (extra.length === 0) return car;
    return {
      ...car,
      colours: [...car.colours, ...extra.map((id) => ({ id, name: colourNameFrom(id), aliases: [id] }))],
    };
  });
}

async function load(threadId: unknown): Promise<Loaded | Failure> {
  const ids = decodeThreadId(threadId);
  if (!ids) return { ok: false, status: 400, problem: "That conversation link is not valid." };
  const account = (await listAccounts()).find((a) => a.id === ids.accountId);
  if (!account) return { ok: false, status: 404, problem: "That account is not connected." };
  const brand = salesBrandOf(account.brand);
  const channel = channelOf(account.channel);
  if (!brand || !channel) return { ok: false, status: 404, problem: "Suggestions are not available for this account." };

  const catalog = loadCatalog();
  const [view, memory, library] = await Promise.all([
    readThreadForStaff(threadId),
    loadSuggestion(account.id, ids.metaConversationId),
    listLibraryFiles(catalog.map((c) => c.id)),
  ]);
  if (!view.ok) return { ok: false, status: view.status, problem: view.problem };

  const notes: string[] = [];
  if (!library.ok) notes.push(`${library.problem} Files cannot be offered right now.`);
  if (!memory.ok) notes.push(`${memory.problem} Suggestions start fresh and cannot be sent.`);
  const files = library.ok ? library.files : [];

  return {
    ok: true,
    account,
    brand,
    channel,
    ref: ids.metaConversationId,
    facts: { brand, channel, messages: view.messages, windowOpen: view.window.open },
    saved: memory.ok ? memory.saved : freshSaved(),
    memoryOk: memory.ok,
    deps: {
      knowledge: MONZA_KNOWLEDGE,
      catalog: withLibraryColours(catalog, files),
      media: libraryMedia(files),
      ttlHours: salesContextTtlHours(process.env.SALES_CONTEXT_TTL_HOURS),
    },
    notes,
  };
}

function viewOf(s: Suggestion, memoryOk: boolean, notes: string[]): SuggestionView {
  if (s.kind !== "suggestion") return { kind: s.kind, reason: s.reason, notes };
  const d = s.turn.decision;
  const blocked = [
    ...s.turn.policy.blocked,
    ...s.turn.policy.verdicts
      .filter((v) => v.blocked.length > 0)
      .map((v) => `${actionLabel(v.action)}: ${v.blocked.join("; ")}`),
  ];
  if (!memoryOk) blocked.push("The suggestion memory is not set up, so this cannot be sent yet.");
  const facing = d.actions.some(isCustomerFacing);
  return {
    kind: "suggestion",
    version: s.version,
    outcome: d.outcome,
    reason: d.reasons.join(" "),
    parts: s.turn.plan,
    actions: d.actions.map(actionLabel),
    gaps: d.gaps.map((g) => g.detail),
    blocked,
    canSend: facing && s.turn.plan.length > 0 && blocked.length === 0,
    understood: {
      intents: d.understanding.intents,
      model: d.understanding.model,
      language: d.understanding.reading.language,
    },
    notes,
  };
}

export async function suggestionFor(threadId: unknown): Promise<{ status: number; body: unknown }> {
  const c = await load(threadId);
  if (!c.ok) return { status: c.status, body: { ok: false, message: c.problem } };
  const s = suggestForThread(c.facts, c.saved, c.deps, { liveSending: channelsSendLive() });
  return { status: 200, body: viewOf(s, c.memoryOk, c.notes) };
}

export async function sendSuggestion(
  threadId: unknown,
  version: unknown,
  staffName: string
): Promise<{ status: number; body: unknown }> {
  const c = await load(threadId);
  if (!c.ok) return { status: c.status, body: { ok: false, message: c.problem } };
  if (!c.memoryOk) {
    return { status: 503, body: { ok: false, message: "The suggestion memory is not set up yet (migration 011) — nothing was sent." } };
  }

  const live = channelsSendLive();
  const s = suggestForThread(c.facts, c.saved, c.deps, { liveSending: live });
  const view = viewOf(s, c.memoryOk, c.notes);
  if (s.kind !== "suggestion" || s.version !== version) {
    return { status: 409, body: { ok: false, message: "The chat changed — here is the new suggestion. Nothing was sent.", view } };
  }
  if (!view.canSend) {
    return { status: 409, body: { ok: false, message: "This suggestion cannot be sent as it is.", view } };
  }

  const target = await suggestionTarget(threadId, live);
  if (target.kind === "switched_off") {
    return { status: 409, body: { ok: false, message: "Sending is switched off for now, so nothing was sent." } };
  }
  if (target.kind === "window_closed") return { status: 409, body: { ok: false, message: target.explanation } };
  if (target.kind === "refused") return { status: target.status, body: { ok: false, message: target.problem } };

  // Claim it first: a second person pressing Send now gets a conflict, not a duplicate.
  const claimed = afterSend(c.saved, null, []);
  const claim = await saveSuggestion({
    accountId: c.account.id,
    brand: c.account.brand,
    conversationRef: c.ref,
    saved: claimed,
    expectedRev: c.saved.rev,
  });
  if (claim !== "saved") {
    return {
      status: 409,
      body: {
        ok: false,
        message: claim === "conflict" ? "Someone else is sending this suggestion — nothing was sent twice." : "Could not save the suggestion memory — nothing was sent.",
      },
    };
  }

  const result = await executePlan(s.turn.plan, target.target);
  const at = new Date().toISOString();

  if (c.channel === "whatsapp") {
    for (const part of result.sent) {
      if (!part.externalMessageId) continue;
      const recorded = await recordWhatsAppSent({
        accountId: c.account.id,
        brand: c.account.brand,
        conversationId: target.conversationId,
        externalMessageId: part.externalMessageId,
        text: part.record,
        at,
        staffName,
        automationId: `${SUGGESTION_AUTOMATION_PREFIX}:${s.version}:${part.index}`,
      });
      if (!recorded) console.error("[sales/suggestion] sent, but the copy could not be recorded");
    }
  }

  // The engine's memory moves on only when the whole answer went.
  const remembered = afterSend(
    claimed,
    result.failed ? null : s.turn.decision.nextState,
    result.sent.map((p) => p.externalMessageId)
  );
  const saved = await saveSuggestion({
    accountId: c.account.id,
    brand: c.account.brand,
    conversationRef: c.ref,
    saved: remembered,
    expectedRev: claimed.rev,
  });
  if (saved !== "saved") console.error(`[sales/suggestion] sent, but the memory could not be saved (${saved})`);

  // Counts and ids only — never the words.
  console.info(
    `[sales/suggestion] ${result.failed ? "partial" : "sent"} ${result.sent.length}/${s.turn.plan.length} on ${c.account.id}`
  );

  if (result.failed) {
    return {
      status: result.sent.length > 0 ? 207 : 502,
      body: {
        ok: false,
        sent: result.sent.length,
        total: s.turn.plan.length,
        message:
          result.sent.length > 0
            ? `${result.sent.length} of ${s.turn.plan.length} messages went, then: ${result.failed.problem}`
            : result.failed.problem,
      },
    };
  }
  return { status: 200, body: { ok: true, sent: result.sent.length, total: s.turn.plan.length } };
}

export async function resumeSuggestions(threadId: unknown): Promise<{ status: number; body: unknown }> {
  const c = await load(threadId);
  if (!c.ok) return { status: c.status, body: { ok: false, message: c.problem } };
  if (!c.memoryOk) {
    return { status: 503, body: { ok: false, message: "The suggestion memory is not set up yet (migration 011)." } };
  }
  const next: SavedSuggestion = { ...c.saved, resumedAt: new Date().toISOString(), rev: c.saved.rev + 1 };
  const r = await saveSuggestion({
    accountId: c.account.id,
    brand: c.account.brand,
    conversationRef: c.ref,
    saved: next,
    expectedRev: c.saved.rev,
  });
  if (r !== "saved") return { status: 409, body: { ok: false, message: "Could not switch suggestions back on — try again." } };
  return suggestionFor(threadId);
}
