/**
 * The Understanding Engine, part one: what did the customer ASK?
 *
 * NOT an AI, and nothing here writes a word to a customer. A closed
 * vocabulary of phrases per intent — English, Arabic and Arabizi — matched
 * against the normalized message exactly the way the model matcher matches
 * model names: whole words, consecutive, the longest phrase winning, typo
 * tolerance only where it is safe. The same message always reads the same
 * way, and every intent reported carries the exact words that produced it.
 *
 * What to DO about an intent is the engine's decision (engine.ts). What to
 * SAY is a template's (templates.ts). This file only reads.
 *
 * Rules that keep the reading honest:
 *
 *   - LONGEST PHRASE WINS, across intents. "price range" is a price question,
 *     not a range question; "range rover" and "no problem" mean nothing.
 *   - WEAK words yield. "how much" is a price question on its own, but "how
 *     much hp" is a horsepower question, and "where can I get the brochure"
 *     is a brochure question — a weak word counts only when nothing
 *     stronger was asked in the same message.
 *   - TYPOS are tolerated only in long Latin words (7+ letters, first letter
 *     right, never a word that is itself a real word such as "changing" or
 *     "contract"). Short words and Arabic script must be exact, because one
 *     letter apart is usually a different word. Repeated letters are squashed
 *     ("priceee", "hpp").
 *   - Several intents in one message are all reported, in the order written.
 *
 * Also read here, because they are properties of the message rather than of
 * the conversation: the language, a button payload ("MODEL:COURAGE"), a
 * numbered answer ("2"), and the HARD EXCLUSIONS — fake Meta-support scams,
 * vendor pitches, Meta's own system notices and internal tests — which are
 * detected only on high-confidence evidence so that a vague real customer is
 * never filtered out.
 */

import { editDistance, isArabicToken, normalize, sameWord } from "@/lib/wasales/matcher";

/* ── The intents ─────────────────────────────────────────────────────────── */

export const INTENTS = [
  "GREETING",
  "GENERAL_INFO",
  "BROCHURE",
  "COLOUR",
  "COLOUR_VIDEO",
  "HORSEPOWER",
  "RANGE",
  "BATTERY",
  "POWERTRAIN",
  "CHARGING",
  "SEATS",
  "DIMENSIONS",
  "SPECIFICATIONS",
  "LOCATION",
  "OPENING_HOURS",
  "CONTACT_NUMBER",
  "PRICE",
  "FINANCING",
  "TEST_DRIVE",
  "WARRANTY",
  "AVAILABILITY",
  "DISCOUNT",
  "TRADE_IN",
  "SERVICE",
  "PARTS",
  "COMPLAINT",
  "UNKNOWN",
] as const;

export type Intent = (typeof INTENTS)[number];

/** Answered from a model's approved facts. */
export const FACT_INTENTS = [
  "HORSEPOWER",
  "RANGE",
  "BATTERY",
  "POWERTRAIN",
  "CHARGING",
  "SEATS",
  "DIMENSIONS",
  "SPECIFICATIONS",
  "WARRANTY",
] as const;

export type FactIntent = (typeof FACT_INTENTS)[number];

/** Answered the same whatever the model — no model needed. */
export const GLOBAL_INTENTS = ["LOCATION", "OPENING_HOURS", "CONTACT_NUMBER"] as const;

export type GlobalIntent = (typeof GLOBAL_INTENTS)[number];

/**
 * Intents whose answer depends on WHICH model. Without one they are saved as
 * pending and the customer is asked which model; the answer then triggers
 * them in order. PRICE is here because Samer's spec routes it through the
 * model (brochure first) even though its answer is the contact number.
 */
export const MODEL_INTENTS: readonly Intent[] = [
  "GENERAL_INFO",
  "BROCHURE",
  "COLOUR",
  "COLOUR_VIDEO",
  ...FACT_INTENTS,
  "PRICE",
];

/**
 * Intents a person must handle, answered at once with the contact number:
 * a figure, a promise or a judgement that no template may make.
 */
export const CONTACT_INTENTS: readonly Intent[] = [
  "FINANCING",
  "TEST_DRIVE",
  "AVAILABILITY",
  "DISCOUNT",
  "TRADE_IN",
  "SERVICE",
  "PARTS",
  "COMPLAINT",
];

