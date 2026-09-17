/**
 * THE MONZA CUSTOMER SEARCH & MEDIA ENGINE — the decision.
 *
 * Not a chatbot. Three deterministic stages, each in its own place:
 *
 *   UNDERSTAND  intent.ts reads WHAT was asked; understand() below reads
 *               WHICH MODEL (a button, the words, a numbered answer, a known
 *               ad, or the model already being discussed) and WHICH COLOUR.
 *   SEARCH      decide() looks the answer up — approved facts
 *               (knowledge.ts) and uploaded files (the ModelMediaLookup) —
 *               and returns ordered, structured actions (actions.ts).
 *   EXECUTE     templates.ts turns the actions into channel messages, and
 *               actions.ts's send policy decides whether any may go out.
 *
 * The engine never writes a sentence, never invents a fact, and never sends
 * anything. The same message in the same state always produces the same
 * decision, so the simulator on /sales IS the production behaviour.
 *
 * THE RULES, in the order they bite:
 *
 *   - Echoes, receipts, reactions, Meta system events, fake Meta-support
 *     scams, vendor pitches and internal tests are EXCLUDED: no action, and
 *     the state does not move.
 *   - The BRAND is the receiving account's — never the text's. A model the
 *     account does not sell gets the contact number, never another brand's
 *     brochure. MONZA SAL accounts sell both marques.
 *   - A model becoming active (none → one, one → another, or a known ad)
 *     sends its BROCHURE FIRST. The same model is never re-sent its brochure
 *     unless the customer asks for the brochure.
 *   - A question that needs a model, asked without one, is saved as PENDING
 *     and the customer is asked which model. The answer triggers: brochure →
 *     the pending answers in order → colour choices.
 *   - Facts are sent only when APPROVED. Anything else — missing,
 *     unapproved, empty, zero — gets the contact number and a CONTENT_GAP
 *     naming exactly what is missing.
 *   - Price, installments, test drives, discounts, trade-ins, service, parts
 *     and complaints get the contact number: a person answers those.
 *   - Only colours with a video are offered. A colour already given is never
 *     asked again. A colour with no video is said honestly, then the real
 *     choices are shown.
 *   - The sales context expires (context.ts) — separately from Meta's 24-hour
 *     window. A returning customer is still answered: the old "new number,
 *     first message only" rule is gone. A bare "hi" in an old conversation
 *     with no live context is left to a person.
 */

import {
  isContactIntent,
  isFactIntent,
  isGlobalIntent,
  isModelIntent,
  parsePayload,
  readMessage,
  type Intent,
  type MessageReading,
} from "@/lib/wasales/intent";
import { familyMentioned, matchModel, pickAmong, type WaCar } from "@/lib/wasales/matcher";
import { readColourAnswer, sendableColours, type WaColour } from "@/lib/wasales/colours";
import {
  freshState,
  hasContext,
  isExpired,
  type SearchEngineState,
} from "@/lib/wasales/context";
import {
  brandSells,
  isModelCode,
  lookupFact,
  lookupGlobal,
  modelByCatalogueId,
  modelByCode,
  modelsForBrand,
  NO_MEDIA,
  salesBrandOf,
  videoCounts,
  type FactStatus,
  type ModelCode,
  type ModelMediaLookup,
  type SalesBrand,
  type SalesKnowledge,
} from "@/lib/wasales/knowledge";
import {
  finalizeActions,
  isCustomerFacing,
  type ContentGapKind,
  type EngineAction,
  type FallbackReason,
} from "@/lib/wasales/actions";

/* ── Input and output ────────────────────────────────────────────────────── */

/** What Meta delivered. Anything but "message" is never answered. */
export type EventKind = "message" | "echo" | "read" | "delivery" | "reaction" | "system";

