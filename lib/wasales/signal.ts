/**
 * A SIGNAL: what the sales engine understood from one customer message, as labels — which car, which
 * question, which colour, which language, what Sales was told. Never the words. Pure, so it is tested
 * without a database; the writer is lib/wasales/signal-server.ts and the reader lib/insights/.
 *
 * Samer, 2026-10-12: "I need the system to track the data and save the data for insights about the
 * models and about our clients." Until now the engine read every message and forgot it; the inbox kept
 * only the alerts. This is the memory the insights page is built on.
 */

import type { EngineDecision } from "@/lib/wasales/engine";
import type { Intent } from "@/lib/wasales/intent";

export interface Signal {
  accountId: string;
  brand: string;
  channel: string;
  conversationId: string;
  externalMessageId: string;
  /** When the customer wrote (ISO). */
  at: string;
  language: string;
  intents: string[];
  models: string[];
  weakModels: string[];
  colour: string | null;
  hasMedia: boolean;
  alertKind: string | null;
  alertTags: string[];
  offered: string[];
  silenced: string[];
}

export interface SignalMeta {
  accountId: string;
  brand: string;
  channel: string;
  conversationId: string;
  externalMessageId: string;
  at: string;
  hasMedia: boolean;
}

/** Intents that are only politeness or mechanics — not a question worth counting. */
const NOT_A_TOPIC: ReadonlySet<string> = new Set(["UNKNOWN", "GREETING", "ACKNOWLEDGEMENT", "YES", "NO"]);

