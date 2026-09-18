/**
 * The Understanding Engine, part one: what did the customer ASK?
 *
 * NOT an AI, and nothing here writes a word to a customer. A closed
 * vocabulary of phrases per intent — English, Arabic and Arabizi — matched
 * against the normalized message exactly the way the model matcher matches
 * model names: whole words, consecutive, the longest phrase winning, typo
 * tolerance only where it is safe. The same message always reads the same
 * way, and every intent reported carries the exact words that produced it.
 *
 * What to DO about an intent is the engine's decision (engine.ts). What to
 * SAY is a template's (templates.ts). This file only reads.
 *
 * Rules that keep the reading honest:
 *
 *   - LONGEST PHRASE WINS, across intents. "price range" is a price question,
 *     not a range question; "range rover" and "no problem" mean nothing.
 *   - WEAK words yield. "how much" is a price question on its own, but "how
 *     much hp" is a horsepower question, and "where can I get the brochure"
 *     is a brochure question — a weak word counts only when nothing
 *     stronger was asked in the same message.
 *   - TYPOS are tolerated only in long Latin words (7+ letters, first letter
 *     right, never a word that is itself a real word such as "changing" or
 *     "contract"). Short words and Arabic script must be exact, because one
 *     letter apart is usually a different word. Repeated letters are squashed
 *     ("priceee", "hpp").
 *   - Several intents in one message are all reported, in the order written.
 *
 * Also read here, because they are properties of the message rather than of
 * the conversation: the language, a button payload ("MODEL:COURAGE"), a
 * numbered answer ("2"), and the HARD EXCLUSIONS — fake Meta-support scams,
 * vendor pitches, Meta's own system notices and internal tests — which are
 * detected only on high-confidence evidence so that a vague real customer is
 * never filtered out.
 */

import { editDistance, isArabicToken, normalize, sameWord } from "@/lib/wasales/matcher";

/* ── The intents ─────────────────────────────────────────────────────────── */

export const INTENTS = [
  "GREETING",
  "GENERAL_INFO",
  "BROCHURE",
  "COLOUR",
  "COLOUR_VIDEO",
  "HORSEPOWER",
  "RANGE",
  "BATTERY",
  "POWERTRAIN",
  "CHARGING",
  "SEATS",
  "DIMENSIONS",
  "SPECIFICATIONS",
  "LOCATION",
  "OPENING_HOURS",
  "CONTACT_NUMBER",
  "PRICE",
  "FINANCING",
  "TEST_DRIVE",
  "WARRANTY",
  "AVAILABILITY",
  "DISCOUNT",
  "TRADE_IN",
  "SERVICE",
  "PARTS",
  "COMPLAINT",
  // Added from Samer's workbook, E Master Bot Logic (2026-09-17).
  "SALES",
  "MODEL_LIST",
  "COMPARE",
  "MODEL_YEAR",
  "OTHER_BRAND",
  "ACKNOWLEDGEMENT",
  // Samer, 2026-09-17: "no more silent ignores".
  "INTERIOR_COLOUR",
  "MEDIA_PHOTOS",
  "HUMAN_HANDOFF",
  "CALLBACK",
  "DELIVERY_LOCATION",
  "PAYMENT_CURRENCY",
  "USED_CARS",
  "OTHER_SPEC",
  "TEST_DRIVE_CHANGE",
  // Samer, 2026-09-18 (the audit): real customer language the bot answered wrongly or not at all.
  "YES",
  "NO",
  "BUYING_INTENT",
  "VISIT",
  "WAITING_COMPLAINT",
  "NOT_INTERESTED",
  "OPT_OUT",
  "WRONG_NUMBER",
  "OWNER_ISSUE",
  "WARRANTY_CLAIM",
  "SAFETY",
  "BATTERY_LIFE",
  "BATTERY_REPLACEMENT",
  "CHARGER_INCLUDED",
  "HOME_CHARGING",
  "PUBLIC_CHARGING",
  "CHARGING_COST",
  "BRAND_ORIGIN",
  "CONTACT_CHANNELS",
  "NO_VIDEO",
  "NO_BROCHURE",
  "UNKNOWN",
] as const;

export type Intent = (typeof INTENTS)[number];

/** Answered from a model's approved facts. */
export const FACT_INTENTS = [
  "HORSEPOWER",
  "RANGE",
  "BATTERY",
  "POWERTRAIN",
  "CHARGING",
  "SEATS",
  "DIMENSIONS",
  "SPECIFICATIONS",
  "WARRANTY",
] as const;

export type FactIntent = (typeof FACT_INTENTS)[number];

/** Answered the same whatever the model — no model needed. */
export const GLOBAL_INTENTS = ["LOCATION", "OPENING_HOURS", "CONTACT_NUMBER"] as const;

export type GlobalIntent = (typeof GLOBAL_INTENTS)[number];

/**
 * Intents whose answer depends on WHICH model. Without one they are saved as
 * pending and the customer is asked which model; the answer then triggers
 * them in order. PRICE is here because Samer's spec routes it through the
 * model (brochure first) even though its answer is the contact number.
 */
export const MODEL_INTENTS: readonly Intent[] = [
  "GENERAL_INFO",
  "BROCHURE",
  "COLOUR",
  "COLOUR_VIDEO",
  ...FACT_INTENTS,
  "PRICE",
];

/**
 * Intents a person must handle, answered at once with the contact number:
 * a figure, a promise or a judgement that no template may make.
 */
export const CONTACT_INTENTS: readonly Intent[] = [
  "FINANCING",
  "TEST_DRIVE",
  "AVAILABILITY",
  "DISCOUNT",
  "TRADE_IN",
  "SERVICE",
  "PARTS",
  "COMPLAINT",
];

export function isFactIntent(intent: Intent): intent is FactIntent {
  return (FACT_INTENTS as readonly Intent[]).includes(intent);
}

export function isGlobalIntent(intent: Intent): intent is GlobalIntent {
  return (GLOBAL_INTENTS as readonly Intent[]).includes(intent);
}

export function isModelIntent(intent: Intent): boolean {
  return MODEL_INTENTS.includes(intent);
}

export function isContactIntent(intent: Intent): boolean {
  return CONTACT_INTENTS.includes(intent);
}

/* ── The vocabulary ──────────────────────────────────────────────────────── */

/** A word that only counts when nothing more specific stands beside it. */
interface Weak {
  weak: string;
}

function weak(phrase: string): Weak {
  return { weak: phrase };
}

type Entry = string | Weak;

/**
 * Written the way customers write, Arabic included; compile() runs every
 * phrase through normalize(), so "أقساط" here and "اقساط" in a message are
 * the same word. Every phrase belongs to exactly one intent — a test checks.
 */