export interface EngineInput {
  /** The customer's words; may be empty (a photo, a story reply). */
  text: string;
  /** A tapped button's payload ("MODEL:COURAGE"), when there was one. */
  payload?: string | null;
  /** The ad or link the conversation started from, when Meta says. */
  referral?: { ref?: string | null; adId?: string | null } | null;
  /** The message carried a photo, video, sticker or shared post. */
  hasMedia?: boolean;
  eventKind?: EventKind;
  /**
   * The RECEIVING account's brand, from its verified Meta id (CLAUDE.md rule
   * 1). Never derived from the text.
   */
  brand: string;
  /** No earlier message, from either side, in this thread. */
  conversationIsNew: boolean;
  /** When the customer sent it — from the payload, never the clock (rule 18). */
  now: string;
}

export interface EngineDeps {
  knowledge: SalesKnowledge;
  /** The sales catalogue (lib/wasales/catalog.ts): aliases, colours, on/off. */
  catalog: readonly WaCar[];
  /** What has really been uploaded, per catalogue car. */
  media: ModelMediaLookup;
  /** SALES_CONTEXT_TTL_HOURS (context.ts). */
  ttlHours: number;
}

/** Where the model came from. "state" means nobody named it this message. */
export type ModelSource = "payload" | "text" | "choice" | "referral" | "state" | "none";

export type ColourReading =
  | { kind: "none" }
  | { kind: "one"; id: string; name: string; source: "payload" | "text" | "choice" }
  | { kind: "no_preference" }
  | { kind: "unavailable"; requested: string }
  | { kind: "several"; ids: string[] };

export interface Understanding {
  reading: MessageReading;
  /** The intents acted on; ["UNKNOWN"] when nothing at all was recognised. */
  intents: Intent[];
  model: ModelCode | null;
  modelSource: ModelSource;
  /** The words that named the model, when words did. */
  modelMatchedText: string | null;
  /** Several of this account's models named at once, or a brand with no model. */
  modelCandidates: ModelCode[];
  /** Models named that this account's brand does not sell. */
  crossBrand: ModelCode[];
  /** A model named whose automation staff switched off on /sales. */
  switchedOff: ModelCode | null;
  colour: ColourReading;
}

export type Activation = { kind: "NEW" | "SWITCH" | "REFERRAL"; model: ModelCode; id: number };

export interface EngineDecision {
  outcome: "ACTIONS" | "NO_AUTOMATIC_ACTION" | "EXCLUDED";
  understanding: Understanding;
  /** The state as it came in. */
  previousState: SearchEngineState;
  /** True when the sales context had expired and was reset before reading. */
  expired: boolean;
  activation: Activation | null;
  /** In the fixed order of actions.ts, customer-facing and internal alike. */
  actions: EngineAction[];
  nextState: SearchEngineState;
  /** Why nothing, or less than expected, happened — in plain words. */
  reasons: string[];
  gaps: Extract<EngineAction, { type: "CONTENT_GAP" }>[];
}

/* ── Small helpers ───────────────────────────────────────────────────────── */

function cloneState(s: SearchEngineState): SearchEngineState {
  return {
    ...s,
    pendingIntents: [...s.pendingIntents],
    offeredModels: [...s.offeredModels],
    offeredColours: [...s.offeredColours],
  };
}

function unique<T>(items: readonly T[]): T[] {
  const out: T[] = [];
  for (const item of items) if (!out.includes(item)) out.push(item);
  return out;
}

/** "PASSION_L" → "PASSION L", for staff-facing lines. */
export function modelLabel(code: ModelCode): string {
  return code.replace(/_/g, " ");
}

/** The catalogue cars of every model the knowledge knows. */
export function engineCars(k: SalesKnowledge, catalog: readonly WaCar[]): WaCar[] {
  const out: WaCar[] = [];
  for (const model of k.models) {
    const car = catalog.find((c) => c.id === model.catalogueId);
    if (car) out.push(car);
  }
  return out;
}

function codesOf(k: SalesKnowledge, catalogueIds: readonly string[]): ModelCode[] {
  return unique(
    catalogueIds
      .map((id) => modelByCatalogueId(k, id)?.code)
      .filter((c): c is ModelCode => Boolean(c))
  );
}

function validTime(iso: string): boolean {
  return typeof iso === "string" && Number.isFinite(Date.parse(iso));
}

