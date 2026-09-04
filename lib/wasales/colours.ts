/**
 * Colour recognition for the sales auto-responder.
 *
 * Same discipline as the model matcher: pure, deterministic, and conservative.
 * Sending someone the wrong colour is a smaller mistake than sending the wrong
 * car, but it is still a mistake a person would not make, so a colour only
 * matches on real evidence.
 *
 * What is matched:
 *   - the colour's own name and aliases, as whole words
 *   - typo tolerance, on the same allowance rule as the model matcher
 *   - "any" / "whatever you have" / "you choose" as an explicit NO PREFERENCE,
 *     which is a real answer and must not read as "did not understand"
 *
 * What is deliberately NOT matched: a colour mentioned about something else
 * ("my black phone"), because the flow only asks this question right after
 * asking it, and the customer's reply is about the car.
 */

import { editDistance, normalize } from "@/lib/wasales/matcher";

export interface WaColour {
  /** Stable id, used in storage paths: lowercase, digits and hyphens. */
  id: string;
  /** As shown to the customer: "Obsidian Black". */
  name: string;
  /** Spelling variants and short forms: "black", "noir", "aswad". */
  aliases: string[];
}

/** How the customer answered the colour question. */
export type ColourAnswer =
  /** They named exactly one colour we have. */
  | { kind: "one"; colour: WaColour; matchedText: string; fuzzy: boolean }
  /** They said any / whatever / you choose — a real answer, not a failure. */
  | { kind: "no_preference"; matchedText: string }
  /** They named more than one, so a person should ask which. */
  | { kind: "several"; colours: WaColour[] }
  /** They named a colour we do not have for this car. */
  | { kind: "unavailable"; asked: string }
  /** Nothing colour-shaped in the message at all. */
  | { kind: "none" };

/**
 * Ways of saying "I don't mind". These are answers, and the flow treats them
 * as permission to pick — asking a second time would be rude.
 */
const NO_PREFERENCE = [
  "any",
  "anyone",
  "any one",
  "any colour",
  "any color",
  "anything",
  "whatever",
  "whatever you have",
  "you choose",
  "you decide",
  "up to you",
  "as you like",
  "no preference",
  "doesnt matter",
  "does not matter",
  "dont care",
  "do not care",
  "all",
  "all of them",
  "everything",
  "surprise me",
  "3adi",
  "aadi",
  "mafi farkr",
  "ma bhem",
  "kelon",
  "kello",
  "nimporte",
  "peu importe",
];

/**
 * Colour words that are NOT in our catalogue but are clearly colours. Used to
 * tell "asked for a colour we don't stock" apart from "said something that
 * wasn't a colour" — the first deserves an honest "we don't have that", the
 * second deserves the question again.
 */
const KNOWN_COLOUR_WORDS = [
  "black", "white", "grey", "gray", "silver", "blue", "red", "green",
  "yellow", "orange", "purple", "brown", "beige", "gold", "bronze", "pink",
  "noir", "blanc", "gris", "bleu", "rouge", "vert",
  "aswad", "abyad", "ahmar", "azrak", "akhdar", "asfar", "rmadi",
];

/** Same allowance rule as the model matcher: short words get less slack. */
function fuzzyAllowance(token: string): number {
  if (token.length <= 3) return 0;
  return token.length <= 5 ? 1 : 2;
}

/** Does this phrase appear in the token stream, allowing typos? */
function phraseHit(
  tokens: string[],
  phrase: string
): { span: number[]; fuzzy: boolean } | null {
  const parts = normalize(phrase).split(" ").filter((p) => p !== "");
  if (parts.length === 0) return null;

  for (let start = 0; start + parts.length <= tokens.length; start++) {
    let fuzzy = false;
    let ok = true;
    for (let j = 0; j < parts.length; j++) {
      const want = parts[j];
      const got = tokens[start + j];
      if (want === got) continue;
      const allow = fuzzyAllowance(want);
      if (allow > 0 && editDistance(want, got, allow) <= allow) {
        fuzzy = true;
        continue;
      }
      ok = false;
      break;
    }
    if (!ok) continue;
    const span: number[] = [];
    for (let j = 0; j < parts.length; j++) span.push(start + j);
    return { span, fuzzy };
  }
  return null;
}