export function isFactIntent(intent: Intent): intent is FactIntent {
  return (FACT_INTENTS as readonly Intent[]).includes(intent);
}

export function isGlobalIntent(intent: Intent): intent is GlobalIntent {
  return (GLOBAL_INTENTS as readonly Intent[]).includes(intent);
}

export function isModelIntent(intent: Intent): boolean {
  return MODEL_INTENTS.includes(intent);
}

export function isContactIntent(intent: Intent): boolean {
  return CONTACT_INTENTS.includes(intent);
}

/* ── The vocabulary ──────────────────────────────────────────────────────── */

/** A word that only counts when nothing more specific stands beside it. */
interface Weak {
  weak: string;
}

function weak(phrase: string): Weak {
  return { weak: phrase };
}

type Entry = string | Weak;

/**
 * Written the way customers write, Arabic included; compile() runs every
 * phrase through normalize(), so "أقساط" here and "اقساط" in a message are
 * the same word. Every phrase belongs to exactly one intent — a test checks.
 */
const LEXICON: Readonly<Record<Exclude<Intent, "UNKNOWN">, readonly Entry[]>> = {
  GREETING: [
    "hi", "hii", "hiii", "hey", "heyy", "hello", "helo", "hallo", "hola",
    "good morning", "good afternoon", "good evening", "good day", "greetings",
    "salam", "salaam", "salam alaykom", "salamo alaykom", "assalamu alaikum",
    "marhaba", "mar7aba", "marhabtein", "hala", "ahla", "ahlan", "ahlein",
    "bonjour", "bonsoir", "salut", "kifak", "kifik", "kifkon",
    "thanks", "thank you", "thankyou", "thx", "merci", "shukran", "choukran",
    "مرحبا", "مرحبتين", "أهلا", "أهلين", "هلا", "السلام عليكم", "سلام",
    "صباح الخير", "مسا الخير", "مساء الخير", "كيفك", "كيفكن", "شكرا",
  ],
  GENERAL_INFO: [
    "info", "infos", "information", "informations", "more info",
    "more information", "more details", "details", "detail", "know more",
    "tell me more", "tell me about", "interested", "inquiry", "enquiry",
    "ma3loumet", "ma3lumet", "ma3loumat", "ma3lomet",
    "معلومات", "معلومة", "تفاصيل", "مهتم", "مهتمة", "استفسار", "بدي اعرف",
  ],
  BROCHURE: [
    "brochure", "brochures", "catalogue", "catalogues", "catalog", "catalogs",
    "pdf", "leaflet", "كتالوج", "كاتالوج", "كاتالوغ", "بروشور",
  ],
  COLOUR: [
    "colour", "colours", "color", "colors", "which colour", "which color",
    "available colours", "available colors", "couleur", "couleurs",
    "alwan", "alwen", "لون", "ألوان", "الوانها", "لونها",
  ],
  COLOUR_VIDEO: [
    "video", "videos", "vid", "clip", "clips", "reel", "reels", "walkaround",
    "فيديو", "فيديوهات", "فيديوات",
  ],
  HORSEPOWER: [
    "hp", "horsepower", "horse power", "horses", "bhp", "power", "kw",
    "حصان", "أحصنة", "قوة", "قوة المحرك", "7san", "a7sne",
  ],
  RANGE: [
    "range", "autonomy", "autonomie", "how far", "km range", "kilometers",
    "kilometres", "kilometer", "kilometre", "km", "kms", "how many km",
    "per charge", "masafe", "masafeh",
    "مسافة", "مدى", "كم كيلو", "كيلومتر",
  ],
  BATTERY: [
    "battery", "batteries", "batterie", "battery capacity", "battery size",
    "kwh", "بطارية",
  ],
  POWERTRAIN: [
    "electric", "full electric", "fully electric", "ev", "bev", "hybrid",
    "plug in", "plugin", "phev", "erev", "reev", "range extender",
    "extended range", "fuel", "petrol", "gasoline", "benzine", "benzin",
    "diesel", "engine", "motor", "motors", "awd", "4x4", "4wd", "2wd", "rwd",
    "fwd", "كهربا", "كهرباء", "كهربائي", "كهربائية", "هايبرد", "هايبريد",
    "بنزين", "مازوت", "محرك", "موتور",
  ],
  CHARGING: [
    "charging", "charge", "charger", "chargers", "charging time",
    "fast charging", "fast charge", "supercharge", "dc", "wallbox",
    "charging station", "plug", "sha7en", "شحن", "شاحن",
  ],
  SEATS: [
    "seats", "seat", "seater", "seaters", "7 seater", "7seater", "5 seater",
    "how many seats", "number of seats", "passengers", "passenger",
    "مقاعد", "مقعد", "ركاب", "كم راكب",
  ],
  DIMENSIONS: [
    "dimensions", "dimension", "size", "length", "width", "height",
    "wheelbase", "trunk", "boot", "boot space", "cargo", "ground clearance",
    "clearance", "قياس", "قياسات", "طول", "ارتفاع", "أبعاد", "صندوق",
  ],
  SPECIFICATIONS: [
    "specs", "spec", "specifications", "specification", "features",
    "feature", "technical", "tech specs", "full specs", "fiche technique",
    "مواصفات", "مميزات",
  ],
  LOCATION: [
    "location", "located", "where are you", "where are you located",
    "where is your showroom", "where is the showroom", "address", "showroom",
    "branch", "branches", "map", "maps", "google maps", "directions",
    "how to get", weak("where"), weak("wen"), weak("wein"), "wen ntou",
    weak("وين"), "وينكم", "وين محلكم", "عنوان", "العنوان", "موقعكم",
    "مكانكم", "صالة العرض", "معرض",
  ],
  OPENING_HOURS: [
    "opening hours", "open hours", "working hours", "business hours",
    "hours", weak("open"), "opening", weak("close"), "closing", "what time",
    "until what time", "till what time", "are you open", "open today",
    "open tomorrow", weak("sunday"), weak("saturday"), "dawem", "dawam",
    "دوام", "الدوام", "ساعات", "مفتوحين", "فاتحين", "بتسكرو",
  ],
  CONTACT_NUMBER: [
    weak("number"), "phone", "phone number", "your number", "mobile",
    "whatsapp", "whatsapp number", "call", "call you", "call me", "contact",
    "contact number", "contact you", "reach you", "telephone", "tel",
    "ra2em", "ra2m", "nemra", "رقم", "رقمكم", "تلفون", "تلفونكم", "واتساب",
    "اتصل",
  ],
  PRICE: [
    "price", "prices", "pricing", "price range", "cost", "costs",
    weak("how much"), "how much does it cost", "usd", "dollars", "dollar",
    "prix", "combien", "se3er", "si3r", "sa3er", "se3r", weak("ade"),
    "adesh", "addesh", "2adesh", weak("adde"), "سعر", "السعر", "أسعار",
    "الأسعار", "بكم", "قديش", weak("كم"), "تكلفة", "كلفة",
  ],
  FINANCING: [
    "installment", "installments", "instalment", "instalments", "finance",
    "financing", "loan", "loans", "bank loan", "monthly", "monthly payment",
    "monthly payments", "payment plan", "payment facilities", "facilities",
    "down payment", "downpayment", "first payment", "credit", "leasing",
    "lease", "taksit", "ta2sit", "takseet", "ta2seet", "a2sat",
    "تقسيط", "بالتقسيط", "أقساط", "قسط", "قرض", "دفعة أولى", "دفعة",
    "شهري", "تسهيلات",
  ],
  TEST_DRIVE: [
    "test drive", "testdrive", "test driving", "try the car", "book a drive",
    "tajrobe", "tajribe", "tajrbe", "تجربة", "تجربة قيادة", "تست درايف",
  ],
  WARRANTY: [
    "warranty", "warranties", "guarantee", "guaranty", "garantie",
    "kafele", "kafeleh", "kafala", "كفالة", "ضمان",
  ],
  AVAILABILITY: [
    "available", "availability", "in stock", "stock", "instock", "delivery",
    "delivery time", "when can i get", "waiting time", "disponible",
    "mawjoud", "mawjoude", "mawjoudin", "متوفر", "متوفرة", "موجود", "موجودة",
  ],
  DISCOUNT: [
    "discount", "discounts", "offer", "offers", "promo", "promotion",
    "promotions", "deal", "deals", "best price", "last price",
    "special price", "khasm", "5asm", "خصم", "حسم", "تخفيض", "عرض", "عروض",
    "آخر سعر",
  ],
  TRADE_IN: [
    "trade in", "tradein", "trade", "exchange", "swap", "part exchange",
    "my old car", "badal", "بدل", "مبادلة", "تبديل",
  ],
  SERVICE: [
    "service", "servicing", "maintenance", "repair", "repairs", "workshop",
    "garage", "mechanic", "check up", "checkup", "inspection", "siyene",
    "صيانة", "تصليح", "كاراج", "ورشة",
  ],
  PARTS: [
    "parts", weak("part"), "spare parts", "spare part", "spares",
    "accessories", "accessory", "tyres", "tires", "قطع", "قطع غيار",
    "اكسسوارات",
  ],
  COMPLAINT: [
    "complaint", "complain", "complaining", "problem", "problems", "issue",
    "issues", "broken", "not working", "doesnt work", "does not work",
    "disappointed", "bad service", "terrible", "worst", "angry", "refund",
    "mechkle", "moshkle", "meshkle", "شكوى", "مشكلة", "مشاكل", "عطل",
    "خربان", "معطل", "زعلان",
  ],
};