const EVENT_REASON: Readonly<Record<Exclude<EventKind, "message">, string>> = {
  echo: "Our own message, played back by Meta — never answered.",
  read: "A read receipt — never answered.",
  delivery: "A delivery receipt — never answered.",
  reaction: "A reaction, not a message — never answered.",
  system: "A Meta system event — never answered.",
};

const GAP_PREFIX: Readonly<Record<Exclude<FactStatus, "OK">, string>> = {
  MISSING: "MISSING APPROVED FACT",
  UNAPPROVED: "FACT NOT APPROVED",
  EMPTY: "APPROVED FACT IS EMPTY",
  ZERO: "APPROVED FACT IS ZERO",
};

/* ── Understanding: which model, which colour ────────────────────────────── */

function understand(
  reading: MessageReading,
  input: EngineInput,
  state: SearchEngineState,
  brand: SalesBrand,
  deps: EngineDeps
): Understanding {
  const k = deps.knowledge;
  const cars = engineCars(k, deps.catalog);
  const carOf = (code: ModelCode): WaCar | null => {
    const model = modelByCode(k, code);
    return model ? (cars.find((c) => c.id === model.catalogueId) ?? null) : null;
  };
  const sells = (code: ModelCode): boolean => {
    const model = modelByCode(k, code);
    return model !== null && brandSells(brand, model);
  };

  // Typed by cast rather than annotation: named() assigns them from a closure,
  // and an annotated `let` would stay narrowed to its first value at every read.
  let model = null as ModelCode | null;
  let source = "none" as ModelSource;
  let matchedText = null as string | null;
  let candidates: ModelCode[] = [];
  const crossBrand: ModelCode[] = [];
  let payloadColour: string | null = null;

  const named = (code: ModelCode, how: ModelSource, words: string | null) => {
    model = code;
    source = how;
    matchedText = words;
  };

  if (reading.payload) {
    // A tapped button. It names a model (and maybe a colour) and nothing else.
    const m = modelByCode(k, reading.payload.model);
    if (m && brandSells(brand, m)) named(m.code, "payload", null);
    else if (m) crossBrand.push(m.code);
    if (m && reading.payload.kind === "COLOUR") payloadColour = reading.payload.colour;
  } else if (reading.tokens.length > 0) {
    const match = matchModel(reading.raw, cars);
    if (match.decision === "send" && match.model) {
      const code = modelByCatalogueId(k, match.model.id)?.code ?? null;
      if (code && sells(code)) named(code, "text", match.matchedText ?? null);
      else if (code) crossBrand.push(code);
    } else if (match.contenderIds && match.contenderIds.length > 1) {
      const all = codesOf(k, match.contenderIds);
      const ours = all.filter(sells);
      crossBrand.push(...all.filter((c) => !sells(c)));
      if (ours.length === 1) named(ours[0], "text", null);
      else if (ours.length > 1) candidates = ours;
    } else {
      // "the mhero", "voyah?": a brand with no model — ask which one.
      const ownCars = cars.filter((c) => {
        const code = modelByCatalogueId(k, c.id)?.code;
        return code !== undefined && sells(code);
      });
      const own = codesOf(k, familyMentioned(reading.raw, ownCars).map((c) => c.id));
      if (own.length > 1) {
        candidates = own;
      } else {
        const other = codesOf(k, familyMentioned(reading.raw, cars).map((c) => c.id));
        crossBrand.push(...other.filter((c) => !sells(c)));
      }
    }

    // "2", "the second one": the answer to the "which model?" just asked.
    const offered = state.offeredModels.filter(sells);
    if (
      model === null &&
      candidates.length === 0 &&
      crossBrand.length === 0 &&
      state.awaiting === "MODEL" &&
      offered.length > 0
    ) {
      const n = reading.choiceNumber;
      if (n !== null && n <= offered.length) {
        named(offered[n - 1], "choice", String(n));
      } else {
        const offeredCars = offered
          .map((code) => carOf(code))
          .filter((c): c is WaCar => c !== null);
        const picked = pickAmong(reading.raw, offeredCars);
        const code = picked ? (modelByCatalogueId(k, picked.id)?.code ?? null) : null;
        if (code) named(code, "choice", null);
      }
    }
  }

  // An ad set up to name its model — only an exact, configured match, never
  // a guess from the ad's picture or text. `ref` travels in a public link, so
  // a crafted one can name a model and nothing more: exactly what typing the
  // model's name does.
  if (model === null && candidates.length === 0 && crossBrand.length === 0 && !state.activeModel) {
    const ref = input.referral?.ref ?? null;
    const adId = input.referral?.adId ?? null;
    const lookup = (key: string | null): ModelCode | null =>
      key !== null && Object.prototype.hasOwnProperty.call(k.referrals, key)
        ? k.referrals[key]
        : null;
    const fromRef = parsePayload(ref);
    const code =
      lookup(ref) ??
      lookup(adId) ??
      (fromRef?.kind === "MODEL" && isModelCode(fromRef.model) ? fromRef.model : null);
    if (code && sells(code)) named(code, "referral", null);
  }

  // Otherwise: the model we were already talking about.
  if (
    model === null &&
    candidates.length === 0 &&
    crossBrand.length === 0 &&
    state.activeModel !== null &&
    sells(state.activeModel)
  ) {
    named(state.activeModel, "state", null);
  }

  // A switched-off car is never talked about automatically.
  let switchedOff: ModelCode | null = null;
  const resolved = model as ModelCode | null;
  if (resolved !== null && carOf(resolved)?.enabled === false) {
    switchedOff = resolved;
    model = null;
    source = "none";
  }

  // Which colour — read against THIS model's colours only.
  let colour: ColourReading = { kind: "none" };
  const current = model as ModelCode | null;
  const car = current ? carOf(current) : null;
  if (current && car) {
    const awaitingColour = state.awaiting === "COLOUR" && state.activeModel === current;
    if (payloadColour !== null) {
      const c = car.colours.find((x) => x.id === payloadColour);
      colour = c
        ? { kind: "one", id: c.id, name: c.name, source: "payload" }
        : { kind: "unavailable", requested: payloadColour };
    } else if (
      awaitingColour &&
      reading.choiceNumber !== null &&
      state.offeredColours[reading.choiceNumber - 1]
    ) {
      const id = state.offeredColours[reading.choiceNumber - 1];
      const c = car.colours.find((x) => x.id === id);
      if (c) colour = { kind: "one", id: c.id, name: c.name, source: "choice" };
    } else if (reading.tokens.length > 0 && source !== "choice") {
      // Words already read as a question are not colours: while the colour
      // question is open, "what's the range?" must not be heard as "orange".
      const covered = new Set<number>();
      for (const h of reading.hits) for (let i = h.start; i < h.end; i++) covered.add(i);
      const colourWords = reading.tokens.filter((_, i) => !covered.has(i)).join(" ");
      const answer = readColourAnswer(colourWords, car.colours, {
        noPreference: awaitingColour,
        fuzzy: awaitingColour,
      });
      if (answer.kind === "one") {
        colour = { kind: "one", id: answer.colour.id, name: answer.colour.name, source: "text" };
      } else if (answer.kind === "several") {
        colour = { kind: "several", ids: answer.colours.map((c) => c.id) };
      } else if (answer.kind === "unavailable") {
        colour = { kind: "unavailable", requested: answer.asked };
      } else if (answer.kind === "no_preference") {
        colour = { kind: "no_preference" };
      }
    }
  }

  const intents: Intent[] = [...reading.intents];
  if ((colour.kind === "one" || colour.kind === "no_preference") && !intents.includes("COLOUR_VIDEO")) {
    intents.push("COLOUR_VIDEO");
  }
  if ((colour.kind === "unavailable" || colour.kind === "several") && !intents.includes("COLOUR")) {
    intents.push("COLOUR");
  }
  const namedSomething =
    (source !== "none" && source !== "state") ||
    candidates.length > 0 ||
    crossBrand.length > 0 ||
    switchedOff !== null;
  if (intents.length === 0 && !namedSomething) intents.push("UNKNOWN");

  return {
    reading,
    intents,
    model,
    modelSource: source,
    modelMatchedText: matchedText,
    modelCandidates: candidates,
    crossBrand: unique(crossBrand),
    switchedOff,
    colour,
  };
}

