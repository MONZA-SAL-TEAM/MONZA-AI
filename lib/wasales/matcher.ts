/**
 * WhatsApp Sales — THE BRAIN.
 *
 * Pure, deterministic functions only: no Date, no random, no fetch, no DOM.
 * The exact same input always produces the exact same decision, so the
 * simulator on /sales IS the production logic — when the WhatsApp
 * Business number is connected, the webhook handler will call decide() with
 * real messages and act on the same answers previewed on screen.
 *
 * What it decides: when a BRAND-NEW number sends its FIRST message and that
 * message is clearly about EXACTLY ONE car, the system would send that car's
 * videos + brochure. Anything less certain is a hold — handed to a person.
 * The matching is typo-tolerant ("pasion l" still finds the Passion L) but
 * deliberately conservative: wrong-but-confident is the one failure mode this
 * file is built to never have.
 *
 * SOURCE AWARENESS: input.source says where the customer came from
 * ("facebook" | "instagram" | "website" | "direct"). Click-to-WhatsApp
 * buttons on Facebook/Instagram ads and the website's "chat with us" links
 * PREFILL the first message with text like "More information about the Voyah
 * Free please" — that prefill arrives as ordinary message text and counts as
 * car evidence exactly like words the customer typed themselves. No special
 * casing is needed: the matcher reads the words, wherever they came from.
 * The source is carried through for reporting only; it never changes the
 * decision.
 */

/* ---------------------------------------------------------------- types --- */

import type { WaColour } from "@/lib/wasales/colours";

export type { WaColour };

export type WaSource = "facebook" | "instagram" | "website" | "direct";

export interface WaAsset {
  label: string;
  fileName: string;
}

export interface WaCar {
  id: string;
  name: string;
  /** A switched-off car is invisible to the matcher entirely. */
  enabled: boolean;
  /**
   * Generous spelling variants and short names ("pasion", "dreem", "m hero",
   * "917"). Multi-word aliases are matched as whole phrases, in order.
   */
  aliases: string[];
  videos: WaAsset[];
  /**
   * The colours this model actually has material for. DISCOVERED from the
   * imported sales folder, never invented — an empty list means nothing has
   * been imported yet, and the flow holds rather than offering a colour it
   * cannot show.
   */
  colours: WaColour[];
  /** One brochure per car, sent whatever colour the customer picks — the
   *  brochure is not colour-specific. null = nothing uploaded yet. */
  brochure: WaAsset | null;
  oneLiner: string;
}

export interface ModelMatch {
  decision: "send" | "hold";
  model?: WaCar;
  confidence?: "exact" | "fuzzy";
  /** A plain-words sentence a salesperson can read out loud. */
  reason: string;
  /** The exact words from the message that identified the car. */
  matchedText?: string;
  /** When 2+ cars matched: their names, for the reason sentence. */
  contenders?: string[];
  /** When 2+ cars matched: their ids, so the flow can ask "which one?". */
  contenderIds?: string[];
}

export interface IncomingInput {
  text: string;
  /** Has this phone number ever messaged Monza before? */
  isNewNumber: boolean;
  /** Is this the first message of the conversation? */
  isFirstMessage: boolean;
  source: WaSource;
  /** The master switch on the control page. Off = nothing ever auto-sends. */
  autoSendEnabled: boolean;
}

export interface Decision {
  decision: "send" | "hold";
  model?: WaCar;
  confidence?: "exact" | "fuzzy";
  reason: string;
  matchedText?: string;
}

/* ------------------------------------------------------------ normalize --- */

/** Arabic letters that customers write interchangeably for the same word. */
const ARABIC_FOLD: Readonly<Record<string, string>> = {
  "ة": "ه", // taa marbuta: "سيارة" and "سياره" are one word
  "ى": "ي", // alef maksura
  "ی": "ي", // Persian yeh, arrives from some keyboards
  "ک": "ك", // Persian kaf
  "ـ": "", // tatweel, pure decoration: "مرحبـــا"
};

/** Arabic-Indic and extended Arabic-Indic digits: "٣١٨" is "318". */
function westernDigit(ch: string): string {
  const code = ch.charCodeAt(0);
  return String.fromCharCode(48 + (code >= 0x06f0 ? code - 0x06f0 : code - 0x0660));
}

