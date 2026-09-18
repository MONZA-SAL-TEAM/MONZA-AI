/**
 * THE MODEL-ENTITY RESOLVER — does the customer MEAN a car, or did they only
 * use a word that happens to be a car's name?
 *
 * Four of Monza's cars are named with ordinary English words: Dream, Passion,
 * Free, Courage. Until 2026-09-18 any message containing one of them was "about
 * that car": "it's my dream car" got the Dream's brochure and video and raised
 * a sales alert; "is the first service free?" got the Free 318's brochure;
 * "I need a person" was filed under the Passion (one letter from "person").
 *
 * The matcher (matcher.ts `modelHits`) still says which WORDS land on which
 * car. This file decides what that is worth, and says why:
 *
 *   STRONG  act on it — brochure, video, facts, alerts.
 *   WEAK    the word is there, nothing says it is the car, nothing says it is
 *           not: the engine ASKS ("Did you mean the VOYAH Dream?"). It never
 *           sends material or raises a model-specific alert on a weak match.
 *   (none)  ordinary use ("my dream car", "courage to ask", "service free"):
 *           the word is dropped as if it were not there.
 *
 * Evidence, strongest first (Samer's order, 2026-09-18):
 *   1. manufacturer + model            "voyah dream", "فوياه دريم"
 *   2. an exact, unambiguous mention   "taishan", "mhero 1", "free 318", "917",
 *                                      a transliteration ("كوراج"), a typo alias
 *   3. the conversation                the bot asked "which model?" and offered
 *                                      it; it is the car already being discussed
 *   4. the ad the customer came from   the same model
 *   5. grammar and neighbours          "the dream", "dream price", "price of the
 *                                      courage", "dream or taishan", the word
 *                                      alone as the whole message
 *
 * Not an AI: closed word lists and neighbour rules, the same every time, and
 * every decision carries the evidence that produced it (shown to staff).
 */

import type { ModelCode } from "@/lib/wasales/knowledge";
import type { WaCar } from "@/lib/wasales/matcher";
import { modelHits, normalize } from "@/lib/wasales/matcher";

export type ModelConfidence = "strong" | "weak";

/**
 * THE FOUR STATES (Samer, 2026-09-18). Only the first two may act:
 *   explicit    the words themselves say it is the car        ("Voyah Dream", "Dream price", "the Dream")
 *   contextual  the conversation or the ad says so            (just offered · being discussed · came from its ad)
 *   ambiguous   could be the car, could be the word           → the engine ASKS, and does nothing else
 *   incidental  an ordinary word ("my dream car", "is it free?") → ignored as a trigger
 * explicit and contextual are `confidence: "strong"`; ambiguous is "weak"; incidental is a rejection.
 */
export type MentionState = "explicit" | "contextual" | "ambiguous" | "incidental";

export interface ModelMention {
  carId: string;
  confidence: ModelConfidence;
  state: Exclude<MentionState, "incidental">;
  /** Why, in plain words — for staff and for tests. */
  evidence: string[];
  matchedText: string;
  fuzzy: boolean;
}

export interface ModelRejection {
  carId: string;
  matchedText: string;
  reason: string;
  state: "incidental";
}

export interface EntityContext {
  /** Catalogue ids the bot just offered ("which model?", "did you mean…?"). */
  offeredCarIds: readonly string[];
  /** Catalogue ids already being discussed in this conversation. */
  discussedCarIds: readonly string[];
  /** The car of the ad the customer came from, if any. */
  adCarId: string | null;
  /** Normalized tokens that are, exactly, words of the intent vocabulary ("person", "free" is not). */
  intentWords: ReadonlySet<string>;
  /** Normalized tokens of words that talk about a car ("price", "range", "colours", "brochure", "stock"…). */
  carTalkWords: ReadonlySet<string>;
}

export interface EntityResolution {
  mentions: ModelMention[];
  rejected: ModelRejection[];
}

/** Model names that are ordinary English words, and the ordinary ways they are used. */
/** Arabizi / Arabic "my", "of mine", "this": the word before or after belongs to the speaker, not to Monza's range. */
const POSSESSIVE_NEIGHBOURS = ["taba", "taba3e", "taba3i", "taba3o", "taba3na", "taba3ak", "تبعي", "تبعنا", "hayda", "hayde", "hay", "shi", "3ande", "3andi", "عندي"];

