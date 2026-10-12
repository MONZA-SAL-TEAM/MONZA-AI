/**
 * The PROFILE observer: who the customer is and what they need, from their own words — budget,
 * timeline, purpose, city, the other brands they compare or own, their trade-in, financing, needs and
 * concerns (Samer, 2026-10-12: "I want to know all data of clients and leads"). Pure; never the words:
 * every fact is a closed-vocabulary key, an amount, or a count.
 *
 * Each reader demands EVIDENCE, because the traps are real (tests/insights-traps.test.ts):
 *   budget    an amount AND (a budget word or a currency). "Free 318", "318 km", "BMW 318", a phone
 *             number, "a 2025 model", "40 kWh" are never budgets. "k" / "alf" with no currency is USD
 *             (Lebanon prices cars in dollars) — a stated rule, kept in `rule`.
 *   timeline  a time ONLY alongside a buying verb ("test drive tomorrow" is not a purchase date), except
 *             "just looking", which needs none.
 *   city      a closed list of Lebanese places; the ones that are also ordinary words ("tyre", "sour" /
 *             "صور" = photos, "chouf" = look, "saida" = good day) need a place word right before them.
 *   brand     a closed list; ordinary words that are also brands ("range", "seat", "jeep", "tank", "mini")
 *             are never read alone.
 */

import type { EngineDecision } from "@/lib/wasales/engine";
import { readNeeds } from "@/lib/wasales/intent";
import { normalize, sameWord } from "@/lib/wasales/matcher";
import type { Observation, ObservationKind, Stance } from "@/lib/wasales/observe";

/* ── Small tools ──────────────────────────────────────────────────────────── */

function fact(kind: ObservationKind, value: string, rule: string, extra: Partial<Observation> = {}): Observation {
  return { kind, stance: null, model: null, binding: null, part: null, value, detail: null, amountMin: null, amountMax: null, currency: null, amountKind: null, months: null, rule, ...extra };
}

const words = (text: string) => normalize(text).split(" ").filter((t) => t !== "");
const phrase = (p: string) => normalize(p).split(" ").filter((t) => t !== "");

/** Where a phrase starts in the tokens, or -1. Arabic attached prefixes are allowed (sameWord). */
function runAt(tokens: readonly string[], p: string, from = 0): number {
  const w = phrase(p);
  if (w.length === 0) return -1;
  for (let i = from; i + w.length <= tokens.length; i++) if (w.every((x, j) => sameWord(x, tokens[i + j]))) return i;
  return -1;
}
const hasAny = (tokens: readonly string[], list: readonly string[]) => list.some((p) => runAt(tokens, p) >= 0);
function firstOf(tokens: readonly string[], list: readonly string[]): { at: number; len: number } | null {
  let best: { at: number; len: number } | null = null;
  for (const p of list) {
    const at = runAt(tokens, p);
    if (at >= 0 && (!best || at < best.at)) best = { at, len: phrase(p).length };
  }
  return best;
}

