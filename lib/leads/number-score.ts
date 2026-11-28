/**
 * How memorable a Lebanese mobile number is (Samer, 2026-11-28).
 *
 * In Lebanon a memorable number — repeated digits, a run, a mirrored half, the original 03 prefix —
 * is bought at a price. That makes it a commercial SIGNAL when selling cars, and nothing more: it
 * is never read as wealth, standing or ability to pay, and it never outranks what a customer
 * actually asks for. The label is "number class", always shown with its reasons.
 *
 * THE EVIDENCE BEHIND THE WEIGHTS (read-only audit, 2026-11-28, first-version rules):
 *                      chat leads (1,481)   past CRM buyers (142)
 *   class S or A              2.9%                 7.7%
 *   class B                   7.7%                12.0%
 *   03 prefix                37.1%                62.0%
 * Two different groups, not one cohort followed to a sale, and 11 buyers carry S or A — an
 * association, not proof. The 03 prefix separates the groups about as well as the patterns do and
 * covers a third of the leads, which is why it is its own reason and its own bonus.
 *
 * Rules: only a Lebanese MOBILE is scored; anything else is null — never "C", because an
 * unscorable number is not an ordinary one. The six subscriber digits are scored by their single
 * STRONGEST pattern, so overlapping patterns are never added up (111111 is "six identical", not
 * also "a triple" and "a mirror"). Pure: change a weight here and every lead changes at once.
 */
import { LEBANON_CC, isMobileNational, normalizeLebanesePhone } from "@/lib/leads/phone";

export type NumberClass = "S" | "A" | "B" | "C";

export interface NumberScore {
  /** 0-100. */
  score: number;
  cls: NumberClass;
  /** Why, in plain words, strongest first. Empty for an ordinary number. */
  reasons: string[];
}

export const CLASS_LABEL: Readonly<Record<NumberClass, string>> = { S: "Ultra VIP number", A: "VIP number", B: "Premium number", C: "Standard number" };

/** Where a class starts. */
export const CLASS_FROM: Readonly<Record<Exclude<NumberClass, "C">, number>> = { S: 90, A: 75, B: 50 };

/** Added for the original 03 range, on top of the pattern; never enough alone to leave class C. */
export const PREFIX_03_BONUS = 15;

const RUNS = ["0123456789", "9876543210"];
const isRun = (s: string): boolean => RUNS.some((r) => r.includes(s));

/** The longest stretch of one repeated digit. */
function longestRepeat(d: string): number {
  let best = 1;
  let cur = 1;
  for (let i = 1; i < d.length; i += 1) {
    cur = d[i] === d[i - 1] ? cur + 1 : 1;
    if (cur > best) best = cur;
  }
  return best;
}

/** The six subscriber digits' strongest pattern: its points and its name. Checked strongest first. */
export function strongestPattern(d: string): { points: number; reason: string } | null {
  if (!/^\d{6}$/.test(d)) return null;
  const [a, b] = [d.slice(0, 3), d.slice(3)];
  const triple = (s: string) => s[0] === s[1] && s[1] === s[2];
  if (longestRepeat(d) === 6) return { points: 100, reason: "six identical digits" };
  if (isRun(d)) return { points: 95, reason: "a full run of six" };
  if (triple(a) && triple(b)) return { points: 95, reason: "two triples" };
  if (/^\d0{5}$/.test(d)) return { points: 95, reason: "five zeros" };
  if (longestRepeat(d) === 5) return { points: 90, reason: "five identical digits in a row" };
  if (a === b) return { points: 90, reason: "the same three digits twice" };
  if (d.slice(0, 2) === d.slice(2, 4) && d.slice(2, 4) === d.slice(4)) return { points: 85, reason: "the same pair three times" };
  if (d === [...d].reverse().join("")) return { points: 85, reason: "a mirrored number" };
  if (longestRepeat(d) === 4) return { points: 80, reason: "four identical digits in a row" };
  if (isRun(a) && isRun(b)) return { points: 65, reason: "two runs of three" };
  if (d[0] === d[1] && d[2] === d[3] && d[4] === d[5]) return { points: 65, reason: "three pairs" };
  if (longestRepeat(d) === 3) return { points: 65, reason: "three identical digits in a row" };
  if (b === "000") return { points: 60, reason: "ends in three zeros" };
  if (isRun(a) || isRun(b)) return { points: 30, reason: "a run of three" };
  if (new Set(d).size <= 2) return { points: 30, reason: "only two different digits" };
  return null;
}

export function classOf(score: number): NumberClass {
  if (score >= CLASS_FROM.S) return "S";
  if (score >= CLASS_FROM.A) return "A";
  if (score >= CLASS_FROM.B) return "B";
  return "C";
}

/**
 * The score of a phone number however it is written (+961…, 00961…, 03…, with spaces). Null for a
 * landline, a foreign number, an Instagram / Facebook id, or anything that is not a number.
 */
export function scoreNumber(input: string | null | undefined): NumberScore | null {
  const e164 = normalizeLebanesePhone(input);
  if (!e164 || !e164.startsWith(LEBANON_CC)) return null;
  const national = e164.slice(LEBANON_CC.length);
  if (!isMobileNational(national)) return null;
  const is03 = national.length === 7;
  const pattern = strongestPattern(national.slice(-6));
  const reasons = [...(pattern ? [pattern.reason] : []), ...(is03 ? ["the original 03 prefix"] : [])];
  const score = Math.min(100, (pattern?.points ?? 0) + (is03 ? PREFIX_03_BONUS : 0));
  return { score, cls: classOf(score), reasons };
}
