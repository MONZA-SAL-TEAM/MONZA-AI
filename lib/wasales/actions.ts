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
 *   SEND_BROCHURE            brochures always come first
 *   SEND_FACTS               approved facts, one car or several, in the order asked
 *   SEND_COMPARISON          several cars side by side
 *   SEND_COLOUR_LIST         colours of several cars, as text
 *   SEND_GLOBAL_INFO         location / opening hours / the sales number
 *   SEND_COLOUR_VIDEO
 *   COLOUR_NOT_AVAILABLE
 *   SEND_TEXT                fixed sentences: hand-offs, service, trade-in, …
 *   SEND_CONTACT_FALLBACK    at most one, however many reasons
 *   SEND_TEXT (a question)   "please send your name"…
 *   SHOW_CATEGORY            …a question always comes last,
 *   SHOW_TEST_DRIVE_SLOTS
 *   SHOW_COLOUR_CHOICES
 *   SHOW_MODEL_CHOICES
 *   SHOW_DEPARTMENTS         …so it is the thing the customer answers
 *   —  CONTENT_GAP, FLAG_FOR_STAFF, ALERT_SALES, BOOK_TEST_DRIVE: internal, never sent
 */

import type { CategoryFilter, FactIntent, GlobalIntent, Intent } from "@/lib/wasales/intent";
import {
  lookupFact,
  lookupGlobal,
  mediaFitsChannel,
  modelByCode,
  type FactStatus,
  type MediaRef,
  type ModelCode,
  type PowertrainBucket,
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

/** One fact of one car, as a SEND_FACTS row. `value` is empty when the workbook says it is not stated. */
export interface FactRow {
  model: ModelCode;
  fact: FactIntent;
  value: string;
  confirmed: boolean;
}

/**
 * The fixed sentences the engine may choose (the words are in templates.ts).
 * Keys ending in a question ask the customer something and so come last.
 */
export type TextKey =
  | "PRICE_HANDOFF"
  | "FINANCING_INFO"
  | "ASK_NAME"
  | "ASK_NAME_AND_PHONE"
  | "LEAD_THANKS"
  | "TEST_DRIVE_ASK_NAME"
  | "TEST_DRIVE_BOOKED"
  | "TEST_DRIVE_NO_SLOTS"
  | "STOCK_CONFIRM"
  | "DISCOUNT_HANDOFF"
  | "TRADE_IN_INFO"
  | "TRADE_IN_THANKS"
  | "SERVICE_CONTACT"
  | "COMPLAINT_CONTACT"
  | "ADMIN_CONTACT"
  | "MODEL_YEAR"
  | "OTHER_BRAND"
  | "HANDOFF";

/** Sentences that already carry a phone number. */
const GIVES_NUMBER: readonly TextKey[] = ["PRICE_HANDOFF", "DISCOUNT_HANDOFF", "STOCK_CONFIRM", "SERVICE_CONTACT", "COMPLAINT_CONTACT", "ADMIN_CONTACT", "HANDOFF"];

const QUESTION_TEXT: readonly TextKey[] = ["ASK_NAME", "ASK_NAME_AND_PHONE", "TEST_DRIVE_ASK_NAME"];

/** What the team is alerted about (inbox flag + WhatsApp to a salesperson). */
export type AlertKind = "PRICE" | "FINANCING" | "TEST_DRIVE" | "STOCK" | "DISCOUNT" | "TRADE_IN" | "NEEDS_PERSON";

export type EngineAction =
  | { type: "SEND_BROCHURE"; model: ModelCode; asset: MediaRef; explicit: boolean }
  | {
      type: "SEND_FACTS";
      /** "one": sentences about one car · "several": labelled lines per car · "all": every car in scope. */
      scope: "one" | "several" | "all";
      rows: FactRow[];
    }
  | { type: "SEND_COMPARISON"; models: ModelCode[]; rows: FactRow[] }
  | { type: "SEND_COLOUR_LIST"; rows: { model: ModelCode; colours: string[] }[] }
  | { type: "SEND_TEXT"; key: TextKey; models: ModelCode[]; vars?: Record<string, string> }
  | {
      type: "SHOW_CATEGORY";
      filter: CategoryFilter | "ALL_TYPES" | "SEATS";
      seats?: number;
      groups: { bucket: PowertrainBucket | null; models: ModelCode[] }[];
    }
  | { type: "SHOW_TEST_DRIVE_SLOTS"; models: ModelCode[]; slots: string[] }
  | { type: "SHOW_DEPARTMENTS" }
  | {
      type: "ALERT_SALES";
      kind: AlertKind;
      models: ModelCode[];
      /** The name the customer gave, when this message gave it. Never stored in the engine state. */
      name: string | null;
      /** A phone number the customer typed (Instagram, Messenger). */
      phone: string | null;
      slot: string | null;
    }
  | { type: "BOOK_TEST_DRIVE"; slot: string; models: ModelCode[] }
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
      /** How to ask: "which" (default), "explore" (after a list of every car), "first" (after several brochures). */
      prompt?: "which" | "explore" | "first";
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
  SEND_FACTS: 2,
  SEND_COMPARISON: 3,
  SEND_COLOUR_LIST: 4,
  SEND_GLOBAL_INFO: 5,
  COLOUR_NOT_AVAILABLE: 6,
  SEND_COLOUR_VIDEO: 7,
  SEND_TEXT: 8,
  SEND_CONTACT_FALLBACK: 9,
  SHOW_CATEGORY: 11,
  SHOW_TEST_DRIVE_SLOTS: 12,
  SHOW_COLOUR_CHOICES: 13,
  SHOW_MODEL_CHOICES: 14,
  SHOW_DEPARTMENTS: 15,
  CONTENT_GAP: 20,
  FLAG_FOR_STAFF: 21,
  ALERT_SALES: 22,
  BOOK_TEST_DRIVE: 23,
};