interface OrdinaryRule {
  before: readonly string[];
  after: readonly string[];
  /** "a courage", "a free" are not English: with an article it can only be the car. */
  article?: boolean;
  /** The word alone is NOT enough ("Free"): it is asked, unless the conversation already points at the car. */
  aloneIsAmbiguous?: boolean;
  /**
   * Only an article, a demonstrative or "car" points at it ("the Free", "this Free", "سيارة Free"). "I want free…",
   * "bade free" could be the adjective, so a want-word is not evidence.
   */
  strictPointing?: boolean;
  /** "Is charging free?", "is CarPlay free?": the word closes a yes/no question as a predicate. */
  predicate?: boolean;
  /** Anywhere in the message, these say it is something else entirely (Mount Taishan). */
  elsewhere?: readonly string[];
  /**
   * A name nobody uses for anything else once the traps above are excluded ("taishan", "318"): it is the car
   * unless a trap says otherwise. The four English words are the opposite: a word until evidence says car.
   */
  safeByDefault?: boolean;
  /** In the raw text: "$318" is money. */
  money?: boolean;
}

const ORDINARY: Readonly<Record<string, OrdinaryRule>> = {
  // 318 is a number before it is a car: "BMW 318", "318 km", "invoice 318".
  "318": {
    safeByDefault: true,
    money: true,
    before: ["bmw", "invoice", "order", "ticket", "plate", "number", "no", "ref", "reference", "room", "page", "code", "flight", "receipt", "bill", "paid", "pay", "cost", "costs", "usd", "lbp"],
    after: ["km", "kms", "kilometers", "kilometres", "hp", "horsepower", "bhp", "days", "day", "dollars", "dollar", "usd", "lbp", "euros", "k", "miles", "kw", "kwh", "nm", "mm", "cm", "i", "d", "is", "months", "years"],
  },
  taishan: {
    safeByDefault: true,
    before: ["mount", "mt", "mountain", "جبل"],
    after: ["mountain", "mountains", "china", "tourism", "restaurant", "company", "city", "province", "shandong", "temple", "hike", "trip", "travel"],
    elsewhere: ["mount", "mountain", "mountains", "tourism", "restaurant", "climb", "climbing", "hike", "hiking", "shandong", "province", "temple"],
  },
  dream: {
    elsewhere: ["dreamed", "dreamt", "dreaming", "dreams"],
    before: ["my", "your", "his", "her", "our", "their", "a", "i", "we", "you", "they", "big", "biggest", "childhood", "lifelong", "true", "pipe", "sweet", "american", "the same", ...POSSESSIVE_NEIGHBOURS],
    after: ["specification", "specifications", "spec", "setup", "build", "configuration", "config", "suv", "sedan", "truck", "taba", "taba3e", "taba3i", "car", "cars", "vehicle", "job", "home", "house", "life", "come", "comes", "came", "of", "about", "big", "team", "girl", "machine", "garage", "holiday", "wedding", "to"],
  },
  passion: {
    before: ["my", "your", "his", "her", "our", "their", "a", "with", "real", "true", "great", "big", "such", "much", "pure", "same", "has", "have", "had", "shows", "show", "and", "more", "their", ...POSSESSIVE_NEIGHBOURS],
    after: ["for", "is", "of", "project", "projects", "shows", "taba", "taba3e", "taba3i", "taba3o"],
  },
  free: {
    // The most dangerous of the four: an everyday adjective. The bare word is asked; only an article points at it.
    aloneIsAmbiguous: true,
    strictPointing: true,
    predicate: true,
    before: ["re", "youre", "were", "theyre", "he", "she", "we", "they", "something", "hayda", "hayde", "hay", "shi", "bala", "مجانا", "charger", "carplay", "assistance", "warranty", "accessories", "installation", "wash", "is", "are", "was", "were", "be", "its", "it", "for", "feel", "totally", "completely", "absolutely", "im", "i", "am", "you", "u", "get", "got", "getting", "service", "delivery", "charging", "maintenance", "insurance", "registration", "parking", "wifi", "charger", "included", "comes", "come", "stay", "when", "toll", "tax", "duty", "hands", "interest", "almost", "not", "anything", "something", "everything", "any"],
    after: ["test", "drive", "carplay", "assistance", "roadside", "gift", "saturday", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "after", "when", "tyres", "tires", "mats", "coffee", "of", "to", "now", "today", "tomorrow", "tonight", "later", "time", "service", "services", "servicing", "delivery", "shipping", "charging", "charger", "maintenance", "insurance", "registration", "gift", "gifts", "trial", "parking", "wifi", "at", "on", "this", "next", "after", "before", "from", "for", "accessories", "installation", "wallbox", "warranty", "offer", "offers", "upgrade", "checkup", "check", "wash", "tint", "plates", "fuel", "with"],
  },
  courage: {
    // Courage is uncountable: "a courage", "reserve a courage for me" can only be the car.
    article: true,
    before: ["have", "had", "has", "takes", "took", "take", "my", "your", "his", "her", "their", "our", "much", "more", "enough", "with", "real", "great", "needs", "some", "any", "little", "got", "find", "found", "lack", "no"],
    after: ["to"],
  },
};