/* ── The decision ────────────────────────────────────────────────────────── */

/**
 * Decide what happens in response to ONE inbound event.
 *
 * `state` is the conversation's SearchEngineState (context.ts); the decision
 * carries the next one. Nothing is mutated and nothing is sent.
 */
export function decide(
  input: EngineInput,
  state: SearchEngineState,
  deps: EngineDeps
): EngineDecision {
  const k = deps.knowledge;
  const reading = readMessage(input.text, input.payload);
  const eventKind = input.eventKind ?? "message";

  const bare = (reason: string, outcome: EngineDecision["outcome"]): EngineDecision => ({
    outcome,
    understanding: {
      reading,
      intents: [],
      model: null,
      modelSource: "none",
      modelMatchedText: null,
      modelCandidates: [],
      crossBrand: [],
      switchedOff: null,
      colour: { kind: "none" },
    },
    previousState: state,
    expired: false,
    activation: null,
    actions: [],
    nextState: cloneState(state),
    reasons: [reason],
    gaps: [],
  });

  // Hard exclusions: nothing happens, and the conversation does not move.
  if (eventKind !== "message") return bare(EVENT_REASON[eventKind], "EXCLUDED");
  if (reading.exclusion) return bare(reading.exclusion.reason, "EXCLUDED");

  const brand = salesBrandOf(input.brand);
  if (!brand) {
    return bare(
      "The receiving account has no known brand — nothing is automated.",
      "NO_AUTOMATIC_ACTION"
    );
  }

  const expired = isExpired(state, input.now, deps.ttlHours);
  const base = expired ? freshState() : cloneState(state);
  const u = understand(reading, input, base, brand, deps);
  const next = cloneState(base);

  const out: EngineAction[] = [];
  const reasons: string[] = [];
  let activation: Activation | null = null;

  const fallback = (reason: FallbackReason) =>
    out.push({ type: "SEND_CONTACT_FALLBACK", reasons: [reason] });
  const gap = (
    model: ModelCode | null,
    content: ContentGapKind,
    key: string | null,
    status: FactStatus | null,
    detail: string
  ) => out.push({ type: "CONTENT_GAP", model, content, key, status, detail });

  const cars = engineCars(k, deps.catalog);
  const carOf = (code: ModelCode): WaCar | null => {
    const model = modelByCode(k, code);
    return model ? (cars.find((c) => c.id === model.catalogueId) ?? null) : null;
  };

  const intents = u.intents.filter((i) => i !== "UNKNOWN");
  const substantive = intents.filter((i) => i !== "GREETING");
  const greeted = intents.includes("GREETING");
  const freshConversation = input.conversationIsNew && !hasContext(base);

  /** Location, hours, the number, and questions only a person answers. */
  const answerIndependent = (model: ModelCode | null) => {
    for (const intent of substantive) {
      if (intent === "CONTACT_NUMBER") {
        fallback({ kind: "CONTACT_NUMBER" });
      } else if (isGlobalIntent(intent)) {
        const { status, fact } = lookupGlobal(k, intent);
        if (status === "OK" && fact) {
          out.push({ type: "SEND_GLOBAL_INFO", key: intent, value: fact.value, source: fact.source });
        } else {
          gap(null, "GLOBAL", intent, status, `${GAP_PREFIX[status as Exclude<FactStatus, "OK">]}: ${intent}`);
          fallback({ kind: "MISSING_GLOBAL", key: intent, status });
        }
      } else if (isContactIntent(intent)) {
        fallback({ kind: "CONTACT_INTENT", intent, model });
        if (intent === "COMPLAINT") {
          out.push({ type: "FLAG_FOR_STAFF", reason: "A complaint — a person should reply personally." });
        }
      }
    }
  };

  /** Show the choice of models: this account's, switched on, in the catalogue. */
  const offerModels = (codes: readonly ModelCode[], narrowed: boolean) => {
    const offer = codes.filter((code) => carOf(code)?.enabled === true);
    if (offer.length === 0) {
      reasons.push("There is no switched-on model to offer — a person answers.");
      return;
    }
    out.push({
      type: "SHOW_MODEL_CHOICES",
      models: offer,
      greet: greeted && freshConversation,
      narrowed,
    });
    next.awaiting = "MODEL";
    next.offeredModels = offer;
  };

  const brandModels = modelsForBrand(k, brand).map((m) => m.code);
  const modelDependent = substantive.filter(isModelIntent);

  if (reading.tokens.length === 0 && !reading.payload && u.modelSource !== "referral") {
    // A photo, a story reply, a sticker. A model is never guessed from media.
    reasons.push(
      input.hasMedia
        ? "A photo, video or story reply with no words — a person looks. A model is never guessed from media."
        : "An empty message — nothing to answer."
    );
  } else if (u.switchedOff) {
    fallback({ kind: "MODEL_SWITCHED_OFF", model: u.switchedOff });
    answerIndependent(null);
    reasons.push(`Automation is switched off for the ${modelLabel(u.switchedOff)} on /sales.`);
  } else if (u.model === null && u.modelCandidates.length === 0 && u.crossBrand.length > 0) {
    // Another brand's model, on this brand's account: never that brand's material.
    for (const code of u.crossBrand) fallback({ kind: "CROSS_BRAND", model: code });
    answerIndependent(null);
    reasons.push(
      `${u.crossBrand.map(modelLabel).join(", ")} is sold by another brand's account — ` +
        `this account never sends another brand's material.`
    );
  } else if (u.modelCandidates.length > 1) {
    // "the dream or the passion?", "the mhero": ask which, of just those.
    next.pendingIntents = unique([...base.pendingIntents, ...modelDependent]);
    answerIndependent(null);
    offerModels(u.modelCandidates, true);
  } else if (u.model !== null) {
    decideForModel(u.model);
  } else if (substantive.length === 0) {
    if (greeted) {
      if (freshConversation) {
        offerModels(brandModels, false);
      } else {
        reasons.push(
          hasContext(base)
            ? "A greeting mid-conversation — nothing new was asked."
            : "A greeting in an existing conversation with no sales context — a person says hello back."
        );
      }
    } else {
      reasons.push(
        base.awaiting === "MODEL"
          ? "Not an answer to \"which model?\" — a person reads it."
          : "Nothing the engine recognises — a person reads it."
      );
    }
  } else {
    // Questions, but no model yet: answer what needs none, save the rest.
    answerIndependent(null);
    if (modelDependent.length > 0) {
      next.pendingIntents = unique([...base.pendingIntents, ...modelDependent]);
      // "the price of each", right after "MHERO 1 or MHERO 2?": ask of just
      // those again, not of every model.
      const stillOffered =
        base.awaiting === "MODEL" ? base.offeredModels.filter((c) => brandModels.includes(c)) : [];
      if (stillOffered.length > 1 && stillOffered.length < brandModels.length) {
        offerModels(stillOffered, true);
      } else {
        offerModels(brandModels, false);
      }
    }
  }

  function decideForModel(model: ModelCode): void {
    const knowledgeModel = modelByCode(k, model);
    if (!knowledgeModel) return;
    const car = carOf(model);
    const isNamed = u.modelSource !== "state";
    const activating = isNamed && model !== base.activeModel;

    if (activating) {
      activation = {
        kind:
          u.modelSource === "referral" ? "REFERRAL" : base.activeModel ? "SWITCH" : "NEW",
        model,
        id: base.modelActivationId + 1,
      };
      next.activeModel = model;
      next.modelActivationId = base.modelActivationId + 1;
      next.selectedColour = null;
      next.brochureSentForCurrentActivation = false;
      next.colourPromptSentForCurrentActivation = false;
      next.offeredColours = [];
      next.offeredModels = [];
      next.awaiting = "NONE";
    }

    // The answer to "which model?" releases what was asked before it.
    const consumePending = activating || (isNamed && base.awaiting === "MODEL");
    const toAnswer = unique([
      ...(consumePending ? base.pendingIntents : []),
      ...substantive,
    ]);
    if (consumePending) {
      next.pendingIntents = [];
      next.offeredModels = [];
      if (next.awaiting === "MODEL") next.awaiting = "NONE";
    }

    const have = car ? deps.media(car.id) : NO_MEDIA;
    const sendable: WaColour[] = car ? sendableColours(car.colours, videoCounts(have)) : [];

    // 1. The brochure: first on every activation, again only when asked.
    const wantsBrochure = toAnswer.includes("BROCHURE");
    const wantsInfo = toAnswer.includes("GENERAL_INFO");
    if (activating || wantsBrochure || (wantsInfo && !next.brochureSentForCurrentActivation)) {
      if (have.brochure) {
        out.push({
          type: "SEND_BROCHURE",
          model,
          asset: have.brochure,
          explicit: wantsBrochure && !activating,
        });
        next.brochureSentForCurrentActivation = true;
      } else {
        gap(model, "BROCHURE", null, null, `MISSING BROCHURE: ${modelLabel(model)}`);
        fallback({ kind: "MISSING_BROCHURE", model });
      }
    } else if (wantsInfo) {
      fallback({ kind: "MORE_INFO", model });
    }

    // 2. Facts, price, colour requests — in the order they were asked.
    let wantVideo = false;
    let wantColours = false;
    for (const intent of toAnswer) {
      if (isFactIntent(intent)) {
        const { status, fact } = lookupFact(knowledgeModel, intent);
        if (status === "OK" && fact) {
          out.push({ type: "SEND_FACT", model, fact: intent, value: fact.value, source: fact.source });
        } else {
          gap(
            model,
            "FACT",
            intent,
            status,
            `${GAP_PREFIX[status as Exclude<FactStatus, "OK">]}: ${modelLabel(model)} / ${intent}`
          );
          fallback({ kind: "MISSING_FACT", model, fact: intent, status });
        }
      } else if (intent === "PRICE") {
        fallback({ kind: "CONTACT_INTENT", intent, model });
      } else if (intent === "COLOUR") {
        wantColours = true;
      } else if (intent === "COLOUR_VIDEO") {
        wantVideo = true;
      }
    }
    answerIndependent(model);

    // 3. The colour.
    const offerColours = () => {
      if (sendable.length === 0) {
        gap(model, "COLOUR_MEDIA", null, null, `NO COLOUR VIDEOS: ${modelLabel(model)}`);
        fallback({ kind: "NO_COLOUR_MEDIA", model });
        next.colourPromptSentForCurrentActivation = true;
        return;
      }
      out.push({
        type: "SHOW_COLOUR_CHOICES",
        model,
        colours: sendable.map((c) => ({ id: c.id, name: c.name })),
      });
      next.awaiting = "COLOUR";
      next.offeredColours = sendable.map((c) => c.id);
      next.colourPromptSentForCurrentActivation = true;
    };
    const sendVideo = (colour: WaColour, chosenForThem: boolean) => {
      const asset = have.videosByColour[colour.id]?.[0];
      if (!asset) {
        offerColours();
        return;
      }
      out.push({
        type: "SEND_COLOUR_VIDEO",
        model,
        colour: colour.id,
        colourName: colour.name,
        asset,
        chosenForThem,
        onlyOption: sendable.length === 1,
      });
      next.selectedColour = colour.id;
      next.colourPromptSentForCurrentActivation = true;
      next.offeredColours = [];
      if (next.awaiting === "COLOUR") next.awaiting = "NONE";
    };

    const c = u.colour;
    if (c.kind === "one") {
      const colour = sendable.find((s) => s.id === c.id);
      if (colour) {
        sendVideo(colour, false);
      } else {
        out.push({ type: "COLOUR_NOT_AVAILABLE", model, requested: c.name });
        offerColours();
      }
    } else if (c.kind === "unavailable") {
      out.push({ type: "COLOUR_NOT_AVAILABLE", model, requested: c.requested });
      offerColours();
    } else if (c.kind === "several") {
      offerColours();
    } else if (c.kind === "no_preference") {
      const pick = sendable[0];
      if (pick) sendVideo(pick, true);
      else offerColours();
    } else if (wantVideo) {
      const chosen =
        sendable.find((s) => s.id === next.selectedColour) ??
        (sendable.length === 1 ? sendable[0] : null);
      if (chosen) sendVideo(chosen, false);
      else offerColours();
    } else if (wantColours) {
      offerColours();
    } else if (activating) {
      // The colour step of an activation: one colour needs no question.
      if (sendable.length === 1) sendVideo(sendable[0], false);
      else offerColours();
    }

    // Also named: a model this account does not sell.
    for (const code of u.crossBrand) fallback({ kind: "CROSS_BRAND", model: code });

    if (out.length === 0) {
      reasons.push(`Already talking about the ${modelLabel(model)} — nothing new was asked.`);
    }
  }

  const actions = finalizeActions(out);
  next.lastIntent =
    substantive[0] ?? intents[0] ?? (u.intents.includes("UNKNOWN") ? "UNKNOWN" : base.lastIntent);
  next.updatedAt = validTime(input.now) ? input.now : base.updatedAt;

  const outcome = actions.some(isCustomerFacing) ? "ACTIONS" : "NO_AUTOMATIC_ACTION";
  if (outcome === "NO_AUTOMATIC_ACTION" && reasons.length === 0) reasons.push("Nothing to send.");

  return {
    outcome,
    understanding: u,
    previousState: state,
    expired,
    activation,
    actions,
    nextState: next,
    reasons,
    gaps: actions.filter(
      (a): a is Extract<EngineAction, { type: "CONTENT_GAP" }> => a.type === "CONTENT_GAP"
    ),
  };
}

