/**
 * THE MANDATORY REGRESSION SET (Samer, 2026-09-17).
 *
 * Every case is a customer conversation run through the real engine, the
 * real workbook facts and the real media library, and its LAST reply is
 * classified exactly one way:
 *
 *   PASS                   what the workbook asks for
 *   WRONG ANSWER           an answer, but not the one asked for (or an internal label leaked)
 *   NO ANSWER              the customer got nothing and nobody was told
 *   UNSAFE-INVENTED FACT   a figure that is not in the approved knowledge
 *   HANDOFF REQUIRED       a person was needed and no alert was raised
 *
 * The target is 0 wrong, 0 silent ignores, 0 invented facts, 0 internal
 * labels. The summary test at the end fails on the first non-PASS, and the
 * per-case tests say which one.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { runConversation } from "@/lib/wasales/flow";
import type { EngineInput } from "@/lib/wasales/engine";
import type { AlertKind } from "@/lib/wasales/actions";
import { needsPerson } from "@/lib/wasales/suggest";
import { triageInbound } from "@/lib/wasales/triage";
import { MONZA_KNOWLEDGE } from "@/lib/wasales/knowledge";
import { folderMedia, loadCatalog } from "@/lib/wasales/catalog";
import type { OutboundPart } from "@/lib/wasales/templates";
import type { SalesChannel } from "@/lib/wasales/knowledge";

const DEPS = { knowledge: MONZA_KNOWLEDGE, catalog: loadCatalog(), media: folderMedia, ttlHours: 72 };
/** Thursday 17 September 2026, 12:00 in Beirut: the showroom is open. */
const NOW = "2026-09-17T09:00:00.000Z";
const SEND = { autoSendEnabled: true, replyWindowOpen: true, humanLock: false, liveSending: true, attachmentsSupported: true } as const;

type Verdict = "PASS" | "WRONG ANSWER" | "NO ANSWER" | "UNSAFE-INVENTED FACT" | "HANDOFF REQUIRED";

interface Case {
  category: string;
  name: string;
  messages: (string | Partial<EngineInput>)[];
  brand?: string;
  channel?: SalesChannel;
  now?: string;
  /** Every pattern must appear in the customer-facing text. */
  say?: RegExp[];
  /** No pattern may appear. */
  notSay?: RegExp[];
  /** Files expected in the last reply. */
  files?: number;
  /** A sales alert of this kind must be raised in the last turn. */
  alert?: AlertKind;
  /** The bot is expected to say nothing, and a person must be told. */
  quietForPerson?: boolean;
  /** The bot is expected to say nothing, and that is right (an "ok"). */
  quietOk?: boolean;
}

/* ── The allowed figures: anything numeric the bot says must come from here ── */

const APPROVED_NUMBERS = new Set<string>();
const addNumbers = (s: string) => {
  for (const m of s.matchAll(/\d[\d,.:–-]*\d|\d/g)) APPROVED_NUMBERS.add(m[0]);
};
addNumbers(JSON.stringify(MONZA_KNOWLEDGE));
for (const n of ["2026", "2027"]) APPROVED_NUMBERS.add(n); // model years, workbook E
for (let i = 1; i <= 31; i++) APPROVED_NUMBERS.add(String(i)); // list numbering, days of the month
for (const n of ["10:00", "17:00", "14:00", "8:00", "6:00", "2:00"]) APPROVED_NUMBERS.add(n); // showroom and test-drive hours (workbook B/C)
for (const n of ["0–100", "0-100", "100"]) APPROVED_NUMBERS.add(n); // "0–100 km/h acceleration" is the customer's question named back

const TIME_OR_PHONE = /^\d{1,2}:\d{2}$|^\+?\d{7,}$/;

/** The words a customer would read: text parts and button titles, never file names. */
function customerText(plan: readonly OutboundPart[]): string {
  return plan
    .filter((p): p is Extract<OutboundPart, { kind: "text" }> => p.kind === "text")
    .map((p) => [p.text, ...p.choices.map((c) => c.title)].join("\n"))
    .join("\n");
}

const INTERNAL_LABEL = /\b[A-Z]{2,}_[A-Z_]+\b|\.mp4\b|\.pdf\b|video-send|brochure-send|\bstandard\b|\bnull\b|\bundefined\b/i;

function inventedNumbers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\+?\d[\d,.:–-]*\d|\d/g)) {
    const n = m[0].replace(/^\+/, "");
    if (APPROVED_NUMBERS.has(n) || TIME_OR_PHONE.test(n)) continue;
    // A phone number is written with spaces: "70 70 85 85" is four approved pairs.
    out.push(n);
  }
  return out;
}