/** Words that, right before a model's name, say the customer means the car. */
const POINTS_AT_A_CAR = new Set([
  "the", "about", "want", "wants", "wanted", "like", "liked", "love", "prefer", "need", "buy", "buying", "see", "saw", "check", "for", "on", "in", "new",
  "this", "that", "your", "ur", "el", "al", "l", "3andkon", "3andkoun", "3endkon", "3andak", "andkon", "andkoun", "endkon", "andak", "andik", "fi", "fih", "عندكم", "عندكن", "عندك", "في", "3an", "eshtere", "ishtere", "eshtre", "shuf", "shouf", "chouf", "jarreb", "se3er", "s3r", "acheter", "essayer", "bade", "bde", "badde", "baddi", "bdi", "baddna", "fi", "3al", "vs", "versus", "or", "and", "than", "not", "also", "with",
  "عن", "بدي", "اريد", "أريد", "ال", "او", "أو", "و", "اشتري", "أشتري", "سعر", "شوف", "جرب",
]);

/** The only words that point at a `strictPointing` name: an article, a demonstrative, or "car". */
const ARTICLES = new Set(["the", "this", "that", "new", "el", "al", "l", "ال", "الـ", "car", "cars", "siyara", "siyaret", "siyarat", "سيارة", "سياره", "سيارات", "voiture", "la", "le"]);
/** "Dream MPV", "Courage SUV", "Passion sedan": the body after the name says it is the car. */
const MODEL_NOUNS = new Set(["suv", "sedan", "mpv", "van", "minivan", "crossover", "model", "phev", "erev", "ev", "hybrid", "2026", "2027", "موديل"]);
/** Verbs of wanting: "I WANT a Dream", "RESERVE a Passion". */
const WANT_VERBS = new Set(["want", "wants", "wanted", "need", "buy", "buying", "get", "getting", "take", "reserve", "order", "book", "hold", "like", "prefer", "test", "drive", "bade", "bde", "badde", "baddi", "bdi", "eshtere", "بدي", "اريد", "أريد", "اشتري"]);

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

/** "Is … free?", "are … free?": the opening of a yes/no question. */
const QUESTION_OPENERS = new Set(["is", "are", "was", "will", "do", "does", "can", "could", "any", "hal", "هل", "est", "c"]);

const FILLERS = new Set([
  "the", "a", "an", "please", "pls", "plz", "hi", "hello", "hey", "about", "for", "el", "al", "l", "ok", "okay", "yes", "and", "or", "this", "that", "one", "car", "model",
  "marhaba", "bonjour", "salam", "مرحبا", "اهلا", "أهلا", "لو", "سمحت", "plzz", "thanks", "thank", "you", "u", "new", "2026", "2027",
]);

/** A colour beside a car's name is talk about the car: "courage black", "the free in white". */
const COLOUR_WORDS = new Set([
  "black", "white", "grey", "gray", "silver", "green", "blue", "red", "beige", "brown", "gold", "orange", "yellow", "purple", "pearl", "matte",
  "noir", "blanc", "gris", "vert", "bleu", "rouge", "aswad", "abyad", "rmede", "akhdar", "azra2", "a7mar",
  "اسود", "أسود", "ابيض", "أبيض", "رمادي", "اخضر", "أخضر", "ازرق", "أزرق", "احمر", "أحمر", "فضي",
]);

const BRAND_WORDS = new Set(["voyah", "voya", "voyha", "voiah", "فوياه", "فويا", "mhero", "m-hero", "mengshi", "hero", "منغشي"]);

function isOrdinaryAlias(tokens: readonly string[]): string | null {
  return tokens.length === 1 && Object.prototype.hasOwnProperty.call(ORDINARY, tokens[0]) ? tokens[0] : null;
}

