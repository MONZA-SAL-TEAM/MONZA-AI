/**
 * The conversation state the Search Engine threads through a conversation.
 *
 * One small record per conversation: which model we are talking about, which
 * colour, what the customer asked before we knew the model, and what we are
 * waiting for. Everything else — the facts, the files, the wording — is looked
 * up fresh on every message, so a corrected fact or a new video takes effect
 * in the middle of a conversation rather than at the next one.
 *
 * STATEFUL BUT PURE, exactly as the old flow was: the state goes into the
 * engine as an argument and comes back as a new object. The caller (a webhook
 * handler, or the simulator on /sales) owns persistence — see
 * database/migrations/008_conversation_sales_state.sql — and this module
 * stays deterministic and testable.
 *
 * THE SALES CONTEXT EXPIRES. SALES_CONTEXT_TTL_HOURS after the last message,
 * the model, colour and pending questions are forgotten and the next message
 * starts clean. That is a SALES rule — "they came back a week later, don't
 * assume it is still the Courage" — and it is deliberately separate from
 * Meta's 24-hour reply window, which is about whether a reply may be sent at
 * all and is enforced by the send policy (actions.ts), not here.
 */

import { INTENTS, type CategoryFilter, type Intent } from "@/lib/wasales/intent";
import { isModelCode, type ModelCode } from "@/lib/wasales/knowledge";

export type Awaiting = "NONE" | "MODEL" | "COLOUR" | "LEAD_NAME" | "LEAD_PHONE" | "TEST_DRIVE_SLOT" | "PERSON";

/**
 * A sales request the team must follow up (workbook, C Decisions): what it is
 * about and which cars. The customer's NAME is never kept here — it goes
 * straight into the sales alert — so this memory still holds no customer words.
 */
export type LeadKind = "FINANCING" | "TEST_DRIVE" | "CALLBACK";

export interface LeadState {
  kind: LeadKind;
  models: ModelCode[];
  /** The name arrived and the team was alerted. */
  captured: boolean;
  /** Installments asked together with a test drive: after the name, the slots too. */
  andTestDrive?: boolean;
  /** Which of the two the customer has given (WhatsApp already knows the number). */
  haveName?: boolean;
  havePhone?: boolean;
}

export interface SearchEngineState {
  version: 1;
  activeModel: ModelCode | null;
  /** A catalogue colour id ("black"), for the active model only. */
  selectedColour: string | null;
  /** Model-dependent questions asked before the model was known, in order. */
  pendingIntents: Intent[];
  awaiting: Awaiting;
  lastIntent: Intent | null;
  /** Increments every time a model becomes active: the brochure rule keys on it. */
  modelActivationId: number;
  brochureSentForCurrentActivation: boolean;
  colourPromptSentForCurrentActivation: boolean;
  /**
   * The models offered in the last "which model?", in the order shown, so a
   * numbered answer ("2") or an ordinal ("the second one") can answer it.
   */
  offeredModels: ModelCode[];
  /** The colour ids offered in the last colour question, in order. */
  offeredColours: string[];
  /**
   * Every car the customer has in play (workbook E: "keep several models").
   * One car here is the same as activeModel; two or more are answered together.
   */
  selectedModels: ModelCode[];
  /** "which EVs / hybrids?": the type the customer narrowed to. */
  categoryFilter: CategoryFilter | null;
  /** Installments or a test drive being taken down for the team. */
  lead: LeadState | null;
  /** Test-drive slots offered, as ISO times, so a numbered answer can pick one. */
  offeredSlots: string[];
  /** The test drive booked in this chat (UTC ISO), for "change" / "cancel" / "when is it". */
  booking: string | null;
  /** A time the customer typed before giving their name; booked once the name arrives. */
  requestedSlot: string | null;
  /**
   * Staff pressed "Hand this chat to a person": the bot stays out of this chat
   * until "Suggest again", however long the chat goes quiet.
   */
  manualTakeover: boolean;
  /** ISO time of the last message the engine read, from the message itself. */
  updatedAt: string | null;
}

/** A brand-new state. A fresh object every call, so nobody can share one. */
export function freshState(): SearchEngineState {
  return {
    version: 1,
    activeModel: null,
    selectedColour: null,
    pendingIntents: [],
    awaiting: "NONE",
    lastIntent: null,
    modelActivationId: 0,
    brochureSentForCurrentActivation: false,
    colourPromptSentForCurrentActivation: false,
    offeredModels: [],
    offeredColours: [],
    selectedModels: [],
    categoryFilter: null,
    lead: null,
    offeredSlots: [],
    booking: null,
    requestedSlot: null,
    manualTakeover: false,
    updatedAt: null,
  };
}

/* ── How long a sales context lives ──────────────────────────────────────── */

export const DEFAULT_SALES_CONTEXT_TTL_HOURS = 72;
const MAX_SALES_CONTEXT_TTL_HOURS = 24 * 30;

/**
 * SALES_CONTEXT_TTL_HOURS as configured, or the default. A whole number of
 * hours from 1 to 720; anything else — unset, empty, "3 days", "-1" — is the
 * default rather than a surprise.
 */
export function salesContextTtlHours(raw: string | undefined | null): number {
  if (typeof raw !== "string" || !/^\s*\d{1,3}\s*$/.test(raw)) {
    return DEFAULT_SALES_CONTEXT_TTL_HOURS;
  }
  const hours = Number(raw.trim());
  return hours >= 1 && hours <= MAX_SALES_CONTEXT_TTL_HOURS
    ? hours
    : DEFAULT_SALES_CONTEXT_TTL_HOURS;
}

