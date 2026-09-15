/**
 * The Search Engine's OUTPUT — ordered, structured actions. Never words.
 *
 * An action says WHAT happens ("send the Courage brochure", "send the
 * horsepower fact", "show the colour choices"). The wording is a template's
 * job (templates.ts), and whether anything may actually leave the building is
 * the send policy's (bottom of this file). Keeping the three apart is what
 * lets the simulator show exactly what the engine understood even when every
 * send is blocked — which, today, every send is.
 *
 * THE ORDER IS FIXED, whatever order the engine found things in:
 *
 *   1  SEND_BROCHURE          the model's brochure always comes first
 *   2  SEND_FACT              approved facts, in the order asked
 *   3  SEND_GLOBAL_INFO       location / opening hours
 *   4  SEND_COLOUR_VIDEO
 *   5  COLOUR_NOT_AVAILABLE
 *   6  SEND_CONTACT_FALLBACK  at most one, however many reasons
 *   7  SHOW_COLOUR_CHOICES    a question always comes last…
 *   8  SHOW_MODEL_CHOICES     …so it is the thing the customer answers
 *   —  CONTENT_GAP, FLAG_FOR_STAFF   internal: never sent to a customer
 */

import type { FactIntent, GlobalIntent, Intent } from "@/lib/wasales/intent";
import {
  lookupFact,
  lookupGlobal,
  mediaFitsChannel,
  modelByCode,
  type FactStatus,
  type MediaRef,
  type ModelCode,
  type SalesChannel,
  type SalesKnowledge,
} from "@/lib/wasales/knowledge";

/* ── The vocabulary ──────────────────────────────────────────────────────── */

/** Why the contact number is being given. One fallback can carry several. */
export type FallbackReason =
  /** A question a person must answer: price, installments, test drive, … */
  | { kind: "CONTACT_INTENT"; intent: Intent; model: ModelCode | null }
  /** A fact the customer asked for has no approved value. */
  | { kind: "MISSING_FACT"; model: ModelCode; fact: FactIntent; status: FactStatus }
  /** Location or opening hours have no approved value. */
  | { kind: "MISSING_GLOBAL"; key: GlobalIntent; status: FactStatus }
  /** The customer asked for the number itself. */
  | { kind: "CONTACT_NUMBER" }
  /** The model has no brochure to open the conversation with. */
  | { kind: "MISSING_BROCHURE"; model: ModelCode }
  /** The model has no colour with a video. */
  | { kind: "NO_COLOUR_MEDIA"; model: ModelCode }
  /** The model belongs to a brand this account does not sell. */
  | { kind: "CROSS_BRAND"; model: ModelCode }
  /** "Tell me more" after the brochure has already gone. */
  | { kind: "MORE_INFO"; model: ModelCode }
  /** Staff switched automation off for this model on /sales. */
  | { kind: "MODEL_SWITCHED_OFF"; model: ModelCode };

export type ContentGapKind = "BROCHURE" | "COLOUR_MEDIA" | "FACT" | "GLOBAL";

export type EngineAction =
  | { type: "SEND_BROCHURE"; model: ModelCode; asset: MediaRef; explicit: boolean }
  | { type: "SEND_FACT"; model: ModelCode; fact: FactIntent; value: string; source: string }
  | { type: "SEND_GLOBAL_INFO"; key: GlobalIntent; value: string; source: string }
  | {
      type: "SEND_COLOUR_VIDEO";
      model: ModelCode;
      colour: string;
      colourName: string;
      asset: MediaRef;
      /** True when the customer said "any" and the engine picked. */
      chosenForThem: boolean;
      /**
       * The model has exactly one colour with a video (Voyah Dream, filmed
       * without colour folders): the words must not name or offer a colour.
       */
      onlyOption: boolean;
    }
  | { type: "COLOUR_NOT_AVAILABLE"; model: ModelCode; requested: string }
  | { type: "SEND_CONTACT_FALLBACK"; reasons: FallbackReason[] }
  | {
      type: "SHOW_COLOUR_CHOICES";
      model: ModelCode;
      colours: { id: string; name: string }[];
    }
  | {
      type: "SHOW_MODEL_CHOICES";
      models: ModelCode[];
      /** Open with a welcome: a new conversation that said hello. */
      greet: boolean;
      /** A narrowed "which one?" of a few, rather than the whole range. */
      narrowed: boolean;
    }
  | {
      type: "CONTENT_GAP";
      model: ModelCode | null;
      content: ContentGapKind;
      /** The fact or global key, for FACT and GLOBAL gaps. */
      key: string | null;
      status: FactStatus | null;
      /** "MISSING APPROVED FACT: COURAGE / HORSEPOWER" — for staff and the simulator. */
      detail: string;
    }
  | { type: "FLAG_FOR_STAFF"; reason: string };