/** A window of raw text has one of these words (ASCII by word boundary, Arabic by inclusion). */
function windowHas(s: string, list: readonly string[]): boolean {
  return list.some((w) => (/[a-z]/.test(w) ? new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\/$]/g, "\\$&")}([^a-z0-9]|$)`).test(s) : s.includes(w)));
}

/* ── Money ────────────────────────────────────────────────────────────────── */

/** Raw text for money: lower case, western digits, "40,000" → "40000". normalize() would strip "$" and ",". */
export function moneyText(raw: string): string {
  let s = raw
    .toLowerCase()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));
  for (let i = 0; i < 3; i++) s = s.replace(/(\d)[,.'](\d{3})(?!\d)/g, "$1$2");
  // "40 000": a space joins only a short group standing alone ("2018 120000 km" stays two numbers).
  s = s.replace(/(?<!\d)(\d{1,3}) (\d{3})(?!\d)/g, "$1$2");
  return s;
}

const UNIT: Readonly<Record<string, number>> = {
  k: 1000, thousand: 1000, thousands: 1000, alf: 1000, alef: 1000, elf: 1000, "ألف": 1000, "الف": 1000, "آلاف": 1000, "الاف": 1000, mille: 1000,
  mil: 1_000_000, million: 1_000_000, millions: 1_000_000, milion: 1_000_000, malyon: 1_000_000, "مليون": 1_000_000, "ملايين": 1_000_000,
};
const AMOUNT = /(?:(\$|usd|us\$|€)\s*)?(\d+(?:\.\d+)?)(?:\s*(k|thousands?|alf|alef|elf|ألف|الف|آلاف|الاف|mille|mil|millions?|milion|malyon|مليون|ملايين)(?![a-z؀-ۿ]))?(?![a-z0-9؀-ۿ])/g;
const CURRENCY_AFTER: ReadonlyArray<[RegExp, "USD" | "LBP" | "EUR"]> = [
  [/^\s*(\$|usd|us dollars?|dollars?|dolar|dolars|dollar|doller|دولار|دولارات|fresh)/, "USD"],
  [/^\s*(lbp|ll|l\.l|lira|lire|liras|ليرة|ليره|ل\.ل)/, "LBP"],
  [/^\s*(€|eur|euros?|يورو)/, "EUR"],
];

const BUDGET_CUES = [
  "budget", "my budget", "max", "maximum", "up to", "upto", "under", "below", "less than", "not more than", "no more than",
  "around", "approximately", "approx", "roughly", "between", "afford", "can pay", "can spend", "spend", "pay", "paying",
  "edfa3", "dafe3", "badfa3", "bedfa3", "b7dud", "bi7dud", "bhdud", "ma32oul", "ta2riban", "ta2reeban", "cash", "kash",
  "ميزانية", "ميزانيتي", "بحدود", "حوالي", "تقريبا", "لحد", "ادفع", "بدفع", "دافع", "كاش", "environ", "jusqu",
];
const MONTHLY_CUES = ["monthly", "per month", "a month", "/month", "/mo", "each month", "every month", "shahriyan", "shahriyen", "bel shahr", "bil shahr", "kel shahr", "شهري", "شهريا", "بالشهر", "كل شهر", "par mois", "mensuel"];
const DOWN_CUES = ["down payment", "downpayment", "first payment", "daf3a oula", "daf3a ula", "awal daf3a", "دفعة أولى", "دفعة اولى", "اول دفعة", "advance", "upfront", "up front", "cash down", "apport"];
const REST_WORDS = ["ba2e", "ba2i", "l ba2e", "el ba2e", "the rest", "remaining", "rest", "الباقي", "والباقي", "le reste"];
const INSTALMENT_WORDS = ["ta2sit", "ta2seet", "taksit", "takseet", "installment", "installments", "instalment", "instalments", "financing", "finance", "loan", "تقسيط", "بالتقسيط", "اقساط", "أقساط", "قرض", "تمويل", "credit"];

interface Amount {
  value: number;
  scaled: boolean;
  currency: "USD" | "LBP" | "EUR" | null;
  start: number;
  end: number;
}

function amountsIn(s: string): Amount[] {
  const out: Amount[] = [];
  for (const m of s.matchAll(AMOUNT)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const n = Number(m[2]);
    if (!Number.isFinite(n)) continue;
    // A digit run inside a longer number or a word is not an amount ("x5", "70708585").
    if (start > 0 && /[a-z0-9]/.test(s[start - 1]) && !m[1]) continue;
    const unit = m[3] ? UNIT[m[3]] ?? 1 : 1;
    let currency: Amount["currency"] = m[1] ? (m[1] === "€" ? "EUR" : "USD") : null;
    const after = s.slice(end, end + 16);
    if (!currency) for (const [re, cur] of CURRENCY_AFTER) if (re.test(after)) currency = cur;
    out.push({ value: n * unit, scaled: unit > 1, currency, start, end });
  }
  return out;
}

const RANGE_JOIN = /^\s*(-|–|to|till|until|and|w|or|aw|la|ila|الى|إلى|و|ل|a|à)\s*$/;

function bucket(kind: "total" | "monthly" | "down_payment", usd: number): string {
  const k = usd / 1000;
  if (kind === "monthly") return usd < 500 ? "monthly_under_500" : usd < 1000 ? "monthly_500_1000" : usd < 1500 ? "monthly_1000_1500" : "monthly_over_1500";
  if (kind === "down_payment") return k < 10 ? "down_under_10k" : k < 20 ? "down_10k_20k" : k < 30 ? "down_20k_30k" : "down_over_30k";
  const edges: Array<[number, string]> = [[20, "under_20k"], [30, "20k_30k"], [40, "30k_40k"], [50, "40k_50k"], [60, "50k_60k"], [80, "60k_80k"], [100, "80k_100k"]];
  for (const [edge, name] of edges) if (k < edge) return `total_${name}`;
  return "total_over_100k";
}

const PLAUSIBLE: Readonly<Record<"total" | "monthly" | "down_payment", [number, number]>> = {
  total: [3000, 1_000_000],
  monthly: [100, 20000],
  down_payment: [500, 500_000],
};

export function readBudget(raw: string, intents: readonly string[]): Observation[] {
  const s = moneyText(raw);
  const all = amountsIn(s);
  if (all.length === 0) return [];
  const tokens = words(raw);
  const financing = hasAny(tokens, INSTALMENT_WORDS);
  const rest = hasAny(tokens, REST_WORDS);
  const out: Observation[] = [];
  const used = new Set<number>();
  for (let i = 0; i < all.length; i++) {
    if (used.has(i)) continue;
    let a = all[i];
    let b: Amount | null = null;
    const next = all[i + 1];
    if (next && RANGE_JOIN.test(s.slice(a.end, next.start))) {
      // "35-45k", "between 35 and 45k": the second's unit applies to the first.
      const scale = !a.scaled && next.scaled ? next.value / Number(s.slice(next.start, next.end).match(/\d+(?:\.\d+)?/)?.[0] ?? 1) : 1;
      const first = { ...a, value: a.value * scale };
      if (first.value < next.value) {
        a = first;
        b = next;
        used.add(i + 1);
      }
    }
    const before = s.slice(Math.max(0, a.start - 40), a.start);
    const after = s.slice((b ?? a).end, (b ?? a).end + 24);
    const near = `${before} ${after}`;
    const currency = a.currency ?? b?.currency ?? null;
    const cue = windowHas(near, BUDGET_CUES) || windowHas(near, MONTHLY_CUES) || windowHas(near, DOWN_CUES);
    if (!cue && !currency) continue;
    // A customer quoting a price back ("is it 40k$?") is asking the price, not stating a budget.
    if (!cue && (intents.includes("PRICE") || /[?؟]/.test(raw))) continue;
    const kind: "total" | "monthly" | "down_payment" =
      windowHas(s.slice(Math.max(0, a.start - 24), (b ?? a).end + 20), MONTHLY_CUES)
        ? "monthly"
        : windowHas(near, DOWN_CUES) || (financing && rest)
          ? "down_payment"
          : "total";
    const cur = currency ?? (a.scaled || (b?.scaled ?? false) || a.value >= 1000 ? "USD" : null);
    if (!cur) continue;
    const lo = a.value;
    const hi = b ? b.value : a.value;
    if (cur === "USD") {
      const [min, max] = PLAUSIBLE[kind];
      if (lo < min || hi > max) continue;
    }
    const value = cur === "USD" ? bucket(kind, (lo + hi) / 2) : `${kind === "down_payment" ? "down" : kind}_${cur.toLowerCase()}`;
    out.push(
      fact("budget", value, `budget.${cue ? "cue" : "currency"}${currency ? "" : ".usd_default"}${b ? ".range" : ""}`, {
        stance: "mentioned",
        amountMin: lo,
        amountMax: hi,
        currency: cur,
        amountKind: kind,
        detail: cur,
      })
    );
  }
  return out;
}

/* ── Financing ────────────────────────────────────────────────────────────── */

const CASH_WORDS = ["cash", "kash", "in cash", "full payment", "pay in full", "pay full", "one payment", "daf3a wa7de", "كاش", "نقدي", "نقدا", "comptant", "cash buyer"];
const NUMBER_WORDS: Readonly<Record<string, number>> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, tnen: 2, tlet: 3, arba3: 4, khams: 5, "5ams": 5, set: 6, sab3: 7, "تنين": 2, "تلات": 3, "ثلاث": 3, "اربع": 4, "خمس": 5, "ست": 6, "سبع": 7 };
const MONTH_WORDS = ["months", "month", "mois", "shahr", "ashhor", "ashhur", "shhur", "shoohour", "شهر", "اشهر", "شهور"];
const YEAR_WORDS = ["years", "year", "yrs", "yr", "snin", "sneen", "sine", "sene", "ans", "سنين", "سنوات", "سنه"];

function termMonths(tokens: readonly string[]): number | null {
  for (let i = 0; i + 1 < tokens.length; i++) {
    const n = /^\d{1,3}$/.test(tokens[i]) ? Number(tokens[i]) : NUMBER_WORDS[tokens[i]];
    if (!n) continue;
    const unit = tokens[i + 1];
    if (MONTH_WORDS.some((w) => sameWord(w, unit)) && n >= 6 && n <= 120) return n;
    if (YEAR_WORDS.some((w) => sameWord(w, unit)) && n >= 1 && n <= 10) return n * 12;
  }
  return null;
}

export function readFinancing(raw: string, intents: readonly string[], refusedOnly: boolean, budget: readonly Observation[]): Observation[] {
  const tokens = words(raw);
  const out: Observation[] = [];
  const financing = intents.includes("FINANCING") && !refusedOnly;
  if (financing) out.push(fact("financing", "interested", "financing.intent", { stance: "wants" }));
  if (hasAny(tokens, CASH_WORDS) && !financing) out.push(fact("financing", "cash", "financing.cash", { stance: "mentioned" }));
  const down = budget.find((b) => b.amountKind === "down_payment");
  if (down) out.push(fact("financing", "down_payment", "financing.down_payment", { stance: "mentioned", amountMin: down.amountMin, amountMax: down.amountMax, currency: down.currency, amountKind: "down_payment" }));
  if (financing) {
    const months = termMonths(tokens);
    if (months) out.push(fact("financing", "term", "financing.term", { stance: "mentioned", months }));
  }
  return out;
}

/* ── Timeline ─────────────────────────────────────────────────────────────── */

const BUY_VERBS = [
  "buy", "buying", "purchase", "get it", "get one", "take it", "take one", "order", "order one", "reserve", "eshtere", "eshtiri", "ishtiri", "ishtere",
  "chtere", "echtere", "neshtere", "nechtere", "eshteriya", "eshtereha", "a5od", "e5od", "akhod", "ekhod", "a5da", "e5da", "اشتري", "نشتري", "بشتري",
  "اشتريها", "اخد", "اخدها", "acheter", "achete", "acheterai",
];
const WHEN: ReadonlyArray<[string, readonly string[]]> = [
  ["now", ["now", "right now", "today", "this week", "asap", "immediately", "urgently", "urgent", "hala2", "halla2", "hal2", "halla", "هلق", "هلا", "الان", "اليوم", "هالاسبوع", "fawran", "فورا", "tout de suite", "maintenant", "cette semaine", "el yom", "lyom", "hal esbou3", "hal jem3a"]],
  ["this_month", ["this month", "end of the month", "end of month", "hal shahr", "hayda el shahr", "akher el shahr", "هالشهر", "هيدا الشهر", "اخر الشهر", "ce mois"]],
  ["1_3_months", ["next month", "el shahr el jeye", "shahr el jeye", "الشهر الجاي", "الشهر القادم", "in a month", "within a month", "couple of months", "in two months", "in three months", "two months", "three months", "few weeks", "couple of weeks", "ba3d shahr", "ba3d shahrein", "ba3d shahren", "بعد شهر", "بعد شهرين", "mois prochain", "dans un mois"]],
  ["later", ["next year", "el sene el jeye", "السنه الجايه", "end of the year", "end of year", "akher el sene", "اخر السنه", "six months", "later", "later on", "ba3den", "ba3dein", "بعدين", "after summer", "next summer", "l annee prochaine", "plus tard"]],
];
const JUST_LOOKING = [
  "just looking", "just asking", "just checking", "just browsing", "just curious", "only asking", "for information", "for info", "not now", "not yet",
  "not ready", "mesh hala2", "mish hala2", "msh hala2", "mesh halla2", "mish halla2", "3am bes2al", "bes2al bas", "عم اسال", "مش هلق", "مش هلا",
  "pas maintenant", "juste pour savoir", "je me renseigne",
];

function monthsAhead(tokens: readonly string[]): number | null {
  for (let i = 0; i + 2 < tokens.length; i++) {
    if (!["ba3d", "in", "within", "khilal", "خلال", "بعد", "dans"].includes(tokens[i])) continue;
    const n = /^\d{1,2}$/.test(tokens[i + 1]) ? Number(tokens[i + 1]) : NUMBER_WORDS[tokens[i + 1]];
    if (!n) continue;
    const unit = tokens[i + 2];
    if (MONTH_WORDS.some((w) => sameWord(w, unit))) return n;
    if (["weeks", "week", "asabi3", "jem3a", "اسابيع", "semaines"].includes(unit)) return Math.max(1, Math.round(n / 4));
    if (YEAR_WORDS.some((w) => sameWord(w, unit))) return n * 12;
  }
  return null;
}

export function readTimeline(raw: string, intents: readonly string[]): Observation[] {
  const tokens = words(raw);
  const buying = intents.includes("BUYING_INTENT") || hasAny(tokens, BUY_VERBS);
  if (buying) {
    const n = monthsAhead(tokens);
    if (n !== null) return [fact("timeline", n <= 3 ? "1_3_months" : "later", "timeline.months", { stance: "mentioned", months: n })];
    for (const [value, list] of WHEN) if (hasAny(tokens, list)) return [fact("timeline", value, `timeline.${value}`, { stance: "mentioned" })];
  }
  if (hasAny(tokens, JUST_LOOKING)) return [fact("timeline", "just_looking", "timeline.just_looking", { stance: "mentioned" })];
  return [];
}

/* ── Purpose ──────────────────────────────────────────────────────────────── */

const BUSINESS = ["my company", "our company", "for the company", "for a company", "for company", "company car", "for my business", "for business", "for work", "for the business", "corporate", "lal sharike", "lal sherke", "la sharikti", "sharikte", "sherkte", "للشركه", "شركتي", "لشركتي", "pour l entreprise", "pour la societe", "mon entreprise"];
const FLEET = ["fleet", "our fleet", "flotte", "اسطول"];
const FAMILY = ["family", "my family", "for the family", "kids", "children", "my kids", "3ayle", "3ayleh", "3ele", "3eileh", "l3ele", "ولادي", "عيلتي", "العيله", "عيله", "عايله", "famille"];
const GIFT = ["gift", "as a gift", "present for", "surprise for", "birthday", "hdiye", "hdiyye", "hedye", "هديه", "cadeau"];
const RIDE = ["uber", "careem", "bolt", "taxi", "ride hailing", "rideshare", "تاكسي", "اوبر"];
const WE_NEED = ["we need", "we want", "need", "badna", "bidna", "بدنا", "نحنا", "for our", "for the company"];
const CAR_NOUNS = ["cars", "vehicles", "units", "sayarat", "siyarat", "sayyarat", "سيارات", "voitures"];

export function readPurpose(raw: string, intents: readonly string[]): Observation[] {
  const tokens = words(raw);
  const out: Observation[] = [];
  const business = hasAny(tokens, BUSINESS) && !intents.includes("BRAND_ORIGIN");
  let fleetCount: number | null = null;
  for (let i = 0; i + 1 < tokens.length; i++) {
    const n = /^\d{1,3}$/.test(tokens[i]) ? Number(tokens[i]) : NUMBER_WORDS[tokens[i]];
    if (n && n >= 2 && n <= 500 && CAR_NOUNS.includes(tokens[i + 1])) fleetCount = n;
  }
  const fleetWord = hasAny(tokens, FLEET);
  if (fleetWord || (fleetCount !== null && !intents.includes("COMPARE") && (business || hasAny(tokens, WE_NEED) || hasAny(tokens, BUY_VERBS)))) {
    out.push(fact("purpose", "fleet", fleetCount ? "purpose.fleet.count" : "purpose.fleet", { stance: "mentioned", detail: fleetCount ? `${fleetCount} cars` : null }));
  } else if (business) out.push(fact("purpose", "business", "purpose.business", { stance: "mentioned" }));
  if (hasAny(tokens, FAMILY)) out.push(fact("purpose", "family", "purpose.family", { stance: "mentioned" }));
  if (hasAny(tokens, GIFT)) out.push(fact("purpose", "gift", "purpose.gift", { stance: "mentioned" }));
  if (hasAny(tokens, RIDE)) out.push(fact("purpose", "ride_hailing", "purpose.ride_hailing", { stance: "mentioned" }));
  return out;
}

/* ── City ─────────────────────────────────────────────────────────────────── */

interface Place {
  key: string;
  name: string;
  words: readonly string[];
  /** Also an ordinary word: needs a place word right before it. */
  ambiguous?: readonly string[];
}

export const PLACES: readonly Place[] = [
  { key: "beirut", name: "Beirut", words: ["beirut", "beyrouth", "bayrut", "beyrut", "achrafieh", "ashrafieh", "achrafiyeh", "hamra", "verdun", "ras beirut", "mar mikhael", "gemmayzeh", "bierut", "بيروت", "الاشرفيه", "الحمرا"] },
  { key: "metn", name: "Metn", words: ["metn", "matn", "el metn", "dbayeh", "antelias", "jal el dib", "zalka", "jdeideh", "dekwaneh", "sin el fil", "broummana", "beit mery", "bikfaya", "mansourieh", "fanar", "naccache", "rabieh", "bsalim", "mtayleb", "المتن", "متن", "الضبيه", "انطلياس", "جل الديب", "الزلقا", "الدكوانه", "سن الفيل", "برمانا", "بكفيا", "المنصوريه"] },
  { key: "kesrouan", name: "Kesrouan", words: ["kesrouan", "keserwan", "kesserwan", "jounieh", "jounie", "kaslik", "zouk", "zouk mosbeh", "zouk mikael", "ghazir", "harissa", "ajaltoun", "faraya", "adma", "كسروان", "جونيه", "الكسليك", "ذوق مصبح", "غزير"] },
  { key: "jbeil", name: "Jbeil", words: ["jbeil", "byblos", "amchit", "halat", "jbail", "جبيل", "عمشيت"] },
  { key: "batroun", name: "Batroun", words: ["batroun", "el batroun", "البترون", "بترون"] },
  { key: "tripoli", name: "Tripoli", words: ["tripoli", "trablos", "trablous", "tarablos", "طرابلس"] },
  { key: "zgharta", name: "Zgharta", words: ["zgharta", "ehden", "زغرتا", "اهدن"] },
  { key: "koura", name: "Koura", words: ["koura", "el koura", "amioun", "الكوره", "اميون"] },
  { key: "akkar", name: "Akkar", words: ["akkar", "halba", "عكار", "حلبا"] },
  { key: "bsharri", name: "Bsharri", words: ["bsharri", "bcharre", "bsherri", "بشري"] },
  { key: "zahle", name: "Zahle", words: ["zahle", "zahleh", "chtaura", "chtoura", "زحله", "شتوره"] },
  { key: "bekaa", name: "Bekaa", words: ["bekaa", "beqaa", "el bekaa", "west bekaa", "البقاع", "بقاع"] },
  { key: "baalbek", name: "Baalbek", words: ["baalbek", "baalbeck", "hermel", "بعلبك", "الهرمل"] },
  { key: "saida", name: "Saida", words: ["sidon", "صيدا"], ambiguous: ["saida"] },
  { key: "tyre", name: "Tyre", words: [], ambiguous: ["tyre", "tyr", "sour", "صور"] },
  { key: "nabatieh", name: "Nabatieh", words: ["nabatieh", "nabatiyeh", "nabatiye", "النبطيه", "نبطيه"] },
  { key: "jezzine", name: "Jezzine", words: ["jezzine", "jezzin", "جزين"] },
  { key: "chouf", name: "Chouf", words: ["the chouf", "el chouf", "al chouf", "el shouf", "الشوف", "damour", "deir el qamar", "beiteddine", "barouk", "الدامور"], ambiguous: ["chouf", "shouf"] },
  { key: "aley", name: "Aley", words: ["bhamdoun", "sofar", "عاليه", "بحمدون"], ambiguous: ["aley", "aaley"] },
  { key: "baabda", name: "Baabda", words: ["baabda", "hazmieh", "hazmiyeh", "hadath", "dahye", "dahieh", "dahiyeh", "khaldeh", "choueifat", "بعبدا", "الحازميه", "الحدث", "الضاحيه", "خلده", "الشويفات"] },
  { key: "south", name: "South Lebanon", words: ["marjayoun", "bint jbeil", "hasbaya", "مرجعيون", "بنت جبيل", "حاصبيا"] },
];
const ABROAD_DIRECT = ["abroad", "outside lebanon", "outside of lebanon", "barra lebnen", "bara lebnen", "barra lebnan", "برا لبنان", "خارج لبنان", "expat", "mughtarib", "مغترب", "a l etranger"];
const ABROAD_PLACES = ["dubai", "uae", "emirates", "saudi", "ksa", "riyadh", "jeddah", "qatar", "doha", "kuwait", "africa", "abidjan", "lagos", "france", "paris", "canada", "australia", "usa", "america", "germany", "gulf", "khalij", "الخليج", "دبي", "الامارات", "السعوديه", "قطر", "الكويت", "افريقيا"];
const PLACE_CUES = ["in", "from", "at", "near", "live", "living", "based", "located", "area", "region", "ana", "bel", "bil", "men", "min", "mn", "sakin", "saken", "sekne", "sakne", "ساكن", "ساكنه", "من", "منطقه", "بمنطقه", "habite", "j habite"];

function cued(tokens: readonly string[], at: number): boolean {
  return at > 0 && (PLACE_CUES.includes(tokens[at - 1]) || (at > 1 && PLACE_CUES.includes(tokens[at - 2]) && ["el", "al", "the", "l"].includes(tokens[at - 1])));
}

export function readCity(raw: string): Observation[] {
  const tokens = words(raw);
  const out: Observation[] = [];
  for (const place of PLACES) {
    let found = hasAny(tokens, place.words);
    if (!found && place.ambiguous) {
      for (const w of place.ambiguous) {
        let at = runAt(tokens, w);
        while (at >= 0 && !found) {
          if (cued(tokens, at)) found = true;
          at = runAt(tokens, w, at + 1);
        }
      }
    }
    if (found) out.push(fact("city", place.key, place.ambiguous && !hasAny(tokens, place.words) ? "city.cued" : "city.named", { stance: "mentioned", detail: place.name }));
  }
  let abroad = hasAny(tokens, ABROAD_DIRECT);
  if (!abroad) {
    for (const w of ABROAD_PLACES) {
      const at = runAt(tokens, w);
      if (at >= 0 && cued(tokens, at)) abroad = true;
    }
  }
  if (abroad) out.push(fact("city", "abroad", "city.abroad", { stance: "mentioned", detail: "Abroad" }));
  return out;
}

/* ── Other brands ─────────────────────────────────────────────────────────── */

export const BRANDS: ReadonlyArray<{ key: string; name: string; words: readonly string[] }> = [
  { key: "byd", name: "BYD", words: ["byd", "بي واي دي"] },
  { key: "zeekr", name: "Zeekr", words: ["zeekr", "zeeker"] },
  { key: "xpeng", name: "Xpeng", words: ["xpeng", "x peng"] },
  { key: "jetour", name: "Jetour", words: ["jetour", "جيتور"] },
  { key: "geely", name: "Geely", words: ["geely", "جيلي"] },
  { key: "chery", name: "Chery", words: ["chery", "شيري"] },
  { key: "li_auto", name: "Li Auto", words: ["li auto", "lixiang", "li xiang"] },
  { key: "nio", name: "NIO", words: ["nio"] },
  { key: "hongqi", name: "Hongqi", words: ["hongqi", "hong qi"] },
  { key: "changan", name: "Changan", words: ["changan", "chang an", "شانجان"] },
  { key: "avatr", name: "Avatr", words: ["avatr", "avatar 11", "avatar 12"] },
  { key: "deepal", name: "Deepal", words: ["deepal"] },
  { key: "denza", name: "Denza", words: ["denza"] },
  { key: "leapmotor", name: "Leapmotor", words: ["leapmotor", "leap motor"] },
  { key: "tank", name: "Tank", words: ["tank 300", "tank 500", "tank 700"] },
  { key: "haval", name: "Haval", words: ["haval", "هافال"] },
  { key: "mg", name: "MG", words: ["mg zs", "mg 4", "mg 5", "mg hs", "mg rx5", "mg cyberster", "mg motor"] },
  { key: "exeed", name: "Exeed", words: ["exeed"] },
  { key: "jaecoo", name: "Jaecoo", words: ["jaecoo"] },
  { key: "omoda", name: "Omoda", words: ["omoda"] },
  { key: "gac", name: "GAC", words: ["gac", "aion"] },
  { key: "dongfeng", name: "Dongfeng", words: ["dongfeng", "dong feng", "forthing"] },
  { key: "polestar", name: "Polestar", words: ["polestar"] },
  { key: "bmw", name: "BMW", words: ["bmw", "بي ام", "بي ام دبليو"] },
  { key: "mercedes", name: "Mercedes", words: ["mercedes", "benz", "mercedes benz", "مرسيدس"] },
  { key: "tesla", name: "Tesla", words: ["tesla", "تسلا"] },
  { key: "toyota", name: "Toyota", words: ["toyota", "تويوتا"] },
  { key: "lexus", name: "Lexus", words: ["lexus", "لكزس"] },
  { key: "nissan", name: "Nissan", words: ["nissan", "نيسان"] },
  { key: "kia", name: "Kia", words: ["kia", "كيا"] },
  { key: "hyundai", name: "Hyundai", words: ["hyundai", "هيونداي", "هونداي"] },
  { key: "audi", name: "Audi", words: ["audi", "اودي"] },
  { key: "porsche", name: "Porsche", words: ["porsche", "بورش"] },
  { key: "volkswagen", name: "Volkswagen", words: ["volkswagen", "vw"] },
  { key: "volvo", name: "Volvo", words: ["volvo", "فولفو"] },
  { key: "land_rover", name: "Land Rover", words: ["range rover", "land rover", "defender", "رينج"] },
  { key: "ford", name: "Ford", words: ["ford", "فورد"] },
  { key: "chevrolet", name: "Chevrolet", words: ["chevrolet", "chevy", "شفروليه"] },
  { key: "honda", name: "Honda", words: ["honda", "هوندا"] },
  { key: "mitsubishi", name: "Mitsubishi", words: ["mitsubishi", "متسوبيشي"] },
  { key: "jeep", name: "Jeep", words: ["jeep grand cherokee", "grand cherokee", "jeep wrangler", "wrangler", "jeep compass", "jeep cherokee"] },
  { key: "mazda", name: "Mazda", words: ["mazda"] },
  { key: "infiniti", name: "Infiniti", words: ["infiniti"] },
  { key: "cadillac", name: "Cadillac", words: ["cadillac"] },
  { key: "gmc", name: "GMC", words: ["gmc"] },
  { key: "dodge", name: "Dodge", words: ["dodge"] },
  { key: "renault", name: "Renault", words: ["renault"] },
  { key: "peugeot", name: "Peugeot", words: ["peugeot"] },
  { key: "genesis", name: "Genesis", words: ["genesis gv80", "genesis g80", "genesis gv70"] },
];
const OWNS = ["i have", "i own", "i drive", "my", "3ande", "3andi", "3ndi", "3nde", "عندي", "معي", "ma3e", "ma3i", "j ai", "ma voiture", "currently"];
const TRADE = ["trade", "trade in", "tradein", "exchange", "swap", "badel", "badal", "بدل", "تبديل", "reprise", "sell my"];
const COMPARE = ["vs", "versus", "better than", "compared", "compare", "comparison", "or", "aw", "walla", "difference", "against", "than", "او", "ولا", "الفرق", "مقارنه", "ahsan", "a7san", "احسن"];

export function readBrands(raw: string, intents: readonly string[]): Observation[] {
  const tokens = words(raw);
  const out: Observation[] = [];
  const trading = intents.includes("TRADE_IN") || hasAny(tokens, TRADE);
  const comparing = intents.includes("COMPARE") || hasAny(tokens, COMPARE);
  for (const brand of BRANDS) {
    const hit = firstOf(tokens, brand.words);
    if (!hit) continue;
    const back = tokens.slice(Math.max(0, hit.at - 3), hit.at);
    const owns = OWNS.some((w) => runAt(back, w) >= 0);
    let stance: Stance = "mentioned";
    if (owns && trading) stance = "trading_in";
    else if (owns) stance = "owns";
    else if (trading) stance = "trading_in";
    else if (comparing) stance = "compared";
    out.push(fact("competitor", brand.key, `competitor.${stance}`, { stance, detail: brand.name }));
  }
  return out;
}

/* ── Trade-in ─────────────────────────────────────────────────────────────── */

function mileageBucket(km: number): string {
  return km < 50000 ? "km_under_50k" : km < 100000 ? "km_50k_100k" : km < 150000 ? "km_100k_150k" : km < 200000 ? "km_150k_200k" : "km_over_200k";
}

export function readTradeIn(raw: string, intents: readonly string[], brands: readonly Observation[]): Observation[] {
  const tradingBrand = brands.find((b) => b.stance === "trading_in");
  if (!intents.includes("TRADE_IN") && !tradingBrand) return [];
  const out: Observation[] = [];
  const make = tradingBrand ?? brands.find((b) => b.stance === "owns");
  out.push(fact("trade_in", make ? make.value : "car", "trade_in.make", { stance: "trading_in", detail: make?.detail ?? null }));
  const s = moneyText(raw);
  const year = [...s.matchAll(/(?<![\d])(199\d|20[0-2]\d)(?![\d])/g)].map((m) => Number(m[1])).find((y) => y <= new Date().getUTCFullYear() + 1);
  if (year) out.push(fact("trade_in", `year_${year}`, "trade_in.year", { stance: "trading_in" }));
  const km = s.match(/(\d+(?:\.\d+)?)\s*(k)?\s*(km|kms|kilometers|kilometres|kilometre|kilometer|kilo|كم|كلم)(?![a-z])/);
  if (km) {
    const n = Number(km[1]) * (km[2] ? 1000 : 1);
    if (n >= 1000 && n <= 1_000_000) out.push(fact("trade_in", mileageBucket(n), "trade_in.mileage", { stance: "trading_in" }));
  }
  return out;
}

/* ── Concerns and needs ───────────────────────────────────────────────────── */

const CONCERNS: ReadonlyArray<[string, readonly string[]]> = [
  ["price_too_high", ["ghali", "ghaleh", "ghalye", "ghelye", "too expensive", "so expensive", "very expensive", "expensive", "pricey", "overpriced", "trop cher", "غالي", "غاليه"]],
  ["power_cuts", ["power cut", "power cuts", "power outage", "electricity cut", "no electricity", "ma fi kahraba", "2at3et kahraba", "ta2nin kahraba", "edl", "generator", "moteur", "eshtirak", "ishtirak", "ما في كهربا", "انقطاع الكهربا", "اشتراك", "موتير", "مولد"]],
  ["charging_access", ["where to charge", "where can i charge", "charging stations", "charging station", "charging points", "chargers in lebanon", "wen bshahen", "وين بشحن", "محطات شحن", "محطه شحن"]],
  ["range", ["range anxiety", "enough range", "will it reach", "does it reach", "ykaffe", "bi wasel", "biwasel", "بيوصل", "long trips", "long distance", "runs out of battery", "battery runs out", "stuck on the road"]],
  ["resale", ["resale", "resale value", "sell it later", "selling it later", "depreciation", "loses value", "lose value", "btekhsar", "bt5sar", "btinba3", "tenba3", "بتنباع", "بتخسر", "revente"]],
  ["parts_service", ["spare parts", "parts available", "availability of parts", "after sales", "aftersales", "service center", "service centre", "maintenance", "2ita3", "2ta3", "قطع غيار", "صيانه", "sayene", "siyene", "entretien"]],
  ["brand_trust", ["chinese", "made in china", "china", "sini", "seene", "siniyye", "صيني", "صينيه", "الصين", "reliable", "reliability", "trust", "trustworthy", "chinoise", "fiable"]],
  ["delivery_wait", ["delivery time", "how long delivery", "how long to deliver", "when will it arrive", "waiting time", "wait long", "how many days", "kam yom", "delai", "delai de livraison", "قديش بدها وقت"]],
];
const NOT_BEFORE = ["least", "less", "not", "mesh", "mish", "msh", "ma", "most", "مش", "مو", "pas"];
const INTENT_CONCERN: Readonly<Record<string, string>> = { HOME_CHARGING: "home_charging", PUBLIC_CHARGING: "charging_access" };

export function readConcerns(raw: string, intents: readonly string[], ownerSupport: boolean): Observation[] {
  if (ownerSupport) return []; // an owner's fault is after-sales, not a buying concern
  const tokens = words(raw);
  const out: Observation[] = [];
  for (const [value, list] of CONCERNS) {
    const hit = firstOf(tokens, list);
    if (!hit) continue;
    if (value === "price_too_high" && hit.at > 0 && NOT_BEFORE.includes(tokens[hit.at - 1])) continue;
    out.push(fact("concern", value, `concern.words.${value}`, { stance: "mentioned" }));
  }
  for (const i of intents) {
    const value = INTENT_CONCERN[i];
    if (value && !out.some((o) => o.value === value)) out.push(fact("concern", value, `concern.intent.${value}`, { stance: "asked" }));
  }
  return out;
}

export function readNeedFacts(raw: string, hasBudget: boolean): Observation[] {
  return readNeeds(words(raw)).filter((n) => !(n === "BUDGET" && hasBudget)).map((n) => fact("need", n.toLowerCase(), `need.${n.toLowerCase()}`, { stance: "wants" }));
}

/* ── Everything ───────────────────────────────────────────────────────────── */

export function observeProfile(raw: string, d: EngineDecision): Observation[] {
  if (d.outcome === "EXCLUDED") return [];
  const u = d.understanding;
  const intents = u.intents as readonly string[];
  const budget = readBudget(raw, intents);
  const brands = readBrands(raw, intents);
  return [
    ...budget,
    ...readFinancing(raw, intents, u.refusedOnly, budget),
    ...readTimeline(raw, intents),
    ...readPurpose(raw, intents),
    ...readCity(raw),
    ...brands,
    ...readTradeIn(raw, intents, brands),
    ...readNeedFacts(raw, budget.length > 0),
    ...readConcerns(raw, intents, u.ownerSupport),
  ];
}
