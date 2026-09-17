/**
 * Every word the Search Engine can make a customer read — and the executor
 * that turns ordered actions into the messages a channel would carry.
 *
 * The engine decides WHAT (actions.ts); this file decides the WORDS, and only
 * from the fixed sentences below, filled with approved values: a model's
 * official name, a colour's name, a fact and the showroom sentences from
 * Samer's workbook (knowledge.ts). There is no free text and no model-written
 * sentence anywhere on this path. The sentence patterns follow the workbook's
 * E Master Bot Logic ("The VOYAH Courage produces 320 kW / 435 PS.").
 *
 * THE EXECUTOR IS A PLAN, NOT A SENDER. renderPlan() returns the messages in
 * order — text, then the file it introduces — shaped for the channel: quick
 * replies on Instagram and Messenger, reply buttons or a list on WhatsApp,
 * and a numbered list wherever the choices do not fit, whose typed answers
 * ("2") the engine reads back.
 *
 * English only, deliberately. Arabic versions need a person to write and
 * approve them; until then a customer writing in Arabic is answered in English
 * (the language is recorded, so the gap is measurable).
 *
 * Also here: the SHORT LABELS staff read on /sales ("SEND COURAGE BROCHURE"),
 * kept beside the customer wording so the two cannot drift.
 */

import type { EngineAction, FactRow, FallbackReason, TextKey } from "@/lib/wasales/actions";
import {
  categoryPayload,
  colourPayload,
  departmentPayload,
  modelPayload,
  slotPayload,
  type FactIntent,
} from "@/lib/wasales/intent";
import { slotLabel } from "@/lib/wasales/booking";
import {
  CHANNEL_LIMITS,
  mediaFitsChannel,
  modelByCode,
  type ModelCode,
  type PowertrainBucket,
  type SalesBrand,
  type SalesChannel,
  type SalesKnowledge,
} from "@/lib/wasales/knowledge";

/* ── Output shape ────────────────────────────────────────────────────────── */

export interface Choice {
  title: string;
  /** The stable payload the engine reads back: MODEL:COURAGE, COLOUR:COURAGE:BLACK. */
  payload: string;
}

export type ChoiceStyle = "quick_replies" | "buttons" | "list" | "numbered";

export type OutboundPart =
  | { kind: "text"; text: string; choices: Choice[]; style: ChoiceStyle | null }
  | {
      kind: "file";
      fileKind: "document" | "video";
      name: string;
      bytes: number | null;
      /** Where the channel fetches it; null when it is not in the shared library. */
      url: string | null;
    };

export interface RenderContext {
  channel: SalesChannel;
  brand: SalesBrand;
  knowledge: SalesKnowledge;
  /**
   * A file too big for the channel, but in the shared library, goes as a
   * tap-to-open link in the sentence instead of as an attachment.
   */
  linkOversize?: boolean;
  /**
   * "ar" answers in Arabic (Samer, 2026-09-17: reply in the customer's language).
   * Model and colour names stay as they are. The Arabic wording here was written
   * for Samer's approval; anything without an Arabic version falls back to English.
   */
  lang?: "en" | "ar";
}

let LANG: "en" | "ar" = "en";
/** The Arabic sentence when the customer wrote in Arabic, else the English one. */
const pick = (en: string, ar: string): string => (LANG === "ar" ? ar : en);

/** The address to put in the sentence, when the file must go as a link. */
function linkInstead(
  asset: { name: string; bytes: number | null; url?: string | null },
  kind: "document" | "video",
  ctx: RenderContext
): string | null {
  if (!ctx.linkOversize || !asset.url) return null;
  return mediaFitsChannel(asset, kind, ctx.channel) === null ? null : asset.url;
}

/* ── The words ───────────────────────────────────────────────────────────── */

export const BRAND_NAME: Readonly<Record<SalesBrand, string>> = {
  voyah: "VOYAH Lebanon",
  mhero: "MHERO Lebanon",
  monza: "Monza S.A.L.",
};

/** The hand-off sentence (workbook, B Showroom). */
export function contactFallbackText(k: SalesKnowledge): string {
  return pick(k.showroom.handoff, `لمزيد من المساعدة، يرجى الاتصال بنا على ${k.contact.display}.`);
}

/** The welcome (workbook, B Showroom), naming the brand of the account written to. */
function welcomeText(ctx: RenderContext): string {
  const name = BRAND_NAME[ctx.brand];
  if (LANG === "ar") return `أهلاً وسهلاً بكم في ${name.replace(/\.$/, "")}. كيف يمكننا مساعدتكم اليوم؟`;
  // "Monza S.A.L." ends the sentence with its own dot; another name needs one.
  return ctx.knowledge.showroom.welcome.replace("Monza S.A.L.", name.endsWith(".") ? name : `${name}.`);
}

function listWords(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(pick(", ", "، "))} ${pick("or", "أو")} ${names[names.length - 1]}`;
}

function andWords(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(pick(", ", "، "))} ${pick("and", "و")} ${names[names.length - 1]}`;
}

function nameOf(k: SalesKnowledge, code: ModelCode): string {
  return modelByCode(k, code)?.displayName ?? code;
}

const FACT_NAME: Readonly<Record<FactIntent, string>> = {
  HORSEPOWER: "power output",
  RANGE: "range",
  BATTERY: "battery capacity",
  POWERTRAIN: "powertrain",
  CHARGING: "charging time",
  SEATS: "number of seats",
  DIMENSIONS: "dimensions",
  SPECIFICATIONS: "specifications",
  WARRANTY: "warranty",
};