/* ── Observability ───────────────────────────────────────────────────────── */

/**
 * One decision as a structured log line: what was understood, what was
 * decided, and how the state moved. It carries NO message text, no names, no
 * ids and nothing secret — only intents, model codes and action types — so it
 * can be logged for every message without becoming a store of what customers
 * wrote.
 */
export function traceForLog(d: EngineDecision): Record<string, unknown> {
  const u = d.understanding;
  const summary = (s: SearchEngineState) => ({
    activeModel: s.activeModel,
    selectedColour: s.selectedColour,
    awaiting: s.awaiting,
    pendingIntents: s.pendingIntents,
    modelActivationId: s.modelActivationId,
    brochureSent: s.brochureSentForCurrentActivation,
    colourPromptSent: s.colourPromptSentForCurrentActivation,
  });
  return {
    outcome: d.outcome,
    exclusion: u.reading.exclusion?.kind ?? null,
    language: u.reading.language,
    confidence: u.reading.confidence,
    intents: u.intents,
    model: u.model,
    modelSource: u.modelSource,
    modelCandidates: u.modelCandidates,
    crossBrand: u.crossBrand,
    colour: u.colour.kind === "one" ? u.colour.id : u.colour.kind,
    activation: d.activation,
    expired: d.expired,
    actions: d.actions.map((a) => {
      switch (a.type) {
        case "SEND_BROCHURE":
          return { type: a.type, model: a.model };
        case "SEND_FACT":
          return { type: a.type, model: a.model, fact: a.fact };
        case "SEND_GLOBAL_INFO":
          return { type: a.type, key: a.key };
        case "SEND_COLOUR_VIDEO":
          return { type: a.type, model: a.model, colour: a.colour };
        case "COLOUR_NOT_AVAILABLE":
          return { type: a.type, model: a.model };
        case "SEND_CONTACT_FALLBACK":
          return { type: a.type, reasons: a.reasons.map((r) => r.kind) };
        case "SHOW_COLOUR_CHOICES":
          return { type: a.type, model: a.model, colours: a.colours.map((c) => c.id) };
        case "SHOW_MODEL_CHOICES":
          return { type: a.type, models: a.models };
        case "CONTENT_GAP":
          return { type: a.type, detail: a.detail };
        case "FLAG_FOR_STAFF":
          return { type: a.type };
      }
    }),
    before: summary(d.previousState),
    after: summary(d.nextState),
  };
}
