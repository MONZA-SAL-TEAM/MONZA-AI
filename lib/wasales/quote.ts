/**
 * The QUOTE reader: what MONZA told a customer about money, from a message the team sent
 * (Samer, 2026-11-28: "analyse both incoming customer messages and outgoing MONZA responses").
 *
 * Why it exists. An audit that day found the team's usual first answer carries the total, the down
 * payment and the monthly installment in ONE message — so "asked about installments after the
 * price" is rare, and the group that matters is the people who received full terms and went quiet.
 * Neither can be seen unless what was offered is on record.
 *
 * What it keeps: NUMBERS ONLY — total, down payment, monthly, months. Never a word of the message.
 * What it refuses: an amount with no "$" / USD (a year, a mileage, a phone number), a registration
 * fee, the remaining balance, and any line about ANOTHER make (a trade-in's asking price is not our
 * quote). Pure; the car is decided by the caller, which knows the conversation.
 */

export type QuoteKind = "offer" | "price" | "terms";

export interface Quote {
  /** offer = a total with payment terms; price = a total alone; terms = down payment / monthly alone. */
  kind: QuoteKind;
  totalMin: number | null;
  totalMax: number | null;
  down: number | null;
  monthly: number | null;
  months: number | null;
}

/** USD, the only currency the team quotes in. */
const PLAUSIBLE = { total: [15_000, 500_000], down: [1_000, 300_000], monthly: [100, 20_000], months: [6, 120] } as const;

const OTHER_MAKES = [
  "porsche", "toyota", "mercedes", "cadillac", "denali", "gmc", "bmw", "audi", "range rover", "land rover", "kia", "hyundai", "nissan", "lexus", "byd",
  "tesla", "jeep", "honda", "ford", "chevrolet", "volkswagen", "infiniti", "mazda", "mitsubishi", "peugeot", "renault", "volvo", "jetour", "geely",
];
/** A line that is about somebody's used car, or one colleague briefing another — never our quote to the customer. */
const NOT_A_QUOTE = ["asking price", "can be sold", "at cost", "tell him", "tell her", "he wants", "she wants", "wants to pay", "trade in", "trade-in"];

const DOWN = ["downpayment", "down payment", "deposit", "upfront", "up front", "first payment"];
const MONTHLY = ["monthly", "per month", "a month", "/month", "/mo", "each month", "every month"];
const REMAINING = ["remaining", "balance", "financed", "rest"];
const FEE = ["registration", "plate", "insurance", "mecanique"];

const AMOUNT = /(?:\$\s?(\d{1,3}(?:[,.]\d{3})+|\d+)\s?(k\b)?|\b(\d{1,3}(?:[,.]\d{3})+|\d+)\s?(k)?\s?(?:\$|usd\b|dollars?\b))/gi;
const MONTHS = /(\d{1,3})\s*(?:months?|mois)\b/i;

const has = (text: string, words: readonly string[]) => words.some((w) => text.includes(w));
const within = (n: number, [lo, hi]: readonly [number, number]) => n >= lo && n <= hi;

type Role = "total" | "down" | "monthly" | "ignore";

/** What one amount is, from the words right after it and, failing that, right before it. */
function roleOf(before: string, after: string, value: number): Role {
  // "$23,000 downpayment", "$2,000 registration", "$800 monthly": the word FOLLOWS the figure.
  if (has(after, DOWN)) return "down";
  if (has(after, FEE)) return value < PLAUSIBLE.total[0] ? "ignore" : "total"; // "$57,000 including VAT & registration" is still the total
  if (has(after, MONTHLY)) return "monthly";
  // "Downpayment: $23,000", "Monthly: $800", "Remaining $30,000": the word PRECEDES it.
  if (has(before, DOWN)) return "down";
  if (has(before, MONTHLY)) return "monthly";
  if (has(before, REMAINING)) return "ignore";
  if (has(before, FEE)) return "ignore";
  return within(value, PLAUSIBLE.total) ? "total" : "ignore";
}

export function readQuote(text: string): Quote | null {
  const totals: number[] = [];
  let down: number | null = null;
  let monthly: number | null = null;
  let months: number | null = null;

  for (const raw of text.split(/\n+/)) {
    const line = raw.toLowerCase();
    if (!line.trim()) continue;
    if (has(line, OTHER_MAKES) || has(line, NOT_A_QUOTE)) continue;

    const found = [...line.matchAll(AMOUNT)];
    for (let i = 0; i < found.length; i++) {
      const m = found[i];
      const digits = (m[1] ?? m[3] ?? "").replace(/[,.]/g, "");
      if (!digits) continue;
      const value = Number(digits) * (m[2] || m[4] ? 1000 : 1);
      if (!Number.isFinite(value)) continue;
      const start = m.index ?? 0;
      const prevEnd = i === 0 ? 0 : (found[i - 1].index ?? 0) + found[i - 1][0].length;
      const nextStart = i + 1 < found.length ? (found[i + 1].index ?? line.length) : line.length;
      const role = roleOf(line.slice(prevEnd, start), line.slice(start + m[0].length, nextStart), value);
      if (role === "total" && within(value, PLAUSIBLE.total)) totals.push(value);
      else if (role === "down" && within(value, PLAUSIBLE.down)) down = down ?? value;
      else if (role === "monthly" && within(value, PLAUSIBLE.monthly)) {
        monthly = monthly ?? value;
        const term = MONTHS.exec(line);
        if (term && within(Number(term[1]), PLAUSIBLE.months)) months = months ?? Number(term[1]);
      }
    }
  }

  if (totals.length === 0 && down === null && monthly === null) return null;
  const totalMin = totals.length ? Math.min(...totals) : null;
  const totalMax = totals.length ? Math.max(...totals) : null;
  const kind: QuoteKind = totalMin === null ? "terms" : down !== null || monthly !== null ? "offer" : "price";
  return { kind, totalMin, totalMax, down, monthly, months };
}