const FACT_LABEL: Readonly<Record<FactIntent, string>> = {
  HORSEPOWER: "Power",
  RANGE: "Range",
  BATTERY: "Battery",
  POWERTRAIN: "Powertrain",
  CHARGING: "Charging",
  SEATS: "Seats",
  DIMENSIONS: "Dimensions",
  SPECIFICATIONS: "Specifications",
  WARRANTY: "Warranty",
};

/** Headers for a list covering every car (workbook E, section 5). */
const ALL_HEADER: Readonly<Record<FactIntent, string>> = {
  HORSEPOWER: "Here is the power output for our current models:",
  RANGE: "Here is the range of our current models:",
  BATTERY: "Here is the battery information for our current models:",
  POWERTRAIN: "Here is the powertrain of each of our current models:",
  CHARGING: "Here is the charging information for our current models:",
  SEATS: "Here is the number of seats in each of our current models:",
  DIMENSIONS: "Here are the dimensions of our current models:",
  SPECIFICATIONS: "Here are the specifications of our current models:",
  WARRANTY: "Here is the warranty on our current models:",
};

const FACT_NAME_AR: Readonly<Record<FactIntent, string>> = {
  HORSEPOWER: "قوة المحرك",
  RANGE: "المدى",
  BATTERY: "سعة البطارية",
  POWERTRAIN: "نظام الدفع",
  CHARGING: "وقت الشحن",
  SEATS: "عدد المقاعد",
  DIMENSIONS: "الأبعاد",
  SPECIFICATIONS: "المواصفات",
  WARRANTY: "الكفالة",
};

/** "not confirmed yet": what a customer reads when the workbook says a figure is not stated. */
function notConfirmed(row: FactRow, k: SalesKnowledge): string {
  return pick(
    `The exact ${FACT_NAME[row.fact]} of the ${nameOf(k, row.model)} is not confirmed yet. Our team can confirm it for you on ${k.contact.display}.`,
    `${FACT_NAME_AR[row.fact]} لسيارة ${nameOf(k, row.model)} غير مؤكد بعد. يمكن لفريقنا تأكيده لكم على ${k.contact.display}.`
  );
}

/** One fact of one car, as a sentence (workbook E, section 4). */
function factSentence(row: FactRow, k: SalesKnowledge): string {
  if (!row.confirmed) return notConfirmed(row, k);
  const car = nameOf(k, row.model);
  const v = row.value;
  if (LANG === "ar") return `${FACT_NAME_AR[row.fact]} لسيارة ${car}: ${v}.`;
  switch (row.fact) {
    case "HORSEPOWER":
      return `The ${car} produces ${v}.`;
    case "RANGE":
      return `The ${car} offers ${v}.`;
    case "BATTERY":
      return `The ${car} battery: ${v}.`;
    case "POWERTRAIN":
      return `The ${car} powertrain: ${v}.`;
    case "CHARGING":
      return `Charging for the ${car}: ${v}.`;
    case "SEATS":
      return /^\d+$/.test(v) ? `The ${car} has ${v} seats.` : `The ${car} has ${v.replace(/^(\d+)/, "$1 seats")}.`;
    case "DIMENSIONS":
      return `The ${car} measures ${v}.`;
    case "WARRANTY":
      return `The ${car} comes with a warranty of ${v}.`;
    case "SPECIFICATIONS":
      return `${car}: ${v}.`;
  }
}

/** One fact as a labelled line in a list of several cars. */
function factLine(row: FactRow, k: SalesKnowledge, label: "model" | "fact"): string {
  const value = row.confirmed ? row.value : pick("not confirmed yet", "غير مؤكد بعد");
  return label === "model" ? `• ${nameOf(k, row.model)} — ${value}` : `• ${pick(FACT_LABEL[row.fact], FACT_NAME_AR[row.fact])}: ${value}`;
}

function uniqueInOrder<T>(items: readonly T[]): T[] {
  const out: T[] = [];
  for (const i of items) if (!out.includes(i)) out.push(i);
  return out;
}

function renderFacts(a: Extract<EngineAction, { type: "SEND_FACTS" }>, k: SalesKnowledge): string {
  const models = uniqueInOrder(a.rows.map((r) => r.model));
  const facts = uniqueInOrder(a.rows.map((r) => r.fact));
  if (models.length === 1) {
    if (facts.length === 1) return factSentence(a.rows[0], k);
    return [`${nameOf(k, models[0])}:`, ...a.rows.map((r) => factLine(r, k, "fact"))].join("\n");
  }
  if (facts.length === 1) {
    const header = a.scope === "all" ? pick(ALL_HEADER[facts[0]], `${FACT_NAME_AR[facts[0]]} لموديلاتنا الحالية:`) : `${pick(FACT_LABEL[facts[0]], FACT_NAME_AR[facts[0]])}:`;
    return [header, ...a.rows.map((r) => factLine(r, k, "model"))].join("\n");
  }
  return models
    .map((m) => [nameOf(k, m), ...a.rows.filter((r) => r.model === m).map((r) => factLine(r, k, "fact"))].join("\n"))
    .join("\n\n");
}

function renderComparison(a: Extract<EngineAction, { type: "SEND_COMPARISON" }>, k: SalesKnowledge): string {
  const header =
    a.models.length > 3
      ? pick("Here is a comparison of our current models:", "مقارنة بين موديلاتنا الحالية:")
      : pick(`Here is a side-by-side comparison of the ${andWords(a.models.map((m) => nameOf(k, m)))}:`, `مقارنة بين ${andWords(a.models.map((m) => nameOf(k, m)))}:`);
  const blocks = a.models.map((m) =>
    [nameOf(k, m), ...a.rows.filter((r) => r.model === m).map((r) => factLine(r, k, "fact"))].join("\n")
  );
  return [header, ...blocks].join("\n\n");
}

