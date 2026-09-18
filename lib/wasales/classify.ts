/**
 * INTENT REFINEMENT — what the customer is asking ABOUT, decided before any
 * spec keyword is answered.
 *
 * The vocabulary (intent.ts) says which WORDS are in a message. Words are not
 * questions: "is the battery safe?" contains "battery", and until 2026-09-18
 * that alone answered "43 kWh". "How much does charging cost?" contains "how
 * much", and that alone opened the vehicle-price flow. "I own a Voyah Free and
 * the screen is frozen" contains a car's name, and that alone sent a brochure.
 *
 * This file takes the intents the words produced and keeps only the question
 * that was asked. Closed rules, the same every time, each with its reason:
 *
 *   1. A QUALIFIER beats the bare topic word it qualifies.
 *        battery + safe / life / replacement   → not "battery capacity"
 *        charging + home / public / charger / cost → not "charging time"
 *        warranty + claim                      → not "how long is the warranty"
 *   2. "How much" belongs to the thing it is asked of. Asked of charging, a
 *      battery replacement, a service or a part, it is NOT the car's price.
 *   3. An OWNER with a problem is after-sales. Nothing about selling survives:
 *      no brochure, no colours, no video, no price flow, no lead.
 *   4. A trade-in names the customer's OWN car: not "another brand" we do not
 *      sell, not a model year of ours, not a range in km.
 *   5. "Not interested", "stop", "wrong number" end the sales conversation:
 *      every other word in the message is ignored.
 *
 * Not an AI. It returns what it dropped and why, so staff (and tests) can see
 * the reasoning.
 */

import type { Intent } from "@/lib/wasales/intent";

export interface Classification {
  intents: Intent[];
  dropped: { intent: Intent; because: string }[];
  /** The customer owns the car and needs after-sales: sales media and sales flows must not run. */
  ownerSupport: boolean;
  /** The customer ended the sales conversation (not interested, stop, wrong number). */
  ended: boolean;
  /** Everything asked for was REFUSED ("don't send the Dream brochure", "no test drive"): nothing is done, no car is opened. */
  refusedOnly: boolean;
  /** What an OTHER_SPEC / OTHER_COST question is about, when the words say ("insurance", "battery details"). */
  specDetail: string | null;
}

const BATTERY_QUALIFIERS: readonly Intent[] = ["SAFETY", "BATTERY_LIFE", "BATTERY_REPLACEMENT"];
const CHARGING_QUALIFIERS: readonly Intent[] = ["CHARGER_INCLUDED", "HOME_CHARGING", "PUBLIC_CHARGING", "CHARGING_COST"];
const OWNER_TOPICS: readonly Intent[] = ["OWNER_ISSUE", "WARRANTY_CLAIM", "BATTERY_REPLACEMENT"];
const AFTER_SALES_TOPICS: readonly Intent[] = ["SERVICE", "PARTS", "COMPLAINT", ...OWNER_TOPICS];
const ENDINGS: readonly Intent[] = ["NOT_INTERESTED", "OPT_OUT", "WRONG_NUMBER"];

/** What an owner-support message may still carry: who to talk to, and courtesy. */
const SURVIVES_OWNER_SUPPORT: readonly Intent[] = [
  ...AFTER_SALES_TOPICS, "GREETING", "ACKNOWLEDGEMENT", "HUMAN_HANDOFF", "CALLBACK", "WAITING_COMPLAINT", "LOCATION", "OPENING_HOURS", "CONTACT_NUMBER", "UNKNOWN",
];

/* ── A trigger word is only a trigger when its OBJECT allows it (Samer's word traps, 2026-09-18) ── */

/** What the vocabulary read: the tokens and where each phrase was found. */
export interface ReadWords {
  tokens: readonly string[];
  hits: readonly { intent: Intent; matched: string; start: number; end: number }[];
}

/**
 * "Open", "closed", "where", "available", "how much": each is said OF something. When that something
 * is a thing and not the showroom / the car, the word is not the trigger it looks like.
 */
const OBJECTS: Partial<Record<Intent, { things: readonly string[]; because: string }>> = {
  OPENING_HOURS: {
    things: ["trunk", "boot", "door", "doors", "sunroof", "window", "windows", "hood", "bonnet", "tailgate", "flap", "brochure", "pdf", "link", "file", "app", "deal", "account", "road", "financing", "ticket", "case", "video", "charging"],
    because: "\"open\" / \"closed\" is said of a thing, not of the showroom",
  },
  LOCATION: {
    things: ["battery", "vin", "port", "charger", "fuse", "jack", "tire", "tyre", "spare", "engine", "motor", "button", "made", "manufactured", "built", "assembled", "chassis", "from", "center", "centre", "service"],
    because: "\"where\" is asked of a thing, not of the showroom",
  },
};

