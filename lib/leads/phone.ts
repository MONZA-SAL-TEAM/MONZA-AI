/**
 * Lebanese phone numbers, normalised to one comparable form.
 *
 * WHY THIS FILE IS CAREFUL OUT OF PROPORTION TO ITS SIZE. This is the only
 * function in the product allowed to conclude, without a human, that two
 * records are the same person. A number normalised wrongly links one
 * customer's conversations onto another customer's profile — silently, and in
 * a way nobody notices until the wrong person is told about the wrong car.
 *
 * So the rule here is: WHEN IN DOUBT, RETURN NULL. An unmatched lead costs a
 * staff member ten seconds. A wrongly matched lead costs trust.
 *
 * ── What the inputs actually look like ──────────────────────────────────────
 *
 * The same person's number arrives in at least four shapes:
 *
 *   WhatsApp (Cloud API)   "96170708585"        E.164, no plus, always
 *   CRM phone_primary      "+961 70 708 585"    however the staff member typed
 *   CRM phone_primary      "70 708 585"         national, no country code
 *   CRM phone_primary      "03 123456"          with the trunk zero
 *
 * All four must reduce to the same string, and a number that is none of these
 * must reduce to nothing.
 *
 * ── Lebanon's numbering, the part that matters here ─────────────────────────
 *
 * Country code 961. After it, the national significant number is:
 *
 *   3 XXXXXX     7 digits — the original mobile range, written locally as 03
 *   7X XXXXXX    8 digits — 70, 71, 76, 78, 79
 *   81 XXXXXX    8 digits — 81
 *   1 XXXXXX     7 digits — Beirut landline, written locally as 01
 *   4..9 XXXXXX  7 digits — other landline areas, written 04 … 09
 *
 * The leading 0 seen locally is a TRUNK PREFIX, not part of the number. It is
 * dropped before the country code goes on, which is the single most common
 * place this goes wrong: "0347..." must not become "9610347...".
 *
 * Landlines are normalised too — a customer may well give one — but see
 * `isMobile` for why they are treated differently when matching.
 */

/** Mobile prefixes, longest first so 81 is tested before 8 would be. */
const MOBILE_PREFIXES_2 = ["70", "71", "76", "78", "79", "81"] as const;
const MOBILE_PREFIX_1 = "3";

/** Landline area codes, without the trunk zero. */
const LANDLINE_PREFIXES_1 = ["1", "4", "5", "6", "7", "8", "9"] as const;

export const LEBANON_CC = "961";

/**
 * Is this a valid Lebanese NATIONAL significant number (no country code, no
 * trunk zero)? Pure shape check — it says the number could exist, never that
 * it does.
 */
export function isLebaneseNational(nsn: string): boolean {
  // 8-digit mobile: 70/71/76/78/79/81 + six.
  if (nsn.length === 8) {
    return MOBILE_PREFIXES_2.some((p) => nsn.startsWith(p));
  }
  // 7-digit: mobile 3 + six, or a landline area + six.
  if (nsn.length === 7) {
    if (nsn.startsWith(MOBILE_PREFIX_1)) return true;
    return LANDLINE_PREFIXES_1.some((p) => nsn.startsWith(p));
  }
  return false;
}

/** Is a normalised national number a MOBILE one? */
export function isMobileNational(nsn: string): boolean {
  if (nsn.length === 8) return MOBILE_PREFIXES_2.some((p) => nsn.startsWith(p));
  if (nsn.length === 7) return nsn.startsWith(MOBILE_PREFIX_1);
  return false;
}

/**
 * Reduce anything a human or an API might write to `961XXXXXXXX` — digits
 * only, no plus, ready for both comparison and a wa.me link.
 *
 * Returns null for anything it cannot place with confidence. Notably that
 * includes foreign numbers: Monza does sell to people abroad, and their
 * numbers are stored and displayed, but they are NOT normalised here and so
 * never auto-link. That is deliberate — this function only claims to
 * understand Lebanon, and a matcher that guesses at numbering plans it does
 * not know is the thing this file exists to prevent.
 */
export function normalizeLebanesePhone(input: string | null | undefined): string | null {
  if (!input) return null;

  // Everything that is not a digit is decoration: spaces, dashes, brackets,
  // the plus, and the occasional "ext." a staff member typed.
  let d = input.replace(/\D/g, "");
  if (d.length === 0) return null;

  // 00 is the international prefix dialled from a landline. Same meaning as +.
  if (d.startsWith("00")) d = d.slice(2);

  // Already carries the country code.
  if (d.startsWith(LEBANON_CC)) {
    let nsn = d.slice(LEBANON_CC.length);
    // "+961 03 123456" is wrong but people write it. The trunk zero is not
    // part of the number, so drop it rather than reject the whole thing.
    if (nsn.startsWith("0")) nsn = nsn.slice(1);
    return isLebaneseNational(nsn) ? LEBANON_CC + nsn : null;
  }

  // Local form with the trunk zero: 03 123456, 070 708585.
  if (d.startsWith("0")) {
    const nsn = d.slice(1);
    return isLebaneseNational(nsn) ? LEBANON_CC + nsn : null;
  }

  // Bare national number: 70708585, 3123456.
  if (isLebaneseNational(d)) return LEBANON_CC + d;

  // Anything else — a foreign number, a truncated one, a typo. Not ours to
  // interpret.
  return null;
}

/**
 * Do two written numbers denote the same phone?
 *
 * Both must normalise. Two numbers that BOTH fail to normalise are not equal
 * however identical their digits look: comparing raw strings is how "3" would
 * match "3", and how a truncated number would match another truncated one.
 */
export function samePhone(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const na = normalizeLebanesePhone(a);
  const nb = normalizeLebanesePhone(b);
  return na !== null && nb !== null && na === nb;
}

/**
 * Is this number safe to AUTO-LINK on?
 *
 * Stricter than "did it normalise", and the distinction is the point.
 *
 * A landline is a household or an office. Two brothers, a husband and wife, a
 * company and its owner routinely share one — so a landline match is real
 * evidence about a household but NOT proof of a person, and it must go to a
 * human like a name does. A mobile is carried by one person.
 */
export function isAutoLinkable(input: string | null | undefined): boolean {
  const n = normalizeLebanesePhone(input);
  if (n === null) return false;
  return isMobileNational(n.slice(LEBANON_CC.length));
}

/** Display form for staff: "+961 70 708 585". Never used for comparison. */
export function formatLebanesePhone(input: string | null | undefined): string | null {
  const n = normalizeLebanesePhone(input);
  if (n === null) return input ? input.trim() || null : null;
  const nsn = n.slice(LEBANON_CC.length);
  // 8-digit: 70 708 585. 7-digit: 3 123 456.
  const head = nsn.length === 8 ? nsn.slice(0, 2) : nsn.slice(0, 1);
  const rest = nsn.slice(head.length);
  return `+${LEBANON_CC} ${head} ${rest.slice(0, 3)} ${rest.slice(3)}`;
}
