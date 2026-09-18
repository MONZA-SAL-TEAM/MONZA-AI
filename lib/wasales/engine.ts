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
  vocabularyWords,
  asksForOptions,
  isFactIntent,
  isGlobalIntent,
  parsePayload,
  readBodyType,
  readCategories,
  readMessage,
  readNeeds,
  readsAll,
  readsSameQuestion,
  readSeatCount,
  type CategoryFilter,
  type FactIntent,
  type Intent,
  type MessageReading,
} from "@/lib/wasales/intent";
import { familyMentioned, normalize, pickAmong, type WaCar } from "@/lib/wasales/matcher";
import { resolveModels } from "@/lib/wasales/entities";
import { classify } from "@/lib/wasales/classify";
import { consolidateAlerts } from "@/lib/wasales/alerts";
import { normalizeLebanesePhone } from "@/lib/leads/phone";
import { readColourAnswer, sendableColours, type WaColour } from "@/lib/wasales/colours";
import { freshState, hasContext, isExpired, type SearchEngineState } from "@/lib/wasales/context";
import { beirutTime as beirutTimeOf0, dayFromKey, dayKey, dayLabel, freeSlots, freeSlotsOn, isAfterHours, isBookableSlot, parseRequestedTime, showroomOpen, slotAtBeirut, slotLabel } from "@/lib/wasales/booking";
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
  CHANNEL_LIMITS,
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
  type AlertUrgency,
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
  /** The ad or link the conversation started from, when Meta says. `headline` is the ad's own title ("Voyah COURAGE"). */
  referral?: { ref?: string | null; adId?: string | null; headline?: string | null } | null;
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
/** "ad": the car of the ad the customer came from — soft context, used only when nothing stronger names a car. */
export type ModelSource = "payload" | "text" | "choice" | "referral" | "state" | "ad" | "none";

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
  /** Why the named cars were believed (entities.ts): shown to staff, asserted in tests. */
  modelEvidence: string[];
  /** A car's name appeared as an ordinary word with nothing to say it is the car: ASK, never act. */
  weakModels: ModelCode[];
  /** Words that landed on a car's name and were dismissed as ordinary English, with the reason. */
  dismissedModelWords: string[];
  /** Intents the words produced that are NOT what was asked, with the reason (classify.ts). */
  droppedIntents: string[];
  /** An owner needing after-sales: no sales material, no sales flow. */
  ownerSupport: boolean;
  /** "Not interested", "stop", "wrong number". */
  ended: boolean;
  /** Everything asked for was refused ("don't send the Dream brochure"): nothing is done, and no car is opened. */
  refusedOnly: boolean;
  /** What a question with no approved answer is about, when the words say. */
  specDetail: string | null;
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
    lastAsked: [...s.lastAsked],
    recentModels: [...s.recentModels],
    brochuresJustSent: [...s.brochuresJustSent],
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

/** The vocabulary's words, for the model-entity resolver: built once. */
const VOCABULARY = vocabularyWords();

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
const SALES_INTENTS: readonly Intent[] = ["BUYING_INTENT", "PRICE", "FINANCING", "TEST_DRIVE", "AVAILABILITY", "DISCOUNT", "TRADE_IN", "MODEL_YEAR"];
const SERVICE_INTENTS: readonly Intent[] = ["SERVICE", "PARTS", "COMPLAINT", "OWNER_ISSUE", "WARRANTY_CLAIM", "BATTERY_REPLACEMENT"];
/** Questions with no approved answer: answered honestly and handed to the team (Samer, 2026-09-17). */
const QUESTION_INTENTS: readonly Intent[] = [
  "DELIVERY_LOCATION", "PAYMENT_CURRENCY", "USED_CARS", "OTHER_SPEC", "OTHER_COST",
  // 2026-09-18: topics the workbook has no column for. Said honestly, handed over, never answered from a neighbouring fact.
  "SAFETY", "BATTERY_LIFE", "CHARGER_INCLUDED", "HOME_CHARGING", "PUBLIC_CHARGING", "CHARGING_COST", "BRAND_ORIGIN", "CONTACT_CHANNELS",
];
/** What each of those topics is called in the sentence, and in the alert. */
const TOPIC_NAMES: Partial<Record<Intent, string>> = {
  SAFETY: "safety",
  CHARGER_INCLUDED: "the charger supplied with the car",
  HOME_CHARGING: "home charging",
  PUBLIC_CHARGING: "public charging in Lebanon",
  CHARGING_COST: "charging costs",
  BRAND_ORIGIN: "where the brand comes from and who makes it",
  CONTACT_CHANNELS: "our email, website and social pages",
};
/** A question whose answer depends on which car: the ad's car answers it when nothing stronger names one. */
const NEEDS_A_CAR: readonly Intent[] = [
  "PRICE", "FINANCING", "TEST_DRIVE", "AVAILABILITY", "DISCOUNT", "BUYING_INTENT", "BROCHURE", "COLOUR", "COLOUR_VIDEO", "GENERAL_INFO",
  "MEDIA_PHOTOS", "INTERIOR_COLOUR", "OTHER_SPEC", "HORSEPOWER", "RANGE", "BATTERY", "POWERTRAIN", "CHARGING", "SEATS", "DIMENSIONS", "SPECIFICATIONS", "WARRANTY",
];
/** The previous question, asked again of another car ("and the Taishan?"). */
const CARRIED_OVER: readonly Intent[] = [...NEEDS_A_CAR];
/** "ok", "sure": a yes to the question the bot just asked — never to a question it did not ask. */
const OK_WORDS: readonly string[] = ["ok", "okay", "okey", "oki", "k", "sure", "yep", "yeah", "yup", "تمام", "ماشي", "اوكي", "أوكي", "tamam", "mashi", "meshe", "eh", "ee", "oui"];
/**
 * Colour folder ids that are not colours a customer chooses: the one video of a
 * car filmed without colour folders. Never shown as a button or in a sentence.
 */
const NO_CHOICE_COLOURS: readonly string[] = ["standard", "default", "all", "general", "misc", "other", "video", "videos"];
const isChoiceColour = (c: { id: string }) => !NO_CHOICE_COLOURS.includes(c.id.toLowerCase());
const MAX_BROCHURES = 8;
/** "All brochures" sends the files only when there are this few; more becomes a menu ("which ones?"). */
const MAX_BROCHURES_AT_ONCE = 3;

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
  const international = /^\s*(?:\+|00)/.test(m[0]);
  const digits = m[0].replace(/\D/g, "").replace(/^00/, "");
  // Lebanese, however it was typed: 71222333, 71 222 333, 03 123 456, 03123456, +961…, 00961… → 961XXXXXXXX
  // (lib/leads/phone.ts — the one normaliser the product trusts).
  const lebanese = normalizeLebanesePhone(m[0]);
  if (lebanese) return lebanese;
  // A number that is not Lebanese is kept exactly as written: a valid international number is never rewritten.
  if (international) return digits.length >= 8 && digits.length <= 15 ? digits : null;
  return digits.length >= 7 && digits.length <= 13 ? digits : null;
}

