/**
 * TRIAGE for customers the bot is NOT switched on for (Samer, 2026-09-17):
 * "a non-pilot customer should never disappear simply because the bot is
 * disabled for them".
 *
 * The bot answers only the pilot chats (autoreply-pilot.ts). Every OTHER
 * customer message is still read by the same engine, purely to say what it is
 * about, and the chat is marked for a person: the sales team sees "Asked for
 * the price · VOYAH Courage" in the inbox strip instead of a message nobody
 * noticed. Nothing is ever sent from here.
 *
 * PURE. The reason carries the engine's words and model codes only — never
 * the customer's words (rule: the alert store holds no customer text).
 */

import { decide, type EngineDeps } from "@/lib/wasales/engine";
import { freshState } from "@/lib/wasales/context";
import type { AlertKind } from "@/lib/wasales/actions";
import type { Intent } from "@/lib/wasales/intent";
import type { ModelCode } from "@/lib/wasales/knowledge";

export interface Triage {
  kind: AlertKind;
  models: ModelCode[];
  /** Why a person is needed, in the engine's words: intents and model codes, never customer text. */
  reason: string;
}

const KIND_BY_INTENT: Partial<Record<Intent, AlertKind>> = {
  PRICE: "PRICE",
  FINANCING: "FINANCING",
  TEST_DRIVE: "TEST_DRIVE",
  AVAILABILITY: "STOCK",
  DISCOUNT: "DISCOUNT",
  TRADE_IN: "TRADE_IN",
  CALLBACK: "CALLBACK",
  HUMAN_HANDOFF: "HUMAN",
  DELIVERY_LOCATION: "QUESTION",
  PAYMENT_CURRENCY: "QUESTION",
  USED_CARS: "QUESTION",
  OTHER_SPEC: "QUESTION",
};

const INTENT_WORDS: Partial<Record<Intent, string>> = {
  GREETING: "a greeting",
  GENERAL_INFO: "more information",
  BROCHURE: "the brochure",
  COLOUR: "colours",
  COLOUR_VIDEO: "a video",
  INTERIOR_COLOUR: "the interior",
  MEDIA_PHOTOS: "photos",
  HORSEPOWER: "horsepower",
  RANGE: "range",
  BATTERY: "battery",
  POWERTRAIN: "electric or hybrid",
  CHARGING: "charging",
  SEATS: "seats",
  DIMENSIONS: "dimensions",
  SPECIFICATIONS: "specifications",
  WARRANTY: "warranty",
  LOCATION: "the showroom location",
  OPENING_HOURS: "opening hours",
  CONTACT_NUMBER: "the phone number",
  PRICE: "the price",
  FINANCING: "installments",
  TEST_DRIVE: "a test drive",
  AVAILABILITY: "availability",
  DISCOUNT: "offers",
  TRADE_IN: "a trade-in",
  SERVICE: "service",
  PARTS: "spare parts",
  COMPLAINT: "a complaint",
  SALES: "sales",
  MODEL_LIST: "which cars we have",
  COMPARE: "a comparison",
  MODEL_YEAR: "the model year",
  OTHER_BRAND: "another brand",
  CALLBACK: "a call back",
  HUMAN_HANDOFF: "a person",
  DELIVERY_LOCATION: "delivery",
  PAYMENT_CURRENCY: "the payment currency",
  USED_CARS: "used cars",
  OTHER_SPEC: "a specification",
  TEST_DRIVE_CHANGE: "changing a test drive",
};

/**
 * What a message from a customer outside the pilot is about, as an alert for
 * the team. Null only for what is not a customer at all (a scam, a vendor
 * pitch, Meta's own notice, an internal test).
 */
export function triageInbound(
  input: { text: string; hasMedia: boolean; brand: string; now: string },
  deps: EngineDeps
): Triage | null {
  const d = decide(
    { text: input.text, hasMedia: input.hasMedia, brand: input.brand, conversationIsNew: true, now: input.now },
    freshState(),
    deps
  );
  if (d.outcome === "EXCLUDED") return null;

  const u = d.understanding;
  const models = u.models.length > 0 ? u.models : u.model ? [u.model] : u.modelCandidates;
  const intents = u.intents.filter((i) => i !== "UNKNOWN" && i !== "GREETING" && i !== "ACKNOWLEDGEMENT");
  const kind = intents.map((i) => KIND_BY_INTENT[i]).find((k): k is AlertKind => k !== undefined) ?? "NEEDS_PERSON";

  const about = intents.map((i) => INTENT_WORDS[i] ?? i.toLowerCase()).filter((w, i, all) => all.indexOf(w) === i);
  const what =
    input.text.trim() === "" && input.hasMedia
      ? "sent a photo, video or file"
      : about.length > 0
        ? `asked about ${about.join(", ")}`
        : u.intents.includes("GREETING") && intents.length === 0
          ? "said hello"
          : "wrote something the bot does not recognise";
  return {
    kind,
    models,
    reason: `Bot not switched on for this chat: the customer ${what}${models.length > 0 ? ` (${models.join(", ")})` : ""}.`,
  };
}
