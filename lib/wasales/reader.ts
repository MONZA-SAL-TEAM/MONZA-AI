/**
 * The insights READER: a conversation read the way a person reads it — message after message, with
 * memory (Samer, 2026-10-12). "Free 318 price?" then "do you have it in white?" is white FOR THE FREE.
 *
 * It runs the bot's own engine (decide) over every customer message, threading the conversation state,
 * but as a LISTENER: what the customer said is remembered (the cars, the ad, the trade-in), what the bot
 * would have asked is forgotten. The bot is silent for almost everyone (silence.ts, and everyone outside
 * the pilot), so a later "yes", "2" or "white" must never be read as the answer to a question nobody
 * asked. A car a staff member names is context ("here is the Courage brochure" → the Courage is being
 * discussed), never the customer's interest.
 *
 * Pure. Never keeps words: a turn's text is read and dropped; the output is labels.
 */

import { freshState, isExpired, type SearchEngineState } from "@/lib/wasales/context";
import { decide, engineCars, type EngineDeps } from "@/lib/wasales/engine";
import { resolveModels } from "@/lib/wasales/entities";
import { vocabularyWords } from "@/lib/wasales/intent";
import { modelByCatalogueId, salesBrandOf, type ModelCode, type SalesKnowledge } from "@/lib/wasales/knowledge";
import { observe, type Observation } from "@/lib/wasales/observe";
import { signalFromDecision, type Signal, type SignalMeta } from "@/lib/wasales/signal";

/** Bump when a reading rule changes: stored rows on an older version are read again. */
export const READER_VERSION = 6;

export interface Turn {
  author: "customer" | "staff" | "automation";
  text: string;
  hasMedia: boolean;
  /** ISO, from the platform. */
  at: string;
  externalMessageId: string;
}

export interface ReadResult {
  signal: Signal & { readerVersion: number; contextModels: string[]; needs: string[]; ownerSupport: boolean; ended: boolean; adModel: string | null };
  observations: Observation[];
}

const VOCABULARY = vocabularyWords();

/**
 * The brand a message is about. A brand account's messages are its brand (rule 1). Monza's shared WhatsApp
 * number sells both marques, so there the cars decide — named, by context or the ad's — when they are all of
 * one marque; otherwise (no car, or both marques) it stays "monza" (Samer's audit, 2026-10-13: every
 * WhatsApp message was "Monza S.A.L.", so VOYAH and MHERO showed nothing for WhatsApp).
 */
export function messageBrand(accountBrand: string, codes: readonly (string | null | undefined)[], k: SalesKnowledge): string {
  if (accountBrand !== "monza") return accountBrand;
  const brands = new Set(codes.map((c) => (c ? k.models.find((m) => m.code === c)?.brand : undefined)).filter((b): b is "voyah" | "mhero" => Boolean(b)));
  return brands.size === 1 ? [...brands][0] : accountBrand;
}

/** What a listener keeps: the customer's words, never the bot's questions. */
export function listenerState(next: SearchEngineState): SearchEngineState {
  return {
    ...next,
    awaiting: "NONE",
    offeredModels: [],
    offeredColours: [],
    offeredSlots: [],
    brochuresJustSent: [],
    unknownSaid: false,
    lead: null,
    pendingDay: null,
    pendingVisit: false,
  };
}

/** A staff (or bot) message: the car it names becomes the car being discussed. Never a customer fact. */
export function noteStaffWords(state: SearchEngineState, text: string, at: string, deps: EngineDeps): SearchEngineState {
  if (!text.trim()) return state;
  const k = deps.knowledge;
  const found = resolveModels(text, engineCars(k, deps.catalog), { offeredCarIds: [], discussedCarIds: [], adCarId: null, intentWords: VOCABULARY.single, carTalkWords: VOCABULARY.carTalk });
  const codes = found.mentions
    .filter((m) => m.confidence === "strong")
    .map((m) => modelByCatalogueId(k, m.carId)?.code)
    .filter((c): c is ModelCode => Boolean(c));
  const unique = codes.filter((c, i) => codes.indexOf(c) === i);
  if (unique.length !== 1) return state; // a list of the whole range is not "the car being discussed"
  const code = unique[0];
  return { ...state, activeModel: code, recentModels: [code, ...state.recentModels.filter((m) => m !== code)].slice(0, 2), updatedAt: at };
}

/** One customer message, read in its conversation. Null when the engine excludes it (a scam, a vendor). */
export function readNext(turn: Turn, state: SearchEngineState, meta: SignalMeta, deps: EngineDeps): { result: ReadResult | null; state: SearchEngineState } {
  const brand = salesBrandOf(meta.brand);
  if (!brand) return { result: null, state };
  const d = decide(
    {
      text: turn.text,
      hasMedia: turn.hasMedia,
      brand,
      channel: meta.channel as "whatsapp" | "instagram" | "facebook",
      conversationIsNew: state.updatedAt === null,
      now: turn.at,
      // The ad the chat came from (Samer, 2026-10-12: 557 people came from the COURAGE ad): the engine
      // makes it soft context, exactly as for the live bot — "how much is it?" is then the Courage.
      ...(meta.adHeadline ? { referral: { headline: meta.adHeadline } } : {}),
    },
    state,
    deps
  );
  const next = listenerState(d.nextState);
  const signal = signalFromDecision(d, meta);
  if (!signal) return { result: null, state: next };
  const u = d.understanding;
  const contextual = u.modelSource === "state" || u.modelSource === "ad" || u.modelSource === "referral";
  const contextModels = contextual ? [...new Set([...u.models, ...(u.model ? [u.model] : [])])] : [];
  // The memory the observer may use is the memory the engine used: none, once the conversation has gone cold.
  const before = isExpired(state, turn.at, deps.ttlHours) ? freshState() : state;
  const observations = observe(turn.text, d, { knowledge: deps.knowledge, cars: engineCars(deps.knowledge, deps.catalog), before });
  return {
    result: {
      signal: { ...signal, brand: messageBrand(signal.brand, [...signal.models, ...contextModels, next.adModel], deps.knowledge), readerVersion: READER_VERSION, contextModels, needs: observations.filter((o) => o.kind === "need").map((o) => o.value), ownerSupport: u.ownerSupport, ended: u.ended, adModel: next.adModel ?? null },
      observations,
    },
    state: next,
  };
}

/** A whole conversation, oldest first. Staff and bot turns are context only. */
export function readConversation(
  turns: readonly Turn[],
  meta: Omit<SignalMeta, "externalMessageId" | "at" | "hasMedia">,
  deps: EngineDeps,
  start: SearchEngineState = freshState()
): { results: ReadResult[]; state: SearchEngineState; lastAt: string | null; lastId: string | null } {
  let state = start;
  const results: ReadResult[] = [];
  let lastAt: string | null = null;
  let lastId: string | null = null;
  const ordered = [...turns].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const t of ordered) {
    lastAt = t.at;
    if (t.author !== "customer") {
      state = noteStaffWords(state, t.text, t.at, deps);
      continue;
    }
    lastId = t.externalMessageId;
    const r = readNext(t, state, { ...meta, externalMessageId: t.externalMessageId, at: t.at, hasMedia: t.hasMedia }, deps);
    state = r.state;
    if (r.result) results.push(r.result);
  }
  return { results, state, lastAt, lastId };
}