const LEXICON: Readonly<Record<Exclude<Intent, "UNKNOWN">, readonly Entry[]>> = {
  GREETING: [
    "hi", "hii", "hiii", "hey", "heyy", "hello", "helo", "hallo", "hola",
    "good morning", "good afternoon", "good evening", "good day", "greetings",
    "salam", "salaam", "salam alaykom", "salamo alaykom", "assalamu alaikum",
    "marhaba", "mar7aba", "marhabtein", "hala", "ahla", "ahlan", "ahlein",
    "bonjour", "bonsoir", "salut", "kifak", "kifik", "kifkon", "anyone", "anybody", "any one", "allo", "alo", "yo",
    "sabaho", "saba7o", "sabah el kheir", "saba7 el kheir",
    "مرحبا", "مرحبتين", "أهلا", "أهلين", "هلا", "السلام عليكم", "سلام",
    "صباح الخير", "مسا الخير", "مساء الخير", "كيفك", "كيفكن",
  ],
  GENERAL_INFO: [
    "info", "infos", "information", "informations", "more info",
    "more information", "more details", "details", "detail", "know more",
    "tell me more", "tell me about", "interested", "inquiry", "enquiry",
    "ma3loumet", "ma3lumet", "ma3loumat", "ma3lomet", "more inf", "tafasil",
    "tafaseel", "tafasel",
    "معلومات", "معلومة", "تفاصيل", "مهتم", "مهتمة", "استفسار", "بدي اعرف",
  ],
  BROCHURE: [
    "brochure", "brochures", "catalogue", "catalogues", "catalog", "catalogs",
    "pdf", "leaflet", "كتالوج", "كاتالوج", "كاتالوغ", "بروشور",
  ],
  COLOUR: [
    "colour", "colours", "color", "colors", "which colour", "which color",
    "available colours", "available colors", "couleur", "couleurs",
    "alwan", "alwen", "لون", "ألوان", "الوانها", "لونها",
    // An Arabic COLOUR question says "available colours": it is about colours, not stock (audit, 2026-09-18).
    "الالوان المتوفرة", "الألوان المتوفرة", "الوان متوفرة", "ألوان متوفرة", "الالوان الموجودة", "الألوان الموجودة", "الالوان", "الألوان",
    "colurs", "colers", "colrs", "coulors", "colour options", "color options", "couleurs disponibles",
  ],
  COLOUR_VIDEO: [
    "video", "videos", "vid", "clip", "clips", "reel", "reels", "walkaround",
    "فيديو", "فيديوهات", "فيديوات",
  ],
  HORSEPOWER: [
    // "power" is WEAK: "power?" is the horsepower question, but "how much power the generator
    // gives to the wheels" is not — it was answered "600 hp" on 2026-09-18, a wrong answer.
    "hp", "horsepower", "horse power", "horses", "bhp", weak("power"), "kw",
    "حصان", "أحصنة", "قوة", "قوة المحرك", "7san", "a7sne",
    // Workbook E/F wordings (2026-09-18).
    "how powerful", weak("powerful"), "how many horses", "قوة السيارة", "قديش قوتها", "قوتها",
  ],
  RANGE: [
    "range", "autonomy", "autonomie", "how far", "km range", "kilometers",
    "kilometres", "kilometer", "kilometre", "km", "kms", "how many km",
    "per charge", "masafe", "masafeh", "rnge", "rnage", "raneg", "ragne",
    // Workbook E/F wordings (2026-09-18). "full charge" yields to a charging question beside it.
    weak("full charge"), "electric range", "combined range", "كم كيلو", "كم كيلو بتمشي", "قديش بتمشي", "بتمشي",
    "مسافة", "مدى", "كم كيلو", "كيلومتر",
  ],
  BATTERY: [
    "battery", "batteries", "batterie", "battery capacity", "battery size",
    "kwh", "بطارية", "batery", "battry", "batterry", "baterry",
    // Workbook E/F wordings (2026-09-18). "capacity" alone is the battery; "trunk capacity" is longer and wins.
    weak("capacity"), "what battery", "سعة البطارية", "قديش البطارية",
  ],
  POWERTRAIN: [
    "electric", "full electric", "fully electric", "ev", "bev", "hybrid",
    "plug in", "plugin", "phev", "erev", "reev", "range extender",
    "extended range", "fuel", "petrol", "gasoline", "benzine", "benzin",
    "diesel", "engine", "motor", "motors", "awd", "4x4", "4wd", "2wd", "rwd",
    "fwd", "كهربا", "كهرباء", "كهربائي", "كهربائية", "هايبرد", "هايبريد",
    "بنزين", "مازوت", "محرك", "موتور",
  ],
  CHARGING: [
    "charging", "charge", "charger", "chargers", "charging time",
    "fast charging", "fast charge", "supercharge", "dc", "wallbox",
    "plug", "sha7en", "شحن", "شاحن",
    // Workbook E/F wordings (2026-09-18): "AC / DC?", "20–80", "30–80", "how long to charge".
    weak("ac"), "ac dc", "20 80", "30 80", "charge time", "how long to charge", "قديش بدو شحن", "chargng", "charing", "chrging", "chargin",
  ],
  SEATS: [
    "seats", "seat", "seater", "seaters", "7 seater", "7seater", "5 seater",
    "how many seats", "number of seats", "passengers", "passenger",
    "مقاعد", "مقعد", "ركاب", "كم راكب",
    // Workbook E/F wordings (2026-09-18).
    "how many people", "6 seater", "6seater",
  ],
  DIMENSIONS: [
    "dimensions", "dimension", "size", "length", "width", "height",
    "wheelbase", "trunk", "boot", "boot space", "cargo", "ground clearance",
    "clearance", "قياس", "قياسات", "طول", "ارتفاع", "أبعاد", "صندوق",
    // Workbook E/F wordings (2026-09-18).
    "luggage", "trunk size", "trunk capacity", "حجم",
    // "Will it fit in my garage?" is about the car's size — "garage" alone is a workshop word (SERVICE).
    "fit in my garage", "fit in the garage", "fit in a garage", "fit my garage", "fit into my garage", "will it fit",
    "fit in my parking", "fit in the parking", "fit in a parking", "fit in my driveway", "how big", "is it big", "how long is the car", "how wide",
  ],
  SPECIFICATIONS: [
    "specs", "spec", "specifications", "specification", "features",
    "feature", "technical", "tech specs", "full specs", "fiche technique",
    "مواصفات", "مميزات",
  ],
  LOCATION: [
    "location", "located", "where are you", "where are you located",
    "where is your showroom", "where is the showroom", "address", "showroom",
    "branch", "branches", "map", "maps", "google maps", "directions",
    "how to get", weak("where"), weak("wen"), weak("wein"), "wen ntou",
    weak("وين"), "وينكم", "وين محلكم", "عنوان", "العنوان", "موقعكم",
    "مكانكم", "صالة العرض", "معرض",
    "ou etes vous", "où êtes vous", "ou êtes vous", "où etes vous", "situés", "situes", "adresse", "localisation", "c est ou", "wen el showroom",
  ],
  OPENING_HOURS: [
    "opening hours", "open hours", "working hours", "business hours",
    "hours", weak("open"), "opening", weak("close"), "closing", "what time",
    "until what time", "till what time", "are you open", "open today",
    "open tomorrow", weak("sunday"), weak("saturday"), "dawem", "dawam",
    "دوام", "الدوام", "ساعات", "مفتوحين", "فاتحين", "بتسكرو",
  ],
  CONTACT_NUMBER: [
    weak("number"), "phone", "phone number", "your number", "mobile",
    "whatsapp", "whatsapp number", weak("call"), "call you", "contact",
    "contact number", "contact you", "reach you", "telephone", "tel",
    "ra2em", "ra2m", "nemra", "رقم", "رقمكم", "تلفون", "تلفونكم", "واتساب",
  ],
  PRICE: [
    "price", "prices", "pricing", "price range", "cost", "costs",
    weak("how much"), "how much does it cost", "usd", "dollars", "dollar",
    "prix", "combien", "se3er", "si3r", "sa3er", "se3r", weak("ade"),
    "adesh", "addesh", "2adesh", weak("adde"), "pricr", "prise", "as3ar",
    "asaar", "cheaper", "cheapest", "سعر", "السعر", "أسعار", "ارخص", "أرخص",
    "الأسعار", "بكم", weak("قديش"), weak("كم"), "تكلفة", "كلفة",
    // A real pilot message, 2026-09-18: "Give me quotation" got no reply at all.
    "quotation", "quotations", "quote", "quotes", "a quote", "price quote", "proforma", "pro forma",
    "price list", "pricelist", "devis", "عرض سعر", "عرض اسعار", "عرض أسعار", "لائحة الاسعار",
  ],
  FINANCING: [
    "installment", "installments", "instalment", "instalments", "finance",
    "financing", "loan", "loans", "bank loan", "monthly", "monthly payment",
    "monthly payments", "payment plan", "payment facilities", "facilities",
    "down payment", "downpayment", "first payment", "credit", "leasing",
    "lease", "taksit", "ta2sit", "takseet", "ta2seet", "a2sat", "to2seet",
    "interest", "daf3a", "daf3a oula", "awal daf3a", "dafe3", "طريقة الدفع",
    "تقسيط", "بالتقسيط", "أقساط", "قسط", "قرض", "دفعة أولى", "دفعة",
    "شهري", "تسهيلات",
    // Financing in every shape customers use (audit, 2026-09-18).
    "bank finance", "bank financing", "through the bank", "through a bank", "with banks", "work with banks", "via bank",
    "pay monthly", "monthly installments", "monthly instalments", "per month", "a month",
    "12 months", "24 months", "36 months", "48 months", "60 months", "72 months",
    "pay over", "over 2 years", "over 3 years", "over 4 years", "over 5 years", "years to pay", "in house financing", "in house",
    "تمويل", "دفعات", "دفعة شهرية", "على دفعات", "tamwil", "tamweel", "ta2seet bank", "aksat", "dafa3at", "bel ta2sit", "bil ta2sit",
    "facilités de paiement", "facilites de paiement", "facilite de paiement", "paiement échelonné", "credit auto", "mensualités", "mensualites",
    // Workbook E wording "0%" (2026-09-18): read as "zero percent" by readMessage, never a bare 0.
    "zero percent", "zero interest", "0 interest", "0 percent",
  ],
  TEST_DRIVE: [
    "test drive", "testdrive", "test driving", "try the car", "book a drive",
    "tajrobe", "tajribe", "tajrbe", "تجربة", "تجربة قيادة", "تست درايف",
    "جرب", "اجرب", "جربها", "اجربها", "jarrib", "jarreb",
    // Workbook E wordings (2026-09-18).
    "drive it", "book test drive",
    "try it", "can i try", "try the", "essai", "un essai", "essayer", "test de conduite", "faire un essai",
  ],
  WARRANTY: [
    "warranty", "warranties", "guarantee", "guaranty", "garantie",
    "kafele", "kafeleh", "kafala", "كفالة", "ضمان", "warrnty", "waranty", "warrenty", "warantee", "warrantee", "garanty",
  ],
  AVAILABILITY: [
    "available", "availability", "in stock", "stock", "instock",
    "delivery time", "delivery date", "when can i get", "waiting time", "disponible",
    "mawjoud", "mawjoude", "mawjoudin", "متوفر", "متوفرة", "موجود", "موجودة",
  ],
  DISCOUNT: [
    "discount", "discounts", weak("offer"), "offers", "promo", "promotion",
    "promotions", "deal", "deals", "best price", "last price",
    "special price", "khasm", "5asm", "خصم", "حسم", "تخفيض", "عرض", "عروض",
    "آخر سعر",
  ],
  TRADE_IN: [
    "trade in", "tradein", "trade", "exchange", "swap", "part exchange",
    "my old car", "badal", "بدل", "مبادلة", "تبديل",
    // Workbook E wordings (2026-09-18).
    "exchange my car", "take my old car", "بتاخدو سيارتي", "بتاخدو",
    // Selling or swapping the customer's OWN car is the trade-in workflow (audit, 2026-09-18).
    "do you buy cars", "buy my car", "buy cars", "sell my car", "sell you my car", "sell my old car", "selling my car",
    "car to exchange", "a car to exchange", "swap my car", "my car worth", "car worth", "valuation", "evaluate my car",
    "value my car", "how much will you give me", "how much would you give", "give me for my car", "how much for my car",
    "بدي بيع سيارتي", "بيع سيارتي", "بتشترو سيارات", "تقييم سيارتي", "bade bi3 siyarte", "btishtro siyarat",
  ],
  SERVICE: [
    "service", "servicing", "maintenance", "repair", "repairs", "workshop",
    "garage", "mechanic", "check up", "checkup", "inspection", "siyene",
    "صيانة", "تصليح", "كاراج", "ورشة",
    // The welcome's department rows (workbook D). WhatsApp delivers a tapped row as its WORDS, never
    // its id — and "After-Sales" holds the word "sales" (2026-09-18: tapping After-Sales was answered
    // "which model are you interested in?"). The longer phrase wins over "sales".
    "after sales", "aftersales", "after sale", "aftersale", "after sales service", "customer service",
    "customer care", "service maintenance", "service and maintenance",
    "ما بعد البيع", "خدمة ما بعد البيع", "خدمة العملاء", "خدمة الزبائن", "الصيانة",
  ],
  PARTS: [
    "parts", weak("part"), "spare parts", "spare part", "spares",
    "accessories", "accessory", "tyres", "tires", "قطع", "قطع غيار",
    "اكسسوارات",
  ],
  COMPLAINT: [
    "complaint", "complain", "complaining", "problem", "problems", "issue",
    "issues", "broken", "not working", "doesnt work", "does not work",
    "disappointed", "bad service", "terrible", "worst", "angry", "refund",
    "mechkle", "moshkle", "meshkle", "شكوى", "مشكلة", "مشاكل", "عطل",
    "خربان", "معطل", "زعلان",
  ],
  SALES: [
    "sales", "sales department", "buy a car", "buy a new car", "new car", weak("buy"),
    weak("buying"), weak("purchase"), "مبيعات", "شراء سيارة",
  ],
  MODEL_LIST: [
    "what cars", "which cars", "what models", "which models", "your models",
    "all models", "all cars", "all your cars", "lineup", "line up", "models available",
    "available models", "cars available", "available cars", "what do you have",
    "what do you sell", "what cars do you have", "شو عندكم", "شو عندكن", "شو في سيارات",
    "الموديلات", "شو الموديلات",
  ],
  COMPARE: [
    "compare", "comparison", "difference", "differences", "vs", "versus",
    "which is better", "better", "قارن", "مقارنة", "الفرق", "شو الفرق",
    // Comparatives ask for a comparison of the cars in play ("which has more range?").
    "which has more", "which one has more", "which has the most", "which has better", "which has the longer", "which has longer",
    "which is faster", "which one is faster", "which is bigger", "which one is bigger", "which is larger", "which is more powerful",
    "which one is more powerful", "which is stronger", "which goes further", "which goes farther", "between them", "between the two", "of the two",
    "أيهما", "ايهما", "مين اقوى", "مين اسرع", "anou a7san", "ayya a7san", "min a2wa", "min asra3",
  ],
  MODEL_YEAR: [
    "model year", "what year", "which year", weak("year"), weak("2024"), weak("2025"),
    weak("2026"), weak("2027"), "سنة الصنع", weak("سنة"),
  ],
  OTHER_BRAND: [
    "bmw", "mercedes", "benz", "audi", "toyota", "tesla", "byd", "kia", "hyundai",
    "nissan", "porsche", "lexus", "jeep", "ford", "chevrolet", "honda", "mitsubishi",
    "geely", "chery", "jetour", "zeekr", "xpeng", "volkswagen", "volvo", "land rover",
    "range rover",
  ],
  INTERIOR_COLOUR: [
    "interior", "interiors", "inside", "cabin", "dashboard", "upholstery",
    "interior colour", "interior color", "interior colours", "interior colors",
    "من جوا", "الداخلية", "الداخل", "الصالون", "مقاعد جلد",
  ],
  MEDIA_PHOTOS: [
    "photo", "photos", "picture", "pictures", "pic", "pics", "image", "images",
    "photographs", "صور", "صورة", "صوره", "sowar", "soura",
  ],
  HUMAN_HANDOFF: [
    "human", "a human", "real person", "a person", "someone", "somebody",
    "salesperson", "sales person", "sales rep", "representative", "agent",
    "operator", "talk to someone", "speak to someone", "speak to a person",
    "talk to a person", "can someone help", "is anyone there", "anyone there",
    "are you a bot", "is this a bot", "is this a robot", "chatbot",
    "حدا", "موظف", "شخص", "بدي احكي مع حدا", "في حدا",
    "7ada", "bade 7ada", "7ada ye7kine", "bade 7ada ye7kine", "e7ke ma3 7ada", "bade e7ke ma3 7ada", "mowazaf", "mwazzaf",
    "parler à quelqu un", "parler a quelqu un", "un conseiller", "quelqu un", "real human", "a real person", "live agent",
  ],
  CALLBACK: [
    "call me", "call me back", "callback", "call back", "give me a call",
    "someone call me", "can someone call me", "contact me", "get back to me",
    "reach me", "ring me", "phone me", "اتصل فيي", "اتصلو فيي", "اتصلي فيي",
    "اتصل بي", "خبروني", "ittasel fiye", "ttasel fiye", "call me pls",
  ],
  DELIVERY_LOCATION: [
    "deliver", "delivery", "delivery to", "deliver to", "home delivery", "delivered",
    "shipping", "ship it", "توصيل", "بتوصلو", "بتوصل", "توصلولي", "twasso",
  ],
  PAYMENT_CURRENCY: [
    "lbp", "lira", "liras", "lebanese pounds", "lebanese pound", "lebanese lira",
    "in dollars", "usd only", "dollars only", "fresh dollars", "fresh usd",
    "cash or", "by card", "credit card", "bank transfer", "cheque", "check payment",
    "ليرة", "بالليرة", "ليرات", "دولار", "بالدولار", "فريش", "كاش", "شيك", "تحويل",
  ],
  USED_CARS: [
    "used car", "used cars", "used vehicle", "used vehicles", "second hand",
    "secondhand", "pre owned", "preowned", "pre-owned", "مستعمل", "مستعملة",
    "مستعملين", "سيارات مستعملة", "مستعمله",
  ],
  // Specifications the workbook does not cover: named honestly, never guessed.
  OTHER_SPEC: [
    "top speed", "max speed", "maximum speed", "0 100", "0-100", "acceleration",
    "how fast", "sunroof", "panoramic roof", "moonroof", "seat material",
    "leather", "leather seats", "wheel size", "wheels size", "size of the wheels", "wheel sizes",
    "rims", "rim size", "inch wheels", "tyre size", "tire size",
    // Technical questions the workbook has no column for (2026-09-18): asked of the team, never
    // answered from a neighbouring fact.
    "generator", "range extender power", "extender power", "engine size", "engine power",
    // ("engine", "motor", "awd" and "4wd" are POWERTRAIN words: the workbook's Powertrain fact answers them.)
    "electric motor", "cylinders", "cc", "turbo", "gearbox", "transmission",
    "to the wheels", "at the wheels", "wheel power", "four wheel drive", "all wheel drive",
    "drivetrain", "fuel consumption", "consumption", "fuel tank", "tank size", "مولد", "suspension", "air suspension", "adas",
    "autopilot", "self driving", "cruise control", "lane assist", "parking sensors",
    "camera", "360 camera", "towing", "tow", "snow", "off road", "offroad",
    "off-road", "sound system", "speakers", "screen size", "display size",
    "heated seats", "ventilated seats", "massage seats",
    // Equipment the workbook has no column for (2026-09-18): named back, handed to the team.
    "carplay", "apple carplay", "car play", "android auto", "wireless charging", "wireless charger", "head up display", "hud", "ambient lighting", "fridge", "refrigerator",
    "weight", "kerb weight", "torque", "nm", "سرعة", "سرعه", "فتحة سقف", "جلد",
    "ثلج", "تلج",
  ],
  TEST_DRIVE_CHANGE: [
    "reschedule", "change my test drive", "change the test drive", "change my booking",
    "change the booking", "change the time", "change the appointment", "move my test drive",
    "cancel my test drive", "cancel the test drive", "cancel my booking", "cancel the booking",
    "cancel my appointment", "when is my test drive", "what time is my test drive",
    "my test drive", "my booking", "my appointment", "غير الموعد", "الغي الموعد",
    "الغاء الموعد", "تأجيل",
  ],
  /* ── Answers to the bot's own question (resolved against the pending question, engine.ts) ── */
  YES: [
    weak("yes"), "yes please", "yes pls", "yeah", "yea", "yep", "yup", "sure", "of course", "please do", "go ahead", "why not",
    "send it", "send them", "send it please", "show me", "show it", "i do", "i would", "definitely", "absolutely",
    "ايه", "اي", "نعم", "اكيد", "أكيد", "طبعا", "eh", "ee", "aywa", "akid", "tab3an", "yalla", "oui", "d accord", "bien sur", "bien sûr",
  ],
  NO: [
    weak("no"), "no thanks", "no thank you", "nope", "nah", "not now", "maybe later", "not really", "no need",
    "لا", "لا شكرا", "لأ", "la2", "non", "non merci",
  ],
  /* ── Customer control: negatives and preferences, kept for the conversation ── */
  NO_VIDEO: [
    "no video", "no videos", "no video please", "dont send video", "don't send video", "dont send the video", "don't send the video",
    "dont send videos", "don't send videos", "without video", "without the video", "stop sending videos", "i dont want the video",
    "i don't want the video", "i dont want videos", "i don't want videos", "بلا فيديو", "بدون فيديو", "ما بدي فيديو", "bala video",
  ],
  NO_BROCHURE: [
    "no brochure", "no brochures", "no brochure please", "dont send the brochure", "don't send the brochure", "dont send brochure",
    "don't send brochure", "without the brochure", "without brochure", "i dont want the brochure", "i don't want the brochure",
    "i dont want a brochure", "i don't want a brochure", "no pdf", "no catalogue", "no catalog", "بلا كتالوج", "بدون كتالوج",
    "ما بدي كتالوج", "bala catalogue",
  ],
  NOT_INTERESTED: [
    "not interested", "no longer interested", "not interested anymore", "im not interested", "i am not interested",
    "changed my mind", "i changed my mind", "never mind", "nevermind", "forget it", "مش مهتم", "غير مهتم", "مش مهتمة", "ما بدي",
    "mesh mehtam", "mish mehtam", "ma bade", "ma baddi", "pas intéressé", "pas interesse", "pas intéressée",
  ],
  OPT_OUT: [
    weak("stop"), "stop messaging", "stop messaging me", "stop sending", "stop sending me", "stop texting", "stop texting me",
    "unsubscribe", "remove me", "remove my number", "delete my number", "do not contact", "dont contact me", "don't contact me",
    "dont message me", "don't message me", "leave me alone", "وقفو", "لا ترسلو", "ما تبعتولي", "شيلو رقمي", "arrêtez", "arretez",
  ],
  WRONG_NUMBER: [
    "wrong number", "wrong person", "wrong chat", "sorry wrong", "sent by mistake", "by mistake", "my mistake wrong",
    "رقم غلط", "غلط بالرقم", "ra2em ghalat", "ghalat", "mauvais numéro", "mauvais numero",
  ],
  /* ── High-intent and people ── */
  BUYING_INTENT: [
    "want to buy", "i want to buy", "wanna buy", "would like to buy", "like to buy", "looking to buy", "ready to buy", "ready to purchase",
    "i ll take it", "ill take it", "i will take it", "take it", "i want one", "i want it", "i want this car", "i want this one",
    "reserve", "reserve one", "reserve it", "reservation", "book one", "book it for me", "hold one", "hold it", "hold one for me", "hold it for me", "hold a", "hold the", "can you hold", "keep one for me", "keep it for me", "put my name down",
    "how do i buy", "how can i buy", "how to buy", "how do i order", "place an order", "order one", "i want to order", "pay a deposit", "deposit",
    "bade eshtere", "bade eshtre", "baddi eshtere", "bde eshtere", "bade ishtere", "eshtere", "eshtre", "bade e7joz", "e7joz",
    "بدي اشتري", "بدي اشتريها", "اشتريها", "اشتري", "أريد شراء", "اريد شراء", "أريد حجز", "اريد حجز", "حجز السيارة", "بدي احجز", "احجز", "عربون",
    "je veux acheter", "acheter", "je la prends", "réserver", "reserver",
  ],
  VISIT: [
    "pass by", "come by", "come see", "come and see", "come to see", "come see the car", "see the car", "see it in person", "in person",
    "visit", "visit you", "visit the showroom", "showroom visit", "can i come", "can i visit", "come today", "come tomorrow", "come over",
    "drop by", "stop by", "walk in", "come to the showroom", "بدي مر", "بدي امرق", "امرق", "بمرق", "زيارة", "بدي شوف السيارة", "شوف السيارة",
    "bade mor", "bade emro2", "emro2", "bemro2", "shouf el siyara", "passer", "je peux passer", "venir voir", "visiter",
  ],
  WAITING_COMPLAINT: [
    "still waiting", "i am waiting", "im waiting", "i m waiting", "been waiting", "waiting since", "waiting for a reply", "waiting for an answer",
    "nobody answered", "no one answered", "nobody replied", "no one replied", "nobody answers", "no one answers", "no reply", "no answer", "no response",
    "no one called", "nobody called", "no one called me", "nobody called me", "didnt call", "didn't call", "never called", "any update", "any updates",
    "any news", "hours ago", "since yesterday", "since morning", "since this morning", "days ago", "why no one",
    "ما حدا رد", "ما حدا جاوب", "ما حدا اتصل", "ناطر", "بعدني ناطر", "من مبارح", "ma 7ada rad", "ma 7ada jeweb", "natir", "ba3dne natir",
    "personne ne répond", "personne ne repond", "toujours pas de réponse",
  ],
  /* ── Owners and after-sales: never answered with sales material ── */
  OWNER_ISSUE: [
    "i own", "i own a", "i bought", "i bought a", "i have a voyah", "i have a mhero", "my voyah", "my mhero",
    // Ownership alone is not a problem: "trade in my car", "charge my car at home". WEAK — any real question wins.
    weak("my car"), weak("my vehicle"),
    "screen is frozen", "screen frozen", "frozen", "screen is black", "black screen", "stopped working", "not starting", "wont start", "won't start",
    "doesnt start", "doesn't start", "does not start", "error", "error message", "warning light", "warning", "check engine", "noise", "leak", "leaking",
    "stuck", "spare key", "lost my key", "lost key", "key fob", "new key", "software update", "update the software", "system update", "ota", "recall",
    "breakdown", "broke down", "flat tire", "flat tyre", "puncture", "ac not cooling", "air conditioning", "technical issue", "technical problem",
    "malfunction", "fault", "faulty", "had an accident", "after an accident", "after the accident", "accident repair", "body repair", "scratch", "dent", weak("سيارتي"), "عندي فوياه", "معطلة", "مفتاح", "تحديث",
    weak("siyarte"), "3otol", "m3attale", weak("ma voiture"), "en panne",
  ],
  WARRANTY_CLAIM: [
    "warranty claim", "claim warranty", "claim the warranty", "under warranty", "warranty repair", "covered by warranty", "warranty issue",
    "warranty problem", "my warranty", "use my warranty", "use the warranty", "مطالبة كفالة", "على الكفالة", "تحت الكفالة", "sous garantie",
  ],
  /* ── Topics the workbook has no column for: named honestly, handed to the team, never a neighbouring fact ── */
  SAFETY: [
    "safe", "safety", "is it safe", "fire", "fire risk", "catch fire", "catches fire", "explode", "explodes", "explosion", "blow", "blow up",
    "burn", "burns", "crash test", "crash", "ncap", "euro ncap", "safety rating", "airbag", "airbags", "how many airbags",
    "آمنة", "امنة", "امان", "أمان", "حريق", "انفجار", "aman", "amene", "sécurité", "securite",
  ],
  BATTERY_LIFE: [
    "battery life", "battery lifespan", "lifespan", "life span", "battery last", "battery lasts", "how long does the battery last",
    "how long will the battery last", "battery health", "battery degradation", "degradation", "battery years", "years does the battery",
    "عمر البطارية", "3omr el battery", "3omr el batarye", "durée de vie",
  ],
  BATTERY_REPLACEMENT: [
    "battery replacement", "replace the battery", "replacing the battery", "replacement battery", "new battery", "battery replacement cost",
    "battery cost", "battery price", "cost of the battery", "price of the battery", "cost of a battery", "price of a battery",
    "سعر البطارية", "تغيير البطارية", "كلفة البطارية", "se3r el battery",
  ],
  CHARGER_INCLUDED: [
    "give a charger", "charger included", "include a charger", "includes a charger", "comes with a charger", "come with a charger",
    "charger with the car", "with a charger", "wallbox included", "charging cable", "cable included", "is there a charger", "get a charger",
    "شاحن مع السيارة", "بيجي معها شاحن", "مع شاحن", "ma3a charger", "chargeur inclus",
  ],
  HOME_CHARGING: [
    "charge at home", "charging at home", "home charging", "home charger", "charge it at home", "at my house", "normal socket", "regular socket",
    "wall socket", "household socket", "wallbox at home", "wall box at home", "need a wallbox", "charger at home", "install a charger", "charger installation", "شحن بالبيت", "اشحنها بالبيت", "بالبيت", "bel beit", "bil beit",
    "recharger à la maison", "a la maison",
  ],
  PUBLIC_CHARGING: [
    "where can i charge", "where to charge", "where do i charge", "where can i charge it", "charging stations", "charging station",
    "public charging", "public chargers", "chargers in lebanon", "charging points", "charging network", "charge on the road",
    "وين بشحن", "وين بشحنها", "محطات شحن", "محطة شحن", "wen bish7an", "wen bsha7en", "bornes de recharge",
  ],
  CHARGING_COST: [
    "charging cost", "cost of charging", "cost to charge", "charging price", "price to charge", "how much to charge",
    "how much does charging cost", "how much does it cost to charge", "electricity cost", "electricity bill", "cost per charge",
    "كلفة الشحن", "سعر الشحن", "تكلفة الشحن", "kelfet el sha7en",
  ],
  BRAND_ORIGIN: [
    "who makes", "who makes voyah", "who makes mhero", "who manufactures", "manufacturer", "made in", "where is it made", "where is voyah from",
    "where is mhero from", "where is it from", "where are they from", "which country", "what country", "country of origin", "is it chinese",
    "chinese", "china", "dongfeng", "what brand is", "صيني", "صينية", "مين بيصنع", "صناعة", "بلد المنشأ", "sine", "chinois", "chinoise",
  ],
  CONTACT_CHANNELS: [
    "email", "e mail", "email address", "mail address", "website", "web site", "site web", "instagram", "insta", "instagram page",
    "facebook", "facebook page", "tiktok", "social media", "linkedin", "ايميل", "بريد", "موقع الكتروني", "موقعكم الالكتروني", "انستغرام", "انستا",
  ],
  // An acknowledgement only counts when nothing else was said: all weak.
  ACKNOWLEDGEMENT: [
    weak("thanks"), weak("thank you"), weak("thankyou"), weak("thx"), weak("merci"),
    weak("shukran"), weak("choukran"), weak("thk u"), weak("thku"), weak("thnx"),
    weak("tnx"), weak("thanx"), weak("شكرا"), weak("ok"), weak("okay"), weak("okk"),
    weak("noted"), weak("great"), weak("perfect"), weak("alright"), weak("tamam"),
    weak("تمام"), weak("ماشي"), weak("okay deal"), weak("ok deal"), weak("deal done"),
    weak("stay in contact"), weak("will send them"), weak("i will send"),
  ],
};

