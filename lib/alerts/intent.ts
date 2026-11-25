/**
 * WHAT KIND OF CONVERSATION IS THIS? Nine classes (Samer, 2026-11-25), read from the labels the
 * sales engine already keeps — the alert's kinds and the intents of the customer's messages —
 * never from the words again. A person may correct it; a correction always wins.
 *
 * Honest limits, audited that day: no chat is linked to a CRM customer yet (0 of 1,740 leads), so
 * "existing customer" is known only when the customer's own messages are an owner's (OWNER_ISSUE,
 * the engine's owner_support) or a person says so; and the engine drops suppliers' pitches and
 * scams before it labels anything, so those two classes come from a person's correction only.
 */

import type { AlertKind } from "@/lib/wasales/actions";

export const CONVERSATION_CLASSES = [
  "ready_to_buy",
  "test_drive",
  "interested",
  "general",
  "existing_customer",
  "after_sales",
  "supplier",
  "spam",
  "no_action",
] as const;
export type ConversationClass = (typeof CONVERSATION_CLASSES)[number];

export const CLASS_LABEL: Readonly<Record<ConversationClass, string>> = {
  ready_to_buy: "Ready to buy",
  test_drive: "Test drive requested",
  interested: "Interested customer",
  general: "General inquiry",
  existing_customer: "Existing customer",
  after_sales: "After-sales inquiry",
  supplier: "Supplier or business proposal",
  spam: "Spam",
  no_action: "No action required",
};

export const isConversationClass = (v: unknown): v is ConversationClass => typeof v === "string" && (CONVERSATION_CLASSES as readonly string[]).includes(v);

/** A salesperson's work, most valuable first. */
export const SALES_CLASSES: readonly ConversationClass[] = ["ready_to_buy", "test_drive", "interested"];
export const isHighIntent = (c: ConversationClass): boolean => c === "ready_to_buy" || c === "test_drive";
/** Somebody at Monza has to do something about it. */
export const isActionable = (c: ConversationClass): boolean => c !== "supplier" && c !== "spam" && c !== "no_action";

const BUY: readonly string[] = ["BUYING", "BUYING_INTENT"];
const DRIVE: readonly string[] = ["TEST_DRIVE"];
const INTEREST: readonly string[] = [
  "PRICE", "FINANCING", "STOCK", "AVAILABILITY", "DISCOUNT", "TRADE_IN", "VISIT", "CALLBACK", "LEAD", "SALES",
  "COLOUR", "COLOUR_VIDEO", "INTERIOR_COLOUR", "BROCHURE", "COMPARE", "SPECIFICATIONS", "RANGE", "SEATS", "HORSEPOWER",
  "POWERTRAIN", "CHARGING", "MODEL_LIST", "MODEL_YEAR", "OTHER_SPEC", "MEDIA_PHOTOS", "USED_CARS",
];
const AFTER_SALES: readonly string[] = ["OWNER_ISSUE", "SERVICE", "PARTS", "WARRANTY"];

export interface ClassInput {
  /** A person's correction, when there is one. */
  override?: ConversationClass | null;
  /** Kinds and tags of the chat's open alert(s). */
  alertKinds: readonly (AlertKind | string)[];
  /** The engine's intents over the customer's recent messages. */
  intents: readonly string[];
  /** The engine read an owner asking for support. */
  ownerSupport?: boolean;
}

/**
 * The class, and whether a person set it. Order matters: a correction first; then what the customer
 * is trying to DO (buy, drive) beats who they are — an owner asking to buy a second car is a sale.
 */
export function classOf(input: ClassInput): { class: ConversationClass; source: "person" | "labels" } {
  if (input.override) return { class: input.override, source: "person" };
  const all = new Set<string>([...input.alertKinds, ...input.intents]);
  const any = (list: readonly string[]) => list.some((k) => all.has(k));
  if (any(BUY)) return { class: "ready_to_buy", source: "labels" };
  if (any(DRIVE)) return { class: "test_drive", source: "labels" };
  if (any(AFTER_SALES)) return { class: "after_sales", source: "labels" };
  if (any(INTEREST)) return { class: "interested", source: "labels" };
  if (input.ownerSupport) return { class: "existing_customer", source: "labels" };
  return { class: "general", source: "labels" };
}