function run(c: Case) {
  const brand = c.brand ?? "monza";
  const channel = c.channel ?? "whatsapp";
  const t0 = Date.parse(c.now ?? NOW);
  const inputs: EngineInput[] = c.messages.map((m, i) => ({
    text: "",
    brand,
    channel,
    conversationIsNew: i === 0,
    now: new Date(t0 + i * 60_000).toISOString(),
    ...(typeof m === "string" ? { text: m } : m),
  }));
  const { turns } = runConversation(inputs, DEPS, { channel, ...SEND });
  return turns[turns.length - 1];
}

function classify(c: Case): { verdict: Verdict; why: string } {
  const turn = run(c);
  const text = customerText(turn.plan);
  const alerts = turn.decision.actions.filter((a) => a.type === "ALERT_SALES").map((a) => a.kind);
  const files = turn.plan.filter((p) => p.kind === "file").length;

  if (c.quietOk) {
    return text === "" && files === 0 ? { verdict: "PASS", why: "quiet, as it should be" } : { verdict: "WRONG ANSWER", why: `spoke when it should stay quiet: ${text.slice(0, 80)}` };
  }
  if (c.quietForPerson) {
    if (text !== "" || files > 0) return { verdict: "WRONG ANSWER", why: `answered what a person should read: ${text.slice(0, 80)}` };
    return alerts.length > 0 || needsPerson(turn.decision.reasons)
      ? { verdict: "PASS", why: "quiet, and a person is told" }
      : { verdict: "HANDOFF REQUIRED", why: `quiet and nobody told: ${turn.decision.reasons.join(" | ")}` };
  }
  if (text === "" && files === 0) return { verdict: "NO ANSWER", why: turn.decision.reasons.join(" | ") || "no reason given" };

  const invented = inventedNumbers(text);
  if (invented.length > 0) return { verdict: "UNSAFE-INVENTED FACT", why: `figures not in the approved knowledge: ${invented.join(", ")}` };
  const label = INTERNAL_LABEL.exec(text);
  if (label) return { verdict: "WRONG ANSWER", why: `internal label reached the customer: "${label[0]}"` };

  if (c.alert && !alerts.includes(c.alert)) return { verdict: "HANDOFF REQUIRED", why: `expected a ${c.alert} alert, got ${alerts.join(", ") || "none"}` };
  for (const re of c.say ?? []) if (!re.test(text)) return { verdict: "WRONG ANSWER", why: `missing ${re}: ${text.replace(/\n/g, " / ").slice(0, 160)}` };
  for (const re of c.notSay ?? []) if (re.test(text)) return { verdict: "WRONG ANSWER", why: `must not say ${re}: ${text.replace(/\n/g, " / ").slice(0, 160)}` };
  if (c.files !== undefined && files !== c.files) return { verdict: "WRONG ANSWER", why: `expected ${c.files} file(s), got ${files}` };
  return { verdict: "PASS", why: "" };
}

/* ── The cases ─────────────────────────────────────────────────────────── */

const SALES = /70 70 85 85/;
const SERVICE = /76 877 278/;
const ALL_EIGHT = [/Free 318/, /Courage/, /Dream/, /Passion\b/, /Passion L/, /Taishan/, /MHERO 1/, /MHERO 2/];
const NO_MONEY = [/\$/, /USD/i, /LBP/, /lira/i, /dollar/i, /\bprice is\b/i, /\d+ ?%/, /per month/i];

