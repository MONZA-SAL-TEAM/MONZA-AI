/**
 * The words that name each car, as stable KEYS — for "How customers describe our cars" (Samer,
 * 2026-10-12). A key is made from a DICTIONARY word (catalogue names, aliases, CUSTOMER_WORDS), never
 * from a customer's text: the insights keep "they said كوريج" as the key of our own dictionary entry.
 * A misspelling the matcher tolerated is kept as "fuzzy" with no text at all.
 *
 * Pure. Latin keys are readable ("m_hero_917"); Arabic and other scripts get a short stable hash.
 */

import { matchTokens } from "@/lib/wasales/matcher";
import type { WaCar } from "@/lib/wasales/matcher";

export interface AliasEntry {
  key: string;
  /** The dictionary word itself (ours, not a customer's). */
  text: string;
  carId: string;
  script: "latin" | "arabic" | "digits";
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (const ch of s) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** A dictionary word as a closed-vocabulary key (`^[a-z0-9_]{1,40}$`). */
export function aliasKey(text: string): string {
  const norm = matchTokens(text).join(" ");
  if (/^[a-z0-9 ]+$/.test(norm)) return norm.replace(/ /g, "_").slice(0, 40) || "x";
  return `u_${fnv1a(norm)}`;
}

function scriptOf(norm: string): AliasEntry["script"] {
  if (/^[0-9 ]+$/.test(norm)) return "digits";
  return /[؀-ۿ]/.test(norm) ? "arabic" : "latin";
}

/** Every dictionary word that names a car, once each. */
export function aliasIndex(cars: readonly WaCar[]): AliasEntry[] {
  const out = new Map<string, AliasEntry>();
  for (const car of cars) {
    for (const word of [car.name, ...car.aliases]) {
      const norm = matchTokens(word).join(" ");
      if (!norm) continue;
      const key = aliasKey(word);
      if (!out.has(key)) out.set(key, { key, text: word, carId: car.id, script: scriptOf(norm) });
    }
  }
  return [...out.values()];
}

/** The dictionary entry a mention's words are, or null (a tolerated misspelling). */
export function aliasOf(matchedText: string, index: readonly AliasEntry[]): AliasEntry | null {
  const key = aliasKey(matchedText);
  return index.find((a) => a.key === key) ?? null;
}
