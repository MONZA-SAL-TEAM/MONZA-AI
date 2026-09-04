/**
 * How a search box behaves, defined once.
 *
 * Staff look people up two ways: by name, or by number. Those want different
 * treatment, and getting the split wrong is what makes a search box feel
 * broken:
 *
 *  - A NUMBER query must ignore punctuation, so "+961 3 100 001" finds a
 *    record stored as "9613100001".
 *  - A number query must NOT fall through to a text match, or "96" matches
 *    every Lebanese number in the list.
 *  - Two digits identify nobody, so a query that short matches nothing rather
 *    than everything.
 *
 * This lived in two places (customer lookup and conversation lookup) and had
 * already drifted between them. One definition now.
 */

/** Fewer digits than this cannot usefully identify anyone. */
export const MIN_PHONE_DIGITS = 3;

export type SearchIntent =
  /** Nothing typed — everything matches. */
  | { kind: "empty" }
  /** Digits and phone punctuation only, long enough to mean something. */
  | { kind: "number"; digits: string }
  /** Digits and phone punctuation, but too short to identify anyone. */
  | { kind: "number_too_short" }
  /** Anything else: a name, a handle, a word. */
  | { kind: "text"; text: string };

/** What is this person trying to look up? */
export function searchIntent(raw: string | undefined): SearchIntent {
  const q = (raw ?? "").trim().toLowerCase();
  if (q === "") return { kind: "empty" };

  const digits = q.replace(/\D/g, "");
  const looksLikeANumber = digits.length > 0 && /^[\d\s+()./-]+$/.test(q);
  if (looksLikeANumber) {
    return digits.length < MIN_PHONE_DIGITS
      ? { kind: "number_too_short" }
      : { kind: "number", digits };
  }
  return { kind: "text", text: q };
}

/** Does a stored number contain the searched digits, ignoring punctuation? */
export function numberContains(stored: string | null, digits: string): boolean {
  if (!stored) return false;
  return stored.replace(/\D/g, "").includes(digits);
}

/** Case-insensitive substring, safe on null. */
export function textContains(stored: string | null, needle: string): boolean {
  if (!stored) return false;
  return stored.toLowerCase().includes(needle);
}