/**
 * Phrases that CONTAIN an intent word without meaning it. They take part in
 * longest-phrase-wins and are then thrown away, so the word inside them
 * counts for nothing.
 */
const IGNORE: readonly string[] = [
  "number of",
  "feel free",
  "for free",
  "free of charge",
  "in charge",
  "no problem",
  "no problems",
  "not a problem",
  "no issue",
  "no issues",
  // A forwarded offer's "2 years free maintenance" is not a service request.
  "free maintenance",
  "free service",
];

/**
 * Real words that sit one letter from an intent word. A token that IS one of
 * these is never "corrected" into the intent: "changing" is not "charging".
 */
const NEVER_A_TYPO = [
  "change", "changed", "changes", "changing", "charming", "charting",
  "contract", "contracts", "orange", "arrange", "strange", "financial",
  "position", "vocation", "servant", "serving",
];

/* ── Compiling the vocabulary ────────────────────────────────────────────── */

interface Compiled {
  /** null for an IGNORE phrase. */
  intent: Exclude<Intent, "UNKNOWN"> | null;
  tokens: readonly string[];
  weak: boolean;
}

function tokensOf(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((t) => t !== "");
}

function compile(): Compiled[] {
  const out: Compiled[] = [];
  for (const [intent, entries] of Object.entries(LEXICON) as [
    Exclude<Intent, "UNKNOWN">,
    readonly Entry[],
  ][]) {
    for (const entry of entries) {
      const phrase = typeof entry === "string" ? entry : entry.weak;
      const tokens = tokensOf(phrase);
      if (tokens.length === 0) continue;
      out.push({ intent, tokens, weak: typeof entry !== "string" });
    }
  }
  for (const phrase of IGNORE) {
    out.push({ intent: null, tokens: tokensOf(phrase), weak: false });
  }
  return out;
}