/**
 * Lowercase, strip punctuation/emoji/symbols, collapse whitespace — WITHOUT
 * throwing away any script. "Pasion-L!!" and "pasion l 😍" both normalize to
 * "pasion l", and "سعر الكوراج؟" to "سعر الكوراج".
 *
 * Unicode-aware, in this order:
 *   1. NFKD, then every combining mark removed: "café" → "cafe", fullwidth
 *      letters → ASCII, and in Arabic the hamza and harakat fall away, which
 *      unifies أ إ آ → ا, ؤ → و, ئ → ي exactly the way people type them.
 *   2. Invisible format characters (ZWNJ, RLM, …) removed, never turned into
 *      a space — they sit INSIDE words.
 *   3. Arabic spelling variants folded (ة → ه, ى → ي) and Arabic-Indic digits
 *      made western, so "٣١٨" and "318" are the same token.
 *   4. Anything that is not a letter or digit in ANY script becomes a space.
 *
 * It used to keep only [a-z0-9], which turned every Arabic message into an
 * empty string — 3% of real first messages, and every one of them unreadable.
 * Arabizi ("se3er", "la2") survives either way: its digits are digits.
 *
 * Deterministic and total: any input string comes out as a clean token stream.
 */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/\p{Cf}+/gu, "")
    .toLowerCase()
    .replace(/[ةىیکـ]/g, (ch) => ARABIC_FOLD[ch] ?? ch)
    .replace(/[٠-٩۰-۹]/g, westernDigit)
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True for a token written in Arabic script. */
export function isArabicToken(token: string): boolean {
  return /[؀-ۿ]/.test(token);
}

/**
 * Arabic attaches "and", "the", "with the" to the front of a word: "والسعر",
 * "بالاسود", "الكوراج". The forms of a message token worth comparing: itself,
 * plus each attached prefix peeled off (longest first, and never down to a
 * single letter). Latin tokens have exactly one form.
 */
const ARABIC_PREFIXES = ["وبال", "وال", "بال", "فال", "كال", "لل", "ال", "و"];

export function wordForms(token: string): string[] {
  if (!isArabicToken(token)) return [token];
  const forms = [token];
  for (const prefix of ARABIC_PREFIXES) {
    if (token.startsWith(prefix) && token.length - prefix.length >= 2) {
      const rest = token.slice(prefix.length);
      if (!forms.includes(rest)) forms.push(rest);
    }
  }
  return forms;
}

/** Does a message token equal a vocabulary word, allowing Arabic prefixes? */
export function sameWord(vocabulary: string, token: string): boolean {
  return vocabulary === token || wordForms(token).includes(vocabulary);
}

/**
 * The tokens model matching works on: normalize(), then letters and digits
 * split apart, so "mhero1" reads as "mhero 1" and "2nd" as "2 nd". Customers
 * glue model numbers on as often as not, and an alias written "mhero 1" must
 * still find them. Applied to aliases too, so both sides always agree.
 *
 * Kept separate from normalize() on purpose: colour and greeting matching
 * include words like "3adi" that splitting would break.
 */