function priorityOf(a: EngineAction): number {
  // A sentence that asks something is a question: after the answers, before the buttons.
  if (a.type === "SEND_TEXT" && QUESTION_TEXT.includes(a.key)) return 10;
  return PRIORITY[a.type];
}

const INTERNAL: readonly ActionType[] = ["CONTENT_GAP", "FLAG_FOR_STAFF", "ALERT_SALES", "BOOK_TEST_DRIVE"];

/** Actions that reach the customer; the rest are for staff only. */
export function isCustomerFacing(action: EngineAction): boolean {
  return !INTERNAL.includes(action.type);
}

/** What makes two actions "the same" for de-duplication. */
function actionKey(a: EngineAction): string {
  switch (a.type) {
    case "SEND_BROCHURE":
      return `${a.type}:${a.model}`;
    case "SEND_FACTS":
      return `${a.type}:${a.scope}:${a.rows.map((r) => `${r.model}.${r.fact}`).join(",")}`;
    case "SEND_COMPARISON":
      return `${a.type}:${a.models.join(",")}`;
    case "SEND_COLOUR_LIST":
      return `${a.type}:${a.rows.map((r) => r.model).join(",")}`;
    case "SEND_TEXT":
      return `${a.type}:${a.key}`;
    case "SHOW_CATEGORY":
      return a.type;
    case "SHOW_TEST_DRIVE_SLOTS":
      return a.type;
    case "SHOW_DEPARTMENTS":
      return a.type;
    case "ALERT_SALES":
      return `${a.type}:${a.kind}`;
    case "BOOK_TEST_DRIVE":
      return a.type;
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
  // A sentence that already gives the number makes the generic hand-off a repeat.
  const numberGiven = out.some((x) => x.type === "SEND_TEXT" && GIVES_NUMBER.includes(x.key));
  if (reasons.length > 0 && !numberGiven) out.push({ type: "SEND_CONTACT_FALLBACK", reasons });

  const videoFor = new Set(
    out.filter((a) => a.type === "SEND_COLOUR_VIDEO").map((a) => a.model)
  );
  const pruned = out.filter(
    (a) => !(a.type === "SHOW_COLOUR_CHOICES" && videoFor.has(a.model))
  );

  return pruned
    .map((a, i) => ({ a, i }))
    .sort((x, y) => priorityOf(x.a) - priorityOf(y.a) || x.i - y.i)
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
    if (action.type === "SEND_FACTS" || action.type === "SEND_COMPARISON") {
      for (const row of action.rows) {
        const model = modelByCode(knowledge, row.model);
        const current = model ? lookupFact(model, row.fact) : null;
        const approvedValue = current?.fact?.approved ? current.fact.value : null;
        if (approvedValue === null || approvedValue !== row.value) {
          reasons.push("A fact is no longer approved as sent.");
          break;
        }
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