/** "Are YOU available?", "COLOURS available?", "PARTS available?": available — but not a car in stock. */
const NOT_STOCK_SUBJECTS = new Set([
  "you", "u", "salesman", "salesperson", "someone", "anyone", "somebody", "anybody", "agent", "manager", "team", "appointment", "appointments", "slot", "slots",
  "service", "parts", "part", "charger", "chargers", "colours", "colors", "colour", "color", "financing", "finance", "installments", "instalments", "test", "drive",
  "brochure", "video", "insurance", "warranty", "delivery",
]);
const SUBJECT_FILLERS = new Set(["is", "are", "the", "a", "an", "any", "still", "currently", "now", "it", "be", "will"]);

/** "How much" asked of one of these is a workshop / after-sales cost. */
const AFTER_SALES_COSTS = new Set(["service", "servicing", "maintenance", "repair", "repairs", "parts", "part", "key", "keys", "tire", "tires", "tyre", "tyres", "paint", "bodywork", "brakes", "brake", "oil", "windshield", "bumper"]);
/** …and of one of these, a cost the bot has no approved answer for. Never the vehicle-price flow. */
const OTHER_COSTS = new Set(["insurance", "registration", "plates", "plate", "delivery", "shipping", "charger", "wallbox", "accessories", "accessory", "tint", "customs", "installation", "mats"]);

/** A battery question is the CAPACITY only when it says so, or says nothing else. */
const CAPACITY_WORDS = new Set(["size", "capacity", "kwh", "big", "large", "how", "much", "many", "حجم", "حجمها", "سعة", "قديش", "كم"]);
const NOT_A_QUALIFIER = new Set(["the", "a", "is", "of", "what", "whats", "s", "it", "its", "and", "please", "courage", "dream", "passion", "free", "taishan", "mhero", "voyah", "318", "l", "1", "2", "for", "in", "on", "about", "tell", "me"]);

/** A test drive that was watched, reviewed, or already taken is not a request for one. */
const NOT_A_REQUEST = new Set(["watched", "watch", "watching", "saw", "review", "reviews", "youtube", "previous", "last", "already", "drove", "did", "had", "during", "after"]);

/**
 * NEGATION IS READ BEFORE ANY ACTION. "Don't send the Dream brochure" contains "Dream" and "brochure";
 * the customer asked for NOTHING. A verbal negator reaches across its clause ("I don't want to buy it");
 * a bare "no" / "not" negates only what stands right after it ("no test drive", "not interested") — so
 * "no, I want the brochure" is still a request.
 */
const VERBAL_NEGATORS: readonly string[][] = [
  ["don", "t"], ["dont"], ["do", "not"], ["doesn", "t"], ["didn", "t"], ["won", "t"], ["wouldn", "t"], ["never"], ["stop"], ["without"], ["no", "need"], ["not", "need"],
  ["no", "more"], ["ma"], ["mish"], ["mesh"], ["msh"], ["bala"], ["ما"], ["مش"], ["بلا"], ["بدون"], ["وقفوا"], ["وقف"], ["sans"], ["pas"], ["ne"], ["لا", "تبعتلي"], ["لا", "تبعت"], ["لا", "تتصلوا"],
];
const ADJACENT_NEGATORS = new Set(["no", "not", "لا", "non"]);
const NEGATABLE: Partial<Record<Intent, Intent>> = {
  BROCHURE: "NO_BROCHURE",
  SPECIFICATIONS: "NO_BROCHURE",
  COLOUR_VIDEO: "NO_VIDEO",
  MEDIA_PHOTOS: "NO_VIDEO",
  TEST_DRIVE: "DECLINE",
  FINANCING: "DECLINE",
  CALLBACK: "DECLINE",
  BUYING_INTENT: "DECLINE",
  HUMAN_HANDOFF: "DECLINE",
  VISIT: "DECLINE",
  TRADE_IN: "DECLINE",
  GENERAL_INFO: "DECLINE",
};

function startsAt(tokens: readonly string[], at: number, run: readonly string[]): boolean {
  return run.every((w, j) => tokens[at + j] === w);
}