const BUCKET_TITLE: Readonly<Record<PowertrainBucket, string>> = {
  EV: "Fully electric (EV)",
  EREV: "Range-extended electric (EREV)",
  PHEV: "Plug-in hybrid (PHEV)",
};
const BUCKET_TITLE_AR: Readonly<Record<PowertrainBucket, string>> = {
  EV: "كهربائية بالكامل (EV)",
  EREV: "كهربائية بمدى موسّع (EREV)",
  PHEV: "هجينة قابلة للشحن (PHEV)",
};

function renderText(key: TextKey, models: readonly ModelCode[], vars: Record<string, string>, ctx: RenderContext): string {
  const k = ctx.knowledge;
  const cars = andWords(models.map((m) => nameOf(k, m)));
  const number = k.contact.display;
  if (LANG === "ar") {
    const ar = renderTextAr(key, models, cars, vars, k);
    if (ar) return ar;
  }
  switch (key) {
    case "PRICE_HANDOFF":
      return models.length > 0 && models.length <= 3
        ? `For current pricing of the ${cars}, please contact our sales team on ${number}.`
        : `For current pricing, please contact our sales team on ${number}.`;
    case "FINANCING_INFO":
      return "Yes, installment and payment facilities are available. The plan depends on the vehicle and the payment structure, and our sales team will go through the details with you.";
    case "ASK_NAME":
      return "May I have your name, so our sales team can contact you with the details?";
    case "ASK_NAME_AND_PHONE":
      return "May I have your name and phone number, so our sales team can contact you with the details?";
    case "LEAD_THANKS":
      return vars.name
        ? `Thank you, ${vars.name}. Our sales team will contact you shortly.`
        : "Thank you. Our sales team will contact you shortly.";
    case "TEST_DRIVE_ASK_NAME":
      return models.length > 0
        ? `We'd be happy to book a test drive of the ${cars}. May I have your name?`
        : "We'd be happy to book a test drive for you. May I have your name?";
    case "TEST_DRIVE_BOOKED":
      return `Your test drive${cars ? ` of the ${cars}` : ""} is booked for ${vars.slot ?? "the time you chose"}. ${k.global.LOCATION?.value ?? ""}`.trim();
    case "TEST_DRIVE_NO_SLOTS":
      return `There is no free test-drive time in the next few days. Our sales team will contact you to arrange one, or you can call ${number}.`;
    case "STOCK_CONFIRM":
      return `Our sales team will confirm current availability${cars && models.length <= 3 ? ` of the ${cars}` : ""}. You can also reach them on ${number}.`;
    case "DISCOUNT_HANDOFF":
      return `For current offers${cars && models.length <= 3 ? ` on the ${cars}` : ""}, please contact our sales team on ${number}.`;
    case "TRADE_IN_INFO":
      return [
        "Yes, we do accept trade-ins.",
        "We can evaluate your current vehicle and apply its value toward the purchase of your new car.",
        "To start the valuation, please send us:\n• Car make and model\n• Year\n• Mileage\n• A few clear photos of the exterior and interior",
        "Once we receive the details, our team can review the vehicle and guide you through the next steps.",
      ].join("\n\n");
    case "TRADE_IN_THANKS":
      return "Thank you. Our team will review your vehicle details and contact you about the valuation.";
    case "SERVICE_CONTACT":
      return k.showroom.serviceContact;
    case "ADMIN_CONTACT":
      return k.showroom.administration
        ? `For administration, please contact ${k.showroom.administration}.`
        : k.showroom.handoff;
    case "MODEL_YEAR":
      return models.length > 0
        ? `Our current models are 2026 and 2027 models. Our team can confirm the exact model year of the ${cars}.`
        : "All our current models are 2026 and 2027 models.";
    case "COMPLAINT_CONTACT":
      return `For assistance with a vehicle issue, please contact Service & Maintenance on ${k.showroom.serviceNumber}.`;
    case "OTHER_BRAND":
      return "We currently specialize in VOYAH and MHERO vehicles in Lebanon.";
    case "HANDOFF":
      return k.showroom.handoff;
    case "ASK_PHONE":
      return "And a phone number our sales team can reach you on?";
    case "CATEGORY_NONE":
      return `We don't currently offer a ${vars.kind ?? "model of that type"} in this range. What we do offer:\n${vars.alternatives ?? ""}`;
    case "DELIVERY_INFO":
      return `Our sales team can arrange delivery details with you. They will get back to you, and you can also reach them on ${number}.`;
    case "PAYMENT_HANDOFF":
      return `Our sales team will get back to you on this shortly. You can also reach them on ${number}.`;
    case "USED_CARS_INFO":
      return `Our sales team can help you with pre-owned vehicles and what is currently available. They will get back to you, and you can also reach them on ${number}.`;
    case "HUMAN_HANDOFF":
      return "Of course. A member of our sales team will take over this conversation and reply to you here shortly.";
    case "CALLBACK_CONFIRMED":
      return vars.phone
        ? `Certainly. Our sales team will call you on ${vars.phone} shortly.`
        : "Certainly. Our sales team will call you on this number shortly.";
    case "CALLBACK_ASK_NUMBER":
      return "Certainly. Which phone number should our sales team call you on?";
    case "INTERIOR_INFO":
      return models.length > 0
        ? `I don't have interior colour details or interior media for the ${cars} in our approved information yet. The brochure shows the interior, and our team can confirm the interior options on ${number}.`
        : `I don't have interior colour details in our approved information yet. Which model are you interested in? I can send its brochure, which shows the interior.`;
    case "PHOTOS_INFO":
      return models.length > 0
        ? `I don't have photos to send here, but I can send you a video of the ${cars}.`
        : "I don't have photos to send here, but I can send you a video. Which model are you interested in?";
    case "SPEC_NOT_CONFIRMED":
      return models.length > 0
        ? `The exact ${vars.detail ?? "detail"} of the ${cars} is not in our approved information yet. The brochure has the full specifications, and our team can confirm it on ${number}.`
        : `The exact ${vars.detail ?? "detail"} is not in our approved information yet. Our team can confirm it on ${number}.`;
    case "TEST_DRIVE_CANCELLED":
      return `Your test drive${vars.slot ? ` on ${vars.slot}` : ""} is cancelled. Whenever you'd like to book another, just tell me.`;
    case "TEST_DRIVE_WHEN":
      return `Your test drive${cars ? ` of the ${cars}` : ""} is booked for ${vars.slot ?? "the time you chose"}.`;
    case "TEST_DRIVE_NONE":
      return "You don't have a test drive booked with us yet.";
    case "TEST_DRIVE_TIME_CLOSED":
      return `Test drives are available Monday to Friday from 10:00 to 17:00 and Saturday from 10:00 to 14:00. ${vars.day ? `Here are the free times on ${vars.day}:` : "Here are the next free times:"}`;
    case "TEST_DRIVE_TAKEN":
      return `${vars.slot ?? "That time"} is already taken. Here are the free times closest to it:`;
    case "TEST_DRIVE_TIME_NOTED":
      return `Noted, ${vars.slot ?? "that time"}. Which model would you like to test drive?`;
    case "TEST_DRIVE_RESCHEDULE":
      return `Your test drive${vars.slot ? ` on ${vars.slot}` : ""} is cancelled. Please choose a new time:`;
    case "AFTER_HOURS_NOTE":
      return "Our team is available Monday to Friday from 8:00 AM to 6:00 PM and Saturday from 8:00 AM to 2:00 PM, and will follow up with you during working hours.";
  }
}

