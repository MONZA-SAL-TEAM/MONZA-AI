/**
 * THE MONZA CUSTOMER SEARCH & MEDIA ENGINE — the decision.
 *
 * Not a chatbot. Three deterministic stages, each in its own place:
 *
 *   UNDERSTAND  intent.ts reads WHAT was asked; understand() below reads
 *               WHICH MODEL OR MODELS (a button, the words, a numbered answer,
 *               a known ad, or the cars already being discussed) and WHICH COLOUR.
 *   SEARCH      decide() looks the answer up — approved facts
 *               (knowledge.ts, from Samer's workbook) and uploaded files (the
 *               ModelMediaLookup) — and returns ordered, structured actions
 *               (actions.ts).
 *   EXECUTE     templates.ts turns the actions into channel messages, and
 *               actions.ts's send policy decides whether any may go out.
 *
 * The engine never writes a sentence, never invents a fact, and never sends
 * anything. The same message in the same state always produces the same
 * decision, so the simulator on /sales IS the production behaviour.
 *
 * THE RULES — Samer's workbook, "E Master Bot Logic" (2026-09-17), in the order they bite:
 *
 *   - Echoes, receipts, reactions, Meta system events, fake Meta-support
 *     scams, vendor pitches and internal tests are EXCLUDED: no action, and
 *     the state does not move.
 *   - The BRAND is the receiving account's — never the text's. A model the
 *     account does not sell gets the hand-off, never another brand's brochure.
 *   - An intent is GLOBAL, never model-specific: "hp?" works for every car. One
 *     car selected → that car's value. Several selected → one labelled line per
 *     car. None → the value for every car the account sells.
 *   - Several cars are KEPT together; the customer is never forced to pick one.
 *   - A type question ("what EVs do you have", "7 seater?") filters the cars
 *     by the workbook's powertrain bucket or seat count.
 *   - A model becoming active sends its BROCHURE FIRST, then what was asked,
 *     then the colour question. The brochure is not re-sent unless asked.
 *   - Facts come only from the workbook. A value the workbook says is not
 *     stated is said to be "not confirmed yet" — never guessed.
 *   - Price, offers and stock are never stated: the sales team is alerted and
 *     the customer gets the sales number. Installments and test drives take the
 *     customer's name first; a test drive is booked into a 30-minute slot.
 *   - Service, parts and complaints get the service number; the welcome offers
 *     the departments. "ok" and "thanks" never reopen a menu.
 *   - The sales context expires (context.ts) — separately from Meta's 24-hour
 *     window.
 */

