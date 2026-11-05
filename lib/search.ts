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

/**
 * The digits that identify a phone, the way a person in Lebanon writes it: "03 123 456", "70708585",
 * "+961 70 708 585" and "0096170708585" all mean the number stored as "96170708585". The dialling
 * prefix (00), the country code (961) and the trunk zero are decoration here — stripped from what was
 * TYPED, never from what is stored, so a foreign number is still found by its full digits.
 */
export function significantDigits(digits: string): string {
  let d = digits.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("961") && d.length > 3) d = d.slice(3);
  if (d.startsWith("0") && d.length > 1) d = d.slice(1);
  return d;
}

/**
 * A prefix is only stripped from a number long enough to still mean somebody afterwards: "0151" stripped
 * to "151" would find every number holding those three digits.
 */
export const MIN_STRIPPED_DIGITS = 5;

/** Does a stored number match a typed one, written any of the ways above? */
export function phoneMatches(stored: string | null | undefined, digits: string): boolean {
  if (!stored) return false;
  const have = stored.replace(/\D/g, "");
  if (have === "") return false;
  if (have.includes(digits)) return true;
  const want = significantDigits(digits);
  return want !== digits && want.length >= MIN_STRIPPED_DIGITS && have.includes(want);
}

/** Case-insensitive substring, safe on null. */
export function textContains(stored: string | null, needle: string): boolean {
  if (!stored) return false;
  return stored.toLowerCase().includes(needle);
}