/** The showroom facts in Arabic: the same address, hours and number the workbook gives. */
function globalAr(key: string, value: string, k: SalesKnowledge): string {
  switch (key) {
    case "LOCATION": {
      const link = value.match(/https?:\/\/\S+/)?.[0];
      return `صالة العرض في حرش تابت، بيروت.${link ? `\n${link}` : ""}`;
    }
    case "OPENING_HOURS":
      return "صالة العرض مفتوحة من الاثنين إلى الجمعة من 8:00 صباحاً حتى 6:00 مساءً، والسبت من 8:00 صباحاً حتى 2:00 ظهراً. يوم الأحد والعطل الرسمية يؤكدها أحد أعضاء الفريق.";
    case "CONTACT_NUMBER":
      return `للاستفسارات، يرجى التواصل معنا على ${k.contact.display}.`;
    default:
      return value;
  }
}

/** The Arabic fixed sentences (written for Samer's approval, 2026-09-17). Null: English is used. */
function renderTextAr(key: TextKey, models: readonly ModelCode[], cars: string, vars: Record<string, string>, k: SalesKnowledge): string | null {
  const n = k.contact.display;
  const svc = k.showroom.serviceNumber;
  switch (key) {
    case "PRICE_HANDOFF":
      return models.length > 0 && models.length <= 3 ? `لمعرفة السعر الحالي لسيارة ${cars}، يرجى التواصل مع فريق المبيعات على ${n}.` : `لمعرفة الأسعار الحالية، يرجى التواصل مع فريق المبيعات على ${n}.`;
    case "FINANCING_INFO":
      return "نعم، تتوفر لدينا تسهيلات في الدفع والتقسيط. تختلف الخطة بحسب السيارة وطريقة الدفع، وسيشرح لكم فريق المبيعات التفاصيل.";
    case "ASK_NAME":
      return "ممكن نعرف اسمكم الكريم ليتواصل معكم فريق المبيعات بالتفاصيل؟";
    case "ASK_NAME_AND_PHONE":
      return "ممكن نعرف اسمكم ورقم هاتفكم ليتواصل معكم فريق المبيعات بالتفاصيل؟";
    case "ASK_PHONE":
      return "وما هو رقم الهاتف الذي يمكن لفريق المبيعات التواصل معكم عليه؟";
    case "LEAD_THANKS":
      return vars.name ? `شكراً ${vars.name}. سيتواصل معكم فريق المبيعات قريباً.` : "شكراً لكم. سيتواصل معكم فريق المبيعات قريباً.";
    case "TEST_DRIVE_ASK_NAME":
      return models.length > 0 ? `يسعدنا حجز تجربة قيادة لسيارة ${cars}. ممكن نعرف اسمكم الكريم؟` : "يسعدنا حجز تجربة قيادة لكم. ممكن نعرف اسمكم الكريم؟";
    case "TEST_DRIVE_BOOKED":
      return `تم حجز تجربة القيادة${cars ? ` لسيارة ${cars}` : ""} يوم ${vars.slot ?? ""}. ${k.global.LOCATION?.value ?? ""}`.trim();
    case "TEST_DRIVE_NO_SLOTS":
      return `لا يوجد موعد متاح لتجربة القيادة في الأيام القليلة المقبلة. سيتواصل معكم فريق المبيعات لتحديد موعد، ويمكنكم الاتصال على ${n}.`;
    case "STOCK_CONFIRM":
      return `سيؤكد لكم فريق المبيعات التوفر الحالي${cars && models.length <= 3 ? ` لسيارة ${cars}` : ""}. يمكنكم أيضاً التواصل معهم على ${n}.`;
    case "DISCOUNT_HANDOFF":
      return `لمعرفة العروض الحالية${cars && models.length <= 3 ? ` على ${cars}` : ""}، يرجى التواصل مع فريق المبيعات على ${n}.`;
    case "TRADE_IN_INFO":
      return ["نعم، نقبل استبدال السيارات (Trade-in).", "نقوم بتقييم سيارتكم الحالية واحتساب قيمتها من ثمن السيارة الجديدة.", "لبدء التقييم، يرجى إرسال:\n• نوع السيارة والموديل\n• سنة الصنع\n• عدد الكيلومترات\n• بعض الصور الواضحة من الخارج والداخل", "بعد استلام التفاصيل، سيراجع فريقنا السيارة ويرشدكم إلى الخطوات التالية."].join("\n\n");
    case "TRADE_IN_THANKS":
      return "شكراً لكم. سيراجع فريقنا تفاصيل سيارتكم ويتواصل معكم بشأن التقييم.";
    case "SERVICE_CONTACT":
      return `للصيانة أو قطع الغيار، يرجى الاتصال على ${svc}.`;
    case "COMPLAINT_CONTACT":
      return `للمساعدة بخصوص مشكلة في السيارة، يرجى الاتصال بقسم الصيانة على ${svc}.`;
    case "ADMIN_CONTACT":
      return k.showroom.administration ? `للإدارة، يرجى الاتصال على ${k.showroom.administration}.` : `لمزيد من المساعدة، يرجى الاتصال بنا على ${n}.`;
    case "MODEL_YEAR":
      return models.length > 0 ? `موديلاتنا الحالية هي موديلات 2026 و2027. يمكن لفريقنا تأكيد سنة الصنع لسيارة ${cars}.` : "جميع موديلاتنا الحالية هي موديلات 2026 و2027.";
    case "OTHER_BRAND":
      return "نحن متخصصون حالياً بسيارات VOYAH وMHERO في لبنان.";
    case "HANDOFF":
      return `لمزيد من المساعدة، يرجى الاتصال بنا على ${n}.`;
    case "CATEGORY_NONE":
      return `لا نوفر حالياً ${vars.kind ?? "هذا النوع"} ضمن هذه المجموعة. ما نوفره:\n${vars.alternatives ?? ""}`;
    case "DELIVERY_INFO":
      return `يمكن لفريق المبيعات ترتيب تفاصيل التوصيل معكم. سيتواصلون معكم، ويمكنكم أيضاً الاتصال على ${n}.`;
    case "PAYMENT_HANDOFF":
      return `سيتواصل معكم فريق المبيعات بهذا الخصوص قريباً. يمكنكم أيضاً الاتصال على ${n}.`;
    case "USED_CARS_INFO":
      return `يمكن لفريق المبيعات مساعدتكم بخصوص السيارات المستعملة والمتوفر حالياً. سيتواصلون معكم، ويمكنكم أيضاً الاتصال على ${n}.`;
    case "HUMAN_HANDOFF":
      return "بالتأكيد. سيتابع أحد أعضاء فريق المبيعات هذه المحادثة ويرد عليكم هنا قريباً.";
    case "CALLBACK_CONFIRMED":
      return vars.phone ? `بالتأكيد. سيتصل بكم فريق المبيعات على ${vars.phone} قريباً.` : "بالتأكيد. سيتصل بكم فريق المبيعات على هذا الرقم قريباً.";
    case "CALLBACK_ASK_NUMBER":
      return "بالتأكيد. على أي رقم يمكن لفريق المبيعات الاتصال بكم؟";
    case "INTERIOR_INFO":
      return models.length > 0 ? `لا تتوفر لدي حالياً تفاصيل أو فيديو للمقصورة الداخلية لسيارة ${cars}. الكتالوج يعرض المقصورة الداخلية، ويمكن لفريقنا تأكيد الخيارات على ${n}.` : "لا تتوفر لدي حالياً تفاصيل المقصورة الداخلية. أي موديل يهمكم؟ يمكنني إرسال الكتالوج الذي يعرض المقصورة الداخلية.";
    case "PHOTOS_INFO":
      return models.length > 0 ? `لا تتوفر لدي صور لإرسالها هنا، لكن يمكنني إرسال فيديو لسيارة ${cars}.` : "لا تتوفر لدي صور لإرسالها هنا، لكن يمكنني إرسال فيديو. أي موديل يهمكم؟";
    case "SPEC_NOT_CONFIRMED":
      return models.length > 0 ? `هذه المعلومة (${vars.detail ?? ""}) عن ${cars} غير متوفرة بعد ضمن معلوماتنا المعتمدة. الكتالوج يحتوي على المواصفات الكاملة، ويمكن لفريقنا تأكيدها على ${n}.` : `هذه المعلومة (${vars.detail ?? ""}) غير متوفرة بعد ضمن معلوماتنا المعتمدة. يمكن لفريقنا تأكيدها على ${n}.`;
    case "TEST_DRIVE_CANCELLED":
      return `تم إلغاء تجربة القيادة${vars.slot ? ` يوم ${vars.slot}` : ""}. عندما ترغبون بحجز موعد آخر، أخبروني.`;
    case "TEST_DRIVE_WHEN":
      return `تجربة القيادة${cars ? ` لسيارة ${cars}` : ""} محجوزة يوم ${vars.slot ?? ""}.`;
    case "TEST_DRIVE_NONE":
      return "لا يوجد لديكم حجز تجربة قيادة بعد.";
    case "TEST_DRIVE_TIME_CLOSED":
      return `تجارب القيادة متاحة من الاثنين إلى الجمعة من 10:00 إلى 17:00، والسبت من 10:00 إلى 14:00. ${vars.day ? `المواعيد المتاحة يوم ${vars.day}:` : "المواعيد المتاحة التالية:"}`;
    case "TEST_DRIVE_TAKEN":
      return `الموعد ${vars.slot ?? ""} محجوز. المواعيد المتاحة الأقرب إليه:`;
    case "TEST_DRIVE_RESCHEDULE":
      return `تم إلغاء تجربة القيادة${vars.slot ? ` يوم ${vars.slot}` : ""}. يرجى اختيار موعد جديد:`;
    case "TEST_DRIVE_TIME_NOTED":
      return `تمام، ${vars.slot ?? ""}. أي موديل ترغبون بتجربته؟`;
    case "AFTER_HOURS_NOTE":
      return "فريقنا متواجد من الاثنين إلى الجمعة من 8:00 صباحاً حتى 6:00 مساءً، والسبت من 8:00 صباحاً حتى 2:00 ظهراً، وسيتابع معكم خلال ساعات العمل.";
    default:
      return null;
  }
}