/** "How much will you give me?", "what's it worth?": the value of the customer's OWN car. */
function asksValuation(normalized: string): boolean {
  return (
    /\b(how much|worth|value|valuation|evaluate|estimate|give me|offer me|pay me|combien)\b/.test(normalized) ||
    /قديش|كم بتعطوني|بكم|تقييم|تخمين/.test(normalized) ||
    /\b(adde|2adde|addeh|2addesh|addesh)\b/.test(normalized)
  );
}

/** The car an ad is about, from the ad's own headline ("Voyah COURAGE"): one car, certainly named, or nothing. */
function adModelOf(headline: string | null | undefined, k: SalesKnowledge, cars: readonly WaCar[], brand: SalesBrand): ModelCode | null {
  if (!headline || headline.trim() === "") return null;
  const found = resolveModels(headline, cars, { offeredCarIds: [], discussedCarIds: [], adCarId: null, intentWords: VOCABULARY.single, carTalkWords: VOCABULARY.carTalk });
  const strong = found.mentions.filter((m) => m.confidence === "strong");
  if (strong.length !== 1) return null;
  const model = modelByCatalogueId(k, strong[0].carId);
  return model && brandSells(brand, model) ? model.code : null;
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

  // WHAT IS ASKED, refined before anything answers a keyword (classify.ts).
  const classification = classify(reading.intents, reading);
  const choosing = state.awaiting === "MODEL" || state.awaiting === "CONFIRM_MODEL" || state.awaiting === "COLOUR_OF_WHICH";

  let models: ModelCode[] = [];
  let source = "none" as ModelSource;
  let matchedText = null as string | null;
  let candidates: ModelCode[] = [];
  const crossBrand: ModelCode[] = [];
  let payloadColour: string | null = null;
  let modelEvidence: string[] = [];
  let dismissed: string[] = [];
  let weak: ModelCode[] = [];

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
    // WHICH CAR IS MEANT — never merely which words appear (entities.ts). Only a STRONG mention
    // names a car; "my dream car", "is the service free?", "I need a person" name nothing.
    const carIdOf = (code: ModelCode | null) => (code ? (modelByCode(k, code)?.catalogueId ?? null) : null);
    const offeredNow = choosing ? state.offeredModels : [];
    const resolution = resolveModels(reading.raw, cars, {
      offeredCarIds: offeredNow.map(carIdOf).filter((id): id is string => id !== null),
      discussedCarIds: unique([state.activeModel, ...state.selectedModels, ...state.recentModels]).map(carIdOf).filter((id): id is string => id !== null),
      adCarId: carIdOf(state.adModel),
      intentWords: VOCABULARY.single,
      carTalkWords: VOCABULARY.carTalk,
    });
    const strong = resolution.mentions.filter((m) => m.confidence === "strong");
    modelEvidence = strong.flatMap((m) => m.evidence);
    dismissed = resolution.rejected.map((r) => r.reason);
    weak = codesOf(k, resolution.mentions.filter((m) => m.confidence === "weak").map((m) => m.carId)).filter(sells);
    if (strong.length === 1) {
      const code = modelByCatalogueId(k, strong[0].carId)?.code ?? null;
      if (code && sells(code)) named([code], "text", strong[0].matchedText);
      else if (code) crossBrand.push(code);
    } else if (strong.length > 1) {
      // Several cars named at once: all of them are kept (workbook E, "keep several models").
      const all = codesOf(k, strong.map((m) => m.carId));
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
      choosing &&
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

  // "What about the other one?", "the previous one": of the two cars just discussed, the one that is not current.
  if (models.length === 0 && candidates.length === 0 && crossBrand.length === 0 && !payload && state.recentModels.length === 2) {
    const t = reading.tokens;
    const other = t.some((w, i) => (w === "other" || w === "previous" || w === "earlier" || w === "tene" || w === "التانية" || w === "التاني") && (["one", "car", "model", "wa7de", "siyara"].includes(t[i + 1] ?? "") || i === t.length - 1));
    const code = state.recentModels[1];
    if (other && sells(code)) named([code], "choice", "the other one");
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
  // The ad the customer came from: SOFT context. It answers "how much is it?" when nothing stronger
  // names a car — and it never locks the chat: "actually I'm interested in the Dream" switches.
  if (
    model === null &&
    models.length === 0 &&
    candidates.length === 0 &&
    crossBrand.length === 0 &&
    switchedOff === null &&
    state.selectedModels.length < 2 &&
    state.adModel !== null &&
    sells(state.adModel) &&
    carOf(state.adModel)?.enabled !== false &&
    !classification.ownerSupport &&
    classification.intents.some((i) => NEEDS_A_CAR.includes(i))
  ) {
    model = state.adModel;
    models = [state.adModel];
    source = "ad";
    modelEvidence = ["the customer came from this car's ad, and named no other car"];
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
      const typedColour = reading.tokens.filter((_, i) => !covered.has(i)).join(" ");
      // "black" was typed while two cars were in play, and the bot asked of which: this is that colour.
      const colourWords = state.awaiting === "COLOUR_OF_WHICH" && state.selectedColour ? `${typedColour} ${state.selectedColour}` : typedColour;
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

  const intents: Intent[] = [...classification.intents];
  if (classification.ownerSupport || intents.includes("NO_VIDEO")) colour = { kind: "none" };
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
    modelEvidence,
    weakModels: source === "none" || source === "state" || source === "ad" ? weak : [],
    dismissedModelWords: dismissed,
    droppedIntents: classification.dropped.map((d) => `${d.intent}: ${d.because}`),
    ownerSupport: classification.ownerSupport,
    ended: classification.ended,
    refusedOnly: classification.refusedOnly,
    specDetail: classification.specDetail,
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
      modelEvidence: [],
      weakModels: [],
      dismissedModelWords: [],
      droppedIntents: [],
      ownerSupport: false,
      ended: false,
      refusedOnly: false,
      specDetail: null,
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
  // The ad this chat started from, read once from its own headline and kept as soft context.
  if (!base.adModel) base.adModel = adModelOf(input.referral?.headline, k, engineCars(k, deps.catalog), brand);
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
    extra: { name?: string | null; phone?: string | null; slot?: string | null; reason?: string; urgency?: AlertUrgency } = {}
  ) =>
    out.push({
      type: "ALERT_SALES",
      kind,
      models: [...models],
      name: extra.name ?? null,
      phone: extra.phone ?? null,
      slot: extra.slot ?? null,
      ...(extra.reason ? { reason: extra.reason } : {}),
      ...(extra.urgency ? { urgency: extra.urgency } : {}),
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
  const substantive: Intent[] = intents.filter((i) => i !== "GREETING" && i !== "ACKNOWLEDGEMENT" && i !== "YES" && i !== "NO");
  /** A bare yes / no: an answer to the question the bot asked, never a question of its own. */
  const replied: "yes" | "no" | null = intents.includes("NO") ? "no" : intents.includes("YES") ? "yes" : null;
  // "and the Taishan?", "same for the Dream": the PREVIOUS question, asked of the car named now.
  let carriedOver = false;
  if (u.models.length > 0 && substantive.length === 0 && base.lastAsked.length > 0 && !reading.payload && readsSameQuestion(reading.tokens)) {
    substantive.push(...base.lastAsked.filter((i) => CARRIED_OVER.includes(i)));
    carriedOver = substantive.length > 0;
  }
  // "Monday then, at 10" after "we're closed on Sundays — which other day?": still the VISIT.
  if (base.pendingVisit && !reading.payload && substantive.every((i) => i === "OPENING_HOURS") && parseRequestedTime(reading.raw, validTime(input.now) ? input.now : new Date(0).toISOString()) !== null) {
    (substantive as Intent[]).splice(0, substantive.length, "VISIT");
  }
  // A customer who said "not interested" and now asks something has come back: they are answered.
  if (base.notInterested && substantive.length > 0 && !u.ended) base.notInterested = false;
  next.notInterested = base.notInterested;
  if (carriedOver) reasons.push(`The previous question (${substantive.join(", ")}) asked of another car.`);
  for (const d of u.droppedIntents) reasons.push(`Not the question — ${d}`);
  const freshConversation = input.conversationIsNew && !hasContext(base);
  const nowIso = validTime(input.now) ? input.now : new Date(0).toISOString();

  /** "I want the Courage" — the want-word right before the car's name, and not "…the Courage brochure". */
  const wantsTheCar = (): boolean => {
    if (u.modelSource !== "text" || !u.modelMatchedText || u.models.length !== 1 || u.ownerSupport || u.ended) return false;
    const tokens = reading.tokens;
    const name = u.modelMatchedText.split(" ");
    const at = tokens.findIndex((_, i) => name.every((w, j) => tokens[i + j] === w));
    if (at < 1) return false;
    const before = tokens.slice(Math.max(0, at - 4), at).filter((t) => !["the", "a", "an", "el", "al", "l", "new", "voyah", "mhero"].includes(t)).join(" ");
    const wants = /(^| )(i want|i d like|i would like|i wanna|we want|i ll have|i am getting|bade|bde|badde|baddi|bdi|je veux)$/.test(before) || /(^| )(بدي|اريد|أريد|بدنا)$/.test(before);
    const after = tokens[at + name.length];
    return wants && !(after !== undefined && VOCABULARY.carTalk.has(after));
  };

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
  /** Brochures of a several-cars reply, remembered only while its "which one?" is open. */
  let keepBrochures: ModelCode[] = [];
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
        case "BUYING_INTENT": {
          // "I'll take it", "reserve one for me": the strongest signal there is. One prioritised alert, at once —
          // with or without the car (the car is added to the same alert when it is named).
          const reserve = /\b(reserve|reservation|reserving|hold|deposit|book one|book it|put my name|acompte|reserver)\b/.test(reading.normalized) || /حجز|احجز|عربون/.test(reading.normalized);
          if (models.length > 0) text("BUYING_HANDOFF", models);
          alert("BUYING", models, { reason: reserve ? "Reservation request — wants one held" : "Strong buying intent — says they want to buy" });
          break;
        }
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
            const wish = readWish(requestedNow());
            const typed = wish.slot ?? (wish.status === "none" ? base.requestedSlot : null);
            text("TEST_DRIVE_REQUEST", models, typed ? { slot: slotLabel(typed) } : undefined);
            sayWish(wish, models);
            alert("TEST_DRIVE", models, { slot: typed ?? null, reason: `Asked for a test drive — a team member arranges and confirms it${wish.note ? ` (${wish.note})` : ""}` });
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
          // "How much will you give me?", "what is my car worth?": a VALUATION, which only a person gives.
          const valuation = asksValuation(reading.normalized);
          next.tradeIn = true;
          if (base.tradeIn && valuation) {
            text("TRADE_IN_VALUATION");
            alert("TRADE_IN", models, { reason: "Trade-in: asked what their car is worth — a person values it" });
          } else if (mileage || base.tradeIn || base.lastIntent === "TRADE_IN") {
            text("TRADE_IN_THANKS");
            alert("TRADE_IN", models, { reason: "Trade-in: sent the details of their car" });
          } else {
            // The steps are explained; Sales is told once the details (or photos) arrive — not for the question alone…
            text("TRADE_IN_INFO");
            // …unless it comes with a purchase ("I want a Dream, trade my BMW and pay monthly"): then it is part of that ONE alert.
            if (asked.some((i) => i !== "TRADE_IN" && i !== "MODEL_YEAR")) alert("TRADE_IN", models, { reason: "Has a car to trade in" });
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
    const onlyComplaint = substantive.includes("COMPLAINT") && !substantive.includes("SERVICE") && !substantive.includes("PARTS");
    text(onlyComplaint ? "COMPLAINT_CONTACT" : "SERVICE_CONTACT");
    if (substantive.includes("COMPLAINT")) {
      out.push({ type: "FLAG_FOR_STAFF", reason: "A complaint — a person should reply personally." });
    } else if (u.ownerSupport) {
      const what = substantive.includes("WARRANTY_CLAIM") ? "a warranty claim" : substantive.includes("BATTERY_REPLACEMENT") ? "a battery replacement" : "a problem with their car";
      out.push({ type: "FLAG_FOR_STAFF", reason: `An owner needs after-sales (${what}) — given the Service number, never sales material.` });
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
    carplay: "Apple CarPlay / Android Auto", "apple carplay": "Apple CarPlay / Android Auto", "car play": "Apple CarPlay / Android Auto", "android auto": "Apple CarPlay / Android Auto",
    sunroof: "sunroof", "panoramic roof": "sunroof", moonroof: "sunroof", "wireless charging": "wireless phone charging", "wireless charger": "wireless phone charging",
    "head up display": "head-up display", hud: "head-up display", "ambient lighting": "ambient lighting", fridge: "on-board fridge", refrigerator: "on-board fridge",
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
        case "SAFETY":
          // Never answered by the bot, and never a sentence with "safe" in it: the plain hand-off, and a person.
          text("HANDOFF", models);
          alert("NEEDS_PERSON", models, { reason: "Asked about SAFETY — a person answers personally; the bot said nothing about it" });
          break;
        case "CHARGER_INCLUDED":
        case "HOME_CHARGING":
        case "PUBLIC_CHARGING":
        case "CHARGING_COST":
        case "BRAND_ORIGIN":
        case "CONTACT_CHANNELS": {
          const topic = TOPIC_NAMES[intent] ?? "that";
          text("TOPIC_HANDOFF", models, { topic, topicKey: intent });
          alert("QUESTION", models, { reason: `Asked about ${topic} — not in the approved information` });
          break;
        }
        case "OTHER_COST": {
          // Insurance, registration, delivery, a charger: a cost, but not the car's — and never the price flow.
          const topic = `the cost of ${u.specDetail ?? "that"}`;
          text("TOPIC_HANDOFF", models, { topic, topicKey: "OTHER_COST" });
          alert("QUESTION", models, { reason: `Asked about ${topic} — not the car's price, and not in the approved information` });
          break;
        }
        case "BATTERY_LIFE":
          // The approved fact that bears on it is the battery warranty; the lifespan itself is not in the workbook.
          sendFacts(models.length > 0 ? models : scope, ["WARRANTY"], models.length === 1 ? "one" : models.length > 1 ? "several" : "all");
          text("BATTERY_LIFE_INFO", models);
          alert("QUESTION", models, { reason: "Asked how long the battery lasts — given the warranty; the lifespan is not in the approved information" });
          break;
        case "OTHER_SPEC": {
          const detail = unique(reading.hits.filter((h) => h.intent === "OTHER_SPEC").map((h) => specName(h.matched))).join(", ") || u.specDetail || "detail";
          text("SPEC_NOT_CONFIRMED", models, { detail });
          alert("QUESTION", models, { reason: `Asked about a specification not in the workbook: ${detail}` });
          break;
        }
      }
    }
  };

  /** The day and time typed now — with the day given EARLIER when this message has only a time ("tomorrow" → "at 4"). */
  type Requested = NonNullable<ReturnType<typeof parseRequestedTime>>;
  function requestedNow(): Requested | null {
    const asked = parseRequestedTime(reading.raw, nowIso);
    if (!asked) return null;
    const earlier = dayFromKey(base.pendingDay);
    const today = beirutTimeOf(nowIso);
    const stillAhead = earlier !== null && Date.UTC(earlier.year, earlier.month - 1, earlier.day) >= Date.UTC(today.year, today.month - 1, today.day);
    if (asked.dayGiven === false && asked.minutes !== null && earlier && stillAhead) return { ...asked, ...earlier, dayGiven: true };
    return asked;
  }
  /** What a wished day/time amounts to: a slot to pass on, a day still missing its time, or a time Monza is closed. */
  interface Wish {
    status: "none" | "slot" | "day_only" | "closed_sunday" | "closed_then";
    slot: string | null;
    day: Requested | null;
    note: string;
  }
  function readWish(asked: Requested | null): Wish {
    if (!asked) return { status: "none", slot: null, day: null, note: "" };
    const open = showroomOpen(asked, asked.minutes);
    if (open === "closed_sunday") return { status: "closed_sunday", slot: null, day: asked, note: "asked for a Sunday — told Monza is closed on Sundays and asked for another day" };
    if (open === "closed_then") return { status: "closed_then", slot: null, day: asked, note: `asked for a time outside opening hours on ${dayLabel(asked)} — asked for another time` };
    if (asked.minutes === null) return { status: "day_only", slot: null, day: asked, note: `prefers ${dayLabel(asked)}${asked.part ? ` ${asked.part}` : ""} — no time given yet` };
    return { status: "slot", slot: slotAtBeirut(asked, asked.minutes), day: asked, note: "" };
  }
  /** Say what a wish needs said (closed / which time?), and remember the day. */
  function sayWish(wish: Wish, models: readonly ModelCode[]): void {
    if (wish.status === "closed_sunday") {
      text("CLOSED_SUNDAY", models);
      next.pendingDay = null;
    } else if (wish.status === "closed_then" && wish.day) {
      text("CLOSED_THEN", models, { day: dayLabel(wish.day) });
      next.pendingDay = dayKey(wish.day);
    } else if (wish.status === "day_only" && wish.day) {
      // "Saturday afternoon" is enough for a person to arrange; a bare "tomorrow" is asked its time.
      if (wish.day.part) text("TEST_DRIVE_TEAM", models);
      else text("TEST_DRIVE_DAY_NOTED", models, { day: dayLabel(wish.day) });
      next.pendingDay = dayKey(wish.day);
    } else if (wish.status === "slot") {
      next.pendingDay = null;
    }
  }

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
    // "I want the Courage", "بدي الكوراج": qualified buying interest. It changes nothing the customer receives —
    // it is part of the ONE alert Sales gets ("wants the car · stock · financing · test drive, Friday").
    if (wantsTheCar() && !out.some((a) => a.type === "ALERT_SALES" && a.kind === "BUYING") && out.some(isCustomerFacing)) {
      alert("BUYING", u.models, { reason: "Buying interest — says they want the car", urgency: "qualified" });
    }
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
    const saidHours = out.some((a) => a.type === "SEND_TEXT" && (a.key === "CLOSED_SUNDAY" || a.key === "CLOSED_THEN" || a.key === "VISIT_WELCOME"));
    if (isAfterHours(nowIso) && !saidHours && out.some((a) => a.type === "ALERT_SALES") && out.some(isCustomerFacing)) {
      text("AFTER_HOURS_NOTE");
    }
    // ONE actionable alert per inbound message, carrying every reason (alerts.ts).
    const actions = finalizeActions(consolidateAlerts(out));
    // What was asked, kept so "and the Taishan?" can ask it again of another car.
    const askedNow = unique(substantive.filter((i) => CARRIED_OVER.includes(i)));
    if (askedNow.length > 0) next.lastAsked = askedNow.slice(0, 8);
    next.brochuresJustSent = next.awaiting === "MODEL" || next.awaiting === "COLOUR_OF_WHICH" ? keepBrochures : [];
    // A colour typed for "which car?" is forgotten once that question is no longer open.
    if (base.awaiting === "COLOUR_OF_WHICH" && next.awaiting !== "COLOUR_OF_WHICH" && next.activeModel === null) next.selectedColour = null;
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
  if (reading.tokens.length === 0 && !payload && u.modelSource !== "referral" && input.hasMedia && base.tradeIn) {
    // The bot asked for photos of the car to trade in: this is one. It is filed with the trade-in, never read.
    next.tradeInPhotos = base.tradeInPhotos + 1;
    if (base.tradeInPhotos === 0) text("TRADE_IN_PHOTO_THANKS");
    else reasons.push("Another photo for the trade-in — already thanked.");
    alert("TRADE_IN", base.selectedModels, { reason: "Trade-in: sent photos of their car — see the chat" });
    return finish();
  }
  if (reading.tokens.length === 0 && !payload && u.modelSource !== "referral" && !input.hasMedia && /[?؟]/.test(reading.raw)) {
    // "?", "??": somebody is there and waiting. A light nudge — never silence, never a salesperson for a question mark.
    if (hasContext(base)) text("NUDGE");
    else out.push({ type: "SHOW_DEPARTMENTS" });
    return finish();
  }
  if (reading.tokens.length === 0 && !payload && u.modelSource !== "referral" && input.hasMedia && !base.unknownSaid && !base.notInterested) {
    // A photo, a video or a voice note with no words: a rule cannot read it, and a model is NEVER guessed from media.
    // Said once — that a person will look — and a person is told; the next photo in a row is left to them.
    text("PHOTO_RECEIVED");
    alert("NEEDS_PERSON", base.selectedModels, { reason: "Sent a photo, video or voice note with no words — the bot cannot read media" });
    saidUnknown = true;
    return finish();
  }
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

  /* 0c1. The customer ended it: acknowledged, and nothing is pushed at them. */
  if (u.ended && !payload) {
    text(substantive.includes("WRONG_NUMBER") ? "WRONG_NUMBER_ACK" : substantive.includes("OPT_OUT") ? "OPT_OUT_ACK" : "NOT_INTERESTED_ACK");
    next.notInterested = true;
    next.awaiting = "NONE";
    next.pendingIntents = [];
    next.offeredModels = [];
    next.offeredColours = [];
    next.lead = null;
    next.pendingDay = null;
    reasons.push("The customer ended the sales conversation — acknowledged; no material, no alert, no menu.");
    return finish();
  }

  /* 0c1b. "I've been waiting since yesterday", "nobody answered": an apology and an OVERDUE alert — the top of the list. */
  if (substantive.includes("WAITING_COMPLAINT") && !payload) {
    const models = u.models.length > 0 ? u.models : base.selectedModels;
    text("WAITING_APOLOGY", models);
    alert("OVERDUE", models, { reason: "Says they have been waiting for an answer — reply now" });
    if (substantive.every((i) => i === "WAITING_COMPLAINT" || i === "COMPLAINT")) return finish();
  }

  /* 0c1c. An OWNER needing after-sales: the Service number, a flag — and never a brochure, a colour or a video,
     whatever car they named ("I own a Voyah Free and the screen is frozen"). */
  if (u.ownerSupport && !payload) {
    answerService();
    answerGlobal();
    reasons.push("An owner needing after-sales — routed to Service; no sales material and no sales flow.");
    return finish();
  }

  /* 0c1d. "No video please", "I don't want the brochure": kept for the whole conversation. */
  const refused = substantive.filter((i) => i === "NO_VIDEO" || i === "NO_BROCHURE");
  if (refused.length > 0 && !payload) {
    if (refused.includes("NO_VIDEO")) next.noVideo = true;
    if (refused.includes("NO_BROCHURE")) next.noBrochure = true;
    text("PREFERENCE_NOTED", [], { what: refused.length === 2 ? "both" : refused[0] === "NO_VIDEO" ? "video" : "brochure" });
    if (refused.includes("NO_VIDEO") && next.awaiting === "COLOUR") {
      next.awaiting = "NONE";
      next.offeredColours = [];
    }
    if (u.refusedOnly) {
      reasons.push("The message only REFUSES something — nothing is sent, and the car named in the refusal is not opened.");
      return finish();
    }
  }
  /* 0c1e. "Don't call me", "no test drive", "I don't want to buy it", "I don't need financing": a refusal. Acknowledged —
     no material, no alert, no menu, and the car named inside the refusal is not opened. */
  if (substantive.includes("DECLINE") && !payload) {
    if (!out.some(isCustomerFacing)) text("NO_PROBLEM");
    if (substantive.includes("DECLINE") && next.lead && reading.hits.some((h) => h.intent === "TEST_DRIVE")) next.lead = null;
    if (u.refusedOnly) {
      next.awaiting = base.awaiting === "PERSON" ? "PERSON" : "NONE";
      next.pendingIntents = [];
      reasons.push("A refusal — acknowledged; nothing is pushed.");
      return finish();
    }
  }

  /* 0c1f. Accounts, a payment already made, an existing order: not a new sale. */
  if (substantive.includes("ACCOUNTS") && !payload) {
    text("ADMIN_CONTACT");
    reasons.push("About accounts or an existing payment — Administration, not a financing lead.");
    return finish();
  }
  if (substantive.includes("ORDER_STATUS") && !payload) {
    text("HANDOFF", []);
    alert("QUESTION", u.models, { reason: "An EXISTING ORDER — asked about its delivery / status. Not a new enquiry." });
    return finish();
  }
  /* 0c1g. A file the bot sent will not open, or is the wrong one: a person sorts it out; it is not pushed again. */
  if (substantive.includes("MEDIA_PROBLEM") && !payload) {
    text("HANDOFF", []);
    alert("NEEDS_PERSON", base.selectedModels, { reason: "A file the bot sent does not open or is wrong — send it by hand" });
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
  // "Tomorrow", "saturday at 11 then", "bokra 3al 4" ARE a day; "I'm travelling tomorrow", "I'll decide tomorrow" only contain one.
  const DATE_WORDS = /^(?:\d{1,2}(?::\d{2})?|\d{1,2}(?:am|pm)|am|pm|at|on|in|the|then|ok|okay|yes|maybe|around|about|by|after|before|next|this|morning|afternoon|evening|noon|please|pls|is|fine|works|good|better|instead|make|it|to|change|move|reschedule|postpone|shift|for|me|can|we|do|how|what|el|3al|3a|sa3a|se3a|الساعة|ع|عال|st|nd|rd|th|of|[a-z]*day|today|tomorrow|tmrw|tmr|bukra|bokra|lyom|بكرا|بكره|اليوم|a7ad|tanen|tneen|talata|tlata|arb3a|orb3a|khamis|jem3a|jom3a|sabt|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)$/;
  const ARABIC_DATE_WORDS = /^(?:الاحد|الأحد|الاثنين|الإثنين|الثلاثاء|الثلاثا|الاربعاء|الأربعاء|الخميس|الجمعة|الجمعه|السبت|صباحا|مساء|بعد|الظهر|يوم)$/;
  const onlyADate = reading.tokens.every((t) => DATE_WORDS.test(t) || ARABIC_DATE_WORDS.test(t));
  const retimed =
    hasTestDrive && !payload && !substantive.includes("TEST_DRIVE_CHANGE") && (wantsChange || ((substantive.length === 0 || onlyDayWords) && onlyADate)) && parseRequestedTime(reading.raw, nowIso) !== null;
  if ((substantive.includes("TEST_DRIVE_CHANGE") || retimed) && !payload && !botBooks) {
    // A person arranges test drives: the bot passes the wish on, and never confirms or cancels anything itself.
    const models = base.lead?.models ?? base.selectedModels;
    const wish = wantsCancel ? readWish(null) : readWish(requestedNow());
    const typed = wish.slot;
    if (typed && !wantsCancel) {
      text("TEST_DRIVE_TIME_PASSED", models, { slot: slotLabel(typed) });
      alert("TEST_DRIVE", models, { slot: typed, reason: wantsChange ? "Asked to change the test drive time" : "Gave a preferred test drive time" });
      next.requestedSlot = typed;
      next.pendingDay = null;
    } else if (wish.status !== "none") {
      // A day with no time, a Sunday, a time we are closed: said, and the day is kept for the time that follows.
      sayWish(wish, models);
      alert("TEST_DRIVE", models, { reason: `Test drive: ${wish.note}` });
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
    // "Can you reserve a Courage and call me at 71 222 333?": everything else asked rides in the same alert.
    const ALSO: Partial<Record<Intent, AlertKind>> = { BUYING_INTENT: "BUYING", PRICE: "PRICE", FINANCING: "FINANCING", TEST_DRIVE: "TEST_DRIVE", AVAILABILITY: "STOCK", DISCOUNT: "DISCOUNT", TRADE_IN: "TRADE_IN", VISIT: "VISIT" };
    for (const i of substantive) {
      const kind = ALSO[i];
      if (kind) alert(kind, models, { phone });
    }
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

  /* 2a2. "Can I pass by tomorrow?", "I want to come see the car": welcome — after checking we are open then. */
  if (substantive.includes("VISIT") && !payload) {
    const models = u.models.length > 0 ? u.models : u.model ? [u.model] : base.selectedModels;
    const wish = readWish(requestedNow());
    next.pendingVisit = wish.status === "closed_sunday" || wish.status === "closed_then";
    if (wish.status === "closed_sunday" || wish.status === "closed_then") sayWish(wish, models);
    else text("VISIT_WELCOME", models, wish.slot ? { when: slotLabel(wish.slot) } : wish.day ? { when: dayLabel(wish.day) } : undefined);
    alert("VISIT", models, { slot: wish.slot, reason: `Wants to visit the showroom${wish.slot ? "" : wish.day ? ` (${wish.note || dayLabel(wish.day)})` : ""}` });
    if (substantive.every((i) => i === "VISIT")) return finish();
  }

  /* 2b. Details of the customer's OWN car after the trade-in answer ("bmw x5 2019 120000 km"). */
  if (base.lastIntent === "TRADE_IN" && !payload && u.models.length === 0) {
    const details =
      substantive.some((i) => i === "TRADE_IN" || i === "RANGE" || i === "OTHER_BRAND" || i === "MODEL_YEAR") ||
      reading.tokens.some((t) => /^\d{4,}$/.test(t)) ||
      (reading.tokens.length === 0 && input.hasMedia === true);
    if (details && !substantive.includes("TRADE_IN")) {
      text("TRADE_IN_THANKS");
      alert("TRADE_IN", [], { reason: "Trade-in: sent the details of their car" });
      next.tradeIn = true;
      next.lastIntent = "TRADE_IN";
      return finish();
    }
  }

  /* 2b2. In a trade-in, "what's it worth?" / "how much will you give me?" is the valuation — asked of a person. */
  if (base.tradeIn && !payload && substantive.length === 0 && u.models.length === 0 && asksValuation(reading.normalized)) {
    text("TRADE_IN_VALUATION");
    alert("TRADE_IN", base.selectedModels, { reason: "Trade-in: asked what their car is worth — a person values it" });
    next.lastIntent = "TRADE_IN";
    return finish();
  }

  /* 2c. A bare yes / no / ok: the answer to the question the bot just asked — and to nothing else. */
  // "not now, tomorrow" is more than a no: only a message made of nothing BUT the yes / no / ok words is a bare reply.
  const replyWords = reading.hits.filter((h) => h.intent === "YES" || h.intent === "NO" || h.intent === "ACKNOWLEDGEMENT" || h.intent === "GREETING").reduce((n, h) => n + (h.end - h.start), 0);
  const onlyReply = reading.tokens.length - replyWords <= 1;
  const nothingElse = onlyReply && substantive.length === 0 && !payload && u.models.length === 0 && u.modelCandidates.length === 0 && u.crossBrand.length === 0 && u.colour.kind === "none";
  if (nothingElse && (replied !== null || acknowledged)) {
    const affirmed = replied === "yes" || (replied === null && reading.tokens.length <= 3 && reading.tokens.some((t) => OK_WORDS.includes(t)));
    const askedWhich = base.awaiting === "MODEL" || base.awaiting === "CONFIRM_MODEL" || base.awaiting === "COLOUR_OF_WHICH";
    const offered = base.offeredModels.filter(sells);
    if (affirmed && askedWhich && offered.length === 1) {
      // "Did you mean the VOYAH Dream?" — "yes".
      reasons.push(`"Yes" to the ${modelLabel(offered[0])} the bot had just asked about.`);
      decideForModel(offered[0], true);
      return finish();
    }
    if (replied === "no" && base.awaiting === "CONFIRM_MODEL") {
      next.pendingIntents = [...base.pendingIntents];
      offerModels(scope, false);
      return finish();
    }
    if (replied === "no" && (askedWhich || base.awaiting === "COLOUR")) {
      text("NO_PROBLEM");
      next.awaiting = "NONE";
      next.pendingIntents = [];
      next.offeredModels = [];
      next.offeredColours = [];
      return finish();
    }
    if (replied === "yes" && base.awaiting === "COLOUR" && base.activeModel && sells(base.activeModel)) {
      // "Which colour would you like to see?" — "yes": any of them.
      u.colour = { kind: "no_preference" };
      decideForModel(base.activeModel);
      return finish();
    }
    if (replied !== null) {
      reasons.push("A bare yes / no with no open question — nothing new was asked.");
      return finish();
    }
  }

  /* 3. "ok", "thanks", a thumbs up: never a menu, never a loop. */
  if (substantive.length === 0 && acknowledged && u.models.length === 0 && u.modelCandidates.length === 0 && u.colour.kind === "none") {
    // Workbook C: "a short thank-you when useful — never reopen the model menu". A THANK-YOU is answered, once
    // ("thanks" … "thanks" is not a loop); a bare "ok" or a thumbs-up asks nothing and gets nothing.
    const thanked = reading.hits.some((h) => h.intent === "ACKNOWLEDGEMENT" && /thank|thx|thnx|tnx|thanx|merci|shukran|choukran|شكر|يسلمو|yeslamo/.test(h.matched));
    if (thanked && base.lastIntent !== "ACKNOWLEDGEMENT" && hasContext(base) && !base.notInterested) text("YOU_ARE_WELCOME");
    else reasons.push("An acknowledgement — nothing new was asked.");
    return finish();
  }

  /* 4. A greeting alone: the welcome and the departments. */
  if (substantive.length === 0 && greeted && u.models.length === 0 && u.modelCandidates.length === 0 && u.crossBrand.length === 0 && u.colour.kind === "none") {
    // Always greeted back, in a new chat or an old one (2026-09-18: a "hi" in a chat that already
    // had history got no reply at all). The welcome and the departments.
    out.push({ type: "SHOW_DEPARTMENTS" });
    return finish();
  }

  /* 4b. A car's name used as an ordinary word, with nothing to say it is the car ("dream is nice"): ASK.
     Never a brochure, a video, colours or a model alert from a weak match. */
  if (u.weakModels.length > 0 && u.model === null && u.models.length === 0 && u.modelCandidates.length === 0 && !payload) {
    answerService();
    answerQuestions([], substantive.filter((i) => QUESTION_INTENTS.includes(i)));
    answerGlobal();
    next.pendingIntents = unique([...base.pendingIntents, ...substantive.filter((i) => NEEDS_A_CAR.includes(i))]);
    out.push({ type: "SHOW_MODEL_CHOICES", models: [...u.weakModels], greet: false, narrowed: true, prompt: "confirm" });
    next.awaiting = "CONFIRM_MODEL";
    next.offeredModels = [...u.weakModels];
    reasons.push(`"${u.weakModels.map(modelLabel).join(", ")}" may be meant, but nothing says so — asked, not assumed.`);
    return finish();
  }

  /* 5. After-sales, other brands and questions with no approved answer answer the same whatever the car. */
  answerService();
  const needsAsked = u.models.length === 0 && u.model === null ? readNeeds(reading.tokens) : [];
  answerQuestions(
    u.models.length > 0 ? u.models : u.model ? [u.model] : [],
    substantive.filter((i) => QUESTION_INTENTS.includes(i) && !(i === "OTHER_SPEC" && needsAsked.includes("OFF_ROAD")))
  );
  // "Where is Voyah from?" names the brand, not a wish to pick a model: the answer is the whole reply.
  if (substantive.length > 0 && substantive.every((i) => QUESTION_INTENTS.includes(i)) && u.models.length === 0 && u.model === null && out.some(isCustomerFacing)) {
    answerGlobal();
    return finish();
  }
  if (substantive.includes("OTHER_BRAND") && u.models.length === 0 && u.model === null && !base.tradeIn) {
    text("OTHER_BRAND");
  }
  // After-sales only ("I need a service for my Courage"): the Service number is the whole answer — never the car's brochure.
  if (substantive.length > 0 && substantive.every((i) => SERVICE_INTENTS.includes(i) || isGlobalIntent(i))) {
    answerGlobal();
    reasons.push("An after-sales request — the Service number; no sales material.");
    return finish();
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

  /* 5b. "The fastest one", "a family car", "something for off-road": answered ONLY from the workbook's columns,
     listed — never "the best". A need the workbook has no column for goes to the team with the list of models. */
  const needs = needsAsked;
  // "Biggest screen", "biggest wheels" ask about a part, not for the longest car.
  const aboutAPart = substantive.includes("OTHER_SPEC") && needs.every((need) => need === "BIGGEST" || need === "FASTEST");
  if (needs.length > 0 && !aboutAPart && namedNow.length === 0 && u.model === null && u.modelCandidates.length === 0 && !payload && categories.length === 0 && seats === null) {
    const numberIn = (code: ModelCode, fact: FactIntent): number | null => {
      const km = modelByCode(k, code);
      const found = km ? lookupFact(km, fact) : null;
      if (!found || found.status !== "OK" || !found.fact) return null;
      const nums = (found.fact.value.replace(/(\d),(\d{3})/g, "$1$2").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
      return nums.length > 0 ? (fact === "DIMENSIONS" ? nums[0] : Math.max(...nums)) : null;
    };
    const ranked = (fact: FactIntent): ModelCode[] =>
      scope
        .map((code) => ({ code, n: numberIn(code, fact) }))
        .filter((r): r is { code: ModelCode; n: number } => r.n !== null)
        .sort((a, b) => b.n - a.n)
        .map((r) => r.code);
    const byFact: Partial<Record<(typeof needs)[number], FactIntent>> = { FASTEST: "HORSEPOWER", LONGEST_RANGE: "RANGE", BIGGEST: "DIMENSIONS" };
    const dataNeed = needs.find((n) => byFact[n] !== undefined);
    if (needs.includes("BUDGET")) {
      // Never a price, never "the cheapest is…": a person recommends by budget.
      text("BUDGET_HANDOFF");
      alert("PRICE", [], { reason: "Asked for a recommendation by budget — a person answers; the bot states no price" });
      offerModels(scope, false);
    } else if (dataNeed) {
      const fact = byFact[dataNeed] as FactIntent;
      const top = ranked(fact).slice(0, 3);
      if (top.length > 0) {
        sendFacts(top, [fact], "several");
        next.selectedModels = [];
        offerModels(top, true, "explore");
      } else offerModels(scope, false);
    } else if (needs.includes("FAMILY")) {
      const roomy = scope.filter((c) => (modelByCode(k, c)?.seatOptions ?? [modelByCode(k, c)?.seatCount ?? 0]).some((s) => (s ?? 0) >= 6));
      sendFacts(roomy.length > 0 ? roomy : scope, ["SEATS"], roomy.length > 0 ? "several" : "all");
      offerModels(roomy.length > 0 ? roomy : scope, roomy.length > 0, "explore");
    } else {
      const need = needs.includes("SUV") ? "an SUV" : needs.includes("OFF_ROAD") ? "off-road driving" : needs.includes("LUXURY") ? "a luxury car" : "your needs";
      text("RECOMMEND_HANDOFF", [], { need });
      alert("QUESTION", [], { reason: `Asked for a recommendation (${need}) — the workbook has no column for it` });
      offerModels(scope, false);
    }
    answerGlobal();
    answerSales([], substantive.filter((i) => SALES_INTENTS.includes(i) && i !== "PRICE"));
    return finish();
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

  /* 7a. "Is it better than BYD?": the workbook has nothing about other brands, and the bot never gives a verdict. */
  if (substantive.includes("COMPARE") && substantive.includes("OTHER_BRAND") && namedNow.length < 2) {
    const models = namedNow.length === 1 ? namedNow : u.model ? [u.model] : [];
    text("TOPIC_HANDOFF", models, { topic: "how it compares with other brands", topicKey: "OTHER_BRAND_COMPARE" });
    alert("QUESTION", models, { reason: "Asked for a comparison with another brand — a person answers" });
    return finish();
  }

  /* 7. "Compare them", "which is better, the Dream or the Passion?". */
  if (substantive.includes("COMPARE")) {
    // "Courage" → "Dream" → "which has more range?": the two cars just discussed are the ones compared.
    const recent = unique([...(namedNow.length === 1 ? namedNow : []), ...base.recentModels]).filter(sells).slice(0, 2);
    const models = namedNow.length >= 2 ? namedNow : context.length >= 2 ? context : recent.length >= 2 ? recent : u.modelCandidates.length >= 2 ? u.modelCandidates : scope;
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
      if (next.awaiting === "MODEL" || next.awaiting === "CONFIRM_MODEL" || next.awaiting === "COLOUR_OF_WHICH") next.awaiting = "NONE";
    }
    // The cars talked about, newest first: "which has more range?" compares the last two.
    if (isNamed) next.recentModels = unique([model, ...base.recentModels]).slice(0, 2);

    // The answer to "which model?" releases what was asked before it.
    const askedWhich = base.awaiting === "MODEL" || base.awaiting === "CONFIRM_MODEL" || base.awaiting === "COLOUR_OF_WHICH";
    const consumePending = activating || (isNamed && askedWhich);
    const toAnswer = unique([...(consumePending ? base.pendingIntents : []), ...substantive]);
    if (consumePending) {
      next.pendingIntents = [];
      next.offeredModels = [];
      if (next.awaiting === "MODEL" || next.awaiting === "CONFIRM_MODEL" || next.awaiting === "COLOUR_OF_WHICH") next.awaiting = "NONE";
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
    // "I don't want the brochure" holds for the conversation — until the customer asks for it.
    if (wantsBrochure) next.noBrochure = false;
    const justSent = base.brochuresJustSent.includes(model) && !wantsBrochure;
    if (justSent) next.brochureSentForCurrentActivation = true;
    const brochureDue = (activating || wantsBrochure || ((wantsInfo || wantsStock) && !next.brochureSentForCurrentActivation)) && !next.noBrochure && !justSent;
    if (next.noBrochure && activating) reasons.push("The customer asked not to be sent the brochure — it is not sent.");
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
    // "No video please" holds for the conversation — until the customer asks for a video or names a colour.
    if (wantVideo && !substantive.includes("NO_VIDEO")) next.noVideo = false;
    /** The video sent when the customer names no colour: the FIRST colour of the workbook's own list that
     *  has a video fitting this channel — an approved order, never the alphabet. */
    const defaultColour = (): WaColour | undefined => {
      const fits = (c: WaColour) => {
        const asset = (have.videosByColour[c.id] ?? []).find((v) => v.view !== "interior");
        return asset !== undefined && (asset.bytes === null || asset.bytes <= CHANNEL_LIMITS[channel].videoBytes);
      };
      const order = knowledgeModel.colourNames ?? [];
      const byWorkbook = order
        .map((name) => sendable.find((c) => normalize(c.name) === normalize(name)))
        .filter((c): c is WaColour => c !== undefined);
      return byWorkbook.find(fits) ?? sendable.find(fits) ?? byWorkbook[0] ?? sendable[0];
    };
    const offerColours = () => {
      if (next.noVideo) {
        // The colours are named; the video they lead to is not pushed.
        if (toAnswer.includes("COLOUR") && sendable.length > 0) out.push({ type: "SEND_COLOUR_LIST", rows: [colourRow(model)] });
        next.colourPromptSentForCurrentActivation = true;
        return;
      }
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
      if (next.noVideo) {
        reasons.push("The customer asked not to be sent videos — none is sent.");
        next.colourPromptSentForCurrentActivation = true;
        return;
      }
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

    const commercial = toAnswer.some((i) => i === "PRICE" || i === "FINANCING" || i === "TEST_DRIVE" || i === "DISCOUNT" || i === "BUYING_INTENT");
    // A lead question or a slot list is the one question of this reply.
    const askingSomethingElse =
      next.awaiting === "LEAD_NAME" ||
      next.awaiting === "LEAD_PHONE" ||
      next.awaiting === "TEST_DRIVE_SLOT" ||
      // "What time would suit you?", "which other day?": ONE question per reply — the colour waits.
      out.some((a) => a.type === "SEND_TEXT" && (a.key === "TEST_DRIVE_DAY_NOTED" || a.key === "CLOSED_SUNDAY" || a.key === "CLOSED_THEN"));
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
      const pick = defaultColour();
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
      sendVideo(sendable.find((s) => s.id === next.selectedColour) ?? (defaultColour() as WaColour), false);
    } else if (wantColours) {
      offerColours();
    } else if (activating) {
      // The colour step of an activation: one colour needs no question.
      if (sendable.length === 1) sendVideo(sendable[0], false);
      else offerColours();
    }

    // Also named: a model this account does not sell.
    for (const code of u.crossBrand) fallback({ kind: "CROSS_BRAND", model: code });

    if (out.length === 0 && isNamed && substantive.length === 0 && u.modelSource !== "state") {
      // The same car named again ("Courage" … "Courage"), or a car named by someone who refused the brochure AND the
      // video: never silence. Its key facts, and the colour question if it is still open.
      sendFacts([model], KEY_FACTS, "one");
      if (!activating && !base.selectedColour && choices.length > 1) offerColours();
    }
    if (out.length === 0) {
      // Words the rules cannot read (a name, a sentence of their own) are for a person — never a silent ignore.
      const unread = substantive.length === 0 && !acknowledged && (replied === null || !onlyReply) && u.modelSource === "state" && reading.tokens.length > 0 && !payload && !base.notInterested;
      if (unread) sayUnknown([model], "Words the bot has no approved answer for");
      else reasons.push(`Already talking about the ${modelLabel(model)} — nothing new was asked.`);
    }
  }

  /* ── Several cars ────────────────────────────────────────────────────── */

  function decideForSeveral(models: readonly ModelCode[], namedTogether: boolean): void {
    next.selectedModels = [...models];
    next.activeModel = null;
    next.offeredColours = [];
    if (namedTogether) next.recentModels = unique([...models, ...base.recentModels]).slice(0, 2);
    if (next.awaiting === "MODEL" || next.awaiting === "COLOUR" || next.awaiting === "CONFIRM_MODEL" || next.awaiting === "COLOUR_OF_WHICH") next.awaiting = "NONE";

    // Two cars in play and the customer types "black": of WHICH car? Asked — never guessed.
    if (substantive.length === 0 && !namedTogether && !payload && reading.tokens.length > 0 && reading.tokens.length <= 4) {
      const all = models.flatMap((code) => carOf(code)?.colours ?? []);
      const heard = all.length > 0 ? readColourAnswer(reading.normalized, all, { noPreference: false, fuzzy: false }) : null;
      if (heard && (heard.kind === "one" || heard.kind === "several")) {
        const word = heard.kind === "one" ? heard.colour.name : reading.normalized;
        out.push({ type: "SHOW_MODEL_CHOICES", models: [...models], greet: false, narrowed: true, prompt: "colour_which", colour: word });
        next.awaiting = "COLOUR_OF_WHICH";
        next.offeredModels = [...models];
        next.selectedColour = reading.normalized;
        keepBrochures = base.brochuresJustSent;
        return;
      }
    }
    const toAnswer = unique([...(namedTogether && base.awaiting === "MODEL" ? base.pendingIntents : []), ...substantive]);
    if (namedTogether) next.pendingIntents = [];
    if (next.lead) next.lead = { ...next.lead, models: unique([...next.lead.models, ...models]) };

    const facts = unique(toAnswer.filter(isFactIntent)).filter((f) => f !== "SPECIFICATIONS");
    const wantsBrochure = toAnswer.includes("BROCHURE") || toAnswer.includes("SPECIFICATIONS") || toAnswer.includes("GENERAL_INFO");
    const wantsColours = toAnswer.includes("COLOUR") || toAnswer.includes("COLOUR_VIDEO");
    const sales = toAnswer.filter((i) => SALES_INTENTS.includes(i));

    const sentNow: ModelCode[] = [];
    const sendBrochures = () => {
      if (next.noBrochure && !toAnswer.includes("BROCHURE")) return;
      if (models.length > MAX_BROCHURES_AT_ONCE) {
        // Five cars named at once: five large files is a flood. Their key facts, and "which would you like first?".
        text("ALL_BROCHURES_ASK");
        return;
      }
      for (const code of models.slice(0, MAX_BROCHURES)) {
        const car = carOf(code);
        const have = car ? deps.media(car.id) : NO_MEDIA;
        if (have.brochure) {
          out.push({ type: "SEND_BROCHURE", model: code, asset: have.brochure, explicit: true });
          sentNow.push(code);
        } else gap(code, "BROCHURE", null, null, `MISSING BROCHURE: ${modelLabel(code)}`);
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
    // Kept while the "which one?" that follows is open — also through "black" → "which car in black?".
    keepBrochures = sentNow.length > 0 ? sentNow : base.brochuresJustSent;

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
    if (wantsBrochure && wantsAll && scope.length > MAX_BROCHURES_AT_ONCE) {
      // "Send me all the brochures": eight large files in one reply is a flood. A menu — which ones?
      text("ALL_BROCHURES_ASK");
      next.pendingIntents = unique([...base.pendingIntents, "BROCHURE"]);
      offerModels(scope, false);
      return;
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
      "BUYING_INTENT", "PRICE", "AVAILABILITY", "GENERAL_INFO", "BROCHURE", "COLOUR", "COLOUR_VIDEO", "MEDIA_PHOTOS", "INTERIOR_COLOUR",
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
      if (base.notInterested) reasons.push("The customer said they are not interested — nothing is pushed at them; a person reads it.");
      else sayUnknown([], base.awaiting === "MODEL" || base.awaiting === "CONFIRM_MODEL" ? 'Not an answer to "which model?"' : "Words the bot has no approved answer for");
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
