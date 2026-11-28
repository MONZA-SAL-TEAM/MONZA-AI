/**
 * The QUOTE reader: what MONZA told a customer about money, from a message the team sent
 * (Samer, 2026-11-28: "analyse both incoming customer messages and outgoing MONZA responses").
 *
 * Why it exists. An audit that day found the team's usual first answer carries the total, the down
 * payment and the monthly installment in ONE message — so "asked about installments after the
 * price" is rare, and the group that matters is the people who received full terms and went quiet.
 * Neither can be seen unless what was offered is on record.
 *
 * What it keeps: NUMBERS ONLY — total, a list price named beside it, and each payment option (down
 * payment, monthly, months). Never a word of the message.
 *
 * Reviewed by Samer the same day, and changed for it:
 *   - Two prices are a RANGE only when neither is marked as the original / list price; one so marked
 *     ("was $60,000, now $55,000") is kept apart as `listPrice` and never widens the range.
 *   - SEVERAL payment options are each kept (a second down payment or monthly starts a new option).
 *   - A bare figure with no word saying what it is ("$65,000") is kept but marked LOW confidence:
 *     between two colleagues it is not a quote to a customer, and numbers alone cannot tell.
 *   - Arabic and Arabizi payment words and Arabic-Indic digits are read. (On 2026-11-28 the team's
 *     13,780 stored messages held none; every quote was in English with a "$".)
 * What it refuses: an amount with no "$" / USD (a year, a mileage, a phone number), a registration
 * fee, the remaining balance, and any line about ANOTHER make (a trade-in's asking price is not our
 * quote). Pure; the car is decided by the caller, which knows the conversation.
 */

export type QuoteKind = "offer" | "price" | "terms";

export interface PaymentOption {
  down: number | null;
  monthly: number | null;
  months: number | null;
}

export interface Quote {
  /** offer = a total with payment terms; price = a total alone; terms = down payment / monthly alone. */
  kind: QuoteKind;
  totalMin: number | null;
  totalMax: number | null;
  /** A price named as the original / usual one beside the offer. Never part of the range. */
  listPrice: number | null;
  /** Each way of paying the message offers, in order. Empty when it gives none. */
  options: PaymentOption[];
  /** high = the words say what the figures are; low = a bare figure. */
  confidence: "high" | "low";
}

/** USD, the only currency the team quotes in. */
const PLAUSIBLE = { total: [15_000, 500_000], down: [1_000, 300_000], monthly: [100, 20_000], months: [6, 120] } as const;
const MAX_OPTIONS = 6;

const OTHER_MAKES = [
  "porsche", "toyota", "mercedes", "cadillac", "denali", "gmc", "bmw", "audi", "range rover", "land rover", "kia", "hyundai", "nissan", "lexus", "byd",
  "tesla", "jeep", "honda", "ford", "chevrolet", "volkswagen", "infiniti", "mazda", "mitsubishi", "peugeot", "renault", "volvo", "jetour", "geely",
];
/** A line that is about somebody's used car, or one colleague briefing another — never our quote to the customer. */
const NOT_A_QUOTE = ["asking price", "can be sold", "at cost", "tell him", "tell her", "he wants", "she wants", "wants to pay", "trade in", "trade-in", "tradein", "valuation", "we can give him", "we can give her"];

const DOWN = ["downpayment", "down payment", "deposit", "upfront", "up front", "first payment", "دفعة", "دفعه", "مقدم", "daf3a", "daf3et", "m2addam"];
const MONTHLY = ["monthly", "per month", "a month", "/month", "/mo", "each month", "every month", "شهري", "بالشهر", "كل شهر", "shahri", "bel shaher", "bil shaher", "kel shaher"];
const REMAINING = ["remaining", "balance", "financed", "rest", "الباقي", "ba2e", "be2e"];
const FEE = ["registration", "plate", "insurance", "mecanique", "تسجيل", "tasjil"];
const LIST = ["was", "original", "originally", "instead of", "old price", "regular price", "list price", "usual price", "before discount", "كان", "ken"];
const SAYS_PRICE = ["total", "price", "priced", "including", "excluding", "vat", "cash", "selling", "costs", "سعر", "se3r", "si3r"];

