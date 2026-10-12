/**
 * The OBSERVER: what one customer message says, as typed facts (lib/wasales/signal.ts keeps the
 * message-level labels; this keeps the facts inside it). Pure; no database; never the words.
 *
 *   model   named / compared / wants / rejects — STRONG mentions only (entities.ts), wherever the
 *           customer's own words name the car. A weak "dream" is never a fact.
 *   colour  wants / asked / rejects / no_preference, exterior or interior, TIED to a car: the nearest
 *           car in the same clause, else the only car named, else the car of the conversation, else
 *           the ad's car, else none — and how it was tied (`binding`) is kept, so a page can count
 *           only the certain ones.
 *   concern safety, battery life, battery replacement, charging cost, kept waiting (from intents).
 *   profile budget, timeline, purpose, city, other brands, trade-in, financing, needs, concerns in the
 *           customer's words (observe-profile.ts).
 *
 * Colours are read against the WORKBOOK's colour names and the colour families — never the media
 * library, so uploading a video can never change what history says.
 *
 * Samer, 2026-10-12: "I want to know all data of clients and leads … what they most like: colour, car
 * model and more." Tested in tests/insights-reader.test.ts and tests/insights-colour.test.ts.
 */

import { negatedAt } from "@/lib/wasales/classify";
import { resolveModels } from "@/lib/wasales/entities";
import type { EngineDecision } from "@/lib/wasales/engine";
import { vocabularyWords } from "@/lib/wasales/intent";
import { modelByCatalogueId, modelByCode, type ModelCode, type SalesKnowledge } from "@/lib/wasales/knowledge";
import { matchTokens, sameWord, type WaCar } from "@/lib/wasales/matcher";
import { observeProfile } from "@/lib/wasales/observe-profile";
import type { SearchEngineState } from "@/lib/wasales/context";
import {
  BUT_AFTER,
  COLOUR_FAMILIES,
  COLOUR_NAME_WORDS,
  COLOUR_TOPIC_WORDS,
  EXCEPT_WORDS,
  EXTERIOR_MARKERS,
  INTERIOR_MARKERS,
  NO_PREFERENCE_PHRASES,
  WANT_WORDS,
} from "@/lib/wasales/observe-lexicon";

export type ObservationKind = "model" | "colour" | "budget" | "timeline" | "purpose" | "city" | "competitor" | "trade_in" | "financing" | "need" | "concern";
export type Stance = "named" | "compared" | "wants" | "asked" | "rejects" | "no_preference" | "owns" | "trading_in" | "mentioned";
export type Binding = "same_clause" | "only_car_named" | "conversation" | "ad" | "none";

export interface Observation {
  kind: ObservationKind;
  stance: Stance | null;
  model: ModelCode | null;
  binding: Binding | null;
  part: "exterior" | "interior" | null;
  /** A closed-vocabulary key: `^[a-z0-9_]{1,40}$`. */
  value: string;
  /** The workbook's colour name ("Pearl Black") or a currency; letters, digits and spaces only. */
  detail: string | null;
  amountMin: number | null;
  amountMax: number | null;
  currency: "USD" | "LBP" | "EUR" | null;
  amountKind: "total" | "monthly" | "down_payment" | null;
  months: number | null;
  /** Which rule produced it: evidence for staff and tests. */
  rule: string;
}

export interface ObserveContext {
  knowledge: SalesKnowledge;
  /** The catalogue (engineCars): names and aliases to find a car in the words. */
  cars: readonly WaCar[];
  /** The conversation memory BEFORE this message: the car being discussed, the ad's car. */
  before: SearchEngineState;
}

const VOCABULARY = vocabularyWords();

export function blank(kind: ObservationKind, value: string, rule: string, extra: Partial<Observation> = {}): Observation {
  return { kind, stance: null, model: null, binding: null, part: null, value, detail: null, amountMin: null, amountMax: null, currency: null, amountKind: null, months: null, rule, ...extra };
}

/* ── Words, by clause ─────────────────────────────────────────────────────── */

export interface Clause {
  tokens: string[];
}

/** The message in clauses (a comma, a full stop, a question mark ends one), each in match tokens. */
export function clausesOf(text: string): Clause[] {
  return text
    .split(/[,.;!?؟،\n]+|\s[-–—]\s/)
    .map((part) => ({ tokens: matchTokens(part) }))
    .filter((c) => c.tokens.length > 0);
}

const has = (list: readonly string[], token: string) => list.some((w) => sameWord(w, token));

function phraseAt(tokens: readonly string[], phrase: string): number {
  const words = matchTokens(phrase);
  if (words.length === 0) return -1;
  for (let i = 0; i + words.length <= tokens.length; i++) {
    if (words.every((w, j) => sameWord(w, tokens[i + j]))) return i;
  }
  return -1;
}

/* ── Cars ─────────────────────────────────────────────────────────────────── */

interface CarSpot {
  code: ModelCode;
  clause: number;
  at: number;
}