/** WhatsApp list rows allow a few more characters than buttons do. */
const WHATSAPP_LIST_TITLE = 24;

/** A question with its choices, shaped for the channel. */
function question(text: string, choices: Choice[], channel: SalesChannel): OutboundPart {
  const limits = CHANNEL_LIMITS[channel];
  const fit = (max: number) => choices.every((c) => c.title.length <= max);
  if (choices.length <= limits.quickReplies && fit(limits.choiceTitleChars)) {
    return {
      kind: "text",
      text,
      choices,
      style: channel === "whatsapp" ? "buttons" : "quick_replies",
    };
  }
  if (choices.length <= limits.listRows && fit(WHATSAPP_LIST_TITLE)) {
    return { kind: "text", text, choices, style: "list" };
  }
  const lines = choices.map((c, i) => `${i + 1}. ${c.title}`).join("\n");
  return {
    kind: "text",
    text: `${text}\n${lines}\n${pick("Reply with the number.", "أرسلوا رقم الخيار.")}`,
    choices,
    style: "numbered",
  };
}

function say(text: string): OutboundPart {
  return { kind: "text", text, choices: [], style: null };
}

function modelChoices(k: SalesKnowledge, models: readonly ModelCode[]): Choice[] {
  return models.map((m) => ({ title: nameOf(k, m), payload: modelPayload(m) }));
}

