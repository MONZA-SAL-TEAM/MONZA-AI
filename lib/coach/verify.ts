/**
 * The last line of defence: does this draft contain a fact nobody gave it?
 *
 * The prompt tells the model to write `[[a slot]]` instead of guessing. This
 * checks whether it actually did. A prompt is a request; this is a measurement,
 * and the two failure modes it catches are the ones that cost real money:
 *
 *   an invented NUMBER   "the Free is $62,500"      — a price we never quoted
 *   an invented TIME     "it will be ready Tuesday" — a promise nobody made
 *
 * The second needs no digits at all, which is why a digit scan alone is not
 * enough.
 *
 * IT NEVER REWRITES THE DRAFT. It returns spans, the card marks them, and a
 * person decides. Silently "fixing" a suspicious sentence would produce a draft
 * nobody has read that looks like one somebody has.
 *
 * Pure: no clock, no I/O, no network.
 */

/** A stretch of the reply worth a second look. */
export interface FlagSpan {
  start: number;
  end: number;
  text: string;
  /** Why it was flagged, in words the salesperson reads. */
  reason: string;
}

export type VerifyLevel =
  /** Nothing unsupported. Safe to use as-is. */
  | "ok"
  /** Something in it did not come from the facts. Show it, marked. */
  | "check"
  /** Not a message to a customer at all. Do not offer it. */
  | "reject";

export interface VerifyResult {
  level: VerifyLevel;
  flags: FlagSpan[];
  /** Set when the level is "reject" — why it was thrown away. */
  rejection?: string;
}

/* ── Normalising ─────────────────────────────────────────────────────────── */

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EASTERN_ARABIC = "۰۱۲۳۴۵۶۷۸۹";

/** Map Arabic-Indic and Eastern digits to ASCII so one scan covers all three. */
export function toAsciiDigits(text: string): string {
  let out = "";
  for (const ch of text) {
    const a = ARABIC_INDIC.indexOf(ch);
    if (a >= 0) {
      out += String(a);
      continue;
    }
    const e = EASTERN_ARABIC.indexOf(ch);
    out += e >= 0 ? String(e) : ch;
  }
  return out;
}

/**
 * Blank out `[[slot]]` spans, keeping the string the same LENGTH so every
 * offset still points at the original text.
 *
 * A slot is the model doing the right thing, so anything inside one is exempt
 * by construction — "[[price of the Free]]" must not be flagged for the word
 * "price".
 */
function maskSlots(text: string): string {
  return text.replace(/\[\[[^\]]*\]\]/g, (m) => " ".repeat(m.length));
}

/** Every number-shaped run in a string, as plain digit sequences. */
function numeralsIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of toAsciiDigits(text).matchAll(/\d[\d.,:/]*/g)) {
    const raw = m[0].replace(/[.,:/]+$/, "");
    if (raw === "") continue;
    out.add(raw);
    // Also the bare digits, so "1,550" in the facts covers "1550" in the reply.
    const bare = raw.replace(/[.,:/]/g, "");
    if (bare !== "") out.add(bare);
  }
  return out;
}

/* ── The lexicons ────────────────────────────────────────────────────────── */

/**
 * Promises about WHEN, which need no digit and are the commonest invention.
 * A model that does not know the delivery date will still cheerfully say
 * "next week" unless something checks.
 */
const TIME_PROMISES = [
  "today", "tonight", "tomorrow", "this week", "next week", "this month",
  "next month", "within a few days", "in a few days", "shortly", "very soon",
  "by monday", "by tuesday", "by wednesday", "by thursday", "by friday",
  "by saturday", "by sunday",
  "aujourd'hui", "demain", "cette semaine", "la semaine prochaine", "bientot",
  "bukra", "boukra", "lyom", "hal esbou3", "el esbou3 el jay",
  "غدا", "اليوم", "الأسبوع المقبل", "قريبا",
];

/**
 * Softer commitments — a promise of stock, a discount, a guarantee.
 *
 * Forgiven when the reply is plainly only offering to CHECK, because a
 * verifier that cries wolf on the safe phrasing teaches people to ignore the
 * marks, which costs more than it saves.
 */
const MONEY_CHECK = [
  "discount", "remise", "guarantee", "guaranteed", "we promise", "definitely",
  "for sure", "in stock", "available now", "free of charge", "no charge",
  "akeed", "mawjoud", "garanti", "خصم", "مضمون",
];