const CASES: Case[] = [
  // Greetings and small talk
  { category: "greeting", name: "hi", messages: ["hi"], say: [/welcome to Monza/i, /Sales/, /Service/, /Administration/] },
  { category: "greeting", name: "Arabizi greeting", messages: ["kifak"], say: [/welcome/i] },
  { category: "greeting", name: "Arabic greeting answered in Arabic", messages: ["مرحبا"], say: [/أهلاً/, /المبيعات/], notSay: [/welcome/i] },
  { category: "acknowledgement", name: "ok after an answer never reopens the menu", messages: ["courage hp", "ok thanks"], quietOk: true },
  { category: "acknowledgement", name: "ok after hello", messages: ["hi", "ok"], quietOk: true },

  // Price, offers, stock, payment: never a figure, always a person
  { category: "price", name: "price of one model", messages: ["how much is the courage"], say: [SALES, /Courage/], notSay: NO_MONEY, alert: "PRICE", files: 1 },
  { category: "price", name: "price of two models keeps both", messages: ["how much is the courage vs taishan"], say: [/Courage/, /Taishan/, SALES], notSay: NO_MONEY, alert: "PRICE" },
  { category: "price", name: "price with no model asks which", messages: ["prices?"], say: [/Which model/i] },
  { category: "price", name: "Arabizi price", messages: ["bade el price lal courage"], say: [SALES], notSay: [...NO_MONEY, /[؀-ۿ]/], alert: "PRICE" },
  { category: "price", name: "Arabic price answered in Arabic", messages: ["شو سعر الكوراج"], say: [/فريق المبيعات/, SALES], notSay: [/sales team/i, ...NO_MONEY], alert: "PRICE" },
  { category: "discount", name: "discount", messages: ["any discount"], say: [SALES], notSay: NO_MONEY, alert: "DISCOUNT" },
  { category: "stock", name: "availability", messages: ["is the courage available now"], say: [/confirm current availability/i, SALES], notSay: [/^yes/i, /in stock/i], alert: "STOCK" },
  { category: "financing", name: "installments ask the name", messages: ["installments?"], say: [/payment facilities/i, /your name/i], notSay: NO_MONEY },
  { category: "financing", name: "name completes the lead", messages: ["installments for the courage", "Rabih"], say: [/Thank you, Rabih/], alert: "FINANCING" },
  { category: "financing", name: "phone alone completes the lead", messages: ["installments courage", "03123456"], say: [/Thank you/], alert: "FINANCING" },
  { category: "currency", name: "paying in LBP: hand-off, no money words", messages: ["can i pay in LBP"], say: [/sales team/i, SALES], notSay: [...NO_MONEY, /currency/i, /exchange/i, /rate/i], alert: "QUESTION" },
  { category: "trade-in", name: "trade-in explains the steps", messages: ["i want to trade in my car"], say: [/trade-in/i, /photos/i], notSay: NO_MONEY },
  { category: "used cars", name: "used cars go to a person", messages: ["do you have used cars"], say: [/pre-owned/i, SALES], alert: "QUESTION" },
  { category: "delivery", name: "delivery to a town", messages: ["do you deliver to tripoli"], say: [/delivery/i, SALES], alert: "QUESTION" },

  // Models, filters, categories
  { category: "model list", name: "what models", messages: ["what models do you have"], say: ALL_EIGHT },
  { category: "filter", name: "EVs", messages: ["what EVs do you have"], say: [/fully electric/i, /Courage/], notSay: [/Taishan/, /Dream/] },
  { category: "filter", name: "EREVs", messages: ["erev?"], say: [/Free 318/, /MHERO 1/], notSay: [/Courage/] },
  { category: "filter", name: "PHEVs", messages: ["which are plug in hybrid"], say: [/Dream/, /Passion/, /Taishan/, /MHERO 2/], notSay: [/Courage/] },
  { category: "filter", name: "hybrid shows both groups", messages: ["hybrid?"], say: [/EREV/, /PHEV/, /Free 318/, /Dream/] },
  { category: "filter", name: "7 seats", messages: ["7 seater?"], say: [/7 seats/, /Dream/], notSay: [/Taishan/] },
  { category: "filter", name: "6 seats", messages: ["6 seats?"], say: [/6 seats/, /Taishan/] },
  { category: "filter", name: "sedan", messages: ["do you have a sedan"], say: [/Passion/], notSay: [/Courage/, /Dream/] },
  { category: "filter", name: "MHERO account: no EV, never empty, never VOYAH", messages: ["what EVs do you have"], brand: "mhero", say: [/don't currently offer a fully electric/i, /MHERO 1/, /MHERO 2/], notSay: [/VOYAH/] },
  { category: "model", name: "just 'voyah' lists the six", messages: ["voyah"], say: [/Free 318/, /Taishan/], notSay: [/MHERO/] },
  { category: "multi-model", name: "two models with facts", messages: ["free 318 or dream?"], say: [/Free 318/, /Dream/, /Power/], files: 2 },
  { category: "model year", name: "asked about 2025", messages: ["is it a 2025 model"], say: [/2026 and 2027/] },
  { category: "other brand", name: "BYD", messages: ["do you sell BYD"], say: [/VOYAH and MHERO/] },
  { category: "sales", name: "i want to buy a car", messages: ["i want to buy a car"], say: [/Which model/i] },

  // Colours, media, brochures
  { category: "colours", name: "exterior colours of one model", messages: ["what colours does the courage come in"], say: [/exterior colour/i, /Black/, /Grey/, /White/], files: 1 },
  { category: "colours", name: "all colours lists every model", messages: ["show me all colours"], say: [/Free 318/, /Courage/, /MHERO 2/] },
  { category: "colours", name: "a colour we don't have", messages: ["courage", "red"], say: [/don't have a video .* in red/i, /Black/] },
  { category: "colours", name: "interior colours: honest, no folder names", messages: ["what interior colours for the courage"], say: [/interior/i, SALES] },
  { category: "colours", name: "Dream: one video, never 'Standard'", messages: ["dream colours"], say: [/video of the VOYAH Dream/i], files: 2 },
  { category: "colours", name: "MHERO 1 offers the videos we hold", messages: ["mhero 1 colours"], say: [/Grey/], notSay: [/Green/] },
  { category: "brochure", name: "one brochure", messages: ["send me the courage brochure"], say: [/Courage brochure/], files: 1 },
  { category: "brochure", name: "all brochures", messages: ["all brochures"], files: 8 },
  { category: "photos", name: "photos become a video offer", messages: ["send me photos of the taishan"], say: [/video of the VOYAH Taishan/i, /Black/] },
  { category: "media in", name: "a photo with no words goes to a person", messages: [{ text: "", hasMedia: true }], quietForPerson: true },

  // Facts: only the workbook's figures, held facts say so
  { category: "spec", name: "horsepower", messages: ["courage hp"], say: [/320 kW \/ 435 PS/] },
  { category: "spec", name: "held fact says not confirmed", messages: ["courage range"], say: [/not confirmed yet/, SALES], notSay: [/440/, /470/] },
  { category: "spec", name: "held Passion L range", messages: ["passion l range"], say: [/not confirmed yet/], notSay: [/1,400/] },
  { category: "spec", name: "battery", messages: ["taishan battery"], say: [/Taishan battery/i, /kWh/] },
  { category: "spec", name: "warranty for all", messages: ["warranty?"], say: [/6 years/, /10 years/, /MHERO 2/] },
  { category: "spec", name: "charging of one model only", messages: ["how long to charge the dream"], say: [/Dream/], notSay: [/Courage/] },
  { category: "spec", name: "dimensions", messages: ["courage dimensions"], say: [/mm/] },
  { category: "spec", name: "spec with no model lists all", messages: ["range?"], say: ALL_EIGHT },
  { category: "spec", name: "two models one fact", messages: ["hp of the courage and the taishan"], say: [/Courage — 320 kW/, /Taishan — not confirmed yet/] },
  { category: "compare", name: "compare two", messages: ["compare courage and taishan"], say: [/comparison/i, /Courage/, /Taishan/] },
  { category: "unsupported spec", name: "top speed", messages: ["top speed of the courage"], say: [/not in our approved information/i, SALES], alert: "QUESTION" },
  { category: "unsupported spec", name: "snow", messages: ["how does the courage drive in snow"], say: [/snow/i, /not in our approved information/i], alert: "QUESTION" },
  { category: "unsupported spec", name: "0-100", messages: ["0-100 of the taishan"], say: [/acceleration/i, /not in our approved information/i], alert: "QUESTION" },

  // Test drives
  { category: "test drive", name: "typed 'tomorrow at 3' books", messages: ["i want a test drive for the courage", "Rabih", "tomorrow at 3"], say: [/booked for Fri 18 Sep, 15:00/, /Horch Tabet/], alert: "TEST_DRIVE" },
  { category: "test drive", name: "typed date and time books", messages: ["test drive taishan", "Rabih", "18 september at 4:30"], say: [/booked for Fri 18 Sep, 16:30/], alert: "TEST_DRIVE" },
  { category: "test drive", name: "Saturday afternoon is closed: nearest free", messages: ["test drive taishan", "Rabih", "saturday afternoon"], say: [/Sat 19 Sep, 13:30/] },
  { category: "test drive", name: "today at 5 is closed: hours and free times", messages: ["test drive taishan", "Rabih", "today at 5"], say: [/Monday to Friday from 10:00 to 17:00/, /Thu 17 Sep/] },
  { category: "test drive", name: "what time is my test drive", messages: ["i want a test drive for the courage", "Rabih", "tomorrow at 3", "what time is my test drive"], say: [/booked for Fri 18 Sep, 15:00/] },
  { category: "test drive", name: "cancel", messages: ["i want a test drive for the courage", "Rabih", "tomorrow at 3", "cancel my test drive"], say: [/cancelled/i], alert: "TEST_DRIVE" },
  { category: "test drive", name: "change to a new time: one booking, not two", messages: ["i want a test drive for the courage", "Rabih", "tomorrow at 3", "change it to monday 11am"], say: [/booked for Mon 21 Sep, 11:00/], notSay: [/15:00/], alert: "TEST_DRIVE" },
  { category: "test drive", name: "time typed with the request is kept until the name arrives", messages: ["test drive courage tomorrow at 3", "Rabih"], say: [/booked for Fri 18 Sep, 15:00/], alert: "TEST_DRIVE" },
  { category: "test drive", name: "time typed before the model is noted, then the model asked", messages: ["test drive", "Rabih", "tomorrow at 3"], say: [/Fri 18 Sep, 15:00/, /Which model/i] },

  // People
  { category: "callback", name: "call me back on WhatsApp: this number, never ours", messages: ["call me back please"], say: [/call you on this number/i], notSay: [SALES], alert: "CALLBACK" },
  { category: "callback", name: "call me on Instagram asks the number", messages: ["call me"], channel: "instagram", say: [/Which phone number/i], notSay: [SALES] },
  { category: "callback", name: "Instagram number given", messages: ["call me", "03123456"], channel: "instagram", say: [/\+9613123456/], alert: "CALLBACK" },
  { category: "human", name: "talk to a human", messages: ["i want to talk to a human"], say: [/sales team/i, /this conversation/i], alert: "HUMAN" },
  { category: "human", name: "after asking for a human the bot stays out", messages: ["i want to talk to a human", "hp?"], quietForPerson: true },
  { category: "unknown", name: "gibberish goes to a person, never answered wrongly", messages: ["asdkjh qwe"], quietForPerson: true },

  // Showroom
  { category: "location", name: "where", messages: ["where are you located"], say: [/Horch Tabet/, /maps\.app\.goo\.gl/] },
  { category: "hours", name: "hours", messages: ["what are your hours"], say: [/Monday to Friday/, /8:00 AM to 6:00 PM/, /Saturday/] },
  { category: "contact", name: "number", messages: ["what's your number"], say: [SALES] },
  { category: "service", name: "service", messages: ["my car needs service"], say: [SERVICE], notSay: [SALES] },
  { category: "service", name: "parts", messages: ["spare parts"], say: [SERVICE] },
  { category: "service", name: "complaint", messages: ["my car has a problem"], say: [SERVICE] },
  { category: "after hours", name: "Sunday price adds the hours note", messages: ["price of courage"], now: "2026-09-20T09:00:00.000Z", say: [SALES, /Monday to Friday from 8:00 AM to 6:00 PM/], alert: "PRICE" },
  { category: "arabic", name: "Arabic horsepower keeps the figure, Arabic sentence", messages: ["كم حصان الكوراج"], say: [/قوة المحرك/, /320 kW \/ 435 PS/], notSay: [/produces/] },
  { category: "arabic", name: "Arabic location", messages: ["وين محلكم"], say: [/حرش تابت/, /maps\.app\.goo\.gl/] },
];

/* ── The tests ─────────────────────────────────────────────────────────── */

const results = CASES.map((c) => ({ ...c, ...classify(c) }));

describe("regression set: every case, classified", () => {
  for (const r of results) {
    test(`${r.category} · ${r.name} → ${r.verdict}`, () => {
      assert.equal(r.verdict, "PASS", r.why);
    });
  }
});

describe("regression set: the totals", () => {
  test("0 wrong, 0 silent ignores, 0 invented facts, 0 internal labels", () => {
    const tally: Record<Verdict, number> = { PASS: 0, "WRONG ANSWER": 0, "NO ANSWER": 0, "UNSAFE-INVENTED FACT": 0, "HANDOFF REQUIRED": 0 };
    for (const r of results) tally[r.verdict] += 1;
    const failing = results.filter((r) => r.verdict !== "PASS").map((r) => `${r.verdict}: ${r.category} · ${r.name} — ${r.why}`);
    assert.deepEqual(tally, { PASS: results.length, "WRONG ANSWER": 0, "NO ANSWER": 0, "UNSAFE-INVENTED FACT": 0, "HANDOFF REQUIRED": 0 }, failing.join("\n"));
  });

  test("a customer outside the pilot is classified and marked, never answered, never dropped", () => {
    const t = triageInbound({ text: "how much is the courage", hasMedia: false, brand: "monza", now: NOW }, DEPS);
    assert.equal(t?.kind, "PRICE");
    assert.ok(t && !/courage/.test(t.reason.replace(/COURAGE/, "")), "the reason names the model code, not the customer's words");
    assert.equal(triageInbound({ text: "", hasMedia: true, brand: "monza", now: NOW }, DEPS)?.kind, "NEEDS_PERSON");
  });
});