/**
 * Phrases that CONTAIN an intent word without meaning it. They take part in
 * longest-phrase-wins and are then thrown away, so the word inside them
 * counts for nothing.
 */
const IGNORE: readonly string[] = [
  "range rover",
  "number of",
  "feel free",
  "for free",
  "free of charge",
  "in charge",
  "no problem",
  "no problems",
  "not a problem",
  "no issue",
  "no issues",
];

/**
 * Real words that sit one letter from an intent word. A token that IS one of
 * these is never "corrected" into the intent: "changing" is not "charging".
 */
const NEVER_A_TYPO = [
  "change", "changed", "changes", "changing", "charming", "charting",
  "contract", "contracts", "orange", "arrange", "strange", "financial",
  "position", "vocation", "servant", "serving",
];

/* ── Compiling the vocabulary ────────────────────────────────────────────── */

interface Compiled {
  /** null for an IGNORE phrase. */
  intent: Exclude<Intent, "UNKNOWN"> | null;
  tokens: readonly string[];
  weak: boolean;
}

function tokensOf(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((t) => t !== "");
}

function compile(): Compiled[] {
  const out: Compiled[] = [];
  for (const [intent, entries] of Object.entries(LEXICON) as [
    Exclude<Intent, "UNKNOWN">,
    readonly Entry[],
  ][]) {
    for (const entry of entries) {
      const phrase = typeof entry === "string" ? entry : entry.weak;
      const tokens = tokensOf(phrase);
      if (tokens.length === 0) continue;
      out.push({ intent, tokens, weak: typeof entry !== "string" });
    }
  }
  for (const phrase of IGNORE) {
    out.push({ intent: null, tokens: tokensOf(phrase), weak: false });
  }
  return out;
}