/** The decision's labels, or null when the engine excluded the message (a scam, a vendor, an echo). */
export function signalFromDecision(d: EngineDecision, meta: SignalMeta): Signal | null {
  if (d.outcome === "EXCLUDED") return null;
  const u = d.understanding;
  const models = u.models.length > 0 ? u.models : u.model ? [u.model] : [];
  const alerts = d.actions.filter((a): a is Extract<EngineDecision["actions"][number], { type: "ALERT_SALES" }> => a.type === "ALERT_SALES");
  const alert = alerts[0] ?? null;
  const offered = unique(d.actions.filter((a) => a.type.startsWith("SEND_") || a.type.startsWith("SHOW_")).map((a) => a.type));
  const silenced = unique(
    d.reasons
      .filter((r) => r.startsWith("Not said (silent hand-off): "))
      .flatMap((r) => r.replace("Not said (silent hand-off): ", "").replace(/ — a person answers\.$/, "").split(", "))
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const colour = u.colour.kind === "one" ? u.colour.name : u.colour.kind === "unavailable" ? u.colour.requested : null;
  return {
    ...meta,
    language: u.reading.language ?? "unknown",
    intents: unique(u.intents.filter((i) => !NOT_A_TOPIC.has(i))).slice(0, 24),
    models: unique(models).slice(0, 8),
    weakModels: unique(u.weakModels).slice(0, 8),
    colour: colour ? colour.slice(0, 60) : null,
    alertKind: alert?.kind ?? null,
    alertTags: unique(alert ? (alert.tags ?? [alert.kind]) : []).slice(0, 16),
    offered: offered.slice(0, 16),
    silenced: silenced.slice(0, 16),
  };
}

function unique<T>(items: readonly T[]): T[] {
  return items.filter((x, i, all) => all.indexOf(x) === i);
}

/* ── Reading the labels back, for people ─────────────────────────────────── */

/** What a customer asked about, in the words the insights page shows. */
export const TOPIC_LABEL: Readonly<Partial<Record<Intent, string>>> = {
  GENERAL_INFO: "General info",
  BROCHURE: "Brochure",
  COLOUR: "Colours",
  COLOUR_VIDEO: "Video",
  HORSEPOWER: "Power",
  RANGE: "Range",
  BATTERY: "Battery",
  POWERTRAIN: "Powertrain",
  CHARGING: "Charging",
  SEATS: "Seats",
  DIMENSIONS: "Dimensions",
  SPECIFICATIONS: "Specifications",
  LOCATION: "Location",
  OPENING_HOURS: "Opening hours",
  CONTACT_NUMBER: "Phone number",
  PRICE: "Price",
  FINANCING: "Installments",
  TEST_DRIVE: "Test drive",
  WARRANTY: "Warranty",
  AVAILABILITY: "Availability",
  DISCOUNT: "Offers",
  TRADE_IN: "Trade-in",
  SERVICE: "Service",
  PARTS: "Parts",
  COMPLAINT: "Complaint",
  SALES: "Sales",
  MODEL_LIST: "Which models",
  COMPARE: "Compare",
  MODEL_YEAR: "Model year",
  OTHER_BRAND: "Other brand",
  INTERIOR_COLOUR: "Interior",
  MEDIA_PHOTOS: "Photos",
  HUMAN_HANDOFF: "A person",
  CALLBACK: "Call me",
  DELIVERY_LOCATION: "Delivery",
  PAYMENT_CURRENCY: "Payment",
  USED_CARS: "Used cars",
  OTHER_SPEC: "Other detail",
  TEST_DRIVE_CHANGE: "Change test drive",
  ACCOUNTS: "Accounts",
  ORDER_STATUS: "Order status",
  OTHER_COST: "Other cost",
  MEDIA_PROBLEM: "File problem",
  DECLINE: "Declined",
  NO_VIDEO: "No video",
  NO_BROCHURE: "No brochure",
  NOT_INTERESTED: "Not interested",
  OPT_OUT: "Stop",
  WRONG_NUMBER: "Wrong number",
  BUYING_INTENT: "Wants to buy",
  VISIT: "Visit",
  WAITING_COMPLAINT: "Kept waiting",
  OWNER_ISSUE: "Owner issue",
  WARRANTY_CLAIM: "Warranty claim",
  SAFETY: "Safety",
  BATTERY_LIFE: "Battery life",
  BATTERY_REPLACEMENT: "Battery replacement",
  CHARGER_INCLUDED: "Charger included",
  HOME_CHARGING: "Home charging",
  PUBLIC_CHARGING: "Public charging",
  CHARGING_COST: "Charging cost",
  BRAND_ORIGIN: "Where it's made",
  CONTACT_CHANNELS: "Email / website",
};

export function topicLabel(intent: string): string {
  return TOPIC_LABEL[intent as Intent] ?? intent.toLowerCase().replace(/_/g, " ");
}

/**
 * How far a customer has come, from what they asked. One of these, the furthest wins.
 * It is a reading of the questions, not a CRM stage: nobody sets it, and it never goes backwards.
 */
export type Stage = "buying" | "test_drive" | "pricing" | "interested" | "asking" | "wrote";

export const STAGE_LABEL: Readonly<Record<Stage, string>> = {
  buying: "Wants to buy",
  test_drive: "Wants a test drive",
  pricing: "Asked price / terms",
  interested: "Interested in a car",
  asking: "Asking questions",
  wrote: "Wrote",
};

const STAGE_RANK: Readonly<Record<Stage, number>> = { buying: 5, test_drive: 4, pricing: 3, interested: 2, asking: 1, wrote: 0 };

export function stageOf(intents: readonly string[], models: readonly string[]): Stage {
  const has = (i: string) => intents.includes(i);
  if (has("BUYING_INTENT")) return "buying";
  if (has("TEST_DRIVE") || has("VISIT")) return "test_drive";
  if (has("PRICE") || has("FINANCING") || has("DISCOUNT") || has("AVAILABILITY") || has("TRADE_IN")) return "pricing";
  if (models.length > 0) return "interested";
  if (intents.length > 0) return "asking";
  return "wrote";
}

export function furthestStage(stages: readonly Stage[]): Stage {
  return stages.reduce<Stage>((best, s) => (STAGE_RANK[s] > STAGE_RANK[best] ? s : best), "wrote");
}