/**
 * The messages the actions would produce, in order. Internal actions
 * (CONTENT_GAP, FLAG_FOR_STAFF, ALERT_SALES, BOOK_TEST_DRIVE) produce nothing a customer sees.
 */
export function renderPlan(actions: readonly EngineAction[], ctx: RenderContext): OutboundPart[] {
  const k = ctx.knowledge;
  LANG = ctx.lang ?? "en";
  const parts: OutboundPart[] = [];
  for (const a of actions) {
    switch (a.type) {
      case "SEND_BROCHURE": {
        const link = linkInstead(a.asset, "document", ctx);
        if (link) {
          parts.push(say(pick(`Here is the ${nameOf(k, a.model)} brochure: ${link}`, `كتالوج ${nameOf(k, a.model)}: ${link}`)));
          break;
        }
        parts.push(say(pick(`Here is the ${nameOf(k, a.model)} brochure.`, `إليكم كتالوج ${nameOf(k, a.model)}.`)));
        parts.push({
          kind: "file",
          fileKind: "document",
          name: a.asset.name,
          bytes: a.asset.bytes,
          url: a.asset.url ?? null,
        });
        break;
      }
      case "SEND_FACTS":
        parts.push(say(renderFacts(a, k)));
        break;
      case "SEND_COMPARISON":
        parts.push(say(renderComparison(a, k)));
        break;
      case "SEND_COLOUR_LIST":
        parts.push(
          say(
            [
              pick(a.rows.length > 2 ? "Here are the colours we can show you for our models:" : "Here are the colours we can show you:", "الألوان التي يمكننا عرضها لكم:"),
              ...a.rows.map(
                (r) =>
                  `• ${nameOf(k, r.model)} — ${r.colours.length > 0 ? r.colours.join(pick(", ", "، ")) : r.hasVideo ? pick("one video, no colour choice", "فيديو واحد، بدون خيار لون") : pick("no videos yet", "لا فيديو بعد")}`
              ),
            ].join("\n")
          )
        );
        break;
      case "SEND_GLOBAL_INFO":
        // The workbook's showroom answers are whole sentences (English); Arabic versions of the same facts.
        parts.push(say(LANG === "ar" ? globalAr(a.key, a.value, k) : a.value));
        break;
      case "SEND_COLOUR_VIDEO": {
        const car = nameOf(k, a.model);
        const text = a.interior
          ? pick(`Here is a look inside the ${car}.`, `إليكم نظرة على المقصورة الداخلية لسيارة ${car}.`)
          : a.onlyOption
          ? pick(`Here is a video of the ${car}.`, `إليكم فيديو لسيارة ${car}.`)
          : a.chosenForThem
            ? pick(`Here is the ${car} in ${a.colourName} — a favourite of ours.`, `إليكم ${car} باللون ${a.colourName}، من ألواننا المفضلة.`)
            : pick(`Here is the ${car} in ${a.colourName}.`, `إليكم ${car} باللون ${a.colourName}.`);
        const link = linkInstead(a.asset, "video", ctx);
        if (link) {
          parts.push(say(`${text.replace(/\.$/, "")}: ${link}`));
          break;
        }
        parts.push(say(text));
        parts.push({
          kind: "file",
          fileKind: "video",
          name: a.asset.name,
          bytes: a.asset.bytes,
          url: a.asset.url ?? null,
        });
        break;
      }
      case "COLOUR_NOT_AVAILABLE":
        parts.push(
          say(pick(`Sorry — we don't have a video of the ${nameOf(k, a.model)} in ${a.requested}.`, `عذراً، لا يتوفر لدينا فيديو لسيارة ${nameOf(k, a.model)} باللون ${a.requested}.`))
        );
        break;
      case "SEND_TEXT":
        parts.push(say(renderText(a.key, a.models, a.vars ?? {}, ctx)));
        break;
      case "SEND_CONTACT_FALLBACK":
        parts.push(say(contactFallbackText(k)));
        break;
      case "SHOW_COLOUR_CHOICES":
        parts.push(
          question(
            pick(
              `Which exterior colour would you like to see? We can show you the ${nameOf(k, a.model)} in ${listWords(a.colours.map((c) => c.name))}.`,
              `أي لون خارجي تودون رؤيته؟ يمكننا عرض ${nameOf(k, a.model)} باللون ${listWords(a.colours.map((c) => c.name))}.`
            ),
            a.colours.map((c) => ({ title: c.name, payload: colourPayload(a.model, c.id) })),
            ctx.channel
          )
        );
        break;
      case "SHOW_MODEL_CHOICES": {
        const lead = a.greet ? `${welcomeText(ctx)}\n\n` : "";
        const ask =
          a.prompt === "explore"
            ? pick("Which model would you like to explore further?", "أي موديل تودون معرفة المزيد عنه؟")
            : a.prompt === "first"
              ? pick("Which one would you like to see first?", "أيهما تودون رؤيته أولاً؟")
              : a.narrowed
                ? pick("Which one are you interested in?", "أيهما يهمكم؟")
                : pick("Which model are you interested in?", "أي موديل يهمكم؟");
        parts.push(question(`${lead}${ask}`, modelChoices(k, a.models), ctx.channel));
        break;
      }
      case "SHOW_CATEGORY": {
        const lines: string[] = [];
        if (a.filter === "SEATS") {
          const cars = a.groups.flatMap((g) => g.models);
          lines.push(
            cars.length > 0
              ? pick(`For ${a.seats} seats, we currently offer the ${andWords(cars.map((m) => nameOf(k, m)))}.`, `بـ${a.seats} مقاعد، نوفر حالياً ${andWords(cars.map((m) => nameOf(k, m)))}.`)
              : pick(`We don't currently offer a ${a.seats}-seat model.`, `لا نوفر حالياً موديلاً بـ${a.seats} مقاعد.`)
          );
        } else if (a.filter === "ALL_TYPES" || a.filter === "HYBRID") {
          lines.push(
            a.filter === "HYBRID"
              ? pick("We offer two hybrid-style systems:", "نوفر نظامين هجينين:")
              : pick("We offer three power systems, depending on how you prefer to drive:", "نوفر ثلاثة أنظمة دفع، بحسب ما تفضلون:")
          );
          for (const g of a.groups) {
            if (!g.bucket || g.models.length === 0) continue;
            lines.push(`\n${pick(BUCKET_TITLE[g.bucket], BUCKET_TITLE_AR[g.bucket])}\n${g.models.map((m) => `• ${nameOf(k, m)}`).join("\n")}`);
          }
        } else {
          const cars = a.groups.flatMap((g) => g.models);
          const kind =
            a.filter === "EV" ? pick("fully electric driving", "القيادة الكهربائية بالكامل") : a.filter === "EREV" ? pick("range-extended electric driving", "القيادة الكهربائية بمدى موسّع") : pick("plug-in hybrid driving", "القيادة الهجينة القابلة للشحن");
          lines.push(
            cars.length === 1
              ? pick(`For ${kind}, we currently offer the ${nameOf(k, cars[0])}.`, `لـ${kind}، نوفر حالياً ${nameOf(k, cars[0])}.`)
              : pick(`For ${kind}, we currently offer:\n${cars.map((m) => `• ${nameOf(k, m)}`).join("\n")}`, `لـ${kind}، نوفر حالياً:\n${cars.map((m) => `• ${nameOf(k, m)}`).join("\n")}`)
          );
        }
        const models = a.groups.flatMap((g) => g.models);
        const choices =
          a.filter === "ALL_TYPES"
            ? a.groups
                .filter((g) => g.bucket && g.models.length > 0)
                .map((g) => ({ title: g.bucket === "EV" ? "Fully electric" : (g.bucket as string), payload: categoryPayload(g.bucket as PowertrainBucket) }))
            : modelChoices(k, models);
        if (choices.length === 0) {
          parts.push(say(lines.join("\n")));
        } else {
          parts.push(
            question(
              `${lines.join("\n")}\n\n${a.filter === "ALL_TYPES" ? pick("Which system are you interested in?", "أي نظام يهمكم؟") : models.length === 1 ? pick("Would you like to see it?", "هل تودون رؤيتها؟") : pick("Which one are you interested in?", "أيهما يهمكم؟")}`,
              choices,
              ctx.channel
            )
          );
        }
        break;
      }
      case "SHOW_TEST_DRIVE_SLOTS":
        parts.push(
          question(
            pick("Please choose a time for your test drive:", "يرجى اختيار موعد لتجربة القيادة:"),
            a.slots.map((slot) => ({ title: slotLabel(slot), payload: slotPayload(slot) })),
            ctx.channel
          )
        );
        break;
      case "SHOW_DEPARTMENTS":
        parts.push(
          question(
            `${welcomeText(ctx)}\n\n${pick("Please choose an option:", "يرجى اختيار قسم:")}`,
            [
              { title: pick("Sales", "المبيعات"), payload: departmentPayload("SALES") },
              { title: pick("Service & Parts", "الصيانة وقطع الغيار"), payload: departmentPayload("SERVICE") },
              { title: pick("Administration", "الإدارة"), payload: departmentPayload("ADMIN") },
            ],
            ctx.channel
          )
        );
        break;
      case "CONTENT_GAP":
      case "FLAG_FOR_STAFF":
      case "ALERT_SALES":
      case "BOOK_TEST_DRIVE":
        break;
    }
  }
  return parts;
}