/**
 * Read a colour answer out of a message, given the colours this car has.
 *
 * Order matters. "No preference" is checked BEFORE colour names, because
 * "any colour" contains the word "colour" and some catalogues name a colour
 * "Any-thing"-adjacent; an explicit no-preference must never be mistaken for a
 * partial colour match.
 */
export function readColourAnswer(
  text: string,
  colours: readonly WaColour[]
): ColourAnswer {
  const tokens = normalize(text).split(" ").filter((t) => t !== "");
  if (tokens.length === 0) return { kind: "none" };

  // 1. An explicit "I don't mind".
  for (const phrase of NO_PREFERENCE) {
    const hit = phraseHit(tokens, phrase);
    if (hit) {
      return {
        kind: "no_preference",
        matchedText: hit.span.map((i) => tokens[i]).join(" "),
      };
    }
  }

  // 2. Colours we actually have. Longest phrase wins, so "obsidian black"
  //    beats a bare "black" when both are aliases of different colours.
  interface Hit {
    colour: WaColour;
    span: number[];
    fuzzy: boolean;
  }
  const hits: Hit[] = [];
  for (const colour of colours) {
    let best: Hit | null = null;
    for (const phrase of [colour.name, ...colour.aliases]) {
      const hit = phraseHit(tokens, phrase);
      if (!hit) continue;
      if (
        !best ||
        hit.span.length > best.span.length ||
        (hit.span.length === best.span.length && !hit.fuzzy && best.fuzzy)
      ) {
        best = { colour, span: hit.span, fuzzy: hit.fuzzy };
      }
    }
    if (best) hits.push(best);
  }

  // Most-specific-wins, exactly as the model matcher does it: a hit whose span
  // sits inside another hit's span is evidence FOR that longer one, not a
  // second colour.
  const survivors = hits.filter(
    (a) =>
      !hits.some(
        (b) =>
          b !== a &&
          a.span.length < b.span.length &&
          a.span.every((i) => b.span.includes(i))
      )
  );

  if (survivors.length === 1) {
    const win = survivors[0];
    return {
      kind: "one",
      colour: win.colour,
      matchedText: win.span.map((i) => tokens[i]).join(" "),
      fuzzy: win.fuzzy,
    };
  }
  if (survivors.length > 1) {
    return { kind: "several", colours: survivors.map((s) => s.colour) };
  }

  // 3. A colour word we simply do not have for this car.
  for (const word of KNOWN_COLOUR_WORDS) {
    const hit = phraseHit(tokens, word);
    if (hit) {
      return { kind: "unavailable", asked: hit.span.map((i) => tokens[i]).join(" ") };
    }
  }

  return { kind: "none" };
}

/** Colours of this car that actually have a video to send. */
export function sendableColours(
  colours: readonly WaColour[],
  videosByColour: Readonly<Record<string, number>>
): WaColour[] {
  return colours.filter((c) => (videosByColour[c.id] ?? 0) > 0);
}

/**
 * Which colour to send when the customer has no preference.
 *
 * The FIRST sendable colour in the catalogue order, so the choice is the
 * showroom's (put your best colour first) and is identical every time — never
 * random, or two customers asking the same thing get different answers and
 * nobody can reproduce a complaint.
 */
export function defaultColour(
  colours: readonly WaColour[],
  videosByColour: Readonly<Record<string, number>>
): WaColour | null {
  return sendableColours(colours, videosByColour)[0] ?? null;
}

/** "Black, White or Grey" — for the question we ask the customer. */
export function listColourNames(colours: readonly WaColour[]): string {
  const names = colours.map((c) => c.name);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}