/** Is the phrase found at [start, end) negated? */
function negated(tokens: readonly string[], start: number, otherStarts: readonly number[]): boolean {
  // Adjacent: "no brochure", "not interested", with at most an article between.
  for (let back = 1; back <= 2; back++) {
    const t = tokens[start - back];
    if (t === undefined) break;
    if (ADJACENT_NEGATORS.has(t) && (back === 1 || ["the", "a", "any", "more", "el"].includes(tokens[start - 1]))) return true;
  }
  // Verbal: within the five words before it, with no OTHER request in between ("don't call, send the brochure").
  for (let at = Math.max(0, start - 5); at < start; at++) {
    const run = VERBAL_NEGATORS.find((r) => startsAt(tokens, at, r));
    if (!run) continue;
    const between = otherStarts.some((o) => o > at && o < start);
    if (!between) return true;
  }
  return false;
}

/** The token-aware pass: what each trigger word is attached to. Returns the intents that survive, and why the others did not. */
function attach(read: readonly Intent[], words: ReadWords, dropped: Classification["dropped"]): { intents: Intent[]; specDetail: string | null } {
  let intents = [...read];
  let specDetail: string | null = null;
  const { tokens, hits } = words;
  const has = (i: Intent) => intents.includes(i);
  const drop = (i: Intent, because: string) => {
    if (!has(i)) return;
    intents = intents.filter((x) => x !== i);
    dropped.push({ intent: i, because });
  };
  const add = (i: Intent) => {
    if (!has(i)) intents.push(i);
  };
  const hitsOf = (i: Intent) => hits.filter((h) => h.intent === i);

  // 1. Negation, before anything else.
  for (const [intent, becomes] of Object.entries(NEGATABLE) as [Intent, Intent][]) {
    const found = hitsOf(intent);
    if (found.length === 0) continue;
    // "don't" and "send" are themselves read as a no and a yes: they are the refusal's own words, not another request.
    const others = hits.filter((h) => h.intent !== intent && !["YES", "NO", "ACKNOWLEDGEMENT", "GREETING", "DECLINE"].includes(h.intent)).map((h) => h.start);
    if (found.every((h) => negated(tokens, h.start, others))) {
      drop(intent, "the customer said NOT to");
      add(becomes);
      drop("YES", "part of the refusal's own words");
      drop("NO", "part of the refusal's own words");
    }
  }

  // 2. "Open" / "closed" / "where" said of a thing.
  for (const [intent, rule] of Object.entries(OBJECTS) as [Intent, { things: readonly string[]; because: string }][]) {
    if (has(intent) && tokens.some((t) => rule.things.includes(t))) drop(intent, rule.because);
  }

  // 3. "Available" needs a car as its subject.
  if (has("AVAILABILITY")) {
    const loose = hitsOf("AVAILABILITY").filter((h) => /^(available|availability|avilable|availble|availabe|avaliable|disponible|متوفر|متوفره|موجود|موجوده)$/.test(h.matched));
    const subjectOf = (start: number): string | null => {
      for (let i = start - 1; i >= 0; i--) if (!SUBJECT_FILLERS.has(tokens[i])) return tokens[i];
      return null;
    };
    const allLoose = loose.length === hitsOf("AVAILABILITY").length;
    if (allLoose && loose.length > 0 && loose.every((h) => NOT_STOCK_SUBJECTS.has(subjectOf(h.start) ?? ""))) {
      drop("AVAILABILITY", "\"available\" is asked of something that is not a car in stock");
    }
  }

  // 4. "How much" / "cost" / "price" of a thing that is not the car.
  if (has("PRICE")) {
    const near = (h: { start: number; end: number }) => [tokens[h.start - 2], tokens[h.start - 1], tokens[h.end], tokens[h.end + 1]].filter((t): t is string => typeof t === "string");
    const priced = hitsOf("PRICE");
    const workshop = priced.length > 0 && priced.every((h) => near(h).some((t) => AFTER_SALES_COSTS.has(t)));
    const other = priced.length > 0 && priced.every((h) => near(h).some((t) => OTHER_COSTS.has(t)));
    if (workshop) {
      drop("PRICE", "\"how much\" is asked of a workshop item, not of the car");
      add("SERVICE");
    } else if (other) {
      drop("PRICE", "\"how much\" is asked of something that is not the car");
      add("OTHER_COST");
      specDetail = priced.flatMap(near).find((t) => OTHER_COSTS.has(t)) ?? null;
    }
  }
  if (has("OTHER_COST")) {
    drop("PRICE", "the cost asked about is not the car's");
    drop("DELIVERY_LOCATION", "the question is what delivery costs");
    specDetail = specDetail ?? tokens.find((t) => OTHER_COSTS.has(t)) ?? null;
  }

  // 5. "Battery" alone is the capacity; "what battery does it use?", "battery temperature" are not.
  if (has("BATTERY") && !has("BATTERY_LIFE") && !has("SAFETY") && !has("BATTERY_REPLACEMENT") && !has("WARRANTY")) {
    const found = hitsOf("BATTERY");
    const covered = new Set<number>();
    for (const h of hits) for (let i = h.start; i < h.end; i++) covered.add(i);
    const extra = tokens.filter((t, i) => !covered.has(i) && !NOT_A_QUALIFIER.has(t) && !CAPACITY_WORDS.has(t));
    const saysCapacity = tokens.some((t) => CAPACITY_WORDS.has(t)) || found.some((h) => h.end - h.start > 1);
    if (!saysCapacity && extra.length > 1) {
      drop("BATTERY", "the question is about the battery, but not its capacity");
      add("OTHER_SPEC");
      specDetail = "battery details";
    }
  }

  // 6. A test drive watched, reviewed or already taken.
  if (has("TEST_DRIVE") && tokens.some((t) => NOT_A_REQUEST.has(t))) drop("TEST_DRIVE", "a test drive watched or already taken is not a request for one");

  // 7. A file the bot sent that will not open is a problem for a person — never a reason to send it again.
  if (has("MEDIA_PROBLEM") || (has("OWNER_ISSUE") && (has("BROCHURE") || has("COLOUR_VIDEO") || tokens.some((t) => ["pdf", "link", "file", "brochure", "catalogue", "catalog"].includes(t))))) {
    add("MEDIA_PROBLEM");
    for (const i of ["OWNER_ISSUE", "BROCHURE", "SPECIFICATIONS", "COLOUR_VIDEO", "OPENING_HOURS"] as const) drop(i, "a file that will not open is for a person to sort out");
  }

  // 8. "Is it safe in an accident?" asks about safety; "I had an accident" reports one.
  if (has("SAFETY") && has("OWNER_ISSUE") && hitsOf("OWNER_ISSUE").every((h) => /^(an accident|accident)$/.test(h.matched)) && tokens.some((t) => ["safe", "safety", "protect", "protection", "rating"].includes(t))) {
    drop("OWNER_ISSUE", "the accident is hypothetical: a safety question");
  }

  return { intents, specDetail };
}