/** The plan as plain lines, for the simulator and for logs. */
export function planLines(parts: readonly OutboundPart[]): string[] {
  return parts.map((p) =>
    p.kind === "file"
      ? `[${p.fileKind === "document" ? "PDF" : "Video"}: ${p.name}]`
      : p.choices.length > 0 && p.style !== "numbered"
        ? `${p.text} [${p.style}: ${p.choices.map((c) => c.title).join(" | ")}]`
        : p.text
  );
}

/* ── Staff labels ────────────────────────────────────────────────────────── */

function label(code: string): string {
  return code.replace(/_/g, " ");
}

/** One fallback reason, as staff read it. */
export function reasonLabel(r: FallbackReason): string {
  switch (r.kind) {
    case "CONTACT_INTENT":
      return r.model ? `${label(r.intent)} (${label(r.model)})` : label(r.intent);
    case "MISSING_FACT":
      return `${r.status} FACT ${label(r.model)} / ${label(r.fact)}`;
    case "MISSING_GLOBAL":
      return `${r.status} ${label(r.key)}`;
    case "CONTACT_NUMBER":
      return "ASKED FOR THE NUMBER";
    case "MISSING_BROCHURE":
      return `NO BROCHURE ${label(r.model)}`;
    case "NO_COLOUR_MEDIA":
      return `NO COLOUR VIDEOS ${label(r.model)}`;
    case "CROSS_BRAND":
      return `OTHER BRAND ${label(r.model)}`;
    case "MORE_INFO":
      return `MORE INFO ${label(r.model)}`;
    case "MODEL_SWITCHED_OFF":
      return `SWITCHED OFF ${label(r.model)}`;
  }
}

