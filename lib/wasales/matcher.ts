/**
 * WhatsApp Sales — THE BRAIN.
 *
 * Pure, deterministic functions only: no Date, no random, no fetch, no DOM.
 * The exact same input always produces the exact same decision, so the
 * simulator on /whatsapp-sales IS the production logic — when the WhatsApp
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
  /** null = no brochure uploaded yet — the car can never auto-send. */
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

/**
 * Lowercase, strip punctuation/emoji/symbols, collapse whitespace. Everything
 * that is not a latin letter, digit or space becomes a space, so "Pasion-L!!"
 * and "pasion l 😍" both normalize to "pasion l". Deterministic and total:
 * any input string comes out as a clean lowercase token stream.
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
 */
function fuzzyAllowance(token: string): number {
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
export function matchModel(text: string, catalog: WaCar[]): ModelMatch {
  const tokens = normalize(text).split(" ").filter((t) => t !== "");
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
      const n = normalize(p);
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
          if (pt === mt) {
            score += 100;
            continue;
          }
          const allow = fuzzyAllowance(pt);
          if (allow > 0 && editDistance(pt, mt, allow) <= allow) {
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
export function decide(input: IncomingInput, catalog: WaCar[]): Decision {
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
