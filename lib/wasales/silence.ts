/**
 * SILENT HAND-OFF (Samer, 2026-10-06): the bot answers only with INFORMATION — the welcome and its
 * menus, the car facts, the type menus, brochures, colours and videos, installments and trade-in
 * information, the showroom's address and hours. Everything else it used to say — the price and
 * offer hand-offs, test drives and visits, "a person will reply", call-backs, the service and
 * administration numbers, thank-yous, "not interested", "stop", "wrong number" — is NOT sent.
 * The bot stays silent on those, and the chat is flagged for Sales (the inbox bar and the phone
 * notification), so a person answers in their own words.
 *
 * He marked the 66 sentences in the workbook export (Monza-AI-Sales-Bot-Messages.xlsx, rows
 * highlighted yellow); this file is that list. It reverses the 2026-09-18 "never silent" rule for
 * those sentences only: a question the bot CAN answer from the workbook is still answered.
 *
 * The rule is applied in ONE place, at the end of the engine's decision (`applySilence`), so every
 * path — the autoreply, the inbox suggestion, the simulator — behaves the same. It is a knowledge
 * decision (`silentHandoff`), so the older behaviour stays testable.
 */

import type { EngineAction, TextKey } from "@/lib/wasales/actions";
import type { Awaiting } from "@/lib/wasales/context";

/** The fixed sentences the bot no longer sends. */
export const SILENCED_TEXT: ReadonlySet<TextKey> = new Set<TextKey>([
  // Hello and menus
  "NUDGE",
  // Car facts it cannot give
  "SPEC_NOT_CONFIRMED",
  "MODEL_YEAR",
  "BATTERY_LIFE_INFO",
  "TOPIC_HANDOFF",
  "INTERIOR_INFO",
  "PHOTOS_INFO",
  "OTHER_BRAND",
  // Types of car
  "CATEGORY_NONE",
  "RECOMMEND_HANDOFF",
  "BUDGET_HANDOFF",
  // Brochures and videos
  "ALL_BROCHURES_ASK",
  "PREFERENCE_NOTED",
  // Buying
  "PRICE_HANDOFF",
  "DISCOUNT_HANDOFF",
  "STOCK_CONFIRM",
  "PAYMENT_HANDOFF",
  "BUYING_HANDOFF",
  "DELIVERY_INFO",
  "USED_CARS_INFO",
  "TRADE_IN_THANKS",
  "TRADE_IN_PHOTO_THANKS",
  "TRADE_IN_VALUATION",
  // Test drives and visits
  "TEST_DRIVE_REQUEST",
  "TEST_DRIVE_TIME_PASSED",
  "TEST_DRIVE_DAY_NOTED",
  "TEST_DRIVE_TEAM",
  "CLOSED_SUNDAY",
  "CLOSED_THEN",
  "VISIT_WELCOME",
  // Numbers and departments
  "SERVICE_CONTACT",
  "COMPLAINT_CONTACT",
  "ADMIN_CONTACT",
  "AFTER_HOURS_NOTE",
  // A person, and everything else
  "HANDOFF",
  "HUMAN_HANDOFF",
  "CALLBACK_ASK_NUMBER",
  "ASK_PHONE",
  "CALLBACK_CONFIRMED",
  "WAITING_APOLOGY",
  "PHOTO_RECEIVED",
  "YOU_ARE_WELCOME",
  "NO_PROBLEM",
  "NOT_INTERESTED_ACK",
  "OPT_OUT_ACK",
  "WRONG_NUMBER_ACK",
  // The switched-off booking flow, should it ever be switched back on
  "ASK_NAME",
  "ASK_NAME_AND_PHONE",
  "LEAD_THANKS",
  "TEST_DRIVE_ASK_NAME",
  "TEST_DRIVE_BOOKED",
  "TEST_DRIVE_TIME_NOTED",
  "TEST_DRIVE_TIME_CLOSED",
  "TEST_DRIVE_TAKEN",
  "TEST_DRIVE_NO_SLOTS",
  "TEST_DRIVE_WHEN",
  "TEST_DRIVE_NONE",
  "TEST_DRIVE_CANCELLED",
  "TEST_DRIVE_RESCHEDULE",
]);

/** Kept, for the record: what the bot STILL says. A test asserts the two sets cover every key. */
export const SPOKEN_TEXT: ReadonlySet<TextKey> = new Set<TextKey>(["FINANCING_INFO", "SALES_FOLLOWUP", "TRADE_IN_INFO"]);

/**
 * Dropped sentences that were only politeness: nothing was asked, so nobody is alerted. Everything
 * else that is dropped was a question or a request, and a person must see it.
 */
const QUIET_DROPS: ReadonlySet<TextKey> = new Set<TextKey>(["NUDGE", "PREFERENCE_NOTED", "YOU_ARE_WELCOME", "NO_PROBLEM", "TRADE_IN_THANKS", "AFTER_HOURS_NOTE"]);