/** Where each strongly named car stands in the clauses. */
function carSpots(text: string, clauses: readonly Clause[], ctx: ObserveContext): CarSpot[] {
  const k = ctx.knowledge;
  const idOf = (code: ModelCode | null) => (code ? (modelByCode(k, code)?.catalogueId ?? null) : null);
  const s = ctx.before;
  const resolution = resolveModels(text, ctx.cars, {
    offeredCarIds: [],
    discussedCarIds: [s.activeModel, ...s.selectedModels, ...s.recentModels].map(idOf).filter((id): id is string => id !== null),
    adCarId: idOf(s.adModel),
    intentWords: VOCABULARY.single,
    carTalkWords: VOCABULARY.carTalk,
  });
  const spots: CarSpot[] = [];
  for (const m of resolution.mentions) {
    if (m.confidence !== "strong") continue;
    const code = modelByCatalogueId(k, m.carId)?.code;
    if (!code || spots.some((x) => x.code === code)) continue;
    let found: CarSpot | null = null;
    clauses.forEach((c, ci) => {
      if (found) return;
      const at = phraseAt(c.tokens, m.matchedText);
      if (at >= 0) found = { code, clause: ci, at };
    });
    spots.push(found ?? { code, clause: 0, at: 0 });
  }
  return spots;
}

/* ── Colours ──────────────────────────────────────────────────────────────── */

interface ColourSpot {
  family: string;
  /** A word only an official name carries ("sage"). */
  nameWord: string | null;
  clause: number;
  at: number;
}

function colourSpots(clauses: readonly Clause[]): ColourSpot[] {
  const out: ColourSpot[] = [];
  clauses.forEach((c, ci) => {
    c.tokens.forEach((t, i) => {
      const family = Object.keys(COLOUR_FAMILIES).find((f) => has(COLOUR_FAMILIES[f], t));
      if (family) {
        // "sage green": one colour, not two — the name word before it joins it.
        const prev = out[out.length - 1];
        if (prev && prev.clause === ci && prev.at === i - 1 && prev.nameWord && !prev.family) {
          prev.family = family;
          return;
        }
        out.push({ family, nameWord: null, clause: ci, at: i });
        return;
      }
      if (COLOUR_NAME_WORDS.includes(t)) out.push({ family: "", nameWord: t, clause: ci, at: i });
    });
  });
  return out;
}

/** The workbook's colour name for this car, when the words pick exactly one. */
function officialName(k: SalesKnowledge, code: ModelCode | null, spot: ColourSpot): { name: string; family: string } | null {
  const names = code ? (modelByCode(k, code)?.colourNames ?? []) : [];
  const familyOf = (name: string) => Object.keys(COLOUR_FAMILIES).find((f) => name.toLowerCase().split(" ").some((w) => COLOUR_FAMILIES[f].includes(w))) ?? "";
  if (spot.nameWord) {
    const hits = names.filter((n) => n.toLowerCase().split(" ").includes(spot.nameWord as string));
    if (hits.length === 1) return { name: hits[0], family: familyOf(hits[0]) };
    return null;
  }
  const inFamily = names.filter((n) => familyOf(n) === spot.family);
  return inFamily.length === 1 ? { name: inFamily[0], family: spot.family } : null;
}

function within(c: Clause, at: number, words: readonly string[], back: number, ahead: number): boolean {
  for (let i = Math.max(0, at - back); i <= Math.min(c.tokens.length - 1, at + ahead); i++) {
    if (i !== at && has(words, c.tokens[i])) return true;
  }
  return false;
}

function stanceOf(c: Clause, at: number, otherColourAts: readonly number[]): Stance {
  // Rejection first: a negator before it, or "except / ella / غير" right before it.
  if (negatedAt(c.tokens, at, otherColourAts)) return "rejects";
  for (let i = Math.max(0, at - 3); i < at; i++) {
    const t = c.tokens[i];
    if (has(EXCEPT_WORDS, t) && !otherColourAts.some((o) => o > i && o < at)) return "rejects";
    if (t === "but" && i > 0 && BUT_AFTER.includes(c.tokens[i - 1])) return "rejects";
    if (t === "other" && c.tokens[i + 1] === "than") return "rejects";
  }
  // A wish: a want-word in the four words before it, with no other colour in between.
  for (let i = Math.max(0, at - 4); i < at; i++) {
    if (has(WANT_WORDS, c.tokens[i]) && !otherColourAts.some((o) => o > i && o < at)) return "wants";
  }
  return "asked";
}

/** Only colour words (and fillers): "black", "el abyad please" — an answer, a wish. */
const FILLER = new Set(["the", "a", "an", "el", "al", "l", "one", "please", "pls", "plz", "colour", "color", "lon", "ok", "yes", "eh", "ال", "لون", "اللون"]);

function partOf(c: Clause, at: number): "exterior" | "interior" {
  if (within(c, at, EXTERIOR_MARKERS, 3, 3)) return "exterior";
  return within(c, at, INTERIOR_MARKERS, 3, 3) ? "interior" : "exterior";
}