/** "SEND COURAGE BROCHURE", "SHOW COURAGE COLOURS" — the simulator's action list. */
export function actionLabel(a: EngineAction): string {
  switch (a.type) {
    case "SEND_BROCHURE":
      return `SEND ${label(a.model)} BROCHURE`;
    case "SEND_FACTS":
      return `SEND ${uniqueInOrder(a.rows.map((r) => label(r.model))).join(" + ")} ${uniqueInOrder(a.rows.map((r) => label(r.fact))).join(" + ")}${a.scope === "all" ? " (ALL MODELS)" : ""}`;
    case "SEND_COMPARISON":
      return `COMPARE ${a.models.map(label).join(", ")}`;
    case "SEND_COLOUR_LIST":
      return `LIST COLOURS ${a.rows.map((r) => label(r.model)).join(", ")}`;
    case "CANCEL_TEST_DRIVE":
      return `CANCEL TEST DRIVE ${a.slot}`;
    case "SEND_GLOBAL_INFO":
      return `SEND ${label(a.key)}`;
    case "SEND_COLOUR_VIDEO":
      return `SEND ${label(a.model)} ${a.colourName.toUpperCase()} VIDEO`;
    case "COLOUR_NOT_AVAILABLE":
      return `${label(a.model)} ${a.requested.toUpperCase()} NOT AVAILABLE`;
    case "SEND_TEXT":
      return `SAY ${label(a.key)}${a.models.length > 0 ? ` (${a.models.map(label).join(", ")})` : ""}`;
    case "SEND_CONTACT_FALLBACK":
      return `SEND CONTACT FALLBACK — ${a.reasons.map(reasonLabel).join("; ")}`;
    case "SHOW_COLOUR_CHOICES":
      return `SHOW ${label(a.model)} COLOURS`;
    case "SHOW_MODEL_CHOICES":
      return `SHOW MODEL CHOICES (${a.models.map(label).join(", ")})`;
    case "SHOW_CATEGORY":
      return `SHOW ${a.filter === "SEATS" ? `${a.seats}-SEAT` : label(a.filter)} MODELS (${a.groups.flatMap((g) => g.models).map(label).join(", ")})`;
    case "SHOW_TEST_DRIVE_SLOTS":
      return `SHOW ${a.slots.length} TEST-DRIVE SLOTS`;
    case "SHOW_DEPARTMENTS":
      return "SHOW DEPARTMENTS";
    case "CONTENT_GAP":
      return a.detail;
    case "FLAG_FOR_STAFF":
      return `FLAG FOR STAFF — ${a.reason}`;
    case "ALERT_SALES":
      return `ALERT SALES — ${label(a.kind)}${a.models.length > 0 ? ` (${a.models.map(label).join(", ")})` : ""}${a.name ? " WITH NAME" : ""}${a.phone ? " WITH PHONE" : ""}`;
    case "BOOK_TEST_DRIVE":
      return `BOOK TEST DRIVE ${a.slot}`;
  }
}
