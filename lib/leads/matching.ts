/**
 * Deciding whether two records are the same person.
 *
 * Pure. Nothing here reads a database, a clock or an environment variable —
 * candidates go in, a decision comes out — so every rule below is testable
 * from a fixture, which for matching logic is the difference between a rule
 * that holds and a rule that was intended.
 *
 * ── The one asymmetry that shapes the whole file ────────────────────────────
 *
 * A phone number IDENTIFIES. A name DESCRIBES.
 *
 * A mobile number belongs to one person, and WhatsApp hands it to us, so that
 * match links itself and nobody is asked anything. A name belongs to hundreds
 * of people — Lebanon has a modest stock of surnames and a very generous stock
 * of transliterations for each given name — so a name match is a lead for a
 * human to follow, never a conclusion.
 *
 * `decide()` returns one of exactly two things and cannot be talked into a
 * third: a LINK (phone only) or a SUGGESTION (everything else). The database
 * refuses a name-based link independently, so an error here is caught rather
 * than executed.
 *
 * ── Why the name scorer is generous anyway ──────────────────────────────────
 *
 * Because it costs nothing to be. A suggestion that turns out wrong is
 * rejected in one click and never offered again. A suggestion never made is a
 * customer nobody recognised. So the scorer aims to RANK the review queue
 * well, not to be right on its own — a different job from the phone matcher's,
 * and a much more forgiving one.
 */

import {
  isAutoLinkable,
  normalizeLebanesePhone,
  samePhone,
} from "@/lib/leads/phone";

/* ── Name normalisation ──────────────────────────────────────────────────── */

/**
 * Transliteration families. Lebanese names reach us spelled by whoever typed
 * them — a customer choosing their own Instagram handle, a salesperson in a
 * hurry, an Arabic keyboard, a French-schooled speaker.
 *
 * Each family collapses to its first member. The list is deliberately short
 * and covers the names that actually recur in Monza's book; a exhaustive
 * transliteration table is a research project, and the scorer degrades
 * gracefully without one because the fuzzy comparison below still catches
 * most near-spellings.
 */
const NAME_FAMILIES: readonly (readonly string[])[] = [
  ["mohamad", "mohammad", "muhammad", "mohammed", "mohamed", "mhamad", "hamad"],
  ["ahmad", "ahmed"],
  ["khaled", "khalid"],
  ["hussein", "hussain", "husayn", "hussain", "hsein"],
  ["hassan", "hasan"],
  ["ali", "aly"],
  ["youssef", "yousef", "yusuf", "joseph", "youssef"],
  ["georges", "george", "gorge", "jorj"],
  ["elie", "eli", "elias", "ilyas"],
  ["antoine", "antoun", "anton"],
  ["charbel", "sharbel"],
  ["nabil", "nabeel"],
  ["samer", "sameer", "samir", "sami r"],
  ["karim", "kareem"],
  ["rami", "ramy"],
  ["ziad", "zyad"],
  ["walid", "waleed"],
  ["fadi", "fady"],
  ["tony", "toni"],
  ["jean", "john", "jhon"],
  ["abdallah", "abdullah", "abdalla"],
  ["haddad", "hadad"],
  ["khoury", "khouri", "el khoury", "elkhoury"],
];

const FAMILY_OF: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const family of NAME_FAMILIES) {
    for (const variant of family) m.set(variant, family[0]);
  }
  return m;
})();

/**
 * Words that carry no identifying information. Dropped before comparison so
 * "Monza Voyah Lebanon" and "Voyah Lebanon Official" do not score as a strong
 * match on the words they share with everything else.
 */
const NOISE_WORDS = new Set([
  "the", "el", "al", "abu", "abou", "official", "officiel", "lebanon", "leb",
  "beirut", "beyrouth", "mr", "mrs", "dr", "eng", "engineer", "sayed",
]);

/**
 * Reduce a display name to comparable tokens.
 *
 * Instagram display names are a genre of their own: emoji, dots between
 * letters, a business suffix, a location, an occupation. What survives here is
 * the letters that might be a person's name.
 */
export function nameTokens(input: string | null | undefined): string[] {
  if (!input) return [];

  const cleaned = input
    .normalize("NFD")
    // Strip combining marks — French accents and Arabic vowel marks alike.
    .replace(/[̀-ًͯ-ْ]/g, "")
    .toLowerCase()
    // Anything that is not a letter (Latin or Arabic) is a separator. This
    // takes out emoji, dots, underscores, digits and punctuation in one pass.
    .replace(/[^a-zء-ي]+/g, " ")
    .trim();

  if (!cleaned) return [];

  return cleaned
    .split(/\s+/)
    // Single letters are initials, not evidence.
    .filter((t) => t.length >= 2 && !NOISE_WORDS.has(t))
    .map((t) => FAMILY_OF.get(t) ?? t);
}

/* ── Fuzzy comparison ────────────────────────────────────────────────────── */

