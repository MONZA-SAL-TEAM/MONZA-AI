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
import { loadCatalog } from "@/lib/wasales/catalog";
import { liveMedia } from "@/tests/_live-library";
import type { OutboundPart } from "@/lib/wasales/templates";
import type { SalesChannel } from "@/lib/wasales/knowledge";

const DEPS = { knowledge: MONZA_KNOWLEDGE, catalog: loadCatalog(), media: liveMedia, ttlHours: 72 };
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
/** The one showroom pin (Samer, 2026-09-18): Monza SAL, Horch Tabet. Every location answer carries exactly this link. */
const MAP = /https:\/\/maps\.app\.goo\.gl\/CVPJQqXfnnbBmubZ8/;
/** Workbook B (2026-09-18): the customer is already in the Sales chat, so Sales follows up HERE. */
const HERE = /right here/;
const HANDOFF = /Our Sales Team will assist you further right here with all the details you need\./;
const ALL_EIGHT = [/Free 318/, /Courage/, /Dream/, /Passion\b/, /Passion L/, /Taishan/, /MHERO 1/, /MHERO 2/];
// Charging values hold "0% - 100%", so a percentage is only money next to a money word.
const NO_MONEY = [/\$/, /USD/i, /LBP/, /lira/i, /dollar/i, /\bprice is\b/i, /\d+ ?% ?(interest|down|off|discount)/i, /per month/i, /down payment/i, /\binterest\b/i];
const NEVER_BOOKED = [/is booked/i, /\bconfirmed for\b/i, /is cancelled/i];