/**
 * Agreeing to a PAYMENT ARRANGEMENT on Monza's behalf. Never suppressed.
 *
 * Caught twice on screen. First: "we can combine the two $1,200 installments
 * next week." Then, after that phrasing was covered: "Sure, we can arrange a
 * combined payment next week. Let me check the details…" — which agrees AND
 * offers to check, so a blanket "it also says let me check" exemption let it
 * through. The agreement is the dangerous half and is flagged on its own terms.
 */
const PAYMENT_AGREEMENT = [
  "we can combine", "can combine the", "a combined payment", "we can merge",
  "we can arrange to", "we can arrange for", "we can arrange a",
  "we can receive the", "we can accept",
  "pay them together", "pay two together", "pay both together",
  "installments together", "payments together",
  "we can postpone", "we can delay", "we can push", "we can move the due",
  "that is fine to pay", "no problem to pay", "we can extend",
];

/**
 * Phrases that look like agreement but are only an offer to CHECK.
 *
 * Without these, "let me see what we can arrange" would be flagged as hard as
 * "we can arrange it" — and a verifier that cries wolf on the safe phrasing
 * teaches people to ignore the marks, which costs more than it saves.
 */
const CHECKING_NOT_AGREEING = [
  "let me check", "i will check", "i'll check", "let me see what",
  "let me confirm", "i will confirm", "i'll confirm", "come back to you",
  "get back to you",
];

