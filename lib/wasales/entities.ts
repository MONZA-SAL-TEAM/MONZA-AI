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

export interface ModelMention {
  carId: string;
  confidence: ModelConfidence;
  /** Why, in plain words — for staff and for tests. */
  evidence: string[];
  matchedText: string;
  fuzzy: boolean;
}

export interface ModelRejection {
  carId: string;
  matchedText: string;
  reason: string;
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
const ORDINARY: Readonly<Record<string, { before: readonly string[]; after: readonly string[]; article?: boolean }>> = {
  dream: {
    before: ["my", "your", "his", "her", "our", "their", "a", "i", "we", "you", "they", "big", "biggest", "childhood", "lifelong", "true", "pipe", "sweet", "american"],
    after: ["car", "cars", "vehicle", "job", "home", "house", "life", "come", "comes", "came", "of", "about", "big", "team", "girl", "machine", "garage", "holiday", "wedding", "to"],
  },
  passion: {
    before: ["my", "your", "his", "her", "our", "their", "a", "with", "real", "true", "great", "big", "such", "much", "pure", "same"],
    after: ["for", "is", "of", "project"],
  },
  free: {
    // "a free" is not English: with an article, it is the car ("do you have a free in white?").
    article: true,
    before: ["is", "are", "was", "were", "be", "its", "it", "for", "feel", "totally", "completely", "absolutely", "im", "i", "am", "you", "u", "get", "got", "getting", "service", "delivery", "charging", "maintenance", "insurance", "registration", "parking", "wifi", "charger", "included", "comes", "come", "stay", "when", "toll", "tax", "duty", "hands", "interest", "almost", "not", "anything", "something", "everything", "any"],
    after: ["of", "to", "now", "today", "tomorrow", "tonight", "later", "time", "service", "services", "servicing", "delivery", "shipping", "charging", "charger", "maintenance", "insurance", "registration", "gift", "gifts", "trial", "parking", "wifi", "at", "on", "this", "next", "after", "before", "from", "for", "accessories", "installation", "wallbox", "warranty", "offer", "offers", "upgrade", "checkup", "check", "wash", "tint", "plates", "fuel", "with"],
  },
  courage: {
    // Courage is uncountable: "a courage", "reserve a courage for me" can only be the car.
    article: true,
    before: ["have", "had", "has", "takes", "took", "take", "my", "your", "much", "more", "enough", "with", "real", "great", "needs"],
    after: ["to"],
  },
};

/** Words that, right before a model's name, say the customer means the car. */
const POINTS_AT_A_CAR = new Set([
  "the", "about", "want", "wants", "wanted", "like", "liked", "love", "prefer", "need", "buy", "buying", "see", "saw", "check", "for", "on", "in", "new",
  "this", "that", "your", "ur", "el", "al", "l", "3an", "eshtere", "ishtere", "eshtre", "shuf", "shouf", "chouf", "jarreb", "se3er", "s3r", "acheter", "essayer", "bade", "bde", "badde", "baddi", "bdi", "baddna", "fi", "3al", "vs", "versus", "or", "and", "than", "not", "also", "with",
  "عن", "بدي", "اريد", "أريد", "ال", "او", "أو", "و", "اشتري", "أشتري", "سعر", "شوف", "جرب",
]);

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
      rejected.push({ carId: hit.car.id, matchedText, reason: `"${matchedText}" is an ordinary word of the vocabulary, not a misspelt ${hit.car.name}` });
      continue;
    }

    // Which ordinary word, if any, this mention rests on: the matched token itself ("dream"), or the
    // alias it was typo-matched onto ("dreams" → dream).
    const ordinary =
      hit.span.length === 1
        ? isOrdinaryAlias(words) ?? (hit.usedFuzzy ? Object.keys(ORDINARY).find((o) => hit.car.aliases.some((a) => normalize(a) === o)) ?? null : null)
        : null;

    if (!ordinary) {
      // A name nobody uses for anything else: "taishan", "mhero 1", "917", "free 318", "voyah dream", "كوراج", "corage".
      evidence.push(hit.span.length > 1 ? `the full name "${matchedText}"` : `"${matchedText}" names only this car`);
      if (hit.usedFuzzy) evidence.push("a tolerated spelling");
      mentions.push({ carId: hit.car.id, confidence: "strong", evidence, matchedText, fuzzy: hit.usedFuzzy });
      continue;
    }

    /* ── An ordinary English word: dream, passion, free, courage ── */
    const rule = ORDINARY[ordinary];
    const brandAdjacent = (before !== null && BRAND_WORDS.has(before)) || (after !== null && BRAND_WORDS.has(after));
    if (brandAdjacent) evidence.push("the manufacturer's name beside it");
    if (offered) evidence.push("the bot had just offered this car");
    if (discussed) evidence.push("this car is already being discussed");

    const ordinaryUse =
      (before !== null && rule.before.includes(before) ? `"${before} ${ordinary}"` : null) ??
      (after !== null && rule.after.includes(after) ? `"${ordinary} ${after}"` : null);

    if (!brandAdjacent && !offered && ordinaryUse) {
      // "my dream car", "courage to ask", "service free": the English word, used as one.
      rejected.push({ carId: hit.car.id, matchedText, reason: `${ordinaryUse} is ordinary English, not the ${hit.car.name}` });
      continue;
    }

    if (hit.usedFuzzy && !brandAdjacent && !offered && !discussed) {
      // "dreams", "cream", "tree", "fashion": a different word that merely resembles the name.
      rejected.push({ carId: hit.car.id, matchedText, reason: `"${matchedText}" only resembles "${ordinary}"` });
      continue;
    }

    const rest = plain.filter((t) => t !== ordinary && !FILLERS.has(t) && !BRAND_WORDS.has(t));
    if (rest.length === 0) evidence.push("the word is the whole message");
    if (before !== null && POINTS_AT_A_CAR.has(before)) evidence.push(`"${before} ${ordinary}"`);
    const near = [tokens[first - 2], before, after, tokens[last + 2]].filter((t): t is string => typeof t === "string");
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
      mentions.push({ carId: hit.car.id, confidence: "strong", evidence, matchedText, fuzzy: hit.usedFuzzy });
    } else {
      mentions.push({ carId: hit.car.id, confidence: "weak", evidence: [`"${ordinary}" is an ordinary word and nothing says it is the car`], matchedText, fuzzy: hit.usedFuzzy });
    }
  }

  // "dream or taishan", "courage vs passion": a list with a car that is certainly meant makes the others cars too.
  if (mentions.some((m) => m.confidence === "strong") && mentions.some((m) => m.confidence === "weak")) {
    const listed = plain.some((t) => ["or", "vs", "versus", "and", "او", "أو", "و", "w", "aw"].includes(t));
    if (listed) for (const m of mentions) if (m.confidence === "weak") Object.assign(m, { confidence: "strong", evidence: ["named in a list with another car"] });
  }

  return { mentions, rejected };
}