export type ActionType = EngineAction["type"];

const PRIORITY: Readonly<Record<ActionType, number>> = {
  SEND_BROCHURE: 1,
  SEND_FACT: 2,
  SEND_GLOBAL_INFO: 3,
  SEND_COLOUR_VIDEO: 4,
  COLOUR_NOT_AVAILABLE: 5,
  SEND_CONTACT_FALLBACK: 6,
  SHOW_COLOUR_CHOICES: 7,
  SHOW_MODEL_CHOICES: 8,
  CONTENT_GAP: 9,
  FLAG_FOR_STAFF: 10,
};

/** Actions that reach the customer; the rest are for staff only. */
export function isCustomerFacing(action: EngineAction): boolean {
  return action.type !== "CONTENT_GAP" && action.type !== "FLAG_FOR_STAFF";
}

/** What makes two actions "the same" for de-duplication. */
function actionKey(a: EngineAction): string {
  switch (a.type) {
    case "SEND_BROCHURE":
      return `${a.type}:${a.model}`;
    case "SEND_FACT":
      return `${a.type}:${a.model}:${a.fact}`;
    case "SEND_GLOBAL_INFO":
      return `${a.type}:${a.key}`;
    case "SEND_COLOUR_VIDEO":
      return `${a.type}:${a.model}:${a.colour}`;
    case "COLOUR_NOT_AVAILABLE":
      return `${a.type}:${a.model}:${a.requested}`;
    case "SEND_CONTACT_FALLBACK":
      return a.type;
    case "SHOW_COLOUR_CHOICES":
      return `${a.type}:${a.model}`;
    case "SHOW_MODEL_CHOICES":
      return a.type;
    case "CONTENT_GAP":
      return `${a.type}:${a.model ?? "-"}:${a.content}:${a.key ?? "-"}`;
    case "FLAG_FOR_STAFF":
      return `${a.type}:${a.reason}`;
  }
}

function reasonKey(r: FallbackReason): string {
  return JSON.stringify(r);
}

/**
 * The final, ordered action list: duplicates removed, every contact fallback
 * merged into ONE (carrying all its reasons), colour choices dropped when the
 * colour's video is already going out, and everything sorted into the fixed
 * order above. Stable: within one priority, the engine's order is kept — so
 * facts come out in the order the customer asked for them.
 */