/** Openers that mean the model is talking ABOUT the task, not doing it. */
const LEAKED_REASONING = [
  /^\s*we need to\b/i,
  /^\s*the user\b/i,
  /^\s*let'?s\b/i,
  /^\s*first,/i,
  /^\s*as an ai\b/i,
  /^\s*i (cannot|can'?t|am unable)\b/i,
  /^\s*(sure|certainly|of course|here'?s|here is)\b[^:\n]{0,48}:/i,
];

/**
 * The model writing as the CUSTOMER rather than as Monza. Rare but disastrous:
 * the salesperson sends the customer their own words back.
 */
const SPEAKER_COLLAPSE = [
  // Contracted AND expanded — "sorry I've been" and "sorry I have been" are the
  // same sentence, and an earlier version only caught the apostrophe.
  /^\s*sorry,?\s+i\s*('ve|'m|\s+(have|am|was))\b/i,
  /^\s*i\s*('ll|\s+will)\s+pay\b/i,
  /^\s*can i pay\b/i,
  /^\s*thanks? for the (reminder|update|message)\b/i,
  /^\s*my (car|payment|installment)\b/i,
];

/** Corporate phrases the house voice bans outright. */
const BANNED_VOCABULARY = [
  "kindly", "esteemed", "valued customer", "as per",
  "at your earliest convenience", "we regret to inform", "how may i assist you",
];

/** A WhatsApp reply longer than this is not a reply, it is an essay. */
const TOO_LONG = 480;

/* ── Scanning ────────────────────────────────────────────────────────────── */

function findAll(
  haystack: string,
  needle: string,
  reason: string
): FlagSpan[] {
  const flags: FlagSpan[] = [];
  const lowerHay = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  let from = 0;
  for (;;) {
    const at = lowerHay.indexOf(lowerNeedle, from);
    if (at === -1) break;
    flags.push({
      start: at,
      end: at + needle.length,
      text: haystack.slice(at, at + needle.length),
      reason,
    });
    from = at + needle.length;
  }
  return flags;
}

export interface VerifyInput {
  /** The drafted reply, slots included. */
  reply: string;
  /** Every string from the FACTS block the model was given. */
  facts: readonly string[];
  /** What the customer themselves wrote — their words are fair game to repeat. */
  customerText: readonly string[];
  /** True when the last message was ours, so an empty reply is legitimate. */
  awaitingCustomer?: boolean;
}

/**
 * Check a draft.
 *
 * `ok`     nothing unsupported — the card offers "Use this" normally.
 * `check`  something did not come from the facts — shown, marked, still usable
 *          because the salesperson may well know it is right.
 * `reject` not a message to a customer — never offered.
 */
export function verifyDraft(input: VerifyInput): VerifyResult {
  const reply = input.reply.trim();

  if (reply === "") {
    // Legitimate only when we spoke last and there is genuinely nothing to add.
    return input.awaitingCustomer
      ? { level: "ok", flags: [] }
      : {
          level: "reject",
          flags: [],
          rejection: "The model produced no reply to a customer's message.",
        };
  }

  for (const re of LEAKED_REASONING) {
    if (re.test(reply)) {
      return {
        level: "reject",
        flags: [],
        rejection: "The model explained itself instead of writing a reply.",
      };
    }
  }
  for (const re of SPEAKER_COLLAPSE) {
    if (re.test(reply)) {
      return {
        level: "reject",
        flags: [],
        rejection: "The model wrote as the customer instead of as Monza.",
      };
    }
  }

  // Slots are the model doing the right thing — exempt everything inside them.
  const masked = maskSlots(reply);
  const flags: FlagSpan[] = [];

  /* Numbers that came from nowhere. */
  const allowed = new Set<string>();
  for (const source of [...input.facts, ...input.customerText]) {
    for (const n of numeralsIn(source)) allowed.add(n);
  }
  const asciiMasked = toAsciiDigits(masked);
  for (const m of asciiMasked.matchAll(/\d[\d.,:/]*/g)) {
    const raw = m[0].replace(/[.,:/]+$/, "");
    if (raw === "") continue;
    const bare = raw.replace(/[.,:/]/g, "");
    if (allowed.has(raw) || allowed.has(bare)) continue;
    // Arabizi uses digits AS LETTERS — 3 for ع, 7 for ح, 2 for ء. A lone digit
    // glued to letters ("3andak", "mnee7") is a letter, not a claim.
    const before = masked[(m.index ?? 0) - 1] ?? " ";
    const after = masked[(m.index ?? 0) + m[0].length] ?? " ";
    if (/[a-z]/i.test(before) || /[a-z]/i.test(after)) continue;
    flags.push({
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      text: reply.slice(m.index ?? 0, (m.index ?? 0) + m[0].length),
      reason: "This number is not in the facts you were shown.",
    });
  }

  /* Promises about when. */
  const factsBlob = [...input.facts, ...input.customerText].join(" ").toLowerCase();
  for (const phrase of TIME_PROMISES) {
    if (factsBlob.includes(phrase)) continue;
    flags.push(
      ...findAll(masked, phrase, "This promises a time nobody has confirmed.")
    );
  }

  /* Commitments about money or availability.
   *
   * A reply that ALSO offers to check is treated as checking rather than
   * agreeing: "let me see what we can arrange" is the safe phrasing, and
   * flagging it as hard as "we can arrange it" would teach people to ignore
   * the marks. */
  const lowerReply = masked.toLowerCase();
  const isChecking = CHECKING_NOT_AGREEING.some((p) => lowerReply.includes(p));

  // Softer commitments — a promise of stock or a discount — are forgiven when
  // the reply is plainly only offering to check.
  if (!isChecking) {
    for (const phrase of MONEY_CHECK) {
      flags.push(
        ...findAll(masked, phrase, "This commits Monza to something — check it.")
      );
    }
  }

  // Agreeing a payment arrangement is never forgiven. Adding "let me check the
  // details" afterwards does not undo "Sure, we can arrange a combined payment"
  // — the customer has already read the agreement.
  for (const phrase of PAYMENT_AGREEMENT) {
    flags.push(
      ...findAll(
        masked,
        phrase,
        "This agrees a payment arrangement — only you can do that."
      )
    );
  }

  /* House-voice violations. */
  for (const phrase of BANNED_VOCABULARY) {
    flags.push(...findAll(masked, phrase, "Monza does not write like this."));
  }

  if (reply.length > TOO_LONG) {
    flags.push({
      start: TOO_LONG,
      end: reply.length,
      text: reply.slice(TOO_LONG),
      reason: "Longer than a WhatsApp reply should be.",
    });
  }

  // Overlapping flags read as noise; keep the earliest at each position.
  const deduped = flags
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .filter((f, i, all) => i === 0 || f.start >= all[i - 1].end);

  return { level: deduped.length > 0 ? "check" : "ok", flags: deduped };
}

/** Split a reply into plain and flagged runs, for rendering. */
export function segmentsOf(
  reply: string,
  flags: readonly FlagSpan[]
): { text: string; flagged: boolean; reason?: string }[] {
  if (flags.length === 0) return [{ text: reply, flagged: false }];
  const out: { text: string; flagged: boolean; reason?: string }[] = [];
  let at = 0;
  for (const f of flags) {
    if (f.start > at) out.push({ text: reply.slice(at, f.start), flagged: false });
    out.push({ text: reply.slice(f.start, f.end), flagged: true, reason: f.reason });
    at = f.end;
  }
  if (at < reply.length) out.push({ text: reply.slice(at), flagged: false });
  return out;
}