const MONEY = "(?:\\$|usd\\b|dollars?\\b|dolar\\b|دولار)";
const THOUSAND = "(k\\b|alf\\b|ألف|الف)";
const NUMBER = "(\\d{1,3}(?:[,.]\\d{3})+|\\d+)";
const AMOUNT = new RegExp(`(?:\\$\\s?${NUMBER}\\s?${THOUSAND}?|(?<![\\d,.])${NUMBER}\\s?${THOUSAND}?\\s?${MONEY})`, "gi");
const MONTHS = /(\d{1,3})\s*(?:months?|mois|شهر|اشهر|أشهر|shaher|ashhor)/i;

const has = (text: string, words: readonly string[]) => words.some((w) => new RegExp(`(?<![a-z])${w.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![a-z])`, "i").test(text));
const within = (n: number, [lo, hi]: readonly [number, number]) => n >= lo && n <= hi;
const western = (text: string) => text.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

type Role = "total" | "list" | "down" | "monthly" | "ignore";
type Cue = "down" | "monthly" | "remaining" | "fee";
const CUES: readonly [Cue, readonly string[]][] = [["down", DOWN], ["monthly", MONTHLY], ["remaining", REMAINING], ["fee", FEE]];

const escaped = (w: string) => w.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** The payment word nearest the figure on one side: how many characters lie between them, and where it ends. */
function nearest(text: string, side: "before" | "after"): { cue: Cue; gap: number; end: number } | null {
  let best: { cue: Cue; gap: number; end: number } | null = null;
  for (const [cue, words] of CUES) {
    for (const w of words) {
      const re = new RegExp(`(?<![a-z])${escaped(w)}(?![a-z])`, "gi");
      for (const m of text.matchAll(re)) {
        const at = m.index ?? 0;
        const gap = side === "after" ? at : text.length - (at + m[0].length);
        if (!best || gap < best.gap) best = { cue, gap, end: at + m[0].length };
      }
    }
  }
  return best;
}

/**
 * What one amount is, from the payment word nearest to it.
 *   - A word directly before the figure names it: "downpayment $17,000", "Monthly: $600".
 *   - "Downpayment: at least $20,000 + registration": a down-payment or monthly label before the
 *     figure beats a fee word after it.
 *   - Otherwise the nearer side wins, and the word after wins a tie: "$17,000 downpayment".
 * `usedAfter` is where the word it took from AFTER the figure ends, so the next figure on the line
 * does not read the same word as its own label.
 */
function roleOf(before: string, after: string, value: number): { role: Role; usedAfter: number } {
  const b = nearest(before, "before");
  const a = nearest(after, "after");
  const labelled = b !== null && (b.cue === "down" || b.cue === "monthly");
  const fromBefore = b !== null && (b.gap <= 2 || !a || (labelled && a.cue === "fee" && b.gap <= 25) || b.gap < a.gap);
  const cue = fromBefore ? b!.cue : a ? a.cue : null;
  const usedAfter = !fromBefore && a ? a.end : 0;
  // A figure already named a price keeps it when the only payment word is further on:
  // "Total: $41,000 downpayment $17,000", "السعر 55,000 دولار دفعة 20,000".
  const namedPrice = !b && has(before, SAYS_PRICE) && within(value, PLAUSIBLE.total);
  if (namedPrice) return { role: has(before, LIST) ? "list" : "total", usedAfter: 0 };
  if (cue === "down") return { role: "down", usedAfter };
  if (cue === "monthly") return { role: "monthly", usedAfter };
  if (cue === "remaining") return { role: "ignore", usedAfter };
  // "$57,000 including VAT & registration" is still the total; "$2,000 registration" is a fee.
  if (cue === "fee") return { role: !fromBefore && within(value, PLAUSIBLE.total) ? "total" : "ignore", usedAfter: 0 };
  if (!within(value, PLAUSIBLE.total)) return { role: "ignore", usedAfter: 0 };
  return { role: has(before, LIST) || has(after, ["before discount"]) ? "list" : "total", usedAfter: 0 };
}

/** Cheap first look: could this text hold an amount of money at all? Never a decision — readQuote decides. */
export function mayHoldQuote(text: string): boolean {
  return /\$|usd|dollar|dolar|دولار/i.test(text);
}