/**
 * Has the sales context gone stale? A state with no time, or a message with
 * an unreadable time, is NOT expired: forgetting a live conversation because
 * a timestamp was malformed would be the worse mistake.
 */
export function isExpired(state: SearchEngineState, nowIso: string, ttlHours: number): boolean {
  if (!state.updatedAt) return false;
  const last = Date.parse(state.updatedAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(last) || !Number.isFinite(now)) return false;
  return now - last > ttlHours * 3_600_000;
}

/** Does the state carry anything worth continuing? */
export function hasContext(state: SearchEngineState): boolean {
  return (
    state.activeModel !== null ||
    state.selectedModels.length > 0 ||
    state.pendingIntents.length > 0 ||
    state.lead !== null ||
    state.awaiting !== "NONE"
  );
}

/* ── Reading a stored state ──────────────────────────────────────────────── */

const AWAITING: readonly Awaiting[] = ["NONE", "MODEL", "COLOUR", "LEAD_NAME", "LEAD_PHONE", "TEST_DRIVE_SLOT", "PERSON"];
const CATEGORIES: readonly CategoryFilter[] = ["EV", "EREV", "PHEV", "HYBRID"];

function leadOrNull(value: unknown): LeadState | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.kind !== "FINANCING" && v.kind !== "TEST_DRIVE" && v.kind !== "CALLBACK") return null;
  return {
    kind: v.kind,
    models: Array.isArray(v.models) ? v.models.map(modelOrNull).filter((m): m is ModelCode => m !== null) : [],
    captured: v.captured === true,
    ...(v.andTestDrive === true ? { andTestDrive: true } : {}),
    ...(v.haveName === true ? { haveName: true } : {}),
    ...(v.havePhone === true ? { havePhone: true } : {}),
  };
}
const COLOUR_ID = /^[a-z0-9-]{1,64}$/;

function isIntent(value: unknown): value is Intent {
  return typeof value === "string" && (INTENTS as readonly string[]).includes(value);
}

function modelOrNull(value: unknown): ModelCode | null {
  return typeof value === "string" && isModelCode(value) ? value : null;
}

/**
 * A state read back from storage, validated field by field. Storage is ours,
 * but a row written by an older version, or edited by hand, must not be able
 * to put the engine somewhere it cannot reason about — anything unreadable
 * falls back to that field's fresh value.
 */
export function parseState(stored: unknown): SearchEngineState {
  const fresh = freshState();
  if (!stored || typeof stored !== "object") return fresh;
  const s = stored as Record<string, unknown>;
  if (s.version !== 1) return fresh;

  const colour = typeof s.selectedColour === "string" && COLOUR_ID.test(s.selectedColour)
    ? s.selectedColour
    : null;
  const activation = typeof s.modelActivationId === "number" &&
    Number.isInteger(s.modelActivationId) && s.modelActivationId >= 0
    ? s.modelActivationId
    : 0;

  return {
    version: 1,
    activeModel: modelOrNull(s.activeModel),
    selectedColour: colour,
    pendingIntents: Array.isArray(s.pendingIntents)
      ? [...new Set(s.pendingIntents.filter(isIntent))]
      : [],
    awaiting: AWAITING.includes(s.awaiting as Awaiting) ? (s.awaiting as Awaiting) : "NONE",
    lastIntent: isIntent(s.lastIntent) ? s.lastIntent : null,
    modelActivationId: activation,
    brochureSentForCurrentActivation: s.brochureSentForCurrentActivation === true,
    colourPromptSentForCurrentActivation: s.colourPromptSentForCurrentActivation === true,
    offeredModels: Array.isArray(s.offeredModels)
      ? s.offeredModels.map(modelOrNull).filter((m): m is ModelCode => m !== null)
      : [],
    offeredColours: Array.isArray(s.offeredColours)
      ? s.offeredColours.filter((c): c is string => typeof c === "string" && COLOUR_ID.test(c))
      : [],
    // Written by a version before several cars could be kept: the active car is the selection.
    selectedModels: Array.isArray(s.selectedModels)
      ? [...new Set(s.selectedModels.map(modelOrNull).filter((m): m is ModelCode => m !== null))]
      : modelOrNull(s.activeModel)
        ? [modelOrNull(s.activeModel) as ModelCode]
        : [],
    categoryFilter: CATEGORIES.includes(s.categoryFilter as CategoryFilter) ? (s.categoryFilter as CategoryFilter) : null,
    lead: leadOrNull(s.lead),
    offeredSlots: Array.isArray(s.offeredSlots)
      ? s.offeredSlots.filter((t): t is string => typeof t === "string" && Number.isFinite(Date.parse(t))).slice(0, 13)
      : [],
    booking: typeof s.booking === "string" && Number.isFinite(Date.parse(s.booking)) ? s.booking : null,
    requestedSlot: typeof s.requestedSlot === "string" && Number.isFinite(Date.parse(s.requestedSlot)) ? s.requestedSlot : null,
    manualTakeover: s.manualTakeover === true,
    updatedAt:
      typeof s.updatedAt === "string" && Number.isFinite(Date.parse(s.updatedAt))
        ? s.updatedAt
        : null,
  };
}