const COMPILED: readonly Compiled[] = compile();

/** Every single word the vocabulary knows, plus the look-alikes above. */
const PROTECTED: ReadonlySet<string> = new Set([
  ...COMPILED.flatMap((c) => c.tokens),
  ...NEVER_A_TYPO,
]);

/**
 * The vocabulary's own words, for the model-entity resolver (entities.ts):
 *  - `single`: every one-word phrase ("person", "price", "garage") — a typo-tolerant model match
 *    that lands on one of these is that word, never a misspelt car;
 *  - `carTalk`: the content words of the sales and specification intents — "price", "range",
 *    "colours", "brochure", "stock" — whose presence beside "dream" says the Dream is meant.
 */
const CAR_TALK_INTENTS: readonly Intent[] = [
  "PRICE", "HORSEPOWER", "RANGE", "BATTERY", "POWERTRAIN", "CHARGING", "SEATS", "DIMENSIONS", "SPECIFICATIONS", "WARRANTY",
  "COLOUR", "COLOUR_VIDEO", "BROCHURE", "GENERAL_INFO", "AVAILABILITY", "FINANCING", "TEST_DRIVE", "DISCOUNT", "COMPARE",
  "MODEL_YEAR", "INTERIOR_COLOUR", "MEDIA_PHOTOS", "BUYING_INTENT",
];
const NOT_CONTENT = new Set([
  "how", "much", "many", "the", "what", "which", "tell", "more", "know", "for", "can", "does", "do", "you", "have", "is", "it", "in", "of", "to", "a", "me",
  "about", "and", "or", "i", "my", "your", "with", "on", "at", "this", "that", "are", "be", "per", "up", "out", "off", "no", "new", "time", "long", "far", "full",
  "want", "take", "one", "ll", "ready", "go", "ahead", "put", "name", "down", "first", "free", "plan", "check", "service", "any", "get", "big", "size", "real", "drive", "test", "try", "car", "now", "available",
]);