export function classify(read: readonly Intent[], words?: ReadWords): Classification {
  const dropped: Classification["dropped"] = [];
  const attached = words ? attach(read, words, dropped) : { intents: [...read], specDetail: null };
  let intents = attached.intents;
  const has = (i: Intent) => intents.includes(i);
  const drop = (i: Intent, because: string) => {
    if (!has(i)) return;
    intents = intents.filter((x) => x !== i);
    dropped.push({ intent: i, because });
  };
  const add = (i: Intent) => {
    if (!has(i)) intents.push(i);
  };

  // 5. The customer ended it: nothing else in the message is a request.
  const ending = ENDINGS.find(has) ?? null;
  if (ending) {
    for (const i of [...intents]) if (i !== ending && i !== "GREETING") drop(i, `the customer said ${ending.toLowerCase().replace(/_/g, " ")}`);
    return { intents, dropped, ownerSupport: false, ended: true, refusedOnly: false, specDetail: null };
  }

  // 2. "How much" asked of something that is not the car.
  if (has("PRICE") && has("CHARGING") && !CHARGING_QUALIFIERS.some(has)) {
    add("CHARGING_COST");
  }
  if (has("PRICE") && has("BATTERY") && !has("CHARGING") && !BATTERY_QUALIFIERS.some(has)) {
    add("BATTERY_REPLACEMENT");
  }
  for (const topic of ["CHARGING_COST", "BATTERY_REPLACEMENT", "SERVICE", "PARTS", "OWNER_ISSUE", "WARRANTY_CLAIM"] as const) {
    if (has(topic)) drop("PRICE", `"how much" is asked of ${topic.toLowerCase().replace(/_/g, " ")}, not of the car`);
  }

  // 1. A qualifier beats the bare topic word.
  const batteryQualifier = BATTERY_QUALIFIERS.find(has);
  if (batteryQualifier) drop("BATTERY", `the question is ${batteryQualifier.toLowerCase().replace(/_/g, " ")}, not the battery's capacity`);
  const chargingQualifier = CHARGING_QUALIFIERS.find(has);
  if (chargingQualifier) {
    drop("CHARGING", `the question is ${chargingQualifier.toLowerCase().replace(/_/g, " ")}, not the charging time`);
    drop("LOCATION", "\"where\" is asked of charging, not of the showroom");
  }
  if (has("SAFETY")) {
    drop("CHARGING", "the question is about safety");
    drop("RANGE", "the question is about safety");
  }
  if (has("WARRANTY_CLAIM")) drop("WARRANTY", "a warranty CLAIM is after-sales, not the warranty's length");
  if (has("WARRANTY") && has("BATTERY")) drop("BATTERY", "the warranty on the battery is a warranty question");
  if (has("WARRANTY") && has("BATTERY_LIFE")) drop("BATTERY_LIFE", "the warranty answers how long the battery is covered");
  if (has("BRAND_ORIGIN")) {
    drop("LOCATION", "\"where is it from\" is the brand's origin, not the showroom");
    drop("MODEL_LIST", "the question is who makes the brand");
    drop("OTHER_BRAND", "the question is who makes the brand");
  }
  if (has("VISIT")) {
    // The visit answer carries the address and the hours itself.
    drop("LOCATION", "the visit answer gives the address");
    drop("OPENING_HOURS", "the visit answer gives the hours");
    drop("TEST_DRIVE_CHANGE", "a visit is not a change to a test drive");
  }
  if (has("BUYING_INTENT")) drop("SALES", "buying intent is the stronger reading");
  if (has("CONTACT_CHANNELS")) drop("CONTACT_NUMBER", "the customer asked for another channel, not the phone number");

  // "No video please" contains "video"; "I don't want the brochure" contains "brochure".
  if (has("NO_VIDEO")) {
    drop("COLOUR_VIDEO", "the customer asked NOT to be sent a video");
    drop("MEDIA_PHOTOS", "the customer asked NOT to be sent a video");
  }
  if (has("NO_BROCHURE")) {
    drop("BROCHURE", "the customer asked NOT to be sent the brochure");
    drop("SPECIFICATIONS", "the customer asked NOT to be sent the brochure");
  }

  // 4. A trade-in is about the customer's own car.
  if (has("TRADE_IN")) {
    drop("OTHER_BRAND", "the other brand is the customer's own car");
    drop("PRICE", "\"how much\" is the value of the customer's own car");
    drop("USED_CARS", "the customer is selling a car, not buying a used one");
    drop("RANGE", "the kilometres are the mileage of the customer's own car");
    drop("MODEL_YEAR", "the year is the year of the customer's own car");
    drop("OWNER_ISSUE", "\"my car\" is the car being traded in");
  }

  // Accounts and an existing order are not a new sale.
  if (has("ACCOUNTS")) for (const i of ["FINANCING", "PRICE", "PAYMENT_CURRENCY", "DISCOUNT"] as const) drop(i, "an existing payment or the accounts department, not a new-car question");
  if (has("ORDER_STATUS")) for (const i of ["AVAILABILITY", "DELIVERY_LOCATION", "VISIT", "OPENING_HOURS", "OWNER_ISSUE"] as const) drop(i, "the customer is asking about a car they already ordered");
  if (has("DECLINE")) drop("NO", "the refusal is already read");

  // 3. An owner with a problem: after-sales, and nothing about selling.
  const ownerSupport = OWNER_TOPICS.some(has) || (has("COMPLAINT") && !has("WAITING_COMPLAINT"));
  if (ownerSupport) {
    for (const i of [...intents]) if (!SURVIVES_OWNER_SUPPORT.includes(i)) drop(i, "an owner needing after-sales is never sent sales material");
  }

  const REFUSALS: readonly Intent[] = ["DECLINE", "NO_VIDEO", "NO_BROCHURE"];
  const asks = intents.filter((i) => i !== "GREETING" && i !== "ACKNOWLEDGEMENT" && i !== "UNKNOWN" && i !== "YES" && i !== "NO");
  const refusedOnly = asks.length > 0 && asks.every((i) => REFUSALS.includes(i));
  return { intents, dropped, ownerSupport, ended: false, refusedOnly, specDetail: attached.specDetail };
}