/** Dropped sentences that say something a person must know even though no question was asked. */
const TOLD_PERSON: Readonly<Partial<Record<TextKey, string>>> = {
  OPT_OUT_ACK: "Asked to stop receiving messages — nothing was sent; a person decides",
  NOT_INTERESTED_ACK: "Said they are not interested — nothing was sent",
  WRONG_NUMBER_ACK: "Said it is the wrong number — nothing was sent",
  WAITING_APOLOGY: "Says they have been kept waiting — nothing was sent; reply now",
  PHOTO_RECEIVED: "Sent a photo, video or voice note with no words — nothing was sent; a person looks",
  TRADE_IN_PHOTO_THANKS: "Sent photos of the car to trade in — nothing was sent; a person looks",
};

/** Does this action, if sent, answer the customer with something the bot may say? */
export function isSilenced(a: EngineAction): boolean {
  switch (a.type) {
    case "SEND_TEXT":
      return SILENCED_TEXT.has(a.key);
    case "SEND_CONTACT_FALLBACK":
    case "COLOUR_NOT_AVAILABLE":
    case "SHOW_TEST_DRIVE_SLOTS":
      return true;
    case "SEND_GLOBAL_INFO":
      // The address and the hours are given; the phone number is not (row 72).
      return a.key === "CONTACT_NUMBER";
    case "SHOW_MODEL_CHOICES":
      // "Did you mean the VOYAH Dream?" and "which car in black?" (rows 7 and 8) are not asked.
      return a.prompt === "confirm" || a.prompt === "colour_which";
    case "SHOW_CATEGORY":
      // "We don't currently offer a 9-seat model" (row 35): a type with no car is not answered.
      return a.groups.every((g) => g.models.length === 0);
    default:
      return false;
  }
}

export interface Silenced {
  actions: EngineAction[];
  /** The keys that were dropped, for the decision's reasons (staff read them; no customer words). */
  dropped: string[];
  /** The open question was dropped with the sentence: the state must not wait for its answer. */
  resetAwaiting: boolean;
  /** A dropped sentence left a request unanswered and no alert existed: this one is added. */
  alertReason: string | null;
}

/**
 * Remove the silenced sentences from a decision's actions. Alerts, flags and content gaps stay.
 * A SEND_FACTS with an unconfirmed row loses that row (row 21: "not confirmed yet" is not said);
 * an all-unconfirmed one goes entirely.
 */
export function applySilence(actions: readonly EngineAction[], awaiting: Awaiting): Silenced {
  const kept: EngineAction[] = [];
  const dropped: string[] = [];
  let askedSomething = false;
  let told: string | null = null;
  let droppedQuestion = false;

  for (const a of actions) {
    if (a.type === "SEND_FACTS") {
      const rows = a.rows.filter((r) => r.confirmed);
      if (rows.length === a.rows.length) {
        kept.push(a);
      } else {
        dropped.push("NOT_CONFIRMED_FACT");
        askedSomething = true;
        if (rows.length > 0) kept.push({ ...a, rows });
      }
      continue;
    }
    if (!isSilenced(a)) {
      kept.push(a);
      continue;
    }
    const key = a.type === "SEND_TEXT" ? a.key : a.type;
    dropped.push(key);
    if (a.type === "SEND_TEXT") {
      if (TOLD_PERSON[a.key]) told = told ?? TOLD_PERSON[a.key] ?? null;
      else if (!QUIET_DROPS.has(a.key)) askedSomething = true;
      if (QUESTIONS.has(a.key)) droppedQuestion = true;
    } else {
      askedSomething = true;
      if (a.type === "SHOW_MODEL_CHOICES" || a.type === "SHOW_TEST_DRIVE_SLOTS") droppedQuestion = true;
    }
  }

  const stillAsks = kept.some((a) => a.type === "SHOW_MODEL_CHOICES" || a.type === "SHOW_COLOUR_CHOICES" || a.type === "SHOW_CATEGORY" || a.type === "SHOW_DEPARTMENTS");
  const hasAlert = kept.some((a) => a.type === "ALERT_SALES");
  const alertReason = !hasAlert && (askedSomething || told) ? (told ?? "Asked something the bot does not answer by itself — nothing was sent; a person replies") : null;
  const resetAwaiting = droppedQuestion && !stillAsks && awaiting !== "NONE" && awaiting !== "MODEL" && awaiting !== "COLOUR";
  return { actions: kept, dropped, resetAwaiting, alertReason };
}

/** Sentences that open a question the state then waits on. */
const QUESTIONS: ReadonlySet<TextKey> = new Set<TextKey>([
  "ASK_NAME",
  "ASK_NAME_AND_PHONE",
  "TEST_DRIVE_ASK_NAME",
  "ASK_PHONE",
  "CALLBACK_ASK_NUMBER",
  "TEST_DRIVE_DAY_NOTED",
  "CLOSED_SUNDAY",
  "CLOSED_THEN",
  "TEST_DRIVE_TIME_NOTED",
  "TEST_DRIVE_TIME_CLOSED",
  "TEST_DRIVE_TAKEN",
  "TEST_DRIVE_RESCHEDULE",
]);