export function vocabularyWords(): { single: ReadonlySet<string>; carTalk: ReadonlySet<string> } {
  const single = new Set<string>();
  const carTalk = new Set<string>();
  for (const c of COMPILED) {
    if (c.tokens.length === 1) single.add(c.tokens[0]);
    if (c.intent !== null && CAR_TALK_INTENTS.includes(c.intent)) {
      for (const t of c.tokens) if (t.length >= 2 && !NOT_CONTENT.has(t)) carTalk.add(t);
    }
  }
  for (const t of ["available", "test", "drive", "stock"]) carTalk.add(t);
  return { single, carTalk };
}

/** Each phrase, normalized, with its intent — for the uniqueness test. */
export function lexiconPhrases(): { intent: Intent | null; phrase: string }[] {
  return COMPILED.map((c) => ({ intent: c.intent, phrase: c.tokens.join(" ") }));
}

/* ── Matching ────────────────────────────────────────────────────────────── */

function squash(word: string): string {
  return word.replace(/(.)\1+/g, "$1");
}

/** How a vocabulary word meets a message token: exactly, as a typo, or not. */
function meet(word: string, token: string): "exact" | "fuzzy" | null {
  if (sameWord(word, token)) return "exact";
  if (isArabicToken(word) || isArabicToken(token)) return null;
  if (squash(word) === squash(token)) return "exact";
  if (PROTECTED.has(token)) return null;
  if (/[0-9]/.test(word) || /[0-9]/.test(token)) return null;
  const allow = word.length >= 9 ? 2 : word.length >= 7 ? 1 : 0;
  if (allow === 0 || word[0] !== token[0]) return null;
  return editDistance(word, token, allow) <= allow ? "fuzzy" : null;
}