/** Levenshtein distance, capped: past the cap the exact number is irrelevant. */
function editDistance(a: string, b: string, cap: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    // Whole row already past the cap — it can only grow.
    if (rowMin > cap) return cap + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Do two name tokens plausibly denote the same word? */
function tokensAgree(a: string, b: string): boolean {
  if (a === b) return true;
  // Tolerance scales with length: "ali"/"aly" is one edit in three letters and
  // should pass; "sami"/"rami" is also one edit and should NOT, so short
  // tokens get no tolerance at all and must match exactly or via a family.
  const shorter = Math.min(a.length, b.length);
  if (shorter <= 4) return false;
  const cap = shorter <= 6 ? 1 : 2;
  return editDistance(a, b, cap) <= cap;
}

/**
 * How alike are two names, 0..1?
 *
 * Overlap over the SHORTER token list, not over the union. "Karim" should
 * score well against "Karim Haddad": Instagram names are routinely a first
 * name only, and penalising the CRM for holding more information would sink
 * every genuine match.
 *
 * The consequence — "Karim" also scores well against every other Karim in the
 * book — is acceptable precisely because this never links anything. It puts
 * several Karims in front of a person who knows which one they mean.
 */
export function nameScore(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;

  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const remaining = [...long];

  let hits = 0;
  for (const token of short) {
    const idx = remaining.findIndex((r) => tokensAgree(token, r));
    if (idx !== -1) {
      hits++;
      // Consume it, so a repeated token cannot match the same word twice.
      remaining.splice(idx, 1);
    }
  }

  const base = hits / short.length;

  // A single shared token is weak evidence however cleanly it matched — one
  // given name in common is the most ordinary thing in the world. Cap it below
  // the range where a reviewer would trust it at a glance.
  if (hits === 1 && short.length === 1) return Math.min(base, 0.55);

  // Two or more agreeing tokens (a given name AND a surname) is the case worth
  // surfacing near the top of the queue.
  return base;
}

/* ── The decision ────────────────────────────────────────────────────────── */

/** A CRM customer as the matcher needs to see them. Nothing else is read. */
export interface MatchCandidate {
  crmCustomerId: string;
  name: string | null;
  phones: (string | null | undefined)[];
}

/** What we know about the person on the other end of a conversation. */
export interface MatchSubject {
  /** Their display name on the channel, when there is one. */
  displayName: string | null;
  /** Their phone, when the channel gives one. Only WhatsApp does. */
  phone: string | null;
}

export type MatchDecision =
  /** Link it. Only ever reached through a mobile number. */
  | {
      kind: "link";
      crmCustomerId: string;
      method: "phone_exact";
      confidence: number;
      evidence: Record<string, unknown>;
    }
  /** Put it in front of a person. Never changes anything on its own. */
  | {
      kind: "suggest";
      suggestions: {
        crmCustomerId: string;
        crmCustomerName: string | null;
        method: "name_similar";
        score: number;
        evidence: Record<string, unknown>;
      }[];
    }
  /** Nothing worth showing anybody. */
  | { kind: "none" };

/**
 * Below this, a name match is noise and goes in nobody's queue. Set where it
 * is because a queue full of 0.3-confidence guesses is a queue that gets
 * ignored, and an ignored queue is worse than no queue — it looks like the
 * work is being done.
 */
export const SUGGESTION_FLOOR = 0.6;

/** At most this many names in front of a person for one lead. */
export const MAX_SUGGESTIONS = 5;

/**
 * Decide what to do about one unidentified person.
 *
 * Order is load-bearing: phone is checked against ALL candidates before any
 * name is scored. A mobile match is certainty and must not be demoted to a
 * suggestion because some other customer happened to share the name.
 */
export function decide(
  subject: MatchSubject,
  candidates: readonly MatchCandidate[]
): MatchDecision {
  // ── 1. Phone. The only route to a link. ──────────────────────────────────
  if (isAutoLinkable(subject.phone)) {
    for (const c of candidates) {
      const hit = c.phones.find((p) => samePhone(p, subject.phone));
      if (hit !== undefined) {
        return {
          kind: "link",
          crmCustomerId: c.crmCustomerId,
          method: "phone_exact",
          confidence: 1,
          evidence: {
            matchedOn: "mobile number",
            normalized: normalizeLebanesePhone(subject.phone),
            crmCustomerName: c.name,
          },
        };
      }
    }
  }

  // ── 2. Name. Suggestions only, forever. ──────────────────────────────────
  const scored = candidates
    .map((c) => ({
      crmCustomerId: c.crmCustomerId,
      crmCustomerName: c.name,
      method: "name_similar" as const,
      score: Number(nameScore(subject.displayName, c.name).toFixed(2)),
      evidence: {
        matchedOn: "name similarity",
        channelName: subject.displayName,
        crmName: c.name,
        // Stated plainly because it is the thing the reviewer most needs to
        // know, and a number alone does not say it.
        note:
          subject.phone === null
            ? "This channel gives no phone number, so the name is all there is."
            : "The phone number did not match any customer.",
      },
    }))
    .filter((s) => s.score >= SUGGESTION_FLOOR)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUGGESTIONS);

  if (scored.length === 0) return { kind: "none" };
  return { kind: "suggest", suggestions: scored };
}
