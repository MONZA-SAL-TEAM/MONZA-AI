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

export function classify(read: readonly Intent[]): Classification {
  let intents = [...read];
  const dropped: Classification["dropped"] = [];
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
    return { intents, dropped, ownerSupport: false, ended: true };
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

  // 3. An owner with a problem: after-sales, and nothing about selling.
  const ownerSupport = OWNER_TOPICS.some(has) || (has("COMPLAINT") && !has("WAITING_COMPLAINT"));
  if (ownerSupport) {
    for (const i of [...intents]) if (!SURVIVES_OWNER_SUPPORT.includes(i)) drop(i, "an owner needing after-sales is never sent sales material");
  }

  return { intents, dropped, ownerSupport, ended: false };
}