/* ── The observer ─────────────────────────────────────────────────────────── */

export function observe(text: string, d: EngineDecision, ctx: ObserveContext): Observation[] {
  if (d.outcome === "EXCLUDED") return [];
  const k = ctx.knowledge;
  const u = d.understanding;
  const out: Observation[] = [];
  const clauses = clausesOf(text);
  const cars = carSpots(text, clauses, ctx);

  // 1. Cars.
  const comparing = u.intents.includes("COMPARE") && cars.length >= 2;
  for (const car of cars) {
    const c = clauses[car.clause];
    const others = cars.filter((x) => x !== car && x.clause === car.clause).map((x) => x.at);
    let stance: Stance = "named";
    let rule = "model.named";
    if (c && negatedAt(c.tokens, car.at, others)) {
      stance = "rejects";
      rule = "model.negated";
    } else if (comparing) {
      stance = "compared";
      rule = "model.compare";
    } else if (c && c.tokens.slice(Math.max(0, car.at - 4), car.at).some((t) => has(WANT_WORDS, t))) {
      stance = "wants";
      rule = "model.want_verb";
    }
    out.push(blank("model", car.code.toLowerCase(), rule, { stance, model: car.code, binding: "same_clause" }));
  }

  // 2. Colours.
  const spots = colourSpots(clauses);
  const contextCar: ModelCode | null =
    ctx.before.activeModel ?? (ctx.before.selectedModels.length === 1 ? ctx.before.selectedModels[0] : null);
  const onlyColours =
    spots.length > 0 &&
    clauses.every((c, ci) => c.tokens.every((t, i) => spots.some((s) => s.clause === ci && s.at === i) || FILLER.has(t) || cars.some((x) => x.clause === ci && x.at === i)));
  for (const spot of spots) {
    const c = clauses[spot.clause];
    const sameClause = cars
      .filter((x) => x.clause === spot.clause && Math.abs(x.at - spot.at) <= 4)
      .sort((a, b) => Math.abs(a.at - spot.at) - Math.abs(b.at - spot.at))[0];
    let model: ModelCode | null = null;
    let binding: Binding = "none";
    if (sameClause) {
      model = sameClause.code;
      binding = "same_clause";
    } else if (cars.length === 1) {
      model = cars[0].code;
      binding = "only_car_named";
    } else if (cars.length === 0 && contextCar) {
      model = contextCar;
      binding = "conversation";
    } else if (cars.length === 0 && ctx.before.adModel) {
      model = ctx.before.adModel;
      binding = "ad";
    }
    const official = officialName(k, model, spot);
    const family = spot.family || official?.family || "";
    if (!family) continue; // "sage" with no car to say which green: not a colour fact.
    const others = spots.filter((s) => s !== spot && s.clause === spot.clause).map((s) => s.at);
    let stance = stanceOf(c, spot.at, others);
    if (stance === "asked" && onlyColours) stance = "wants";
    const part = partOf(c, spot.at);
    out.push(
      blank("colour", family, `colour.${stance}${part === "interior" ? ".interior" : ""}`, {
        stance,
        model,
        binding,
        part,
        detail: part === "exterior" && official ? official.name : null,
      })
    );
  }

  // 3. "Any colour is fine" — only when the message is about colour.
  const words = clauses.flatMap((c) => c.tokens);
  const aboutColour = u.intents.includes("COLOUR") || words.some((t) => has(COLOUR_TOPIC_WORDS, t));
  if (aboutColour && spots.length === 0 && NO_PREFERENCE_PHRASES.some((p) => phraseAt(words, p) >= 0)) {
    const model = cars.length === 1 ? cars[0].code : cars.length === 0 ? contextCar : null;
    out.push(blank("colour", "any", "colour.no_preference", { stance: "no_preference", model, binding: model ? (cars.length === 1 ? "only_car_named" : "conversation") : "none", part: "exterior" }));
  }

  // 4. Concerns the engine already names.
  const CONCERN: Readonly<Record<string, string>> = { SAFETY: "safety", BATTERY_LIFE: "battery_life", BATTERY_REPLACEMENT: "battery_replacement", CHARGING_COST: "charging_cost", WAITING_COMPLAINT: "kept_waiting" };
  for (const i of u.intents) {
    const value = CONCERN[i];
    if (value) out.push(blank("concern", value, `concern.intent.${value}`, { stance: "mentioned" }));
  }

  // 5. Who they are and what they need: budget, timeline, purpose, city, other brands, trade-in,
  //    financing, needs, concerns (observe-profile.ts).
  out.push(...observeProfile(text, d));

  return dedupe(out);
}

function dedupe(items: readonly Observation[]): Observation[] {
  const seen = new Set<string>();
  return items.filter((o) => {
    const key = `${o.kind}|${o.value}|${o.stance}|${o.model}|${o.part}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