const CASES: Case[] = [
  // Greetings and small talk
  { category: "greeting", name: "hi: the welcome and the five departments", messages: ["hi"], say: [/welcome to Monza/i, /Sales/, /Customer Service/, /After-Sales/, /Service & Maintenance/, /Administration/] },
  { category: "greeting", name: "Arabizi greeting", messages: ["kifak"], say: [/welcome/i] },
  { category: "greeting", name: "Arabic greeting answered in Arabic", messages: ["مرحبا"], say: [/أهلاً/, /المبيعات/], notSay: [/welcome/i] },
  { category: "departments", name: "Sales stays in this chat", messages: ["hi", { payload: "DEPT:SALES" }], say: [/Which model/i], notSay: [SALES] },
  { category: "departments", name: "Customer Service goes to the service WhatsApp", messages: ["hi", { payload: "DEPT:CUSTOMER_SERVICE" }], say: [SERVICE, /WhatsApp/], notSay: [SALES] },
  { category: "departments", name: "After-Sales goes to the service WhatsApp", messages: ["hi", { payload: "DEPT:AFTER_SALES" }], say: [SERVICE, /WhatsApp/] },
  { category: "departments", name: "Administration is a phone call", messages: ["hi", { payload: "DEPT:ADMIN" }], say: [/please call 01 488 333 or 01 488 666/], notSay: [/WhatsApp/] },
  { category: "departments", name: "a typed 5 is Administration", messages: ["hi", "5"], say: [/01 488 333/] },
  // WhatsApp delivers a tapped list row as its WORDS ("After-Sales"), never its id. These are the real taps.
  { category: "departments", name: "tapping After-Sales gives the after-sales WhatsApp, never 'which model?'", messages: ["hi", "After-Sales"], say: [SERVICE, /WhatsApp/], notSay: [/Which model/i, SALES] },
  { category: "departments", name: "tapping Customer Service", messages: ["hi", "Customer Service"], say: [SERVICE, /WhatsApp/], notSay: [/Which model/i] },
  { category: "departments", name: "tapping Service & Maintenance", messages: ["hi", "Service & Maintenance"], say: [SERVICE, /WhatsApp/], notSay: [/Which model/i] },
  { category: "departments", name: "tapping Administration", messages: ["hi", "Administration"], say: [/please call 01 488 333 or 01 488 666/], notSay: [/Which model/i] },
  { category: "departments", name: "tapping Sales asks which model", messages: ["hi", "Sales"], say: [/Which model/i], notSay: [SERVICE] },
  { category: "departments", name: "after sales asked in the middle of a sales chat", messages: ["courage", "i need after sales"], say: [SERVICE], notSay: [/Which model/i] },
  { category: "departments", name: "Arabic: tapping ما بعد البيع", messages: ["مرحبا", "ما بعد البيع"], say: [SERVICE], notSay: [/أي موديل/] },
  { category: "departments", name: "Arabic: tapping خدمة العملاء", messages: ["مرحبا", "خدمة العملاء"], say: [SERVICE], notSay: [/أي موديل/] },
  { category: "departments", name: "Arabic: tapping الصيانة", messages: ["مرحبا", "الصيانة"], say: [SERVICE], notSay: [/أي موديل/] },
  { category: "departments", name: "Arabic: tapping الإدارة", messages: ["مرحبا", "الإدارة"], say: [/01 488 333/], notSay: [/أي موديل/] },
  { category: "departments", name: "Arabic: tapping المبيعات asks which model", messages: ["مرحبا", "المبيعات"], say: [/أي موديل/], notSay: [SERVICE] },
  { category: "acknowledgement", name: "ok after an answer never reopens the menu", messages: ["courage hp", "ok thanks"], quietOk: true },
  { category: "acknowledgement", name: "ok after hello", messages: ["hi", "ok"], quietOk: true },

  // Price, offers, stock, payment: never a figure, never "call the number you are already on"
  { category: "price", name: "price: brochure + model video + same-chat hand-off", messages: ["how much is the courage"], say: [HANDOFF, /Courage in Pearl Black/], notSay: [SALES, ...NO_MONEY], alert: "PRICE", files: 2 },
  { category: "price", name: "price of two models keeps both", messages: ["how much is the courage vs taishan"], say: [/Courage/, /Taishan/, HANDOFF], notSay: [SALES, ...NO_MONEY], alert: "PRICE" },
  { category: "price", name: "price with no model asks which", messages: ["prices?"], say: [/Which model/i] },
  { category: "price", name: "the model arrives: brochure, video, hand-off", messages: ["prices?", "taishan"], say: [HANDOFF, /Taishan in Obsidian Black/], notSay: [SALES], alert: "PRICE", files: 2 },
  { category: "price", name: "Arabizi price", messages: ["bade el price lal courage"], say: [HANDOFF], notSay: [SALES, ...NO_MONEY, /[\u0600-\u06FF]/], alert: "PRICE" },
  { category: "price", name: "Arabic price answered in Arabic", messages: ["شو سعر الكوراج"], say: [/فريق المبيعات هنا/], notSay: [SALES, /Sales Team/i, ...NO_MONEY], alert: "PRICE" },
  { category: "discount", name: "discount", messages: ["any discount"], say: [HANDOFF], notSay: [SALES, ...NO_MONEY], alert: "DISCOUNT" },
  { category: "stock", name: "availability: Sales confirms, never 'yes'", messages: ["is the courage available now"], say: [/confirm the current availability/i, HERE], notSay: [/^yes/i, /in stock/i, SALES], alert: "STOCK" },
  { category: "financing", name: "installments: facilities confirmed, model asked, no name", messages: ["installments?"], say: [/we offer installment and payment facilities/i, /Which model/i], notSay: [...NO_MONEY, /your name/i], alert: "FINANCING" },
  { category: "financing", name: "installments with the model: brochure, video, Sales here", messages: ["installments for the courage"], say: [/installment and payment facilities/i, HANDOFF], notSay: [SALES, ...NO_MONEY], alert: "FINANCING", files: 2 },
  { category: "financing", name: "the model arrives after: not repeated, Sales here", messages: ["installments?", "courage"], say: [HANDOFF], alert: "FINANCING", files: 2 },
  { category: "financing", name: "in-house financing may be confirmed", messages: ["do you have in house financing for the dream"], say: [/In-house financing is available\./, HANDOFF], notSay: NO_MONEY, alert: "FINANCING" },
  { category: "financing", name: "a name typed afterwards goes to the person", messages: ["installments for the courage", "Rabih"], quietForPerson: true },
  { category: "currency", name: "paying in LBP: hand-off, no money words", messages: ["can i pay in LBP"], say: [HANDOFF], notSay: [...NO_MONEY, SALES, /currency/i, /exchange/i, /rate/i], alert: "QUESTION" },
  { category: "trade-in", name: "trade-in explains the steps", messages: ["i want to trade in my car"], say: [/trade-in/i, /photos/i], notSay: NO_MONEY },
  { category: "used cars", name: "used cars go to a person", messages: ["do you have used cars"], say: [/pre-owned/i, HERE], notSay: [SALES], alert: "QUESTION" },
  { category: "delivery", name: "delivery to a town", messages: ["do you deliver to tripoli"], say: [/delivery/i, HERE], notSay: [SALES], alert: "QUESTION" },

  // Models, filters, categories
  { category: "model list", name: "what models", messages: ["what models do you have"], say: ALL_EIGHT },
  { category: "filter", name: "EVs", messages: ["what EVs do you have"], say: [/fully electric/i, /Courage/], notSay: [/Taishan/, /Dream/] },
  { category: "filter", name: "EREVs", messages: ["erev?"], say: [/Free 318/, /MHERO 1/], notSay: [/Courage/] },
  { category: "filter", name: "PHEVs", messages: ["which are plug in hybrid"], say: [/Dream/, /Passion/, /Taishan/, /MHERO 2/], notSay: [/Courage/] },
  { category: "filter", name: "hybrid shows both groups", messages: ["hybrid?"], say: [/EREV/, /PHEV/, /Free 318/, /Dream/] },
  { category: "filter", name: "7 seats: the Dream, and the Taishan (6 to 7 seats)", messages: ["7 seater?"], say: [/7 seats/, /Dream/, /Taishan/] },
  { category: "filter", name: "6 seats", messages: ["6 seats?"], say: [/6 seats/, /Taishan/], notSay: [/Dream/] },
  { category: "filter", name: "sedan", messages: ["do you have a sedan"], say: [/Passion/], notSay: [/Courage/, /Dream/] },
  { category: "filter", name: "MHERO account: no EV, never empty, never VOYAH", messages: ["what EVs do you have"], brand: "mhero", say: [/don't currently offer a fully electric/i, /MHERO 1/, /MHERO 2/], notSay: [/VOYAH/] },
  { category: "model", name: "just 'voyah' lists the six", messages: ["voyah"], say: [/Free 318/, /Taishan/], notSay: [/MHERO/] },
  { category: "multi-model", name: "two models with facts", messages: ["free 318 or dream?"], say: [/Free 318/, /Dream/, /Power/], files: 2 },
  { category: "model year", name: "asked about 2025", messages: ["is it a 2025 model"], say: [/2026 and 2027/] },
  { category: "other brand", name: "BYD", messages: ["do you sell BYD"], say: [/VOYAH and MHERO/] },
  { category: "sales", name: "i want to buy a car", messages: ["i want to buy a car"], say: [/Which model/i] },

  // Colours (the workbook's official names), media, brochures
  { category: "colours", name: "exterior colours by their official names", messages: ["what colours does the courage come in"], say: [/exterior colour/i, /Pearl Black/, /Crayon Grey/, /Pearl White/], files: 1 },
  { category: "colours", name: "Free 318: the five official names", messages: ["free 318 colours"], say: [/Midnight Black/, /British Racing Green/, /Titanium Grey/, /Sage Green/, /Pearl White/] },
  { category: "colours", name: "'black' still finds Pearl Black, and Sales is told", messages: ["courage", "black"], say: [/Courage in Pearl Black/], alert: "LEAD", files: 1 },
  { category: "colours", name: "'sage green' is Sage Green, not British Racing Green", messages: ["free 318", "sage green"], say: [/Free 318 in Sage Green/], notSay: [/British/], alert: "LEAD" },
  { category: "colours", name: "'green' is British Racing Green", messages: ["free 318", "green"], say: [/British Racing Green/] },
  { category: "colours", name: "all colours lists every model", messages: ["show me all colours"], say: [/Free 318/, /Courage/, /MHERO 2/, /Midnight Black/] },
  { category: "colours", name: "a colour we don't have", messages: ["courage", "red"], say: [/don't have a video .* in red/i, /Pearl Black/] },
  { category: "colours", name: "interior colours: honest, no folder names", messages: ["what interior colours for the courage"], say: [/interior/i, HERE], notSay: [SALES], alert: "QUESTION" },
  { category: "colours", name: "Dream: one video, never 'Standard'", messages: ["dream colours"], say: [/video of the VOYAH Dream/i], files: 2 },
  // The live library holds the MHERO 1 in Black and Grey; Recon Green has a folder but no video yet.
  { category: "colours", name: "MHERO 1: the two colours with a video, never Recon Green without one", messages: ["mhero 1 colours"], say: [/Obsidian Black/, /Storm Grey/], notSay: [/Recon Green/], files: 1 },
  { category: "colours", name: "MHERO 1 in green: said honestly, then the real colours", messages: ["mhero 1", "green"], say: [/don't have a video of the MHERO 1 in green/i, /Obsidian Black/, /Storm Grey/] },
  { category: "colours", name: "one-video cars (Dream, Passion) send it, never a one-answer question", messages: ["passion colours"], say: [/VOYAH Passion/], notSay: [/Which exterior colour/], files: 2 },
  { category: "colours", name: "MHERO 2 never offers Polar Silver without a video", messages: ["mhero 2 colours"], say: [/Piano Black/, /Olive Green/, /Clouds White/], notSay: [/Polar Silver/] },
  { category: "brochure", name: "one brochure", messages: ["send me the courage brochure"], say: [/Courage brochure/], files: 1 },
  { category: "brochure", name: "all brochures", messages: ["all brochures"], files: 8 },
  { category: "photos", name: "photos become a video offer", messages: ["send me photos of the taishan"], say: [/video of the VOYAH Taishan/i, /Obsidian Black/] },
  { category: "media in", name: "a photo with no words goes to a person", messages: [{ text: "", hasMedia: true }], quietForPerson: true },

  // Facts: A Car Facts of 2026-09-18, exactly as stored
  { category: "spec", name: "horsepower, as stored", messages: ["courage hp"], say: [/produces 430 HP\./], notSay: [/435/, /320/] },
  { category: "spec", name: "every model's power", messages: ["hp?"], say: [/Courage — 430 HP/, /Passion — 550 hp/, /Taishan — 700 hp/, /MHERO 1 — 815 hp/] },
  // Samer, 2026-09-18: "its 550 km and if uphill 440 km" — never the video's 470.
  { category: "spec", name: "Courage range, as Samer settled it", messages: ["courage range"], say: [/offers 550 km of WLTP range on a full charge, and 440 km if uphill\./], notSay: [/470/, /not confirmed/] },
  { category: "spec", name: "Courage range in the list of every model", messages: ["range?"], say: [/Courage — 550 km of WLTP range on a full charge, and 440 km if uphill/] },
  // Samer, 2026-09-18: "leave passion s only to be answered by sales team instead of chat bot".
  { category: "passion s", name: "Passion S: Sales answers, the bot sends nothing about any car", messages: ["how much is the passion s"], say: [HANDOFF], notSay: [/brochure/i, SALES], alert: "QUESTION", files: 0 },
  { category: "passion s", name: "Passion S mid-conversation", messages: ["courage", "do you have the passion S in red?"], say: [HANDOFF], notSay: [/Passion/, /red/i], alert: "QUESTION", files: 0 },
  { category: "passion s", name: "'the passion's price' is the Passion, not the Passion S", messages: ["what is the passion's price"], say: [/Passion brochure/, HANDOFF], alert: "PRICE", files: 2 },
  { category: "passion s", name: "'passion sedan' is the Passion", messages: ["passion sedan hp"], say: [/produces 550 hp/] },
  { category: "spec", name: "Passion L range is confirmed now", messages: ["passion l range"], say: [/410 km EV \/ 1,400 km combined \(CLTC\)/] },
  { category: "spec", name: "Passion L battery is stated now", messages: ["passion l battery"], say: [/65 kWh CATL ternary lithium/] },
  { category: "spec", name: "battery", messages: ["taishan battery"], say: [/Taishan battery/i, /65 kWh CATL/] },
  { category: "spec", name: "warranty for all", messages: ["warranty?"], say: [/6 years/, /10 years/, /MHERO 2/] },
  { category: "spec", name: "charging, in the workbook's sentence", messages: ["how long to charge the free 318"], say: [/approved charging information is: 16 AMP 0% - 100% 7H/] },
  { category: "spec", name: "charging of one model only", messages: ["how long to charge the dream"], say: [/Dream/, /7 h \(6\.6 kW\)/], notSay: [/Courage/, /8\.4/] },
  { category: "spec", name: "seats stated as a range stay a range", messages: ["taishan seats"], say: [/approved seating information is: 6 to 7 seats\./] },
  { category: "spec", name: "MHERO 1 has 5 seats", messages: ["mhero 1 seats"], say: [/MHERO 1 has 5 seats\./] },
  { category: "spec", name: "dimensions", messages: ["courage dimensions"], say: [/mm/] },
  { category: "spec", name: "spec with no model lists all", messages: ["range?"], say: ALL_EIGHT },
  { category: "spec", name: "two models one fact", messages: ["hp of the courage and the taishan"], say: [/Courage — 430 HP/, /Taishan — 700 hp/] },
  { category: "compare", name: "compare two", messages: ["compare courage and taishan"], say: [/comparison/i, /Courage/, /Taishan/] },
  { category: "unsupported spec", name: "top speed", messages: ["top speed of the courage"], say: [/not in our approved information/i, HERE], notSay: [SALES], alert: "QUESTION" },
  { category: "unsupported spec", name: "snow", messages: ["how does the courage drive in snow"], say: [/snow/i, /not in our approved information/i], alert: "QUESTION" },
  { category: "unsupported spec", name: "0-100", messages: ["0-100 of the taishan"], say: [/acceleration/i, /not in our approved information/i], alert: "QUESTION" },

  // Test drives: a team member arranges and confirms them; the bot never says "booked"
  { category: "test drive", name: "request: brochure, video, Sales arranges it here", messages: ["i want a test drive for the courage"], say: [/arrange a test drive of the VOYAH Courage/, HANDOFF], notSay: [...NEVER_BOOKED, /your name/i, SALES], alert: "TEST_DRIVE", files: 2 },
  { category: "test drive", name: "no model: asked which", messages: ["test drive"], say: [/arrange a test drive for you/, /Which model/i], notSay: NEVER_BOOKED, alert: "TEST_DRIVE" },
  { category: "test drive", name: "the model arrives", messages: ["test drive", "free 318"], say: [/test drive of the VOYAH Free 318/, HANDOFF], notSay: NEVER_BOOKED, alert: "TEST_DRIVE", files: 2 },
  { category: "test drive", name: "a time typed with the request is a preference, never a booking", messages: ["test drive courage tomorrow at 3"], say: [/noted Fri 18 Sep, 15:00 as your preferred time/, /team member will confirm/], notSay: NEVER_BOOKED, alert: "TEST_DRIVE" },
  { category: "test drive", name: "a time typed afterwards is passed to Sales", messages: ["i want a test drive for the courage", "tomorrow at 3"], say: [/passed Fri 18 Sep, 15:00 to our Sales Team/], notSay: NEVER_BOOKED, alert: "TEST_DRIVE" },
  { category: "test drive", name: "a date and time", messages: ["test drive taishan", "18 september at 4:30"], say: [/passed Fri 18 Sep, 16:30/], notSay: NEVER_BOOKED, alert: "TEST_DRIVE" },
  { category: "test drive", name: "a day with no hour: Sales is told", messages: ["test drive taishan", "saturday afternoon"], say: [/let our Sales Team know/], notSay: NEVER_BOOKED, alert: "TEST_DRIVE" },
  { category: "test drive", name: "change it to a new time: passed on, nothing claimed", messages: ["i want a test drive for the courage", "tomorrow at 3", "change it to monday 11am"], say: [/passed Mon 21 Sep, 11:00/], notSay: [...NEVER_BOOKED, /15:00/], alert: "TEST_DRIVE" },
  { category: "test drive", name: "cancel: Sales is told, the bot cancels nothing", messages: ["i want a test drive for the courage", "cancel my test drive"], say: [/let our Sales Team know/], notSay: NEVER_BOOKED, alert: "TEST_DRIVE" },
  { category: "test drive", name: "what time is my test drive: a person confirms", messages: ["i want a test drive for the courage", "what time is my test drive"], say: [/team member arranges and confirms test drives/], notSay: NEVER_BOOKED, alert: "TEST_DRIVE" },

  // People
  { category: "callback", name: "call me back on WhatsApp: this number, never ours", messages: ["call me back please"], say: [/call you on this number/i], notSay: [SALES], alert: "CALLBACK" },
  { category: "callback", name: "call me on Instagram asks the number", messages: ["call me"], channel: "instagram", say: [/Which phone number/i], notSay: [SALES] },
  { category: "callback", name: "Instagram number given", messages: ["call me", "03123456"], channel: "instagram", say: [/\+9613123456/], alert: "CALLBACK" },
  { category: "human", name: "talk to a human", messages: ["i want to talk to a human"], say: [/sales team/i, /this conversation/i], alert: "HUMAN" },
  { category: "human", name: "after asking for a human the bot stays out", messages: ["i want to talk to a human", "hp?"], quietForPerson: true },
  { category: "unknown", name: "gibberish goes to a person, never answered wrongly", messages: ["asdkjh qwe"], quietForPerson: true },

  // Showroom
  { category: "location", name: "where", messages: ["where are you located"], say: [/Horch Tabet/, MAP], notSay: [/iframe/i, /orJMduowHtVqQgR58/] },
  { category: "location", name: "asked mid-conversation: the same one link", messages: ["courage", "where is the showroom"], say: [MAP] },
  { category: "hours", name: "hours: Sunday closed", messages: ["what are your hours"], say: [/Monday to Friday/, /8:00 AM to 6:00 PM/, /Saturday/, /Sunday we are closed/] },
  { category: "contact", name: "asked for the number, the number is given", messages: ["what's your number"], say: [SALES] },
  { category: "service", name: "service", messages: ["my car needs service"], say: [SERVICE, /WhatsApp/], notSay: [SALES] },
  { category: "service", name: "parts", messages: ["spare parts"], say: [SERVICE] },
  { category: "service", name: "complaint", messages: ["my car has a problem"], say: [SERVICE] },
  { category: "after hours", name: "Sunday price adds the hours note", messages: ["price of courage"], now: "2026-09-20T09:00:00.000Z", say: [HANDOFF, /Monday to Friday from 8:00 AM to 6:00 PM/], notSay: [SALES], alert: "PRICE" },
  { category: "arabic", name: "Arabic horsepower keeps the figure, Arabic sentence", messages: ["كم حصان الكوراج"], say: [/قوة المحرك/, /430 HP/], notSay: [/produces/] },
  { category: "arabic", name: "Arabic installments", messages: ["بدي تقسيط"], say: [/تسهيلات في الدفع والتقسيط/, /أي موديل/], alert: "FINANCING" },
  { category: "arabic", name: "Arabic location", messages: ["وين محلكم"], say: [/حرش تابت/, MAP] },
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