import {
  asksForOptions,
  isFactIntent,
  isGlobalIntent,
  parsePayload,
  readBodyType,
  readCategories,
  readMessage,
  readsAll,
  readSeatCount,
  type CategoryFilter,
  type FactIntent,
  type Intent,
  type MessageReading,
} from "@/lib/wasales/intent";
import { familyMentioned, matchModel, normalize, pickAmong, type WaCar } from "@/lib/wasales/matcher";
import { readColourAnswer, sendableColours, type WaColour } from "@/lib/wasales/colours";
import { freshState, hasContext, isExpired, type SearchEngineState } from "@/lib/wasales/context";
import { beirutTime as beirutTimeOf0, dayLabel, freeSlots, freeSlotsOn, isAfterHours, isBookableSlot, parseRequestedTime, slotAtBeirut, slotLabel } from "@/lib/wasales/booking";
const beirutTimeOf = (iso: string) => beirutTimeOf0(Date.parse(iso));
import {
  decisionsOf,
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
  type PowertrainBucket,
  type SalesBrand,
  type SalesChannel,
  type SalesKnowledge,
} from "@/lib/wasales/knowledge";
import {
  finalizeActions,
  isCustomerFacing,
  type AlertKind,
  type ContentGapKind,
  type EngineAction,
  type FactRow,
  type FallbackReason,
  type TextKey,
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
  /** The channel it arrived on. WhatsApp already knows the customer's number. */
  channel?: SalesChannel;
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
  /** Test-drive slots already booked (UTC ISO). Absent: none booked. */
  bookedSlots?: readonly string[];
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
  /** The one car in play: named now, or the single car already selected. */
  model: ModelCode | null;
  modelSource: ModelSource;
  /** The words that named the model, when words did. */
  modelMatchedText: string | null;
  /** Every car this account sells that THIS message named, in order (two or more: "Free 318 and Courage"). */
  models: ModelCode[];
  /** A brand named with no model ("the mhero"): ask which one of these. */
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
    selectedModels: [...s.selectedModels],
    lead: s.lead ? { ...s.lead, models: [...s.lead.models] } : null,
    offeredSlots: [...s.offeredSlots],
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

/**
 * "Passion S", "passion-s", "باشن اس" — but not "the passion's price" and not "passion sedan".
 */
export function asksAboutPassionS(raw: string): boolean {
  const text = raw.replace(/[’']s\b/gi, "");
  return /(^|[^a-z])passion[\s-]+s(?![a-z])/i.test(text) || /(باشن|باسيون)\s+(اس|إس)(\s|$)/.test(text);
}

/** The catalogue cars of every model the knowledge knows. */
export function engineCars(k: SalesKnowledge, catalog: readonly WaCar[]): WaCar[] {
  const out: WaCar[] = [];
  for (const model of k.models) {
    const car = catalog.find((c) => c.id === model.catalogueId);
    if (car) out.push(withOfficialColours(car, model.colourNames ?? []));
  }
  return out;
}

/**
 * The library files colours as "Black", "Sage"; the workbook names them
 * "Midnight Black", "Sage Green" (A Car Facts, 2026-09-18). The customer reads
 * the official name; "black" still finds it. A workbook colour with no video
 * in the library is never offered, and a library colour the workbook does not
 * name keeps its library name.
 */
function withOfficialColours(car: WaCar, names: readonly string[]): WaCar {
  if (names.length === 0) return car;
  const library = car.colours.map((c) => c.name.toLowerCase());
  const official = new Map<string, string>();
  for (const name of names) {
    const word = name.toLowerCase().split(/\s+/).find((w) => library.includes(w));
    if (word && !official.has(word)) official.set(word, name);
  }
  if (official.size === 0) return car;
  return {
    ...car,
    colours: car.colours.map((c) => {
      const name = official.get(c.name.toLowerCase());
      return name ? { ...c, name, aliases: unique([...c.aliases, c.name.toLowerCase()]) } : c;
    }),
  };
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

const GAP_PREFIX: Readonly<Record<Exclude<FactStatus, "OK" | "EMPTY">, string>> = {
  MISSING: "MISSING APPROVED FACT",
  UNAPPROVED: "FACT NOT APPROVED",
  ZERO: "APPROVED FACT IS ZERO",
};

/** The facts a comparison shows (workbook E, section 7). Fewer when many cars. */
const COMPARE_FACTS: readonly FactIntent[] = ["HORSEPOWER", "RANGE", "BATTERY", "POWERTRAIN", "CHARGING", "SEATS", "DIMENSIONS", "WARRANTY"];
const COMPARE_FACTS_SHORT: readonly FactIntent[] = ["HORSEPOWER", "RANGE", "POWERTRAIN", "SEATS"];
/** What "tell me more" about a car already introduced adds. */
const KEY_FACTS: readonly FactIntent[] = ["HORSEPOWER", "RANGE", "POWERTRAIN"];

/** Sales questions a person follows up — answered with a hand-off, a lead, or a booking. */
const SALES_INTENTS: readonly Intent[] = ["PRICE", "FINANCING", "TEST_DRIVE", "AVAILABILITY", "DISCOUNT", "TRADE_IN", "MODEL_YEAR"];
const SERVICE_INTENTS: readonly Intent[] = ["SERVICE", "PARTS", "COMPLAINT"];
/** Questions with no approved answer: answered honestly and handed to the team (Samer, 2026-09-17). */
const QUESTION_INTENTS: readonly Intent[] = ["DELIVERY_LOCATION", "PAYMENT_CURRENCY", "USED_CARS", "OTHER_SPEC"];
/**
 * Colour folder ids that are not colours a customer chooses: the one video of a
 * car filmed without colour folders. Never shown as a button or in a sentence.
 */
const NO_CHOICE_COLOURS: readonly string[] = ["standard", "default", "all", "general", "misc", "other", "video", "videos"];
const isChoiceColour = (c: { id: string }) => !NO_CHOICE_COLOURS.includes(c.id.toLowerCase());
const MAX_BROCHURES = 8;

/** A stored slot (UTC ISO) back into the day-and-minutes shape bookRequested reads. */
function requestedFromIso(iso: string): ReturnType<typeof parseRequestedTime> {
  const w = beirutTimeOf(iso);
  return { year: w.year, month: w.month, day: w.day, minutes: w.hour * 60 + w.minute, part: null };
}

/* ── Names and phone numbers, for a lead ─────────────────────────────────── */

const NAME_PREFIX = /^(?:(?:hi|hello|hey|ok|okay|yes|sure)\s+)?(?:my name is|my name's|name is|name:|i am|i'm|im|this is|it's|its|اسمي|انا|أنا)\s+/i;

/**
 * The customer's name, when the message is only a name ("Rabih Yazbek", "my
 * name is Mary"). Letters only, one to four words; anything that reads as a
 * question is not a name.
 */
export function readName(raw: string): string | null {
  let text = raw.replace(/[+\d][\d\s\-()]{6,}\d/g, " ").trim();
  text = text.replace(NAME_PREFIX, "").replace(/[.,!؟?]+$/g, "").trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 4) return null;
  if (!words.every((w) => /^[\p{L}'’-]{2,30}$/u.test(w))) return null;
  const lower = normalize(text);
  if (/\b(?:what|how|where|when|why|price|info|details|test|drive|please|pls|plz|thanks|thank|ok|okay)\b/.test(lower)) return null;
  return words.map((w) => (/^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

/** A phone number the customer typed, digits only (7 to 13 of them), or null. */
export function readPhone(raw: string): string | null {
  const m = /(?:\+|00)?\d[\d\s\-()]{5,}\d/.exec(raw);
  if (!m) return null;
  let digits = m[0].replace(/\D/g, "").replace(/^00/, "");
  // A local number: 03 123 456 → 961 3 123 456.
  if (/^0\d{7}$/.test(digits)) digits = `961${digits.slice(1)}`;
  return digits.length >= 7 && digits.length <= 13 ? digits : null;
}

/* ── Understanding: which models, which colour ───────────────────────────── */

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

  let models: ModelCode[] = [];
  let source = "none" as ModelSource;
  let matchedText = null as string | null;
  let candidates: ModelCode[] = [];
  const crossBrand: ModelCode[] = [];
  let payloadColour: string | null = null;

  const named = (codes: ModelCode[], how: ModelSource, words: string | null) => {
    models = codes;
    source = how;
    matchedText = words;
  };

  const payload = reading.payload;
  if (payload && (payload.kind === "MODEL" || payload.kind === "COLOUR")) {
    // A tapped button. It names a model (and maybe a colour) and nothing else.
    const m = modelByCode(k, payload.model);
    if (m && brandSells(brand, m)) named([m.code], "payload", null);
    else if (m) crossBrand.push(m.code);
    if (m && payload.kind === "COLOUR") payloadColour = payload.colour;
  } else if (!payload && reading.tokens.length > 0) {
    const match = matchModel(reading.raw, cars);
    if (match.decision === "send" && match.model) {
      const code = modelByCatalogueId(k, match.model.id)?.code ?? null;
      if (code && sells(code)) named([code], "text", match.matchedText ?? null);
      else if (code) crossBrand.push(code);
    } else if (match.contenderIds && match.contenderIds.length > 1) {
      // Several cars named at once: all of them are kept (workbook E, "keep several models").
      const all = codesOf(k, match.contenderIds);
      crossBrand.push(...all.filter((c) => !sells(c)));
      const ours = all.filter(sells);
      if (ours.length > 0) named(ours, "text", null);
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
      // "the sedan": the cars of that body.
      const body = readBodyType(reading.tokens);
      if (body && candidates.length === 0) {
        const bodyCars = (body === "SEDAN" ? (["PASSION", "PASSION_L"] as ModelCode[]) : (["DREAM"] as ModelCode[])).filter(sells);
        if (bodyCars.length === 1) named(bodyCars, "text", null);
        else if (bodyCars.length > 1) candidates = bodyCars;
      }
    }

    // "2", "the second one": the answer to the "which model?" just asked.
    const offered = state.offeredModels.filter(sells);
    if (
      models.length === 0 &&
      candidates.length === 0 &&
      crossBrand.length === 0 &&
      state.awaiting === "MODEL" &&
      offered.length > 0
    ) {
      const n = reading.choiceNumber;
      if (n !== null && n <= offered.length) {
        named([offered[n - 1]], "choice", String(n));
      } else {
        const offeredCars = offered.map((code) => carOf(code)).filter((c): c is WaCar => c !== null);
        const picked = pickAmong(reading.raw, offeredCars);
        const code = picked ? (modelByCatalogueId(k, picked.id)?.code ?? null) : null;
        if (code) named([code], "choice", null);
      }
    }
  }

  // An ad set up to name its model — only an exact, configured match, never
  // a guess from the ad's picture or text.
  if (models.length === 0 && candidates.length === 0 && crossBrand.length === 0 && !state.activeModel) {
    const ref = input.referral?.ref ?? null;
    const adId = input.referral?.adId ?? null;
    const lookup = (key: string | null): ModelCode | null =>
      key !== null && Object.prototype.hasOwnProperty.call(k.referrals, key) ? k.referrals[key] : null;
    const fromRef = parsePayload(ref);
    const code =
      lookup(ref) ??
      lookup(adId) ??
      (fromRef?.kind === "MODEL" && isModelCode(fromRef.model) ? fromRef.model : null);
    if (code && sells(code)) named([code], "referral", null);
  }

  // A switched-off car is never talked about automatically.
  let switchedOff: ModelCode | null = null;
  const off = models.find((m) => carOf(m)?.enabled === false) ?? null;
  if (off) {
    switchedOff = off;
    models = models.filter((m) => m !== off);
    if (models.length === 0) source = "none";
  }

  // The one car in play: named now, or the single car already being discussed.
  let model: ModelCode | null = models.length === 1 ? models[0] : null;
  if (
    models.length === 0 &&
    candidates.length === 0 &&
    crossBrand.length === 0 &&
    switchedOff === null &&
    state.activeModel !== null &&
    sells(state.activeModel)
  ) {
    model = state.activeModel;
    source = "state";
  }

  // Which colour — read against THIS model's colours only.
  let colour: ColourReading = { kind: "none" };
  const car = model ? carOf(model) : null;
  if (model && car) {
    const awaitingColour = state.awaiting === "COLOUR" && state.activeModel === model;
    if (payloadColour !== null) {
      const c = car.colours.find((x) => x.id === payloadColour);
      colour = c ? { kind: "one", id: c.id, name: c.name, source: "payload" } : { kind: "unavailable", requested: payloadColour };
    } else if (awaitingColour && reading.choiceNumber !== null && state.offeredColours[reading.choiceNumber - 1]) {
      const id = state.offeredColours[reading.choiceNumber - 1];
      const c = car.colours.find((x) => x.id === id);
      if (c) colour = { kind: "one", id: c.id, name: c.name, source: "choice" };
    } else if (reading.tokens.length > 0 && source !== "choice" && !payload) {
      // Words already read as a question are not colours: while the colour
      // question is open, "what's the range?" must not be heard as "orange".
      const covered = new Set<number>();
      for (const h of reading.hits) for (let i = h.start; i < h.end; i++) covered.add(i);
      const colourWords = reading.tokens.filter((_, i) => !covered.has(i)).join(" ");
      // Colours with a video are heard first: a colour re-filed under its official name
      // ("Obsidian Black") and the old, now empty "Black" both answer to "black", and only one
      // can be sent. The full list is the fallback, so "white" on a car with no white video is
      // still named honestly as not available.
      const opts = { noPreference: awaitingColour, fuzzy: awaitingColour };
      const have = deps.media(car.id);
      const withVideo = car.colours.filter((c) => (have.videosByColour[c.id] ?? []).some((v) => v.view !== "interior"));
      const heard = withVideo.length > 0 ? readColourAnswer(colourWords, withVideo, opts) : null;
      const answer = heard && (heard.kind === "one" || heard.kind === "several" || heard.kind === "no_preference") ? heard : readColourAnswer(colourWords, car.colours, opts);
      if (answer.kind === "one") colour = { kind: "one", id: answer.colour.id, name: answer.colour.name, source: "text" };
      else if (answer.kind === "several") colour = { kind: "several", ids: answer.colours.map((c) => c.id) };
      else if (answer.kind === "unavailable") colour = { kind: "unavailable", requested: answer.asked };
      else if (answer.kind === "no_preference") colour = { kind: "no_preference" };
    }
  }

  // "grey interior" is about the inside of the car, never the grey exterior video.
  if (reading.intents.includes("INTERIOR_COLOUR")) colour = { kind: "none" };

  const intents: Intent[] = [...reading.intents];
  if ((colour.kind === "one" || colour.kind === "no_preference") && !intents.includes("COLOUR_VIDEO")) {
    intents.push("COLOUR_VIDEO");
  }
  if ((colour.kind === "unavailable" || colour.kind === "several") && !intents.includes("COLOUR")) {
    intents.push("COLOUR");
  }
  const namedSomething =
    (source !== "none" && source !== "state") || candidates.length > 0 || crossBrand.length > 0 || switchedOff !== null;
  if (intents.length === 0 && !namedSomething && !payload) intents.push("UNKNOWN");

  return {
    reading,
    intents,
    model,
    modelSource: source,
    modelMatchedText: matchedText,
    models: source === "state" ? [] : models,
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
export function decide(input: EngineInput, state: SearchEngineState, deps: EngineDeps): EngineDecision {
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
      models: [],
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
    return bare("The receiving account has no known brand — nothing is automated.", "NO_AUTOMATIC_ACTION");
  }

  const expired = isExpired(state, input.now, deps.ttlHours);
  const base = expired ? freshState() : cloneState(state);
  const u = understand(reading, input, base, brand, deps);
  const next = cloneState(base);
  const channel: SalesChannel = input.channel ?? "whatsapp";
  const { botBooksTestDrives: botBooks, askLeadName } = decisionsOf(k);

  const out: EngineAction[] = [];
  const reasons: string[] = [];
  let activation: Activation | null = null;

  const fallback = (reason: FallbackReason) => out.push({ type: "SEND_CONTACT_FALLBACK", reasons: [reason] });
  const gap = (model: ModelCode | null, content: ContentGapKind, key: string | null, status: FactStatus | null, detail: string) =>
    out.push({ type: "CONTENT_GAP", model, content, key, status, detail });
  const text = (key: TextKey, models: readonly ModelCode[] = [], vars?: Record<string, string>) =>
    out.push({ type: "SEND_TEXT", key, models: [...models], ...(vars ? { vars } : {}) });
  const alert = (
    kind: AlertKind,
    models: readonly ModelCode[],
    extra: { name?: string | null; phone?: string | null; slot?: string | null; reason?: string } = {}
  ) =>
    out.push({
      type: "ALERT_SALES",
      kind,
      models: [...models],
      name: extra.name ?? null,
      phone: extra.phone ?? null,
      slot: extra.slot ?? null,
      ...(extra.reason ? { reason: extra.reason } : {}),
    });

  const cars = engineCars(k, deps.catalog);
  const carOf = (code: ModelCode): WaCar | null => {
    const model = modelByCode(k, code);
    return model ? (cars.find((c) => c.id === model.catalogueId) ?? null) : null;
  };
  /** Every car this account may offer: its brand's, switched on, in the catalogue. */
  const scope = modelsForBrand(k, brand)
    .map((m) => m.code)
    .filter((code) => carOf(code)?.enabled === true);
  const sells = (code: ModelCode) => scope.includes(code);

  const intents = u.intents.filter((i) => i !== "UNKNOWN");
  const greeted = intents.includes("GREETING");
  const acknowledged = intents.includes("ACKNOWLEDGEMENT");
  const substantive = intents.filter((i) => i !== "GREETING" && i !== "ACKNOWLEDGEMENT");
  const freshConversation = input.conversationIsNew && !hasContext(base);
  const nowIso = validTime(input.now) ? input.now : new Date(0).toISOString();

  /** Show the choice of models: this account's, switched on, in the catalogue. */
  const offerModels = (codes: readonly ModelCode[], narrowed: boolean, prompt?: "which" | "explore" | "first") => {
    const offer = codes.filter(sells);
    if (offer.length === 0) {
      reasons.push("There is no switched-on model to offer — a person answers.");
      return;
    }
    out.push({
      type: "SHOW_MODEL_CHOICES",
      models: offer,
      // The welcome opens a reply only when nothing else comes before the question.
      greet: greeted && freshConversation && !out.some(isCustomerFacing),
      narrowed,
      ...(prompt ? { prompt } : {}),
    });
    next.awaiting = "MODEL";
    next.offeredModels = offer;
  };

  /** The fact rows of these cars: the workbook's value, or "not confirmed yet". */
  const factRows = (models: readonly ModelCode[], facts: readonly FactIntent[]): FactRow[] => {
    const rows: FactRow[] = [];
    for (const code of models) {
      const km = modelByCode(k, code);
      if (!km) continue;
      for (const fact of facts) {
        const { status, fact: found } = lookupFact(km, fact);
        if (status === "OK" && found) {
          rows.push({ model: code, fact, value: found.value, confirmed: true });
        } else if (status === "EMPTY") {
          rows.push({ model: code, fact, value: "", confirmed: false });
        } else {
          gap(code, "FACT", fact, status, `${GAP_PREFIX[status as keyof typeof GAP_PREFIX] ?? status}: ${modelLabel(code)} / ${fact}`);
          rows.push({ model: code, fact, value: "", confirmed: false });
        }
      }
    }
    return rows;
  };

  const sendFacts = (models: readonly ModelCode[], facts: readonly FactIntent[], scopeKind: "one" | "several" | "all") => {
    const rows = factRows(models, facts);
    if (rows.length > 0) out.push({ type: "SEND_FACTS", scope: scopeKind, rows });
  };

  /** Exterior videos per colour: an interior video is never a colour choice. */
  const exteriorCounts = (have: { videosByColour: Readonly<Record<string, readonly { view?: "interior" }[]>> }): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [colour, files] of Object.entries(have.videosByColour)) out[colour] = files.filter((f) => f.view !== "interior").length;
    return out;
  };
  const colourRow = (code: ModelCode): { model: ModelCode; colours: string[]; hasVideo: boolean } => {
    const car = carOf(code);
    if (!car) return { model: code, colours: [], hasVideo: false };
    const sendable = sendableColours(car.colours, exteriorCounts(deps.media(car.id)));
    return { model: code, colours: sendable.filter(isChoiceColour).map((c) => c.name), hasVideo: sendable.length > 0 };
  };

  /**
   * NEVER SILENT (Samer, 2026-09-18: "I need it to answer, not just disappear, if there is a
   * question it doesn't know how to answer"). Words the rules cannot read get the workbook's own
   * hand-off sentence and an alert, so a person follows up in the same chat. Said once: if those
   * were already the bot's last words, the person who was told answers the next line.
   */
  let saidUnknown = false;
  const sayUnknown = (models: readonly ModelCode[], why: string) => {
    if (base.unknownSaid) {
      reasons.push(`${why} — a person reads it (the customer was just told Sales will follow up here).`);
      return;
    }
    text("HANDOFF", []);
    alert("NEEDS_PERSON", models, { reason: `${why}: the customer was told Sales will follow up in this chat` });
    saidUnknown = true;
  };

  /** Location, opening hours and the sales number: the workbook's fixed sentences. */
  const answerGlobal = () => {
    for (const intent of substantive) {
      if (!isGlobalIntent(intent)) continue;
      const { status, fact } = lookupGlobal(k, intent);
      if (status === "OK" && fact) {
        out.push({ type: "SEND_GLOBAL_INFO", key: intent, value: fact.value, source: fact.source });
      } else {
        gap(null, "GLOBAL", intent, status, `MISSING: ${intent}`);
        fallback({ kind: "MISSING_GLOBAL", key: intent, status });
      }
    }
  };

  /** A lead for the sales team: installments and test drives start by taking the name. */
  let leadStartedNow = false;
  const startLead = (kind: "FINANCING" | "TEST_DRIVE", models: readonly ModelCode[]) => {
    if (leadStartedNow && next.lead) {
      // One name question for both: installments lead, the slots offered after the name.
      if (kind === "TEST_DRIVE") {
        next.lead = { ...next.lead, andTestDrive: true };
        return;
      }
      for (let i = out.length - 1; i >= 0; i--) {
        const a = out[i];
        if (a.type === "SEND_TEXT" && a.key === "TEST_DRIVE_ASK_NAME") out.splice(i, 1);
      }
      next.lead = { kind: "FINANCING", models: [...models], captured: false, andTestDrive: true };
      text("FINANCING_INFO", models);
      text(channel === "whatsapp" ? "ASK_NAME" : "ASK_NAME_AND_PHONE", models);
      return;
    }
    leadStartedNow = true;
    next.lead = { kind, models: [...models], captured: false, havePhone: channel === "whatsapp" };
    next.awaiting = "LEAD_NAME";
    if (kind === "FINANCING") {
      text("FINANCING_INFO", models);
      text(channel === "whatsapp" ? "ASK_NAME" : "ASK_NAME_AND_PHONE", models);
    } else {
      text("TEST_DRIVE_ASK_NAME", models);
    }
  };

  const offerSlots = (models: readonly ModelCode[], given?: string[]) => {
    const slots = given ?? freeSlots(nowIso, deps.bookedSlots ?? [], { max: channel === "whatsapp" ? 10 : 12 });
    if (slots.length === 0) {
      text("TEST_DRIVE_NO_SLOTS", models);
      alert("TEST_DRIVE", models);
      next.awaiting = "NONE";
      next.offeredSlots = [];
      return;
    }
    out.push({ type: "SHOW_TEST_DRIVE_SLOTS", models: [...models], slots });
    next.awaiting = "TEST_DRIVE_SLOT";
    next.offeredSlots = slots;
  };

  /**
   * Sales questions about these cars (workbook C and E section 8): never a
   * price, a promise of stock or an offer — a hand-off, an alert, a lead.
   */
  const answerSales = (models: readonly ModelCode[], asked: readonly Intent[]) => {
    for (const intent of asked) {
      switch (intent) {
        case "PRICE":
          if (models.length === 0) break;
          text("PRICE_HANDOFF", models);
          alert("PRICE", models);
          break;
        case "DISCOUNT":
          if (!asked.includes("FINANCING")) text("DISCOUNT_HANDOFF", models);
          alert("DISCOUNT", models);
          break;
        case "AVAILABILITY":
          if (models.length === 0) break;
          text("STOCK_CONFIRM", models);
          alert("STOCK", models);
          break;
        case "FINANCING":
          if (!askLeadName) {
            // Workbook C (2026-09-18): confirm the facilities, never a term, and Sales continues in this chat.
            const told = base.lead?.kind === "FINANCING" && base.lead.captured;
            const inHouse = /\bin ?house\b/.test(reading.normalized);
            if (!told || inHouse) text("FINANCING_INFO", models, inHouse ? { inHouse: "yes" } : undefined);
            if (models.length > 0) text("SALES_FOLLOWUP", models);
            alert("FINANCING", models);
            next.lead = { kind: "FINANCING", models: [...models], captured: true };
            break;
          }
          if (base.lead?.kind === "FINANCING" && base.lead.captured) {
            text("LEAD_THANKS", models);
          } else {
            startLead("FINANCING", models);
          }
          break;
        case "TEST_DRIVE": {
          if (!botBooks) {
            // Workbook C (2026-09-18): a team member arranges and confirms it; the bot never says "booked".
            const asked = parseRequestedTime(reading.raw, nowIso);
            const typed = asked && asked.minutes !== null ? slotAtBeirut(asked, asked.minutes) : base.requestedSlot;
            text("TEST_DRIVE_REQUEST", models, typed ? { slot: slotLabel(typed) } : undefined);
            alert("TEST_DRIVE", models, { slot: typed ?? null, reason: "Asked for a test drive — a team member arranges and confirms it" });
            next.lead = { kind: "TEST_DRIVE", models: [...models], captured: true };
            next.requestedSlot = typed ?? null;
            break;
          }
          if (out.some((a) => a.type === "BOOK_TEST_DRIVE" || a.type === "SHOW_TEST_DRIVE_SLOTS")) break;
          const requested = parseRequestedTime(reading.raw, nowIso);
          if (base.lead?.kind === "TEST_DRIVE" && base.lead.captured) {
            if (requested) bookRequested(requested, models);
            else offerSlots(models);
          } else {
            if (requested && requested.minutes !== null) next.requestedSlot = slotAtBeirut(requested, requested.minutes);
            startLead("TEST_DRIVE", models);
          }
          break;
        }
        case "TRADE_IN": {
          const mileage = reading.hits.some((h) => h.intent === "TRADE_IN" && ["km", "kms"].includes(h.matched));
          if (mileage || base.lastIntent === "TRADE_IN") {
            text("TRADE_IN_THANKS");
            alert("TRADE_IN", models);
          } else {
            text("TRADE_IN_INFO");
          }
          break;
        }
        case "MODEL_YEAR":
          if (!asked.includes("FINANCING")) text("MODEL_YEAR", models);
          break;
      }
    }
  };

  const answerService = () => {
    if (!substantive.some((i) => SERVICE_INTENTS.includes(i))) return;
    text(substantive.includes("COMPLAINT") && !substantive.includes("SERVICE") && !substantive.includes("PARTS") ? "COMPLAINT_CONTACT" : "SERVICE_CONTACT");
    if (substantive.includes("COMPLAINT")) {
      out.push({ type: "FLAG_FOR_STAFF", reason: "A complaint — a person should reply personally." });
    }
  };

  const SPEC_NAMES: Record<string, string> = {
    "0 100": "0–100 km/h acceleration", acceleration: "acceleration", "how fast": "acceleration",
    snow: "performance in snow", "off road": "off-road capability", offroad: "off-road capability",
    leather: "seat material", "leather seats": "seat material", "wheels size": "wheel size", "size of the wheels": "wheel size",
    "wheel sizes": "wheel size", rims: "wheel size", "rim size": "wheel size", "inch wheels": "wheel size",
    generator: "generator output", "range extender power": "generator output", "extender power": "generator output",
    "to the wheels": "power at the wheels", "at the wheels": "power at the wheels", "wheel power": "power at the wheels",
    engine: "engine details", "engine size": "engine details", "engine power": "engine details", cylinders: "engine details",
    cc: "engine details", turbo: "engine details", motor: "motor details", motors: "motor details", "electric motor": "motor details",
    gearbox: "transmission", transmission: "transmission", awd: "drivetrain", "4wd": "drivetrain",
    "four wheel drive": "drivetrain", "all wheel drive": "drivetrain", drivetrain: "drivetrain",
    consumption: "fuel consumption", "fuel tank": "fuel tank size", "tank size": "fuel tank size",
    "مولد": "generator output", "محرك": "engine details", "موتور": "motor details",
    tow: "towing capacity", towing: "towing capacity", camera: "camera system", "360 camera": "camera system",
    adas: "driver-assistance features", autopilot: "driver-assistance features", "self driving": "driver-assistance features",
    weight: "weight", nm: "torque", "screen size": "screen size", "display size": "screen size",
  };
  const specName = (matched: string) => SPEC_NAMES[matched] ?? matched;

  /** Questions with no approved answer: said honestly, handed to the team, never guessed. */
  const answerQuestions = (models: readonly ModelCode[], asked: readonly Intent[]) => {
    for (const intent of asked) {
      switch (intent) {
        case "DELIVERY_LOCATION":
          text("DELIVERY_INFO", models);
          alert("QUESTION", models, { reason: "Asked about delivery" });
          break;
        case "PAYMENT_CURRENCY":
          // Samer, 2026-09-17: the bot does not talk about money or currency.
          text("PAYMENT_HANDOFF", models);
          alert("QUESTION", models, { reason: "Asked about payment / currency" });
          break;
        case "USED_CARS":
          text("USED_CARS_INFO", models);
          alert("QUESTION", models, { reason: "Asked about used cars" });
          break;
        case "OTHER_SPEC": {
          const detail = unique(reading.hits.filter((h) => h.intent === "OTHER_SPEC").map((h) => specName(h.matched))).join(", ") || "detail";
          text("SPEC_NOT_CONFIRMED", models, { detail });
          alert("QUESTION", models, { reason: `Asked about a specification not in the workbook: ${detail}` });
          break;
        }
      }
    }
  };

  /** A typed test-drive time: book it, or say why not and offer the free times near it. */
  function bookRequested(requested: ReturnType<typeof parseRequestedTime>, models: readonly ModelCode[]): void {
    if (!requested) return;
    const booked = deps.bookedSlots ?? [];
    if (requested.minutes === null) {
      const slots = freeSlotsOn(requested, nowIso, booked, requested.part).slice(0, channel === "whatsapp" ? 10 : 12);
      if (slots.length > 0) offerSlots(models, slots);
      else {
        text("TEST_DRIVE_TIME_CLOSED", models, { day: dayLabel(requested) });
        offerSlots(models);
      }
      return;
    }
    const slot = slotAtBeirut(requested, requested.minutes);
    const day = { year: requested.year, month: requested.month, day: requested.day };
    if (!isBookableSlot(slot) || Date.parse(slot) < Date.parse(nowIso) + 30 * 60_000) {
      const sameDay = freeSlotsOn(day, nowIso, booked).slice(0, channel === "whatsapp" ? 10 : 12);
      text("TEST_DRIVE_TIME_CLOSED", models, sameDay.length > 0 ? { day: dayLabel(day) } : {});
      offerSlots(models, sameDay.length > 0 ? sameDay : undefined);
      return;
    }
    if (booked.some((b) => Date.parse(b) === Date.parse(slot))) {
      const near = freeSlotsOn(day, nowIso, booked)
        .sort((a, b) => Math.abs(Date.parse(a) - Date.parse(slot)) - Math.abs(Date.parse(b) - Date.parse(slot)))
        .slice(0, channel === "whatsapp" ? 10 : 12)
        .sort();
      text("TEST_DRIVE_TAKEN", models, { slot: slotLabel(slot) });
      offerSlots(models, near.length > 0 ? near : undefined);
      return;
    }
    out.push({ type: "BOOK_TEST_DRIVE", slot, models: [...models] });
    alert("TEST_DRIVE", models, { slot });
    text("TEST_DRIVE_BOOKED", models, { slot: slotLabel(slot) });
    next.booking = slot;
    next.requestedSlot = null;
    next.awaiting = "NONE";
    next.offeredSlots = [];
    next.lead = null;
  }

  const finish = (): EngineDecision => {
    next.unknownSaid = saidUnknown ? true : out.some(isCustomerFacing) ? false : base.unknownSaid;
    const alerted = () => out.some((a) => a.type === "ALERT_SALES");
    // "Our Sales Team will assist you right here" is a promise: someone must be told.
    const promised = out.some(
      (a) =>
        a.type === "SEND_CONTACT_FALLBACK" ||
        (a.type === "SEND_FACTS" && a.scope === "one" && a.rows.some((r) => !r.confirmed)) ||
        (a.type === "SEND_TEXT" && (a.key === "INTERIOR_INFO" || a.key === "HANDOFF") && a.models.length > 0)
    );
    if (promised && !alerted()) alert("QUESTION", next.selectedModels, { reason: "The approved facts could not answer this — the customer was told Sales will follow up here" });
    // Workbook Replies (2026-09-18): "when done and have received the brochure and the video notify sales to follow up on the lead".
    const video = out.find((a) => a.type === "SEND_COLOUR_VIDEO" && !a.interior);
    if (video && video.type === "SEND_COLOUR_VIDEO" && next.brochureSentForCurrentActivation && !alerted()) {
      alert("LEAD", [video.model], { reason: "Received the brochure and the video — follow up on the lead" });
    }
    // A customer now waiting for a person, outside working hours, is told when the team is back.
    if (isAfterHours(nowIso) && out.some((a) => a.type === "ALERT_SALES") && out.some(isCustomerFacing)) {
      text("AFTER_HOURS_NOTE");
    }
    const actions = finalizeActions(out);
    next.lastIntent = substantive[0] ?? intents[0] ?? (u.intents.includes("UNKNOWN") ? "UNKNOWN" : base.lastIntent);
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
      gaps: actions.filter((a): a is Extract<EngineAction, { type: "CONTENT_GAP" }> => a.type === "CONTENT_GAP"),
    };
  };

  const payload = reading.payload;

  /* 0. A photo, a story reply, an emoji: nothing a rule can read. */
  if (reading.tokens.length === 0 && !payload && u.modelSource !== "referral") {
    reasons.push(
      input.hasMedia
        ? "A photo, video or story reply with no words — a person looks. A model is never guessed from media."
        : "An empty message — nothing to answer."
    );
    return finish();
  }

  /* 0b. The customer asked for a person: the bot stays out until the context expires or a person takes over. */
  // …but only for words it cannot read. A question it CAN answer is answered while they wait
  // (Samer, 2026-09-18: the chat must always be able to talk); a person's reply then pauses the bot.
  const understood = substantive.length > 0 || greeted || u.models.length > 0 || u.modelCandidates.length > 0 || u.colour.kind !== "none";
  if (base.awaiting === "PERSON" && !payload && !understood) {
    reasons.push("The customer asked for a person — a person reads it.");
    return finish();
  }
  if (base.awaiting === "PERSON") next.awaiting = "NONE";

  /* 0c. "Can I talk to a human": said at once, and the chat is theirs. */
  if (substantive.includes("HUMAN_HANDOFF")) {
    text("HUMAN_HANDOFF", u.models.length > 0 ? u.models : u.model ? [u.model] : []);
    alert("HUMAN", u.models.length > 0 ? u.models : u.model ? [u.model] : [], { reason: "Asked to talk to a person" });
    next.awaiting = "PERSON";
    return finish();
  }

  /* 0c2. The Passion S (Samer, 2026-09-18: "leave passion s only to be answered by sales team
     instead of chat bot"). It is not in A Car Facts, so the bot has nothing approved to say about
     it — and it must never be answered as the Passion. "the passion's price" is not the Passion S. */
  if (!payload && asksAboutPassionS(reading.raw)) {
    text("SALES_FOLLOWUP", []);
    alert("QUESTION", [], { reason: "Asked about the Passion S — the Sales team answers, not the bot" });
    return finish();
  }

  /* 0d. My test drive: when is it, change it, cancel it. A new time typed after a booking
     ("change it to monday 11am", "make it 4 instead") is a change too. */
  const n = reading.normalized;
  const wantsCancel = /\b(cancel|الغ)/.test(n) || /الغاء|إلغاء/.test(n);
  const wantsChange = /\b(change|reschedule|move|postpone|instead|shift|تأجيل|غير)/.test(n) || /تغيير/.test(n);
  const hasTestDrive = base.booking !== null || (!botBooks && base.lead?.kind === "TEST_DRIVE");
  // "saturday afternoon" after a test-drive request is a preferred day, not a question about opening hours.
  const onlyDayWords =
    substantive.every((i) => i === "OPENING_HOURS") &&
    reading.hits.filter((h) => h.intent === "OPENING_HOURS").every((h) => /^(mon|tues|wednes|thurs|fri|satur|sun)day$|^(today|tomorrow)$/.test(h.matched));
  const retimed =
    hasTestDrive && !payload && !substantive.includes("TEST_DRIVE_CHANGE") && (wantsChange || substantive.length === 0 || onlyDayWords) && parseRequestedTime(reading.raw, nowIso) !== null;
  if ((substantive.includes("TEST_DRIVE_CHANGE") || retimed) && !payload && !botBooks) {
    // A person arranges test drives: the bot passes the wish on, and never confirms or cancels anything itself.
    const models = base.lead?.models ?? base.selectedModels;
    const asked = parseRequestedTime(reading.raw, nowIso);
    const typed = asked && asked.minutes !== null ? slotAtBeirut(asked, asked.minutes) : null;
    if (typed && !wantsCancel) {
      text("TEST_DRIVE_TIME_PASSED", models, { slot: slotLabel(typed) });
      alert("TEST_DRIVE", models, { slot: typed, reason: wantsChange ? "Asked to change the test drive time" : "Gave a preferred test drive time" });
      next.requestedSlot = typed;
    } else {
      text("TEST_DRIVE_TEAM", models);
      alert("TEST_DRIVE", models, { reason: wantsCancel ? "Asked to cancel the test drive" : wantsChange ? "Asked to change the test drive" : retimed ? "Gave a preferred day for the test drive — see the chat" : "Asked about their test drive" });
    }
    next.lead = { kind: "TEST_DRIVE", models: [...models], captured: true };
    next.lastIntent = "TEST_DRIVE";
    return finish();
  }
  if ((substantive.includes("TEST_DRIVE_CHANGE") || retimed) && !payload) {
    const models = base.lead?.models ?? base.selectedModels;
    if (!base.booking) {
      text("TEST_DRIVE_NONE", models);
      if (!wantsCancel) startLead("TEST_DRIVE", models);
      return finish();
    }
    if (wantsCancel && !wantsChange) {
      out.push({ type: "CANCEL_TEST_DRIVE", slot: base.booking });
      text("TEST_DRIVE_CANCELLED", models, { slot: slotLabel(base.booking) });
      alert("TEST_DRIVE", models, { reason: "Cancelled the test drive" });
      next.booking = null;
      return finish();
    }
    if (wantsChange || retimed) {
      out.push({ type: "CANCEL_TEST_DRIVE", slot: base.booking });
      next.booking = null;
      const requested = parseRequestedTime(reading.raw, nowIso);
      if (requested) {
        bookRequested(requested, models);
      } else {
        text("TEST_DRIVE_RESCHEDULE", models, { slot: slotLabel(base.booking) });
        next.lead = { kind: "TEST_DRIVE", models: [...models], captured: true };
        offerSlots(models);
      }
      return finish();
    }
    text("TEST_DRIVE_WHEN", models, { slot: slotLabel(base.booking) });
    return finish();
  }

  /* 1. The welcome's department menu, a powertrain menu, a test-drive slot. */
  const administration = !payload && reading.tokens.length <= 3 && reading.tokens.some((t) => ["administration", "admin", "accounting", "الاداره", "اداره", "الادارة", "الإدارة"].includes(t));
  if (administration) {
    text("ADMIN_CONTACT");
    return finish();
  }
  // Sales · Customer Service · After-Sales · Service & Maintenance · Administration (workbook D, 2026-09-18).
  if (!payload && base.lastIntent === "GREETING" && !hasContext(base) && reading.choiceNumber !== null && reading.choiceNumber <= 5) {
    const n = reading.choiceNumber;
    if (n === 1) offerModels(scope, false);
    else text(n === 5 ? "ADMIN_CONTACT" : "SERVICE_CONTACT");
    return finish();
  }
  if (payload?.kind === "DEPARTMENT") {
    if (payload.department === "SALES") offerModels(scope, false);
    else text(payload.department === "ADMIN" ? "ADMIN_CONTACT" : "SERVICE_CONTACT");
    return finish();
  }
  if (payload?.kind === "CATEGORY") {
    showCategory([payload.bucket], null);
    return finish();
  }
  const slotAnswer =
    payload?.kind === "SLOT"
      ? payload.at
      : base.awaiting === "TEST_DRIVE_SLOT" && reading.choiceNumber !== null
        ? (base.offeredSlots[reading.choiceNumber - 1] ?? null)
        : base.awaiting === "TEST_DRIVE_SLOT"
          ? (base.offeredSlots.find((s) => normalize(slotLabel(s)) === reading.normalized) ?? null)
          : null;
  if (slotAnswer === null && base.awaiting === "TEST_DRIVE_SLOT" && !payload) {
    const requested = parseRequestedTime(reading.raw, nowIso);
    if (requested) {
      bookRequested(requested, base.lead?.models ?? base.selectedModels);
      return finish();
    }
  }
  if (slotAnswer !== null) {
    const models = base.lead?.models ?? base.selectedModels;
    const stillFree = freeSlots(nowIso, deps.bookedSlots ?? [], { max: 200, perDay: 50, days: 14, noticeMinutes: 30 });
    if (isBookableSlot(slotAnswer) && stillFree.includes(slotAnswer)) {
      out.push({ type: "BOOK_TEST_DRIVE", slot: slotAnswer, models: [...models] });
      alert("TEST_DRIVE", models, { slot: slotAnswer });
      text("TEST_DRIVE_BOOKED", models, { slot: slotLabel(slotAnswer) });
      next.booking = slotAnswer;
      next.requestedSlot = null;
      next.awaiting = "NONE";
      next.offeredSlots = [];
      next.lead = null;
    } else {
      reasons.push("That test-drive time is no longer free — offering the free ones.");
      offerSlots(models);
    }
    return finish();
  }

  /* 2. The name and/or the phone number for a lead. The bot is waiting for a
   *    field, so a bare number or a bare name is that field, whatever else it
   *    might look like — and only the missing one is asked for. */
  if ((base.awaiting === "LEAD_NAME" || base.awaiting === "LEAD_PHONE") && base.lead && !payload && u.models.length === 0 && u.modelCandidates.length === 0) {
    const onlyWords = substantive.filter((i) => i !== "CONTACT_NUMBER" && i !== "CALLBACK" && i !== "TEST_DRIVE").length === 0;
    const phone = readPhone(reading.raw);
    const name = onlyWords ? readName(reading.raw) : null;
    if (name || phone) {
      const lead = base.lead;
      const haveName = Boolean(lead.haveName || name);
      const havePhone = Boolean(lead.havePhone || phone || channel === "whatsapp");
      const kind: AlertKind = lead.kind;
      alert(kind, lead.models, { name, phone, ...(kind === "CALLBACK" ? { reason: "Asked to be called" } : {}) });
      if (!haveName && channel !== "whatsapp" && lead.kind !== "CALLBACK") {
        next.lead = { ...lead, havePhone: true };
        next.awaiting = "LEAD_NAME";
        text("ASK_NAME", lead.models);
        return finish();
      }
      if (!havePhone) {
        next.lead = { ...lead, haveName: true };
        next.awaiting = "LEAD_PHONE";
        text("ASK_PHONE", lead.models);
        return finish();
      }
      next.lead = { ...lead, captured: true, haveName, havePhone };
      next.awaiting = "NONE";
      if (lead.kind === "CALLBACK") {
        text("CALLBACK_CONFIRMED", lead.models, phone ? { phone: `+${phone}` } : {});
      } else if (lead.kind === "FINANCING") {
        text("LEAD_THANKS", lead.models, name ? { name } : {});
        if (lead.andTestDrive) {
          alert("TEST_DRIVE", lead.models, { name, phone });
          next.lead = { kind: "TEST_DRIVE", models: [...lead.models], captured: true, haveName, havePhone };
          if (lead.models.length > 0) offerSlots(lead.models);
        }
      } else if (lead.models.length === 0) {
        next.pendingIntents = unique([...base.pendingIntents, "TEST_DRIVE"]);
        offerModels(scope, false);
      } else if (base.requestedSlot) {
        const w = requestedFromIso(base.requestedSlot);
        bookRequested(w, lead.models);
      } else {
        offerSlots(lead.models);
      }
      return finish();
    }
  }

  /* 2b. A time typed while the bot is still asking which car to test drive: kept for the booking. */
  if (base.awaiting === "MODEL" && base.pendingIntents.includes("TEST_DRIVE") && !payload && u.models.length === 0 && u.modelCandidates.length === 0) {
    const requested = parseRequestedTime(reading.raw, nowIso);
    if (requested && requested.minutes !== null && substantive.length === 0) {
      next.requestedSlot = slotAtBeirut(requested, requested.minutes);
      text("TEST_DRIVE_TIME_NOTED", [], { slot: slotLabel(next.requestedSlot) });
      offerModels(scope, false);
      return finish();
    }
  }

  /* 2a. "Call me": the team calls back — never the number given back to them. */
  if (substantive.includes("CALLBACK")) {
    const phone = readPhone(reading.raw);
    const models = u.models.length > 0 ? u.models : u.model ? [u.model] : base.selectedModels;
    if (phone || channel === "whatsapp") {
      alert("CALLBACK", models, { phone, reason: "Asked to be called" });
      text("CALLBACK_CONFIRMED", models, phone ? { phone: `+${phone}` } : {});
    } else {
      text("CALLBACK_ASK_NUMBER", models);
      next.lead = { kind: "CALLBACK", models: [...models], captured: false, haveName: false, havePhone: false };
      next.awaiting = "LEAD_PHONE";
    }
    return finish();
  }

  /* 2b. Details of the customer's OWN car after the trade-in answer ("bmw x5 2019 120000 km"). */
  if (base.lastIntent === "TRADE_IN" && !payload && u.models.length === 0) {
    const details =
      substantive.some((i) => i === "TRADE_IN" || i === "RANGE" || i === "OTHER_BRAND" || i === "MODEL_YEAR") ||
      reading.tokens.some((t) => /^\d{4,}$/.test(t)) ||
      (reading.tokens.length === 0 && input.hasMedia === true);
    if (details) {
      text("TRADE_IN_THANKS");
      alert("TRADE_IN", []);
      next.lastIntent = "TRADE_IN";
      return finish();
    }
  }

  /* 3. "ok", "thanks", a thumbs up: never a menu, never a loop. */
  if (substantive.length === 0 && acknowledged && u.models.length === 0 && u.modelCandidates.length === 0 && u.colour.kind === "none") {
    reasons.push("An acknowledgement — nothing new was asked.");
    return finish();
  }

  /* 4. A greeting alone: the welcome and the departments. */
  if (substantive.length === 0 && greeted && u.models.length === 0 && u.modelCandidates.length === 0 && u.crossBrand.length === 0 && u.colour.kind === "none") {
    // Always greeted back, in a new chat or an old one (2026-09-18: a "hi" in a chat that already
    // had history got no reply at all). The welcome and the departments.
    out.push({ type: "SHOW_DEPARTMENTS" });
    return finish();
  }

  /* 5. After-sales, other brands and questions with no approved answer answer the same whatever the car. */
  answerService();
  answerQuestions(u.models.length > 0 ? u.models : u.model ? [u.model] : [], substantive.filter((i) => QUESTION_INTENTS.includes(i)));
  if (substantive.includes("OTHER_BRAND") && u.models.length === 0 && u.model === null) {
    text("OTHER_BRAND");
  }

  const namedNow = u.models;
  const context = base.selectedModels.filter(sells);
  const pastedOffer = (reading.raw.match(/\$\s?\d/g) ?? []).length >= 2 && reading.tokens.length > 25;
  if (pastedOffer && namedNow.length === 1) {
    substantive.splice(0, substantive.length, "PRICE");
  }
  const categories = readCategories(reading.tokens);
  const seats = readSeatCount(reading.tokens);
  const wantsAll = readsAll(reading.tokens);
  const factsAsked = unique(substantive.filter(isFactIntent)).filter((f) => f !== "SPECIFICATIONS");

  /* 6. "What EVs do you have?", "7 seater?", "electric or hybrid?": filter the cars. */
  /** "6 to 7 seats" answers a 6-seat and a 7-seat question. */
  function hasSeats(code: ModelCode, count: number): boolean {
    const m = modelByCode(k, code);
    if (!m) return false;
    return (m.seatOptions ?? (m.seatCount !== null ? [m.seatCount] : [])).includes(count);
  }

  function showCategory(filters: readonly CategoryFilter[], seatCount: number | null): void {
    const byBucket = (b: PowertrainBucket) => scope.filter((c) => modelByCode(k, c)?.bucket === b);
    let action: Extract<EngineAction, { type: "SHOW_CATEGORY" }>;
    if (seatCount !== null) {
      action = { type: "SHOW_CATEGORY", filter: "SEATS", seats: seatCount, groups: [{ bucket: null, models: scope.filter((c) => hasSeats(c, seatCount)) }] };
    } else if (filters.includes("EV") && filters.length > 1) {
      action = { type: "SHOW_CATEGORY", filter: "ALL_TYPES", groups: (["EV", "EREV", "PHEV"] as PowertrainBucket[]).map((b) => ({ bucket: b, models: byBucket(b) })) };
    } else if (filters.includes("HYBRID") || (filters.includes("EREV") && filters.includes("PHEV"))) {
      action = { type: "SHOW_CATEGORY", filter: "HYBRID", groups: (["EREV", "PHEV"] as PowertrainBucket[]).map((b) => ({ bucket: b, models: byBucket(b) })) };
    } else {
      const b = filters[0] as PowertrainBucket;
      action = { type: "SHOW_CATEGORY", filter: b, groups: [{ bucket: b, models: byBucket(b) }] };
    }
    const shown = action.groups.flatMap((g) => g.models);
    if (shown.length === 0) {
      // Nothing of that kind in this account's range (an EV on the MHERO account): say so, offer what there is.
      const kind = seatCount !== null ? `${seatCount}-seat model` : filters.includes("EV") ? "fully electric model" : filters.includes("EREV") ? "range-extended electric model" : "plug-in hybrid model";
      const alternatives = (["EV", "EREV", "PHEV"] as PowertrainBucket[])
        .map((b) => ({ b, models: byBucket(b) }))
        .filter((g) => g.models.length > 0)
        .map((g) => `${g.b === "EV" ? "Fully electric (EV)" : g.b === "EREV" ? "Range-extended electric (EREV)" : "Plug-in hybrid (PHEV)"}: ${g.models.map((m) => modelByCode(k, m)?.displayName ?? m).join(", ")}`)
        .join("\n");
      text("CATEGORY_NONE", [], { kind, alternatives });
      offerModels(scope, false);
      return;
    }
    out.push(action);
    next.categoryFilter = seatCount !== null ? null : (filters.length === 1 ? filters[0] : "HYBRID");
    next.offeredModels = shown;
    next.awaiting = shown.length > 0 ? "MODEL" : "NONE";
  }

  const typeQuestion = categories.length > 0 || seats !== null;
  const onlyTypeFacts = factsAsked.every((f) => f === "POWERTRAIN" || f === "SEATS");
  if (typeQuestion && namedNow.length === 0 && u.modelCandidates.length === 0 && !onlyTypeFacts && u.model === null) {
    const typed = seats !== null
      ? scope.filter((c) => hasSeats(c, seats))
      : scope.filter((c) => {
          const b = modelByCode(k, c)?.bucket;
          return categories.some((f) => f === b || (f === "HYBRID" && (b === "EREV" || b === "PHEV")));
        });
    if (typed.length === 1) {
      decideForModel(typed[0], true);
      return finish();
    }
    if (typed.length > 1) {
      decideForSeveral(typed, true);
      return finish();
    }
  }
  if (
    typeQuestion &&
    namedNow.length === 0 &&
    u.modelCandidates.length === 0 &&
    onlyTypeFacts &&
    (u.model === null || asksForOptions(reading.tokens) || substantive.includes("MODEL_LIST"))
  ) {
    showCategory(categories, seats);
    answerGlobal();
    return finish();
  }

  /* 7. "Compare them", "which is better, the Dream or the Passion?". */
  if (substantive.includes("COMPARE")) {
    const models = namedNow.length >= 2 ? namedNow : context.length >= 2 ? context : u.modelCandidates.length >= 2 ? u.modelCandidates : scope;
    const facts = factsAsked.length > 0 ? factsAsked : models.length > 3 ? COMPARE_FACTS_SHORT : COMPARE_FACTS;
    out.push({ type: "SEND_COMPARISON", models: [...models], rows: factRows(models, facts) });
    if (models !== scope) next.selectedModels = [...models];
    answerGlobal();
    answerSales(models === scope ? [] : models, substantive.filter((i) => SALES_INTENTS.includes(i)));
    return finish();
  }

  /* 8. The switched-off car, and cars another brand's account sells. */
  if (u.switchedOff && namedNow.length === 0) {
    fallback({ kind: "MODEL_SWITCHED_OFF", model: u.switchedOff });
    answerGlobal();
    reasons.push(`Automation is switched off for the ${modelLabel(u.switchedOff)} on /sales.`);
    return finish();
  }
  if (namedNow.length === 0 && u.model === null && u.modelCandidates.length === 0 && u.crossBrand.length > 0) {
    for (const code of u.crossBrand) fallback({ kind: "CROSS_BRAND", model: code });
    answerGlobal();
    reasons.push(`${u.crossBrand.map(modelLabel).join(", ")} is sold by another brand's account — this account never sends another brand's material.`);
    return finish();
  }

  /* 9. A brand with no model ("the mhero"), a body type with several cars: which one? */
  const bothWords = reading.tokens.some((t) => ["and", "both", "each", "w", "و"].includes(t));
  if (u.modelCandidates.length > 1 && namedNow.length === 0 && bothWords && substantive.length > 0) {
    decideForSeveral(u.modelCandidates, true);
    return finish();
  }
  if (u.modelCandidates.length > 1 && namedNow.length === 0) {
    next.pendingIntents = unique([...base.pendingIntents, ...substantive.filter((i) => i === "PRICE" || i === "BROCHURE" || i === "GENERAL_INFO" || i === "COLOUR" || i === "COLOUR_VIDEO" || i === "AVAILABILITY")]);
    if (factsAsked.length > 0) sendFacts(u.modelCandidates, factsAsked, "several");
    answerGlobal();
    answerSales([], substantive.filter((i) => i !== "PRICE" && i !== "AVAILABILITY"));
    offerModels(u.modelCandidates, true);
    return finish();
  }

  /* 10. Several cars: named together now, or kept from before. */
  const several = namedNow.length >= 2 ? namedNow : namedNow.length === 0 && u.model === null && context.length >= 2 ? context : null;
  if (several) {
    decideForSeveral(several, namedNow.length >= 2);
    return finish();
  }

  /* 11. One car. */
  if (u.model !== null) {
    decideForModel(u.model);
    return finish();
  }

  /* 12. A question about the cars just offered as a short list ("the price of each"). */
  const narrowedOffer =
    base.awaiting === "MODEL" && base.offeredModels.length >= 2 && (base.offeredModels.length < scope.length || bothWords)
      ? base.offeredModels.filter(sells)
      : [];
  if (
    narrowedOffer.length >= 2 &&
    substantive.some((i) => isFactIntent(i) || i === "PRICE" || i === "COLOUR" || i === "BROCHURE" || i === "AVAILABILITY")
  ) {
    decideForSeveral(narrowedOffer, false);
    return finish();
  }

  /* 13. No car at all. */
  decideWithoutModel();
  return finish();

  /* ── One car ─────────────────────────────────────────────────────────── */

  function decideForModel(model: ModelCode, namedByFilter = false): void {
    const knowledgeModel = modelByCode(k, model);
    if (!knowledgeModel) return;
    const car = carOf(model);
    const isNamed = namedByFilter || u.modelSource !== "state";
    const activating = isNamed && model !== base.activeModel;

    next.selectedModels = [model];
    if (activating) {
      activation = { kind: u.modelSource === "referral" ? "REFERRAL" : base.activeModel ? "SWITCH" : "NEW", model, id: base.modelActivationId + 1 };
      next.activeModel = model;
      next.modelActivationId = base.modelActivationId + 1;
      next.selectedColour = null;
      next.brochureSentForCurrentActivation = false;
      next.colourPromptSentForCurrentActivation = false;
      next.offeredColours = [];
      next.offeredModels = [];
      next.categoryFilter = null;
      if (next.awaiting === "MODEL") next.awaiting = "NONE";
    }

    // The answer to "which model?" releases what was asked before it.
    const consumePending = activating || (isNamed && base.awaiting === "MODEL");
    const toAnswer = unique([...(consumePending ? base.pendingIntents : []), ...substantive]);
    if (consumePending) {
      next.pendingIntents = [];
      next.offeredModels = [];
      if (next.awaiting === "MODEL") next.awaiting = "NONE";
    }
    if (next.lead && !next.lead.models.includes(model)) next.lead = { ...next.lead, models: [...next.lead.models, model] };

    const have = car ? deps.media(car.id) : NO_MEDIA;
    const sendable: WaColour[] = car ? sendableColours(car.colours, exteriorCounts(have)) : [];
    const choices = sendable.filter(isChoiceColour);
    const interiorVideo = Object.values(have.videosByColour).flat().find((v) => v.view === "interior") ?? null;

    // 1. The brochure: first on every activation, again only when asked.
    const wantsBrochure = toAnswer.includes("BROCHURE") || toAnswer.includes("SPECIFICATIONS");
    const wantsInfo = toAnswer.includes("GENERAL_INFO");
    const wantsStock = toAnswer.includes("AVAILABILITY");
    if (consumePending && base.pendingIntents.includes("TEST_DRIVE") && base.requestedSlot && base.lead?.captured) {
      bookRequested(requestedFromIso(base.requestedSlot), [model]);
    }
    const brochureDue = activating || wantsBrochure || ((wantsInfo || wantsStock) && !next.brochureSentForCurrentActivation);
    if (brochureDue) {
      if (have.brochure) {
        out.push({ type: "SEND_BROCHURE", model, asset: have.brochure, explicit: wantsBrochure && !activating });
        next.brochureSentForCurrentActivation = true;
      } else {
        gap(model, "BROCHURE", null, null, `MISSING BROCHURE: ${modelLabel(model)}`);
        fallback({ kind: "MISSING_BROCHURE", model });
      }
    } else if (wantsInfo) {
      // "Tell me more" about a car already introduced: its key facts, not the phone number.
      sendFacts([model], KEY_FACTS, "one");
    }

    // 2. Facts, in the order asked.
    const facts = unique(toAnswer.filter(isFactIntent)).filter((f) => f !== "SPECIFICATIONS");
    if (facts.length > 0) sendFacts([model], facts, "one");

    answerGlobal();
    answerSales([model], toAnswer.filter((i) => SALES_INTENTS.includes(i)));
    answerQuestions([model], toAnswer.filter((i) => QUESTION_INTENTS.includes(i) && !(substantive as readonly Intent[]).includes(i)));

    // The inside of the car, and photos: said honestly, never an exterior video in their place.
    if (toAnswer.includes("INTERIOR_COLOUR")) {
      if (interiorVideo) {
        out.push({ type: "SEND_COLOUR_VIDEO", model, colour: "interior", colourName: "interior", asset: interiorVideo, chosenForThem: false, onlyOption: true, interior: true });
      } else {
        text("INTERIOR_INFO", [model]);
        gap(model, "COLOUR_MEDIA", "INTERIOR", null, `NO INTERIOR MEDIA: ${modelLabel(model)}`);
      }
    }
    const wantsPhotos = toAnswer.includes("MEDIA_PHOTOS");
    if (wantsPhotos) text("PHOTOS_INFO", [model]);

    // 3. The colour.
    const wantVideo = toAnswer.includes("COLOUR_VIDEO") || (wantsPhotos && !toAnswer.includes("INTERIOR_COLOUR"));
    const wantColours = toAnswer.includes("COLOUR") || wantsStock;
    const offerColours = () => {
      if (sendable.length === 0) {
        gap(model, "COLOUR_MEDIA", null, null, `NO COLOUR VIDEOS: ${modelLabel(model)}`);
        next.colourPromptSentForCurrentActivation = true;
        return;
      }
      if (choices.length === 0 || sendable.length === 1) {
        // One video only — no colour choice (the Dream) or a single colour (the MHERO 1): a question
        // with one answer is no question. Every one-video car behaves the same (symmetry, 2026-09-18).
        sendVideo(sendable[0], false);
        return;
      }
      out.push({ type: "SHOW_COLOUR_CHOICES", model, colours: choices.map((c) => ({ id: c.id, name: c.name })) });
      next.awaiting = "COLOUR";
      next.offeredColours = choices.map((c) => c.id);
      next.colourPromptSentForCurrentActivation = true;
    };
    const sendVideo = (colour: WaColour, chosenForThem: boolean) => {
      const asset = (have.videosByColour[colour.id] ?? []).find((v) => v.view !== "interior");
      if (!asset) {
        offerColours();
        return;
      }
      out.push({ type: "SEND_COLOUR_VIDEO", model, colour: colour.id, colourName: colour.name, asset, chosenForThem, onlyOption: choices.length <= 1 });
      next.selectedColour = colour.id;
      next.colourPromptSentForCurrentActivation = true;
      next.offeredColours = [];
      if (next.awaiting === "COLOUR") next.awaiting = "NONE";
    };

    const commercial = toAnswer.some((i) => i === "PRICE" || i === "FINANCING" || i === "TEST_DRIVE" || i === "DISCOUNT");
    // A lead question or a slot list is the one question of this reply.
    const askingSomethingElse = next.awaiting === "LEAD_NAME" || next.awaiting === "LEAD_PHONE" || next.awaiting === "TEST_DRIVE_SLOT";
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
      if (sendable.length === 1) sendVideo(sendable[0], false);
      else offerColours();
    } else if (c.kind === "several") {
      offerColours();
    } else if (c.kind === "no_preference") {
      const pick = sendable[0];
      if (pick) sendVideo(pick, true);
      else offerColours();
    } else if (wantVideo) {
      const chosen = sendable.find((s) => s.id === next.selectedColour) ?? (sendable.length === 1 ? sendable[0] : null);
      if (chosen) sendVideo(chosen, false);
      else offerColours();
    } else if (askingSomethingElse) {
      // The colour waits: one question at a time.
    } else if (commercial && !wantColours && sendable.length > 0 && (activating || !base.selectedColour)) {
      // Workbook C (2026-09-18): price, installments, offers and test drives get the brochure AND the
      // model video before Sales takes over — no colour question in the way.
      sendVideo(sendable.find((s) => s.id === next.selectedColour) ?? sendable[0], false);
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
      // Words the rules cannot read (a name, a sentence of their own) are for a person — never a silent ignore.
      const unread = substantive.length === 0 && !acknowledged && u.modelSource === "state" && reading.tokens.length > 0 && !payload;
      if (unread) sayUnknown([model], "Words the bot has no approved answer for");
      else reasons.push(`Already talking about the ${modelLabel(model)} — nothing new was asked.`);
    }
  }

  /* ── Several cars ────────────────────────────────────────────────────── */

  function decideForSeveral(models: readonly ModelCode[], namedTogether: boolean): void {
    next.selectedModels = [...models];
    next.activeModel = null;
    next.offeredColours = [];
    if (next.awaiting === "MODEL" || next.awaiting === "COLOUR") next.awaiting = "NONE";
    const toAnswer = unique([...(namedTogether && base.awaiting === "MODEL" ? base.pendingIntents : []), ...substantive]);
    if (namedTogether) next.pendingIntents = [];
    if (next.lead) next.lead = { ...next.lead, models: unique([...next.lead.models, ...models]) };

    const facts = unique(toAnswer.filter(isFactIntent)).filter((f) => f !== "SPECIFICATIONS");
    const wantsBrochure = toAnswer.includes("BROCHURE") || toAnswer.includes("SPECIFICATIONS") || toAnswer.includes("GENERAL_INFO");
    const wantsColours = toAnswer.includes("COLOUR") || toAnswer.includes("COLOUR_VIDEO");
    const sales = toAnswer.filter((i) => SALES_INTENTS.includes(i));

    const sendBrochures = () => {
      for (const code of models.slice(0, MAX_BROCHURES)) {
        const car = carOf(code);
        const have = car ? deps.media(car.id) : NO_MEDIA;
        if (have.brochure) out.push({ type: "SEND_BROCHURE", model: code, asset: have.brochure, explicit: true });
        else gap(code, "BROCHURE", null, null, `MISSING BROCHURE: ${modelLabel(code)}`);
      }
    };

    if (facts.length > 0) sendFacts(models, facts, "several");
    if (wantsBrochure || (namedTogether && facts.length === 0 && !wantsColours && sales.length === 0 && toAnswer.length === 0)) {
      // "Show me the Free 318 and the Courage": both brochures, and their key facts.
      sendBrochures();
      if (facts.length === 0) sendFacts(models, KEY_FACTS, "several");
    }
    if (wantsColours) {
      out.push({ type: "SEND_COLOUR_LIST", rows: models.map(colourRow) });
    }
    if (toAnswer.includes("INTERIOR_COLOUR")) text("INTERIOR_INFO", models);
    if (toAnswer.includes("MEDIA_PHOTOS")) text("PHOTOS_INFO", models);
    answerGlobal();
    answerSales(models, sales);
    answerQuestions(models, toAnswer.filter((i) => QUESTION_INTENTS.includes(i) && !(substantive as readonly Intent[]).includes(i)));

    for (const code of u.crossBrand) fallback({ kind: "CROSS_BRAND", model: code });

    const asking = next.awaiting === "LEAD_NAME" || next.awaiting === "LEAD_PHONE" || next.awaiting === "TEST_DRIVE_SLOT";
    if (!asking && (out.length > 0 || namedTogether)) {
      // Keep both selected, and let the customer open either one.
      offerModels(models, true, wantsBrochure || wantsColours || facts.length > 0 ? "first" : "which");
      next.awaiting = "MODEL";
    }
    if (out.length === 0) {
      if (substantive.length === 0 && !acknowledged && !namedTogether && reading.tokens.length > 0 && !payload) sayUnknown(models, "Words the bot has no approved answer for");
      else reasons.push("Several cars in play, but nothing new was asked.");
    }
  }

  /* ── No car ──────────────────────────────────────────────────────────── */

  function decideWithoutModel(): void {
    const wantsBrochure = substantive.includes("BROCHURE") || substantive.includes("SPECIFICATIONS");
    const wantsColours = substantive.includes("COLOUR") || substantive.includes("COLOUR_VIDEO");
    let explore = false;

    // A spec asked of no car: the value for every car in scope (workbook E: never only "which model?").
    if (factsAsked.length > 0) {
      sendFacts(scope, factsAsked, "all");
      explore = true;
    }
    if (wantsBrochure && wantsAll) {
      for (const code of scope.slice(0, MAX_BROCHURES)) {
        const car = carOf(code);
        const have = car ? deps.media(car.id) : NO_MEDIA;
        if (have.brochure) out.push({ type: "SEND_BROCHURE", model: code, asset: have.brochure, explicit: true });
      }
      explore = true;
    }
    if (wantsColours && wantsAll) {
      // "Show me all the colours": every car. Plain "colours?" asks which car first.
      out.push({ type: "SEND_COLOUR_LIST", rows: scope.map(colourRow) });
      explore = true;
    }
    if (substantive.includes("INTERIOR_COLOUR")) text("INTERIOR_INFO", []);
    else if (substantive.includes("MEDIA_PHOTOS")) text("PHOTOS_INFO", []);

    answerGlobal();
    answerSales([], substantive.filter((i) => SALES_INTENTS.includes(i)));

    const PENDING: readonly Intent[] = [
      "PRICE", "AVAILABILITY", "GENERAL_INFO", "BROCHURE", "COLOUR", "COLOUR_VIDEO", "MEDIA_PHOTOS", "INTERIOR_COLOUR",
      // Workbook C (2026-09-18): "ask which model only when missing", then brochure, video and Sales.
      ...(askLeadName ? [] : (["FINANCING"] as const)),
      ...(botBooks ? [] : (["TEST_DRIVE"] as const)),
    ];
    const needsModel = substantive.some((i) => PENDING.includes(i) && !(wantsAll && (i === "BROCHURE" || i === "COLOUR" || i === "COLOUR_VIDEO")));
    const wantsList = substantive.includes("MODEL_LIST") || substantive.includes("SALES");
    const asking = next.awaiting === "LEAD_NAME" || next.awaiting === "LEAD_PHONE" || next.awaiting === "TEST_DRIVE_SLOT";

    if (needsModel && !asking) {
      next.pendingIntents = unique([...base.pendingIntents, ...substantive.filter((i) => PENDING.includes(i))]);
      offerModels(scope, false);
    } else if ((wantsList || explore || (substantive.includes("MODEL_YEAR") && out.length > 0)) && !asking) {
      offerModels(scope, false, explore ? "explore" : "which");
    }

    if (out.length === 0) {
      sayUnknown([], base.awaiting === "MODEL" ? 'Not an answer to "which model?"' : "Words the bot has no approved answer for");
    }
  }
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
    selectedModels: s.selectedModels,
    selectedColour: s.selectedColour,
    awaiting: s.awaiting,
    pendingIntents: s.pendingIntents,
    modelActivationId: s.modelActivationId,
    brochureSent: s.brochureSentForCurrentActivation,
    colourPromptSent: s.colourPromptSentForCurrentActivation,
    lead: s.lead ? { kind: s.lead.kind, captured: s.lead.captured } : null,
  });
  return {
    outcome: d.outcome,
    exclusion: u.reading.exclusion?.kind ?? null,
    language: u.reading.language,
    confidence: u.reading.confidence,
    intents: u.intents,
    model: u.model,
    models: u.models,
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
        case "SEND_FACTS":
          return { type: a.type, scope: a.scope, facts: unique(a.rows.map((r) => r.fact)), models: unique(a.rows.map((r) => r.model)) };
        case "SEND_COMPARISON":
          return { type: a.type, models: a.models };
        case "SEND_COLOUR_LIST":
          return { type: a.type, models: a.rows.map((r) => r.model) };
        case "SEND_GLOBAL_INFO":
          return { type: a.type, key: a.key };
        case "SEND_COLOUR_VIDEO":
          return { type: a.type, model: a.model, colour: a.colour };
        case "COLOUR_NOT_AVAILABLE":
          return { type: a.type, model: a.model };
        case "SEND_TEXT":
          return { type: a.type, key: a.key };
        case "SEND_CONTACT_FALLBACK":
          return { type: a.type, reasons: a.reasons.map((r) => r.kind) };
        case "SHOW_COLOUR_CHOICES":
          return { type: a.type, model: a.model, colours: a.colours.map((c) => c.id) };
        case "SHOW_MODEL_CHOICES":
          return { type: a.type, models: a.models };
        case "SHOW_CATEGORY":
          return { type: a.type, filter: a.filter };
        case "SHOW_TEST_DRIVE_SLOTS":
          return { type: a.type, slots: a.slots.length };
        case "SHOW_DEPARTMENTS":
          return { type: a.type };
        case "CONTENT_GAP":
          return { type: a.type, detail: a.detail };
        case "FLAG_FOR_STAFF":
          return { type: a.type };
        // Never the customer's name or number in a log line.
        case "ALERT_SALES":
          return { type: a.type, kind: a.kind, models: a.models };
        case "BOOK_TEST_DRIVE":
          return { type: a.type };
        case "CANCEL_TEST_DRIVE":
          return { type: a.type };
      }
    }),
    before: summary(d.previousState),
    after: summary(d.nextState),
  };
}