export function matchTokens(text: string): string[] {
  return normalize(text)
    .replace(/([a-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([a-z])/g, "$1 $2")
    .split(" ")
    .filter((t) => t !== "");
}

/**
 * Everyday phrases that contain a model's name without meaning the car.
 *
 * "free" is the reason this exists: it misfired once ("feel free to call me"
 * auto-sent a car), yet "is the free available?" is exactly how customers ask
 * for the Voyah Free. Rather than choose between the two, the words of these
 * phrases are blanked before matching, so "free" can be a real alias and
 * "feel free" still means nothing.
 */
const NOT_A_CAR_PHRASES = [
  "feel free",
  "for free",
  "free of charge",
  "free time",
  "free delivery",
  "free shipping",
  "free trial",
  "toll free",
  "tax free",
  "duty free",
  "hands free",
  "you free",
  "u free",
  "free to",
  "free today",
  "free tomorrow",
  "free now",
  // Offer wording (WhatsApp, 2026-09-16: a customer forwarded the Courage
  // offer's "2 years free maintenance" and was asked "Free 318 or Courage?").
  "free maintenance",
  "free service",
  "free servicing",
  "free insurance",
  "free registration",
  "free charging",
  "free charger",
  "free wallbox",
  "free installation",
  "free warranty",
  "free accessories",
  "interest free",
].map((p) => p.split(" "));

/**
 * Everyday words a typo-tolerant match would land on a car: "charge" is two
 * letters from the alias "corage" (2026-09-17: "how long to charge the dream"
 * answered for the Courage too). None of these is a car's name or alias.
 */
const NOT_A_CAR_WORDS = new Set([
  "charge", "charges", "charged", "charging", "charger", "chargers", "garage", "coverage",
  "courier", "courage's", "cream", "drum", "trim", "tree", "fashion", "mission", "session",
  "pension", "cushion", "passive", "drama", "fee", "fees", "freeze", "freed", "freely", "frame",
]);

/** Stands in for a blanked word; no alias token can ever equal or fuzz onto it. */
const BLANK = "·";

function blankOrdinaryPhrases(tokens: string[]): string[] {
  const out = tokens.map((t) => (NOT_A_CAR_WORDS.has(t) ? BLANK : t));
  for (const phrase of NOT_A_CAR_PHRASES) {
    for (let start = 0; start + phrase.length <= tokens.length; start++) {
      if (phrase.every((word, j) => tokens[start + j] === word)) {
        for (let j = 0; j < phrase.length; j++) out[start + j] = BLANK;
      }
    }
  }
  return out;
}

/* -------------------------------------------------------- edit distance --- */

/**
 * Bounded Levenshtein distance: insertions, deletions and substitutions each
 * cost 1. Returns the true distance when it is <= max, otherwise max + 1
 * (the caller only ever asks "is it within max?", so anything beyond can bail
 * out early — the row-minimum check keeps this O(len * max) in practice).
 */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev: number[] = [];
  let curr: number[] = [];
  for (let j = 0; j <= lb; j++) prev.push(j);
  for (let j = 0; j <= lb; j++) curr.push(0);
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1; // every path already too expensive
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[lb] <= max ? prev[lb] : max + 1;
}

/**
 * How much typo slack a catalog token earns:
 *   - 1–2 characters ("l", the L in Passion L) → 0. One edit on a one-letter
 *     token would match ANYTHING; the variant marker must be typed exactly.
 *   - digits-only ("917") → 0. "911" must never fuzzy-match the 917.
 *   - up to 5 characters ("free", "dream") → 1 edit.
 *   - longer ("passion", "courage") → 2 edits.
 *   - anything not Latin → 0. In Arabic script one letter apart is a
 *     different word far more often than a typo: "كاراج" (garage) is one
 *     edit from "كوراج" (Courage).
 */
function fuzzyAllowance(token: string): number {
  if (/[^a-z0-9]/.test(token)) return 0;
  if (token.length <= 2) return 0;
  if (/^[0-9]+$/.test(token)) return 0;
  return token.length <= 5 ? 1 : 2;
}

/* -------------------------------------------------------- model matching --- */

/** The best way one car matched the message — kept for shadow resolution. */
interface BestHit {
  car: WaCar;
  /** Message token indices the winning phrase covered, in order. */
  span: number[];
  score: number;
  usedFuzzy: boolean;
}

const HOLD_NO_CAR = "Couldn't tell which car — handed to your team.";

/** True when every index of `a` also appears in `b` and `b` is bigger. */
function isProperSubset(a: number[], b: number[]): boolean {
  return a.length < b.length && a.every((i) => b.includes(i));
}

function sameSpan(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((i, k) => i === b[k]);
}

/**
 * Which single car (if any) is the message clearly about?
 *
 * How the score works, in plain words:
 *   1. The message is normalized and split into tokens.
 *   2. Every ENABLED car offers its name + every alias as candidate phrases.
 *      A multi-word phrase ("voyah passion l", "m hero") must appear as
 *      CONSECUTIVE message tokens, in order.
 *   3. Each phrase token scores 100 for an exact hit, 60 for a fuzzy hit
 *      (within fuzzyAllowance edits). Longer phrases therefore always
 *      outscore their shorter prefixes: "passion l" (2 tokens) beats plain
 *      "passion" (1 token) whenever the l is present.
 *   4. Per car, only its single BEST hit survives.
 *   5. SHADOW RESOLUTION — most-specific-wins: a car whose matched message
 *      span is a proper subset of another car's span is dropped ("passion"
 *      inside "passion l" is evidence FOR the Passion L, not a second car).
 *      On the exact same span, a strictly lower score is dropped too (the
 *      Passion's exact "passion" beats the Passion L fuzzing "passionl" onto
 *      the same word) — so plain "passion" matches the Passion, and the
 *      variant only ever wins ON EVIDENCE of the variant token.
 *   6. Exactly one survivor → that car. Zero or 2+ → hold, with the reason
 *      spelled out.
 *
 * Confidence: "exact" when every matched word literally appears in the car's
 * real name ("passion", "917") — "fuzzy" when we tolerated a variation, via
 * edit distance ("pashon") or a typo alias ("pasion"). The reason sentence
 * says "typo-tolerant" in the fuzzy case so the salesperson knows the system
 * corrected a spelling.
 */
export function matchModel(text: string, catalog: readonly WaCar[]): ModelMatch {
  const tokens = blankOrdinaryPhrases(matchTokens(text));
  if (tokens.length === 0) {
    return { decision: "hold", reason: HOLD_NO_CAR };
  }

  const hits: BestHit[] = [];
  // Disabled cars STILL compete for the match. If they were dropped here, a
  // sibling model could silently claim their words (Passion disabled makes
  // "the passion" fuzzy-land on Passion L) and the customer would get the
  // WRONG car's material. The disabled check happens after resolution, in
  // decide(), where the honest answer is a hold — never a different car.
  for (const car of catalog) {
    const phrases: string[] = [];
    for (const p of [car.name, ...car.aliases]) {
      const n = matchTokens(p).join(" ");
      if (n !== "" && !phrases.includes(n)) phrases.push(n);
    }
    let best: BestHit | null = null;
    for (const phrase of phrases) {
      const pts = phrase.split(" ");
      for (let start = 0; start + pts.length <= tokens.length; start++) {
        let score = 0;
        let fuzzy = false;
        let ok = true;
        for (let j = 0; j < pts.length; j++) {
          const pt = pts[j];
          const mt = tokens[start + j];
          // sameWord: "الكوراج" (the Courage) is the alias "كوراج".
          if (sameWord(pt, mt)) {
            score += 100;
            continue;
          }
          const allow = fuzzyAllowance(pt);
          // A typo drops a letter, not half the word: "pass" (in "i will pass
          // by") is two letters short of the alias "passon" and is not a car.
          if (allow > 0 && mt.length >= pt.length - 1 && editDistance(pt, mt, allow) <= allow) {
            score += 60;
            fuzzy = true;
            continue;
          }
          ok = false;
          break;
        }
        if (!ok) continue;
        const span: number[] = [];
        for (let j = 0; j < pts.length; j++) span.push(start + j);
        if (
          !best ||
          score > best.score ||
          (score === best.score && span[0] < best.span[0])
        ) {
          best = { car, span, score, usedFuzzy: fuzzy };
        }
      }
    }
    if (best) hits.push(best);
  }

  if (hits.length === 0) {
    return { decision: "hold", reason: HOLD_NO_CAR };
  }

  // Most-specific-wins: drop hits shadowed by a stronger hit (step 5 above).
  const survivors = hits.filter(
    (a) =>
      !hits.some(
        (b) =>
          b !== a &&
          (isProperSubset(a.span, b.span) ||
            (sameSpan(a.span, b.span) && b.score > a.score))
      )
  );

  if (survivors.length >= 2) {
    const names = survivors.map((s) => s.car.name);
    return {
      decision: "hold",
      contenders: names,
      contenderIds: survivors.map((s) => s.car.id),
      reason: `Mentions more than one car (${names.join(" and ")}) — handed to your team.`,
    };
  }

  const win = survivors[0];
  const matchedText = win.span.map((i) => tokens[i]).join(" ");
  // "fuzzy" means a spelling was actually corrected. An exact alias hit
  // ("m hero 917" typed perfectly) is exact — telling the salesperson a
  // spelling was corrected when it wasn't would be a false sentence.
  const confidence: "exact" | "fuzzy" = win.usedFuzzy ? "fuzzy" : "exact";
  return {
    decision: "send",
    model: win.car,
    confidence,
    matchedText,
    reason:
      confidence === "exact"
        ? `Matched "${matchedText}" → ${win.car.name}.`
        : `Matched "${matchedText}" → ${win.car.name} — typo-tolerant.`,
  };
}

/* ------------------------------------------------------- greeting filter --- */

/**
 * Words that carry zero car information. A message made ONLY of these ("hi",
 * "hello good morning", "thanks!!") is small talk — a person says hello back.
 */
const GREETING_WORDS = new Set([
  "hi", "hii", "hiii", "hey", "heyy", "hello", "helo", "hellow",
  "good", "morning", "evening", "afternoon", "day", "night",
  "thanks", "thank", "thankyou", "thx", "you", "u",
  "please", "pls", "plz", "ok", "okay",
  "salam", "marhaba", "hala", "ahla", "bonjour", "salut", "merci",
  "kifak", "kifik", "how", "are", "there", "sir", "dear",
]);

/** True when the message has words but ALL of them are greeting/thanks words. */
export function isBareGreeting(text: string): boolean {
  const tokens = normalize(text).split(" ").filter((t) => t !== "");
  return tokens.length > 0 && tokens.every((t) => GREETING_WORDS.has(t));
}

/* -------------------------------------------------------- open enquiries --- */

/** Words that say "tell me about your cars" without naming one. */
const ENQUIRY_WORDS = new Set([
  "info", "infos", "information", "informations", "details", "detail",
  "interested", "interest", "car", "cars", "model", "models", "vehicle",
  "vehicles", "catalogue", "catalog", "brochure", "brochures", "lineup",
  "electric", "ev", "evs", "suv", "suvs", "options",
  "ma3loumet", "ma3lomet", "sayara", "sayyara", "voiture", "voitures",
]);

/** Words that carry no subject of their own — they only frame the enquiry. */
const FILLER_WORDS = new Set([
  "i", "im", "m", "d", "s", "me", "my", "we", "a", "an", "the", "some", "any",
  "about", "on", "of", "for", "in", "to", "is", "it", "its", "can", "could",
  "would", "will", "get", "have", "has", "do", "does", "your", "what",
  "which", "want", "wanted", "like", "need", "know", "more", "send", "see",
  "show", "tell", "am", "and", "or", "new", "all", "yes", "just", "also",
]);

/**
 * "Hi, can I get more information?" — a new customer asking about the cars
 * without naming one. The flow answers it with "which model are you
 * interested in?".
 *
 * Deliberately narrow: EVERY word must be an enquiry, filler or greeting
 * word, and at least one must be an enquiry word. "What time do you open
 * tomorrow?" and "how much is it?" are real questions a person should
 * answer, and replying to them with a model list would ignore what they asked.
 */
export function isOpenEnquiry(text: string): boolean {
  const tokens = normalize(text).split(" ").filter((t) => t !== "");
  let sawEnquiry = false;
  for (const t of tokens) {
    if (ENQUIRY_WORDS.has(t)) {
      sawEnquiry = true;
      continue;
    }
    if (FILLER_WORDS.has(t) || GREETING_WORDS.has(t)) continue;
    return false;
  }
  return sawEnquiry;
}

/* ----------------------------------------------------------- the families --- */

/**
 * The cars of a brand the message names WITHOUT naming a model — "the
 * mhero", "voyah?" — in catalogue order, so the flow can ask "which one?".
 *
 * A family is a first word shared by two or more cars, discovered from the
 * catalogue rather than listed here: Mhero 1 and Mhero 2 make "mhero" a
 * family, and a third Mhero would join it. Only consulted when matchModel
 * found no car, so "voyah passion" is still the Passion and never the line.
 */
export function familyMentioned(text: string, catalog: readonly WaCar[]): WaCar[] {
  const tokens = blankOrdinaryPhrases(matchTokens(text));
  // "m hero" is one word typed with a space.
  const words = [...tokens];
  for (let i = 0; i + 1 < tokens.length; i++) {
    if (tokens[i].length === 1) words.push(tokens[i] + tokens[i + 1]);
  }

  const families = new Map<string, WaCar[]>();
  for (const car of catalog) {
    const first = matchTokens(car.name)[0];
    if (!first) continue;
    const members = families.get(first) ?? [];
    members.push(car);
    families.set(first, members);
  }

  const out: WaCar[] = [];
  for (const [word, members] of families) {
    if (members.length < 2) continue;
    const allow = fuzzyAllowance(word);
    const named = words.some(
      (t) => t === word || (allow > 0 && editDistance(word, t, allow) <= allow)
    );
    if (named) out.push(...members);
  }
  return out;
}

/** Ways of pointing at the Nth car offered: "the second", "2nd". */
const ORDINALS: readonly (readonly string[])[] = [
  ["the first", "first one", "1 st"],
  ["the second", "second one", "2 nd"],
  ["the third", "third one", "3 rd"],
];

function containsRun(tokens: readonly string[], run: readonly string[]): boolean {
  for (let s = 0; s + run.length <= tokens.length; s++) {
    if (run.every((w, j) => tokens[s + j] === w)) return true;
  }
  return false;
}

/**
 * Which of the cars we just offered did the reply pick? After "the Mhero 1 or
 * the Mhero 2?", the answers "2", "2nd" and "the second one" name no model
 * but are perfectly clear. Returns null unless exactly ONE candidate is
 * picked.
 *
 * The caller runs the full matcher FIRST, so a reply naming a different car
 * ("actually the dream") still finds it; this only reads what tells the
 * candidates apart.
 */
export function pickAmong(text: string, candidates: readonly WaCar[]): WaCar | null {
  if (candidates.length < 2) return null;
  const tokens = matchTokens(text);
  const names = candidates.map((c) => matchTokens(c.name));
  const shared = names[0].filter((t) => names.every((n) => n.includes(t)));

  const picked = new Set<WaCar>();
  candidates.forEach((car, i) => {
    const distinct = names[i].filter((t) => !shared.includes(t));
    if (distinct.length > 0 && containsRun(tokens, distinct)) picked.add(car);
    const ordinal = ORDINALS[i];
    // Only a short reply points by position: "the first one" does, "what about
    // the first payment" does not (WhatsApp, 2026-09-16: it sent the Free 318).
    if (ordinal && tokens.length <= 4 && ordinal.some((p) => containsRun(tokens, p.split(" ")))) {
      picked.add(car);
    }
  });
  return picked.size === 1 ? [...picked][0] : null;
}

/* ------------------------------------------------------------ the guards --- */

function hold(reason: string): Decision {
  return { decision: "hold", reason };
}

/**
 * decide() — THE GUARD RAILS, checked in order. Every hold carries a plain
 * sentence saying why. The order matters and is deliberate:
 *
 *   (1) Master auto-send switched off        → hold. The owner's kill switch
 *       beats everything.
 *   (2) The number is NOT new                → hold. "This person already has
 *       a conversation — your team replies." The robot never barges into a
 *       relationship a human is having.
 *   (3) Not the first message of the thread  → hold. Once talking has
 *       started, people talk.
 *   (4) Zero cars matched                    → hold. Special case first: a
 *       bare greeting ("hi") gets the greeting reason (guard 6 — it can only
 *       ever fire when no car matched, so it lives inside this branch);
 *       otherwise "couldn't tell which car".
 *   (5) TWO OR MORE cars matched             → hold. "Mentions more than one
 *       car" — a comparison question deserves a human answer.
 *   (6) (folded into 4 — see above.)
 *   (7) The matched car is missing a video or its brochure → hold. Nothing
 *       goes out half-empty.
 *
 * Only when every guard passes: decision "send", with the one matched car —
 * the caller lists its videos + brochure as what WOULD go out. This module
 * never sends anything; it only ever answers the question.
 */
export function decide(input: IncomingInput, catalog: readonly WaCar[]): Decision {
  // (1) master switch
  if (!input.autoSendEnabled) {
    return hold(
      "Auto-send is switched off — nothing goes out automatically until you turn it back on."
    );
  }
  // (2) known number
  if (!input.isNewNumber) {
    return hold(
      "This person already has a conversation with Monza — your team replies, the auto-sender stays quiet."
    );
  }
  // (3) not the first message
  if (!input.isFirstMessage) {
    return hold(
      "Not their first message — once a conversation has started, your team replies."
    );
  }
  // (4) + (5) + (6): what is the message about?
  const m = matchModel(input.text, catalog);
  if (m.decision === "hold") {
    if (!m.contenders && isBareGreeting(input.text)) {
      return hold(
        "Just a greeting, no car mentioned — a person should say hello back."
      );
    }
    return hold(m.reason);
  }
  // (7) the matched car must be switched on…
  const car = m.model as WaCar;
  if (!car.enabled) {
    return hold(
      `Matched ${car.name}, but its auto-send is switched off — handed to your team.`
    );
  }
  // …and must actually have its material
  const missing: string[] = [];
  if (car.videos.length === 0) missing.push("videos");
  if (!car.brochure) missing.push("brochure");
  if (missing.length > 0) {
    return hold(
      `Matched ${car.name}, but it is missing its ${missing.join(" and ")} — nothing goes out half-empty; handed to your team.`
    );
  }
  return {
    decision: "send",
    model: car,
    confidence: m.confidence,
    matchedText: m.matchedText,
    reason: m.reason,
  };
}