const COMPILED: readonly Compiled[] = compile();

/** Every single word the vocabulary knows, plus the look-alikes above. */
const PROTECTED: ReadonlySet<string> = new Set([
  ...COMPILED.flatMap((c) => c.tokens),
  ...NEVER_A_TYPO,
]);

/** Each phrase, normalized, with its intent — for the uniqueness test. */
export function lexiconPhrases(): { intent: Intent | null; phrase: string }[] {
  return COMPILED.map((c) => ({ intent: c.intent, phrase: c.tokens.join(" ") }));
}

/* ── Matching ────────────────────────────────────────────────────────────── */

function squash(word: string): string {
  return word.replace(/(.)\1+/g, "$1");
}

/** How a vocabulary word meets a message token: exactly, as a typo, or not. */
function meet(word: string, token: string): "exact" | "fuzzy" | null {
  if (sameWord(word, token)) return "exact";
  if (isArabicToken(word) || isArabicToken(token)) return null;
  if (squash(word) === squash(token)) return "exact";
  if (PROTECTED.has(token)) return null;
  if (/[0-9]/.test(word) || /[0-9]/.test(token)) return null;
  const allow = word.length >= 9 ? 2 : word.length >= 7 ? 1 : 0;
  if (allow === 0 || word[0] !== token[0]) return null;
  return editDistance(word, token, allow) <= allow ? "fuzzy" : null;
}