export function finalizeActions(actions: readonly EngineAction[]): EngineAction[] {
  const reasons: FallbackReason[] = [];
  const seenReasons = new Set<string>();
  const out: EngineAction[] = [];
  const seen = new Set<string>();

  for (const a of actions) {
    if (a.type === "SEND_CONTACT_FALLBACK") {
      for (const r of a.reasons) {
        const key = reasonKey(r);
        if (!seenReasons.has(key)) {
          seenReasons.add(key);
          reasons.push(r);
        }
      }
      continue;
    }
    const key = actionKey(a);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  if (reasons.length > 0) out.push({ type: "SEND_CONTACT_FALLBACK", reasons });

  const videoFor = new Set(
    out.filter((a) => a.type === "SEND_COLOUR_VIDEO").map((a) => a.model)
  );
  const pruned = out.filter(
    (a) => !(a.type === "SHOW_COLOUR_CHOICES" && videoFor.has(a.model))
  );

  return pruned
    .map((a, i) => ({ a, i }))
    .sort((x, y) => PRIORITY[x.a.type] - PRIORITY[y.a.type] || x.i - y.i)
    .map(({ a }) => a);
}

/* ── The send policy ─────────────────────────────────────────────────────── */

/**
 * Everything that must be true before an action may leave the building. The
 * engine's understanding never depends on these: the simulator shows what the
 * engine WOULD do, and then, separately, why it cannot.
 */
export interface SendContext {
  channel: SalesChannel;
  /** The owner's kill switch on /sales. */
  autoSendEnabled: boolean;
  /** Meta's 24-hour window since the customer's last message. */
  replyWindowOpen: boolean;
  /** A person has taken this conversation over. */
  humanLock: boolean;
  /**
   * CHANNELS_SEND_MODE is "live" AND automated replies have been explicitly
   * allowed. CLAUDE.md rule 24 keeps this false: no inbound message may
   * trigger an outbound one without a person.
   */
  liveSending: boolean;
  /** The channel adapter can send files. */
  attachmentsSupported: boolean;
  /**
   * A file too big for the channel but in the shared library goes as a link
   * in the sentence (templates.ts), so its size does not block the plan.
   */
  linkOversize?: boolean;
}

export interface ActionVerdict {
  action: EngineAction;
  customerFacing: boolean;
  /** Why this action cannot go out; empty when it could. */
  blocked: string[];
}

export interface PolicyResult {
  verdicts: ActionVerdict[];
  /** Reasons that stop EVERYTHING, whatever the actions are. */
  blocked: string[];
  /**
   * True only when every customer-facing action may go out. The plan goes out
   * whole or not at all: the brochure-first order is part of the answer, and
   * half of it would be a different answer.
   */
  wouldSend: boolean;
}

export function applySendPolicy(
  actions: readonly EngineAction[],
  ctx: SendContext,
  knowledge: SalesKnowledge
): PolicyResult {
  const blocked: string[] = [];
  if (!ctx.autoSendEnabled) blocked.push("Auto-send is switched off.");
  if (ctx.humanLock) blocked.push("A person is handling this conversation.");
  if (!ctx.replyWindowOpen) {
    blocked.push("Outside Meta's 24-hour reply window — a free reply would be refused.");
  }
  if (!ctx.liveSending) {
    blocked.push("Live sending is off: the executor only logs (CLAUDE.md rule 24).");
  }

  const verdicts: ActionVerdict[] = actions.map((action) => {
    const reasons: string[] = [];
    if (action.type === "SEND_BROCHURE" || action.type === "SEND_COLOUR_VIDEO") {
      const kind = action.type === "SEND_BROCHURE" ? "document" : "video";
      const fit = mediaFitsChannel(action.asset, kind, ctx.channel);
      // Too big for the channel but in the library: it goes as a link instead.
      const asLink = fit !== null && ctx.linkOversize === true && Boolean(action.asset.url);
      if (!ctx.attachmentsSupported && !asLink) {
        reasons.push("The channel adapter cannot send files yet.");
      }
      if (fit && !asLink) reasons.push(fit);
      if (!action.asset.url) {
        reasons.push("That file is only in the sales folder — upload it to the shared library on /sales first.");
      }
    }
    if (action.type === "SEND_FACT") {
      const model = modelByCode(knowledge, action.model);
      const current = model ? lookupFact(model, action.fact) : null;
      if (!current || current.status !== "OK" || current.fact?.value !== action.value) {
        reasons.push("That fact is no longer approved as sent.");
      }
    }
    if (action.type === "SEND_GLOBAL_INFO") {
      const current = lookupGlobal(knowledge, action.key);
      if (current.status !== "OK" || current.fact?.value !== action.value) {
        reasons.push("That information is no longer approved as sent.");
      }
    }
    return { action, customerFacing: isCustomerFacing(action), blocked: reasons };
  });

  const anyToSend = verdicts.some((v) => v.customerFacing);
  const allClear = verdicts.every((v) => !v.customerFacing || v.blocked.length === 0);
  return { verdicts, blocked, wouldSend: anyToSend && allClear && blocked.length === 0 };
}