/**
 * Which cars the message means, with how sure and why.
 *
 * `text` is the customer's raw message; `catalog` the cars this account may be
 * asked about (including other brands' — the engine decides what to do with
 * those; this file only decides whether a car was meant).
 */
export function resolveModels(text: string, catalog: readonly WaCar[], ctx: EntityContext): EntityResolution {
  const { tokens, hits } = modelHits(text, catalog);
  const plain = normalize(text).split(" ").filter(Boolean);
  const mentions: ModelMention[] = [];
  const rejected: ModelRejection[] = [];
  const brandNamed = tokens.some((t) => BRAND_WORDS.has(t));

  for (const hit of hits) {
    const words = hit.span.map((i) => tokens[i]);
    const matchedText = words.join(" ");
    const evidence: string[] = [];
    const first = hit.span[0];
    const last = hit.span[hit.span.length - 1];
    const before = first > 0 ? tokens[first - 1] : null;
    const after = last + 1 < tokens.length ? tokens[last + 1] : null;
    const offered = ctx.offeredCarIds.includes(hit.car.id);
    const discussed = ctx.discussedCarIds.includes(hit.car.id);

    // A typo-tolerant landing on a word that is, exactly, a word of the intent vocabulary is that
    // word: "person" is a request for a person, never the Passion.
    if (hit.usedFuzzy && words.some((w) => ctx.intentWords.has(w)) && !offered) {
      rejected.push({ carId: hit.car.id, matchedText, state: "incidental", reason: `"${matchedText}" is an ordinary word of the vocabulary, not a misspelt ${hit.car.name}` });
      continue;
    }

    // Which ordinary word, if any, this mention rests on: the matched token itself ("dream"), or the
    // alias it was typo-matched onto ("dreams" → dream).
    const ordinary =
      hit.span.length === 1
        ? isOrdinaryAlias(words) ?? (hit.usedFuzzy ? Object.keys(ORDINARY).find((o) => /\d/.test(o) === /\d/.test(words[0]) && [hit.car.name, ...hit.car.aliases].some((a) => normalize(a) === o || normalize(a).split(" ").includes(o))) ?? null : null)
        : null;

    if (!ordinary) {
      // A name nobody uses for anything else: "taishan", "mhero 1", "917", "free 318", "voyah dream", "كوراج", "corage".
      evidence.push(hit.span.length > 1 ? `the full name "${matchedText}"` : `"${matchedText}" names only this car`);
      if (hit.usedFuzzy) evidence.push("a tolerated spelling");
      mentions.push({ carId: hit.car.id, confidence: "strong", state: "explicit", evidence, matchedText, fuzzy: hit.usedFuzzy });
      continue;
    }

    /* ── An ordinary English word: dream, passion, free, courage ── */
    const rule = ORDINARY[ordinary];
    const brandAdjacent = (before !== null && BRAND_WORDS.has(before)) || (after !== null && BRAND_WORDS.has(after));
    if (brandAdjacent) evidence.push("the manufacturer's name beside it");
    if (offered) evidence.push("the bot had just offered this car");
    if (discussed) evidence.push("this car is already being discussed");

    const money = rule.money === true && new RegExp(`[$€£]\\s?${ordinary}\\b|\\b${ordinary}\\s?[$€£]`).test(text);
    const elsewhere = money ? "$" : ((rule.elsewhere ?? []).find((w) => tokens.includes(w)) ?? null);
    const predicate =
      rule.predicate === true && last === tokens.length - 1 && tokens.length > 2 && QUESTION_OPENERS.has(tokens[0]) && !(before !== null && ARTICLES.has(before))
        ? `"${tokens[0]} … ${ordinary}?"`
        : null;
    // "I want a Dream", "reserve a Passion": after a verb of wanting, the article points at a car — "I have a dream" does not.
    const wanted = (before === "a" || before === "an") && WANT_VERBS.has(tokens[first - 2] ?? "") ? `"${tokens[first - 2]} ${before} ${ordinary}"` : null;
    const ordinaryUse =
      (elsewhere !== null ? `"${elsewhere}" in the message` : null) ??
      (after !== null && rule.after.includes(after) ? `"${ordinary} ${after}"` : null) ??
      (wanted === null && before !== null && rule.before.includes(before) ? `"${before} ${ordinary}"` : null) ??
      predicate;
    if (wanted !== null && ordinaryUse === null) evidence.push(wanted);

    // A misspelling of a safe name is tolerated by ONE letter ("taisan", "taishen"); "taiwan" is another word.
    if (rule.safeByDefault && hit.usedFuzzy && !brandAdjacent && !offered && !discussed && Math.min(...words.map((w) => editDistance(w, ordinary))) > 1) {
      rejected.push({ carId: hit.car.id, matchedText, state: "incidental", reason: `"${matchedText}" is too far from "${ordinary}" to be a misspelling of it` });
      continue;
    }

    if (!brandAdjacent && !offered && ordinaryUse) {
      // "my dream car", "courage to ask", "service free": the English word, used as one.
      rejected.push({ carId: hit.car.id, matchedText, state: "incidental", reason: `${ordinaryUse} is ordinary English, not the ${hit.car.name}` });
      continue;
    }

    if (hit.usedFuzzy && !brandAdjacent && !offered && !discussed && !rule.safeByDefault) {
      // "dreams", "cream", "tree", "fashion": a different word that merely resembles the name.
      rejected.push({ carId: hit.car.id, matchedText, state: "incidental", reason: `"${matchedText}" only resembles "${ordinary}"` });
      continue;
    }

    const rest = plain.filter((t) => t !== ordinary && !FILLERS.has(t) && !BRAND_WORDS.has(t));
    if (rule.safeByDefault) evidence.push(`"${matchedText}" names only this car here`);
    if (rest.length === 0 && !rule.aloneIsAmbiguous) evidence.push("the word is the whole message");
    if (before !== null && (rule.strictPointing ? ARTICLES.has(before) : POINTS_AT_A_CAR.has(before))) evidence.push(`"${before} ${ordinary}"`);
    if (after !== null && MODEL_NOUNS.has(after)) evidence.push(`"${ordinary} ${after}"`);
    const near = (rule.strictPointing ? [after] : [tokens[first - 2], before, after, tokens[last + 2]]).filter((t): t is string => typeof t === "string");
    const talk = near.find((t) => ctx.carTalkWords.has(t));
    if (talk) evidence.push(`"${talk}" beside it`);
    if (rule.article && (before === "a" || before === "an")) evidence.push(`"${before} ${ordinary}" can only be the car`);
    // "Courage — I'll take it", "price? dream": the name set apart by punctuation at the start or the end of the message.
    const escaped = ordinary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const setApart =
      (first === 0 && new RegExp(`^\\W*${escaped}\\s*[,:;\\u2014\\u2013\\-?!.]`, "i").test(text)) ||
      (last === tokens.length - 1 && tokens.length > 1 && new RegExp(`[,:;\\u2014\\u2013\\-?!.]\\s*${escaped}\\W*$`, "i").test(text));
    if (setApart) evidence.push("the name stands apart, at the start or the end of the message");
    const colour = near.find((t) => COLOUR_WORDS.has(t));
    if (colour) evidence.push(`the colour "${colour}" beside it`);
    if (brandNamed && !brandAdjacent) evidence.push("the manufacturer is named in the message");
    if (ctx.adCarId === hit.car.id) evidence.push("the customer came from this car's ad");

    if (evidence.length > 0) {
      // Contextual when ONLY the conversation or the ad says so; explicit when the words themselves do.
      const fromContext = (e: string) => e === "the bot had just offered this car" || e === "this car is already being discussed" || e === "the customer came from this car's ad";
      mentions.push({ carId: hit.car.id, confidence: "strong", state: evidence.every(fromContext) ? "contextual" : "explicit", evidence, matchedText, fuzzy: hit.usedFuzzy });
    } else {
      mentions.push({ carId: hit.car.id, confidence: "weak", state: "ambiguous", evidence: [`"${ordinary}" is an ordinary word and nothing says it is the car`], matchedText, fuzzy: hit.usedFuzzy });
    }
  }

  // "dream or taishan", "courage vs passion": a list with a car that is certainly meant makes the others cars too.
  if (mentions.some((m) => m.confidence === "strong") && mentions.some((m) => m.confidence === "weak")) {
    const listed = plain.some((t) => ["or", "vs", "versus", "and", "او", "أو", "و", "w", "aw"].includes(t));
    if (listed) for (const m of mentions) if (m.confidence === "weak") Object.assign(m, { confidence: "strong", state: "explicit", evidence: ["named in a list with another car"] });
  }

  return { mentions, rejected };
}