/** One place an intent was found. */
export interface IntentHit {
  intent: Exclude<Intent, "UNKNOWN">;
  /** The message words that produced it. */
  matched: string;
  /** Token span, end exclusive. */
  start: number;
  end: number;
  fuzzy: boolean;
  weak: boolean;
}

interface RawHit {
  intent: Exclude<Intent, "UNKNOWN"> | null;
  start: number;
  end: number;
  fuzzy: boolean;
  weak: boolean;
}

/** Every intent in the message, in the order written. */
export function findIntents(tokens: readonly string[]): IntentHit[] {
  const raw: RawHit[] = [];
  for (const entry of COMPILED) {
    const n = entry.tokens.length;
    for (let start = 0; start + n <= tokens.length; start++) {
      let fuzzy = false;
      let ok = true;
      for (let j = 0; j < n; j++) {
        const m = meet(entry.tokens[j], tokens[start + j]);
        if (!m) {
          ok = false;
          break;
        }
        if (m === "fuzzy") fuzzy = true;
      }
      if (ok) {
        raw.push({ intent: entry.intent, start, end: start + n, fuzzy, weak: entry.weak });
      }
    }
  }

  // Longest phrase wins, across intents and ignore-phrases alike.
  const longest = raw.filter(
    (a) =>
      !raw.some(
        (b) =>
          b !== a &&
          b.start <= a.start &&
          b.end >= a.end &&
          b.end - b.start > a.end - a.start
      )
  );

  const meaningful = longest.filter(
    (h): h is RawHit & { intent: Exclude<Intent, "UNKNOWN"> } => h.intent !== null
  );

  // A weak word counts only when nothing stronger was asked.
  const kept = meaningful.filter(
    (a) => !a.weak || !meaningful.some((b) => !b.weak && b.intent !== a.intent)
  );

  kept.sort((a, b) => a.start - b.start || b.end - a.end);
  const seen = new Set<string>();
  const out: IntentHit[] = [];
  for (const h of kept) {
    const key = `${h.intent}:${h.start}:${h.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      intent: h.intent,
      matched: tokens.slice(h.start, h.end).join(" "),
      start: h.start,
      end: h.end,
      fuzzy: h.fuzzy,
      weak: h.weak,
    });
  }
  return out;
}

/** Distinct intents, in the order first written. */
export function intentsOf(hits: readonly IntentHit[]): Intent[] {
  const out: Intent[] = [];
  for (const h of hits) if (!out.includes(h.intent)) out.push(h.intent);
  return out;
}

/* ── Language ────────────────────────────────────────────────────────────── */

export type Language = "en" | "ar" | "arabizi" | "fr" | "mixed" | "unknown";

/** Lebanese Arabizi words unambiguous enough to name the language. */
const ARABIZI_WORDS = new Set([
  "kifak", "kifik", "kifkon", "shu", "chou", "sho", "adesh", "addesh",
  "2adesh", "badde", "baddi", "bade", "3andkon", "3endkon", "marhaba",
  "mar7aba", "ahla", "ahlan", "yalla", "habibi", "tayeb", "mnih", "ktir",
  "kteer", "hayda", "hayde", "hek", "lesh", "leh", "wen", "wein", "ntou",
  "mesh", "msh", "la2", "akid", "tab3an", "se3er", "sa3er", "si3r",
  "ma3loumet", "ma3lumet", "taksit", "ta2sit", "tajrobe", "shukran",
  "choukran", "3adi", "kello", "kelon", "sayara", "sayyara", "fiye", "fik",
  "3am", "ya3ne", "ya3ni", "baddak", "baddik", "inno", "enno",
]);

const FRENCH_WORDS = new Set([
  "bonjour", "bonsoir", "merci", "prix", "combien", "voiture", "svp",
  "quel", "quelle", "couleur", "couleurs", "disponible", "est", "vous",
  "je", "voudrais", "le", "la", "les", "des", "une", "pour", "avec",
]);

/** Latin letters used for Arabic sounds: 2 3 5 6 7 8 9 inside a word. */
const ARABIZI_DIGIT = /[a-z][235-9]|[235-9][a-z]/;

export function detectLanguage(tokens: readonly string[]): Language {
  let arabic = 0;
  let latin = 0;
  let arabizi = 0;
  let french = 0;
  for (const t of tokens) {
    if (isArabicToken(t)) {
      arabic++;
      continue;
    }
    if (!/[a-z]/.test(t)) continue;
    latin++;
    if (ARABIZI_WORDS.has(t) || ARABIZI_DIGIT.test(t)) arabizi++;
    if (FRENCH_WORDS.has(t)) french++;
  }
  if (arabic > 0 && latin > 0) return "mixed";
  if (arabic > 0) return "ar";
  if (latin === 0) return "unknown";
  if (arabizi > 0) return "arabizi";
  if (french >= 2 || (french === 1 && latin === 1)) return "fr";
  return "en";
}

/* ── Button payloads and numbered answers ────────────────────────────────── */

/**
 * The stable payloads the choice buttons carry. A payload names a model or a
 * colour and nothing else — typing one is exactly as powerful as typing the
 * model's name, so a customer who types it gains nothing.
 */
export type ChoicePayload =
  | { kind: "MODEL"; model: string }
  | { kind: "COLOUR"; model: string; colour: string };

export function modelPayload(model: string): string {
  return `MODEL:${model}`;
}

export function colourPayload(model: string, colourId: string): string {
  return `COLOUR:${model}:${colourId.toUpperCase()}`;
}

export function parsePayload(raw: string | null | undefined): ChoicePayload | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  const model = /^MODEL:([A-Z0-9_]{1,20})$/i.exec(s);
  if (model) return { kind: "MODEL", model: model[1].toUpperCase() };
  const colour = /^COLOUR:([A-Z0-9_]{1,20}):([A-Z0-9_-]{1,64})$/i.exec(s);
  if (colour) {
    return { kind: "COLOUR", model: colour[1].toUpperCase(), colour: colour[2].toLowerCase() };
  }
  return null;
}

/**
 * "2", "number 2", "option 2", "#2", "٢" — the answer to a numbered list,
 * which is how choices are shown on a channel without buttons. Only a
 * message that is JUST the number counts; the engine only asks when a list
 * was actually shown.
 */
export function readChoiceNumber(tokens: readonly string[]): number | null {
  const words = tokens.filter((t) => !["number", "no", "num", "option", "رقم"].includes(t));
  if (words.length !== 1 || tokens.length > 2) return null;
  if (!/^[0-9]{1,2}$/.test(words[0])) return null;
  const n = Number(words[0]);
  return n >= 1 ? n : null;
}

/* ── Hard exclusions ─────────────────────────────────────────────────────── */

export type ExclusionKind = "META_SCAM" | "VENDOR_PITCH" | "SYSTEM_NOTICE" | "INTERNAL_TEST";

export interface Exclusion {
  kind: ExclusionKind;
  /** Why, in words staff can check against the message. */
  reason: string;
}

const LINK = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|me|co|info|site|online|xyz|ly)\/\S*/i;

const IMPERSONATION =
  /\b(?:meta|facebook|instagram)\s+(?:business\s+)?(?:support|team|security|help center|policy|pro team|verified)\b/;

const THREAT =
  /\b(?:disabled|deactivated|suspended|restricted|removed|deleted|banned|terminated|unpublished|violat\w*|infringement|appeal|permanently|verify your (?:account|page)|confirm your (?:account|page))\b/g;

const SERVICE =
  /\b(?:seo|web design|website design|web development|app development|digital marketing|social media (?:marketing|management)|followers|likes|lead generation|leads generation|backlinks|google ranking|graphic design|video editing|logo design|content creation|ugc)\b/;

const PITCH =
  /\b(?:we (?:offer|provide|can help|specialize|are a)|i (?:offer|provide|can help you|am a (?:freelancer|professional|digital))|our (?:agency|company|team|services)|would you be interested|boost your|grow your|increase your (?:sales|followers|revenue|reach)|free (?:audit|consultation|trial)|dm me|let me know if you)\b/;

const SYSTEM_NOTICE = /\b(?:created this chat because|this chat was created because)\b/;

const INTERNAL_TEST =
  /^(?:(?:hi|hello|hey)\s)?(?:test|testing|tst|test message|test msg|this is a test|just testing|testing testing)(?:\s\d{1,3})?(?:\s(?:please ignore|ignore))?$/;

export interface ReadOptions {
  /**
   * A REHEARSAL chat (lib/wasales/rehearsal-chats.ts): Samer's own number,
   * testing the product as a client. The INTERNAL_TEST filter is the one rule
   * that would silence exactly the person testing on purpose, so it is off
   * there — "test" reads as an ordinary message with nothing in it.
   *
   * Nothing else changes: a scam, a vendor pitch and Meta's own notice are
   * still excluded, because a client's chat excludes them too.
   */
  rehearsal?: boolean;
}

/**
 * Messages that must never reach the engine as a customer's words. Each rule
 * needs TWO independent signals (or an exact whole-message form), because
 * filtering a real customer is worse than letting a scam through to a
 * person: a person can ignore a scam, nobody answers a filtered customer.
 */
export function detectExclusion(
  raw: string,
  normalized: string,
  opts: ReadOptions = {}
): Exclusion | null {
  if (SYSTEM_NOTICE.test(normalized)) {
    return { kind: "SYSTEM_NOTICE", reason: "Meta's own chat notice, not a customer message." };
  }

  if (!opts.rehearsal && INTERNAL_TEST.test(normalized)) {
    return { kind: "INTERNAL_TEST", reason: "A test message — the whole message is \"test\"." };
  }

  const hasLink = LINK.test(raw);
  const threats = new Set(normalized.match(THREAT) ?? []).size;
  if (IMPERSONATION.test(normalized) && (threats > 0 || hasLink)) {
    return {
      kind: "META_SCAM",
      reason: "Claims to be Meta support and threatens the account or carries a link.",
    };
  }
  if (threats >= 2 && hasLink && /\b(?:page|account)\b/.test(normalized)) {
    return {
      kind: "META_SCAM",
      reason: "Threatens the page or account and carries a link.",
    };
  }

  if (SERVICE.test(normalized) && PITCH.test(normalized)) {
    return { kind: "VENDOR_PITCH", reason: "A vendor offering a service, not a customer." };
  }

  return null;
}

/* ── Reading one message ─────────────────────────────────────────────────── */

export interface MessageReading {
  raw: string;
  normalized: string;
  tokens: string[];
  language: Language;
  hits: IntentHit[];
  /** Distinct intents in the order written; empty when none was found. */
  intents: Intent[];
  /**
   * high: every intent word exact · medium: a typo was tolerated ·
   * low: only weak words · none: no intent at all.
   */
  confidence: "high" | "medium" | "low" | "none";
  exclusion: Exclusion | null;
  payload: ChoicePayload | null;
  choiceNumber: number | null;
}

/**
 * Read one inbound message. `payload` is the button payload when the customer
 * tapped a choice; a message typed in exactly that shape counts too (it is
 * no more powerful than typing the model's name).
 */
export function readMessage(
  text: string,
  payload?: string | null,
  opts: ReadOptions = {}
): MessageReading {
  const raw = typeof text === "string" ? text : "";
  const normalized = normalize(raw);
  const tokens = normalized === "" ? [] : normalized.split(" ");
  const parsedPayload = parsePayload(payload) ?? parsePayload(raw);
  const hits = parsedPayload ? [] : findIntents(tokens);

  let confidence: MessageReading["confidence"] = "none";
  if (hits.length > 0) {
    confidence = hits.every((h) => h.weak)
      ? "low"
      : hits.some((h) => h.fuzzy)
        ? "medium"
        : "high";
  }

  return {
    raw,
    normalized,
    tokens,
    language: detectLanguage(tokens),
    hits,
    intents: intentsOf(hits),
    confidence,
    exclusion: parsedPayload ? null : detectExclusion(raw, normalized, opts),
    payload: parsedPayload,
    choiceNumber: parsedPayload ? null : readChoiceNumber(tokens),
  };
}