/** One place an intent was found. */
export interface IntentHit {
  intent: Exclude<Intent, "UNKNOWN">;
  /** The message words that produced it. */
  matched: string;
  /** Token span, end exclusive. */
  start: number;
  end: number;
  fuzzy: boolean;
  weak: boolean;
}

interface RawHit {
  intent: Exclude<Intent, "UNKNOWN"> | null;
  start: number;
  end: number;
  fuzzy: boolean;
  weak: boolean;
}

/** Every intent in the message, in the order written. */
export function findIntents(tokens: readonly string[]): IntentHit[] {
  const raw: RawHit[] = [];
  for (const entry of COMPILED) {
    const n = entry.tokens.length;
    for (let start = 0; start + n <= tokens.length; start++) {
      let fuzzy = false;
      let ok = true;
      for (let j = 0; j < n; j++) {
        const m = meet(entry.tokens[j], tokens[start + j]);
        if (!m) {
          ok = false;
          break;
        }
        if (m === "fuzzy") fuzzy = true;
      }
      if (ok) {
        raw.push({ intent: entry.intent, start, end: start + n, fuzzy, weak: entry.weak });
      }
    }
  }

  // Longest phrase wins, across intents and ignore-phrases alike.
  const longest = raw.filter(
    (a) =>
      !raw.some(
        (b) =>
          b !== a &&
          b.start <= a.start &&
          b.end >= a.end &&
          b.end - b.start > a.end - a.start
      )
  );

  const meaningful = longest.filter(
    (h): h is RawHit & { intent: Exclude<Intent, "UNKNOWN"> } => h.intent !== null
  );

  // A weak word counts only when nothing stronger was asked — "how much hp" is a
  // horsepower question. A comparison, a model list or a greeting beside it is
  // not stronger: "how much is the Courage vs the Taishan" still asks the price.
  const NOT_STRONGER: readonly Intent[] = ["COMPARE", "MODEL_LIST", "SALES", "GREETING", "ACKNOWLEDGEMENT", "MODEL_YEAR"];
  const kept = meaningful.filter(
    (a) => !a.weak || !meaningful.some((b) => !b.weak && b.intent !== a.intent && !NOT_STRONGER.includes(b.intent))
  );

  kept.sort((a, b) => a.start - b.start || b.end - a.end);
  const seen = new Set<string>();
  const out: IntentHit[] = [];
  for (const h of kept) {
    const key = `${h.intent}:${h.start}:${h.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      intent: h.intent,
      matched: tokens.slice(h.start, h.end).join(" "),
      start: h.start,
      end: h.end,
      fuzzy: h.fuzzy,
      weak: h.weak,
    });
  }
  return out;
}

/** Distinct intents, in the order first written. */
export function intentsOf(hits: readonly IntentHit[]): Intent[] {
  const out: Intent[] = [];
  for (const h of hits) if (!out.includes(h.intent)) out.push(h.intent);
  return out;
}

/* ── Language ────────────────────────────────────────────────────────────── */

export type Language = "en" | "ar" | "arabizi" | "fr" | "mixed" | "unknown";

/** Lebanese Arabizi words unambiguous enough to name the language. */
const ARABIZI_WORDS = new Set([
  "kifak", "kifik", "kifkon", "shu", "chou", "sho", "adesh", "addesh",
  "2adesh", "badde", "baddi", "bade", "3andkon", "3endkon", "marhaba",
  "mar7aba", "ahla", "ahlan", "yalla", "habibi", "tayeb", "mnih", "ktir",
  "kteer", "hayda", "hayde", "hek", "lesh", "leh", "wen", "wein", "ntou",
  "mesh", "msh", "la2", "akid", "tab3an", "se3er", "sa3er", "si3r",
  "ma3loumet", "ma3lumet", "taksit", "ta2sit", "tajrobe", "shukran",
  "choukran", "3adi", "kello", "kelon", "sayara", "sayyara", "fiye", "fik",
  "3am", "ya3ne", "ya3ni", "baddak", "baddik", "inno", "enno",
]);

const FRENCH_WORDS = new Set([
  "bonjour", "bonsoir", "merci", "prix", "combien", "voiture", "svp",
  "quel", "quelle", "couleur", "couleurs", "disponible", "est", "vous",
  "je", "voudrais", "le", "la", "les", "des", "une", "pour", "avec",
]);

/** Latin letters used for Arabic sounds: 2 3 5 6 7 8 9 inside a word. */
const ARABIZI_DIGIT = /[a-z][235-9]|[235-9][a-z]/;

export function detectLanguage(tokens: readonly string[]): Language {
  let arabic = 0;
  let latin = 0;
  let arabizi = 0;
  let french = 0;
  for (const t of tokens) {
    if (isArabicToken(t)) {
      arabic++;
      continue;
    }
    if (!/[a-z]/.test(t)) continue;
    latin++;
    if (ARABIZI_WORDS.has(t) || ARABIZI_DIGIT.test(t)) arabizi++;
    if (FRENCH_WORDS.has(t)) french++;
  }
  if (arabic > 0 && latin > 0) return "mixed";
  if (arabic > 0) return "ar";
  if (latin === 0) return "unknown";
  if (arabizi > 0) return "arabizi";
  if (french >= 2 || (french === 1 && latin === 1)) return "fr";
  return "en";
}

/* ── Button payloads and numbered answers ────────────────────────────────── */

/**
 * The stable payloads the choice buttons carry. A payload names a model or a
 * colour and nothing else — typing one is exactly as powerful as typing the
 * model's name, so a customer who types it gains nothing.
 */
export type ChoicePayload =
  | { kind: "MODEL"; model: string }
  | { kind: "COLOUR"; model: string; colour: string }
  /** The welcome's department menu (workbook, B Showroom / Replies row 3). */
  | { kind: "DEPARTMENT"; department: Department }
  /** A powertrain type menu: EV, EREV, PHEV. */
  | { kind: "CATEGORY"; bucket: "EV" | "EREV" | "PHEV" }
  /** A test-drive slot, as an ISO time. */
  | { kind: "SLOT"; at: string };

export type Department = "SALES" | "CUSTOMER_SERVICE" | "AFTER_SALES" | "SERVICE" | "ADMIN";

export function departmentPayload(d: Department): string {
  return `DEPT:${d}`;
}

export function categoryPayload(bucket: "EV" | "EREV" | "PHEV"): string {
  return `CATEGORY:${bucket}`;
}

export function slotPayload(iso: string): string {
  return `SLOT:${iso}`;
}

export function modelPayload(model: string): string {
  return `MODEL:${model}`;
}

export function colourPayload(model: string, colourId: string): string {
  return `COLOUR:${model}:${colourId.toUpperCase()}`;
}

export function parsePayload(raw: string | null | undefined): ChoicePayload | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  const model = /^MODEL:([A-Z0-9_]{1,20})$/i.exec(s);
  if (model) return { kind: "MODEL", model: model[1].toUpperCase() };
  const dept = /^DEPT:(SALES|CUSTOMER_SERVICE|AFTER_SALES|SERVICE|ADMIN)$/i.exec(s);
  if (dept) return { kind: "DEPARTMENT", department: dept[1].toUpperCase() as Department };
  const category = /^CATEGORY:(EV|EREV|PHEV)$/i.exec(s);
  if (category) return { kind: "CATEGORY", bucket: category[1].toUpperCase() as "EV" | "EREV" | "PHEV" };
  const slot = /^SLOT:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)$/.exec(s);
  if (slot && Number.isFinite(Date.parse(slot[1]))) return { kind: "SLOT", at: new Date(slot[1]).toISOString() };
  const colour = /^COLOUR:([A-Z0-9_]{1,20}):([A-Z0-9_-]{1,64})$/i.exec(s);
  if (colour) {
    return { kind: "COLOUR", model: colour[1].toUpperCase(), colour: colour[2].toLowerCase() };
  }
  return null;
}

/**
 * "2", "number 2", "option 2", "#2", "٢" — the answer to a numbered list,
 * which is how choices are shown on a channel without buttons. Only a
 * message that is JUST the number counts; the engine only asks when a list
 * was actually shown.
 */
export function readChoiceNumber(tokens: readonly string[]): number | null {
  const words = tokens.filter((t) => !["number", "no", "num", "option", "رقم"].includes(t));
  if (words.length !== 1 || tokens.length > 2) return null;
  if (!/^[0-9]{1,2}$/.test(words[0])) return null;
  const n = Number(words[0]);
  return n >= 1 ? n : null;
}

/* ── Filters: which kind of car, how many seats, how many cars ──────────── */

export type CategoryFilter = "EV" | "EREV" | "PHEV" | "HYBRID";

const EV_WORDS = [
  "ev", "evs", "bev", "electric", "fully electric", "full electric", "electric cars", "كهربا", "كهرباء", "كهربائي", "كهربائية", "كهربائيه",
  // Arabizi and French (2026-09-18): "3andkon siyarat kahraba?", "voiture électrique".
  "kahraba", "kahrabe", "kahraba2", "kahrabaiye", "kahraba2iye", "kahrabeye", "electrique", "électrique", "electriques", "électriques",
];
const EREV_WORDS = ["erev", "erevs", "reev", "range extender", "extended range", "range extended"];
const PHEV_WORDS = ["phev", "phevs", "plug in", "plugin", "plug in hybrid"];
const HYBRID_WORDS = ["hybrid", "hybrids", "هايبرد", "هايبريد", "hybride", "hybrides", "haybrid", "هجين", "هجينة"];

function hasRun(tokens: readonly string[], phrase: string): boolean {
  const words = normalize(phrase).split(" ");
  for (let s = 0; s + words.length <= tokens.length; s++) {
    if (words.every((w, j) => sameWord(w, tokens[s + j]))) return true;
  }
  return false;
}

/** Which powertrain kinds the message names, in a fixed order. */
export function readCategories(tokens: readonly string[]): CategoryFilter[] {
  const out: CategoryFilter[] = [];
  if (EV_WORDS.some((w) => hasRun(tokens, w))) out.push("EV");
  if (EREV_WORDS.some((w) => hasRun(tokens, w))) out.push("EREV");
  if (PHEV_WORDS.some((w) => hasRun(tokens, w))) out.push("PHEV");
  else if (HYBRID_WORDS.some((w) => hasRun(tokens, w))) out.push("HYBRID");
  return out;
}

/**
 * "and the Taishan?", "same for the Dream", "what about the Passion L": the PREVIOUS question,
 * asked of another car. Not an intent — it carries no question of its own — so it is read apart.
 */
const SAME_QUESTION_RUNS: readonly string[][] = [
  ["same", "for"], ["same", "question"], ["same", "thing"], ["and", "for"], ["what", "about"], ["how", "about"], ["and", "the"], ["also", "the"],
  ["and"], ["also"], ["same"], ["w", "lal"], ["w", "el"], ["kamen"], ["كمان"], ["نفس", "الشي"], ["et", "la"], ["et", "pour"], ["et"],
];

export function readsSameQuestion(tokens: readonly string[]): boolean {
  return SAME_QUESTION_RUNS.some((run) => run.every((w, i) => tokens[i] === w)) || tokens.includes("same") || tokens.includes("too");
}

/**
 * WHAT KIND OF CAR the customer is looking for, when they name a need and not a model ("the
 * fastest one", "a family car", "something for off-road"). The engine answers ONLY from the
 * workbook's columns — power, range, size, seats — and never says "best"; a need the workbook has
 * no column for (SUV, luxury, off-road, a budget) is handed to the team with the list of models.
 */
export type Need = "FASTEST" | "LONGEST_RANGE" | "BIGGEST" | "FAMILY" | "SUV" | "OFF_ROAD" | "LUXURY" | "BUDGET" | "GENERAL";

const NEED_WORDS: Readonly<Record<Need, readonly string[]>> = {
  FASTEST: ["fastest", "quickest", "most powerful", "strongest", "sportiest", "most hp", "most horsepower", "اسرع", "أسرع", "اقوى", "أقوى", "asra3", "a2wa", "le plus rapide", "la plus rapide", "plus puissant", "plus puissante"],
  LONGEST_RANGE: ["longest range", "most range", "best range", "highest range", "goes furthest", "goes farthest", "اطول مدى", "أطول مدى", "plus grande autonomie"],
  BIGGEST: ["biggest", "largest", "most spacious", "roomiest", "most space", "اكبر", "أكبر", "akbar", "le plus grand", "la plus grande"],
  FAMILY: ["family car", "family", "for my family", "for the family", "kids", "children", "big family", "عائلة", "عائلية", "عيلة", "للعيلة", "3ayle", "3ayle kbire", "famille", "familiale"],
  SUV: ["suv", "suvs", "crossover", "4x4", "jeep style"],
  OFF_ROAD: ["for off road", "for offroad", "off roader", "offroader", "for the mountains", "mountains", "for the jabal", "jabal", "للجبل", "جبل", "tout terrain"],
  LUXURY: ["luxury", "luxurious", "most luxurious", "premium", "vip", "high end", "فخمة", "فخامة", "افخم", "أفخم", "luxe"],
  BUDGET: ["budget", "my budget", "most expensive", "least expensive one", "top of the range", "cheapest", "most affordable", "affordable", "least expensive", "lowest price", "entry level", "ميزانية", "ميزانيتي", "moins cher", "moins chere"],
  GENERAL: ["recommend", "recommendation", "recommendations", "suggest", "suggestion", "which car should i", "which one should i", "what should i get", "what should i buy", "best car", "which is the best", "help me choose", "help me pick", "بتنصح", "بتنصحني", "شو بتنصحني", "تنصحني", "btensa7", "btensa7ne", "conseillez", "conseil"],
};

export function readNeeds(tokens: readonly string[]): Need[] {
  const out: Need[] = [];
  for (const need of Object.keys(NEED_WORDS) as Need[]) if (NEED_WORDS[need].some((w) => hasRun(tokens, w))) out.push(need);
  return out;
}

/** "7 seater", "7 seats", "seven seats" → 7; null when no seat count is named. */
export function readSeatCount(tokens: readonly string[]): number | null {
  const words: Record<string, number> = { five: 5, six: 6, seven: 7, "5": 5, "6": 6, "7": 7 };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const joined = /^([567])(seater|seaters|seats|seat)$/.exec(t);
    if (joined) return Number(joined[1]);
    if (words[t] !== undefined && /^(seater|seaters|seats|seat|مقاعد|ركاب)$/.test(tokens[i + 1] ?? "")) return words[t];
  }
  return null;
}

/** "all", "every", "كل": the customer wants every car in scope. */
export function readsAll(tokens: readonly string[]): boolean {
  return tokens.some((t) => ["all", "every", "everything", "كل", "كلن", "كلها"].includes(t));
}

/** Words that turn a type into a question about the range ("what EVs do you have"). */
export function asksForOptions(tokens: readonly string[]): boolean {
  return tokens.some((t) =>
    ["what", "which", "any", "options", "models", "cars", "have", "offer", "show", "list", "شو", "في", "عندكم"].includes(t)
  );
}

/** A body type that names a group of cars: "the sedan", "mpv". */
export function readBodyType(tokens: readonly string[]): "SEDAN" | "MPV" | null {
  if (tokens.some((t) => ["sedan", "sedans", "saloon", "سيدان"].includes(t))) return "SEDAN";
  if (tokens.some((t) => ["mpv", "minivan", "van"].includes(t))) return "MPV";
  return null;
}

/* ── Hard exclusions ─────────────────────────────────────────────────────── */

export type ExclusionKind = "META_SCAM" | "VENDOR_PITCH" | "SYSTEM_NOTICE" | "INTERNAL_TEST";

export interface Exclusion {
  kind: ExclusionKind;
  /** Why, in words staff can check against the message. */
  reason: string;
}

const LINK = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|me|co|info|site|online|xyz|ly)\/\S*/i;

const IMPERSONATION =
  /\b(?:meta|facebook|instagram)\s+(?:business\s+)?(?:support|team|security|help center|policy|pro team|verified)\b/;

const THREAT =
  /\b(?:disabled|deactivated|suspended|restricted|removed|deleted|banned|terminated|unpublished|violat\w*|infringement|appeal|permanently|verify your (?:account|page)|confirm your (?:account|page))\b/g;

const SERVICE =
  /\b(?:seo|web design|website design|web development|app development|digital marketing|social media (?:marketing|management)|shipments?|freight|logistics|do business with|more leads|leads|followers|likes|lead generation|leads generation|backlinks|google ranking|graphic design|video editing|logo design|content creation|ugc)\b/;

const PITCH =
  /\b(?:we (?:offer|provide|can help|specialize|are a)|i (?:offer|provide|can help you|am a (?:freelancer|professional|digital))|our (?:agency|company|team|services|best services)|company profile|we would like to do business|would you be interested|boost your|grow your|increase your (?:sales|followers|revenue|reach)|free (?:audit|consultation|trial)|dm me|let me know if you)\b/;

const SYSTEM_NOTICE = /\b(?:created this chat because|this chat was created because)\b/;

const INTERNAL_TEST =
  /^(?:(?:hi|hello|hey)\s)?(?:test|testing|tst|test message|test msg|this is a test|just testing|testing testing)(?:\s\d{1,3})?(?:\s(?:please ignore|ignore))?$/;

/**
 * Messages that must never reach the engine as a customer's words. Each rule
 * needs TWO independent signals (or an exact whole-message form), because
 * filtering a real customer is worse than letting a scam through to a
 * person: a person can ignore a scam, nobody answers a filtered customer.
 */
export function detectExclusion(raw: string, normalized: string): Exclusion | null {
  if (SYSTEM_NOTICE.test(normalized)) {
    return { kind: "SYSTEM_NOTICE", reason: "Meta's own chat notice, not a customer message." };
  }

  if (INTERNAL_TEST.test(normalized)) {
    return { kind: "INTERNAL_TEST", reason: "A test message — the whole message is \"test\"." };
  }

  const hasLink = LINK.test(raw);
  const threats = new Set(normalized.match(THREAT) ?? []).size;
  if (IMPERSONATION.test(normalized) && (threats > 0 || hasLink)) {
    return {
      kind: "META_SCAM",
      reason: "Claims to be Meta support and threatens the account or carries a link.",
    };
  }
  if (threats >= 2 && hasLink && /\b(?:page|account)\b/.test(normalized)) {
    return {
      kind: "META_SCAM",
      reason: "Threatens the page or account and carries a link.",
    };
  }

  if (SERVICE.test(normalized) && PITCH.test(normalized)) {
    return { kind: "VENDOR_PITCH", reason: "A vendor offering a service, not a customer." };
  }

  return null;
}

/* ── Reading one message ─────────────────────────────────────────────────── */

export interface MessageReading {
  raw: string;
  normalized: string;
  tokens: string[];
  language: Language;
  hits: IntentHit[];
  /** Distinct intents in the order written; empty when none was found. */
  intents: Intent[];
  /**
   * high: every intent word exact · medium: a typo was tolerated ·
   * low: only weak words · none: no intent at all.
   */
  confidence: "high" | "medium" | "low" | "none";
  exclusion: Exclusion | null;
  payload: ChoicePayload | null;
  choiceNumber: number | null;
}

/**
 * "64000 km", "165,000 km" after photos of a car: the customer telling us
 * THEIR car's mileage for a trade-in, not asking a range (WhatsApp,
 * 2026-09-16). Only a bare "km" after a number of at least 1,000, in a
 * message with no question mark and no other intent.
 */
function mileageAsTradeIn(hits: IntentHit[], tokens: readonly string[], raw: string): IntentHit[] {
  if (raw.includes("?") || raw.includes("؟") || hits.length !== 1) return hits;
  const [h] = hits;
  if (h.intent !== "RANGE" || !["km", "kms"].includes(h.matched) || h.start === 0) return hits;
  // normalize() may split "165,000" into "165" "000"; join the digits before "km".
  let digits = "";
  for (let i = h.start - 1; i >= 0 && /^[0-9]+$/.test(tokens[i]); i--) digits = tokens[i] + digits;
  if (digits === "" || Number(digits) < 1000) return hits;
  return [{ ...h, intent: "TRADE_IN" }];
}

/**
 * Read one inbound message. `payload` is the button payload when the customer
 * tapped a choice; a message typed in exactly that shape counts too (it is
 * no more powerful than typing the model's name).
 */
export function readMessage(text: string, payload?: string | null): MessageReading {
  const raw = typeof text === "string" ? text : "";
  // "0%" is an installments question (workbook E); "0% - 100%" and "0-100" are not.
  const normalized = normalize(raw.replace(/(^|\s)0\s?%(?!\s*[-–]\s*\d)/g, "$1zero percent "));
  const tokens = normalized === "" ? [] : normalized.split(" ");
  const parsedPayload = parsePayload(payload) ?? parsePayload(raw);
  const hits = parsedPayload ? [] : mileageAsTradeIn(findIntents(tokens), tokens, raw);

  let confidence: MessageReading["confidence"] = "none";
  if (hits.length > 0) {
    confidence = hits.every((h) => h.weak)
      ? "low"
      : hits.some((h) => h.fuzzy)
        ? "medium"
        : "high";
  }

  return {
    raw,
    normalized,
    tokens,
    language: detectLanguage(tokens),
    hits,
    intents: intentsOf(hits),
    confidence,
    exclusion: parsedPayload ? null : detectExclusion(raw, normalized),
    payload: parsedPayload,
    choiceNumber: parsedPayload ? null : readChoiceNumber(tokens),
  };
}