export function readQuote(text: string): Quote | null {
  const totals: number[] = [];
  let listPrice: number | null = null;
  const options: PaymentOption[] = [];
  let worded = false;
  const option = (field: "down" | "monthly"): PaymentOption => {
    const last = options[options.length - 1];
    if (last && last[field] === null) return last;
    const next: PaymentOption = { down: null, monthly: null, months: null };
    options.push(next);
    return next;
  };

  for (const raw of western(text).split(/\n+/)) {
    const line = raw.toLowerCase();
    if (!line.trim()) continue;
    if (has(line, OTHER_MAKES) || has(line, NOT_A_QUOTE)) continue;

    const found = [...line.matchAll(AMOUNT)];
    let consumed = 0; // how far past the previous figure its own payment word reached
    for (let i = 0; i < found.length; i++) {
      const m = found[i];
      const digits = (m[1] ?? m[3] ?? "").replace(/[,.]/g, "");
      if (!digits) continue;
      const value = Number(digits) * (m[2] || m[4] ? 1000 : 1);
      if (!Number.isFinite(value)) continue;
      const start = m.index ?? 0;
      const prevEnd = i === 0 ? 0 : (found[i - 1].index ?? 0) + found[i - 1][0].length;
      const nextStart = i + 1 < found.length ? (found[i + 1].index ?? line.length) : line.length;
      const before = line.slice(Math.min(prevEnd + consumed, start), start);
      const after = line.slice(start + m[0].length, nextStart);
      const { role, usedAfter } = roleOf(before, after, value);
      consumed = usedAfter;
      if (role === "total") {
        totals.push(value);
        if (has(line, SAYS_PRICE) || has(line, FEE)) worded = true;
      } else if (role === "list") {
        listPrice = listPrice ?? value;
        worded = true;
      } else if (role === "down" && within(value, PLAUSIBLE.down) && options.length <= MAX_OPTIONS) {
        option("down").down = value;
      } else if (role === "monthly" && within(value, PLAUSIBLE.monthly) && options.length <= MAX_OPTIONS) {
        const o = option("monthly");
        o.monthly = value;
        // "$600 monthly (40 months)" / "Monthly: $600 (40 months)": the term stands beside its own figure.
        const term = MONTHS.exec(after.replace(/^\s*(?:monthly|per month|a month)/, "")) ?? MONTHS.exec(before);
        if (term && within(Number(term[1]), PLAUSIBLE.months)) o.months = Number(term[1]);
      }
    }
  }

  const kept = options.slice(0, MAX_OPTIONS);
  if (totals.length === 0 && kept.length === 0) return null; // a list price alone says nothing about what was offered
  const totalMin = totals.length ? Math.min(...totals) : null;
  const totalMax = totals.length ? Math.max(...totals) : null;
  const kind: QuoteKind = totalMin === null ? "terms" : kept.length > 0 ? "offer" : "price";
  return { kind, totalMin, totalMax, listPrice, options: kept, confidence: kind !== "price" || worded ? "high" : "low" };
}

/**
 * A message that prices SEVERAL cars ("M-Hero II / $x / M-Hero I / $y"): one piece of text per car,
 * from the line naming it to the line naming the next. Null when a single line names two cars — which
 * price is whose cannot then be told. `carsOf` says which cars a line names (the caller's catalogue).
 */
export function splitByCar(text: string, carsOf: (line: string) => readonly string[]): { car: string | null; text: string }[] | null {
  const lines = text.split(/\n/);
  const named = lines.map((l) => (l.trim() ? carsOf(l) : []));
  if (named.some((c) => c.length > 1)) return null;
  const distinct = [...new Set(named.flat())];
  if (distinct.length <= 1) return [{ car: distinct[0] ?? null, text }];
  const blocks: { car: string | null; text: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const car = named[i][0];
    if (car && car !== blocks[blocks.length - 1]?.car) blocks.push({ car, text: lines[i] });
    else if (blocks.length > 0) blocks[blocks.length - 1].text += `\n${lines[i]}`;
    // Lines before the first car belong to none of them and are left out.
  }
  return blocks;
}
