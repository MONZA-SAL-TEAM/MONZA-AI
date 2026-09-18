/**
 * ONE ACTIONABLE ALERT — the rules for what the sales team is told.
 *
 * Until 2026-09-18 every topic in a message raised its own alert: "I want the
 * Courage, do you have stock, can I finance it and test drive tomorrow?" put
 * FOUR rows on the inbox strip, each saying a quarter of the story, and an
 * alert stayed open after a person had already answered the customer (8 of the
 * 14 open alerts in production were stale when audited).
 *
 * Pure: no database, no clock of its own. `sales-ops.ts` does the I/O.
 *
 *   consolidateAlerts   one inbound message → at most ONE alert, carrying every
 *                       reason as a tag, the most important first
 *   mergeIntoOpen       a chat that already has an open alert keeps ONE: the
 *                       new reasons are added to it, and it is escalated
 *   closedByStaffReply  a person answered after the alert was raised → it is
 *                       closed, unless the workflow needs a person to close it
 */

import type { AlertKind, AlertUrgency, EngineAction } from "@/lib/wasales/actions";
import type { ModelCode } from "@/lib/wasales/knowledge";

type AlertAction = Extract<EngineAction, { type: "ALERT_SALES" }>;

/** Most important first: what a salesperson should see as the headline. */
export const ALERT_PRIORITY: readonly AlertKind[] = [
  "BUYING", "OVERDUE", "HUMAN", "CALLBACK", "TEST_DRIVE", "FINANCING", "PRICE", "STOCK", "DISCOUNT", "TRADE_IN", "VISIT", "QUESTION", "LEAD", "NEEDS_PERSON",
];

const URGENCY_ORDER: readonly AlertUrgency[] = ["normal", "qualified", "hot", "overdue"];

/** Commercial enquiries: somebody is weighing a purchase. */
const QUALIFIED: readonly AlertKind[] = ["PRICE", "FINANCING", "TEST_DRIVE", "STOCK", "DISCOUNT", "TRADE_IN", "VISIT", "CALLBACK", "LEAD"];

/**
 * A person closes these by hand: the work is a call made, a drive arranged, a car valued, a sale
 * followed — a reply in the chat does not mean it happened.
 */
export const MANUAL_CLOSE: readonly AlertKind[] = ["BUYING", "CALLBACK", "TEST_DRIVE", "TRADE_IN"];

export const KIND_WORDS: Readonly<Record<AlertKind, string>> = {
  BUYING: "Wants to buy",
  OVERDUE: "Kept waiting",
  HUMAN: "Asked for a person",
  CALLBACK: "Asked to be called",
  TEST_DRIVE: "Test drive",
  FINANCING: "Financing",
  PRICE: "Price",
  STOCK: "Stock",
  DISCOUNT: "Offers",
  TRADE_IN: "Trade-in",
  VISIT: "Showroom visit",
  QUESTION: "A question for the team",
  LEAD: "Lead to follow up",
  NEEDS_PERSON: "Needs a person",
};

export function sortKinds(kinds: readonly AlertKind[]): AlertKind[] {
  const seen = new Set<AlertKind>();
  for (const k of kinds) seen.add(k);
  return ALERT_PRIORITY.filter((k) => seen.has(k));
}

export function urgencyOf(kinds: readonly AlertKind[]): AlertUrgency {
  if (kinds.includes("OVERDUE")) return "overdue";
  if (kinds.includes("BUYING")) return "hot";
  if (kinds.some((k) => QUALIFIED.includes(k))) return "qualified";
  return "normal";
}

export function maxUrgency(a: AlertUrgency, b: AlertUrgency): AlertUrgency {
  return URGENCY_ORDER.indexOf(a) >= URGENCY_ORDER.indexOf(b) ? a : b;
}

function uniqueModels(lists: readonly (readonly ModelCode[])[]): ModelCode[] {
  const out: ModelCode[] = [];
  for (const l of lists) for (const m of l) if (!out.includes(m)) out.push(m);
  return out;
}

/**
 * Every ALERT_SALES action of one decision, folded into one. The other actions keep their order;
 * the single alert takes the place of the first.
 */
export function consolidateAlerts(actions: readonly EngineAction[]): EngineAction[] {
  const alerts = actions.filter((a): a is AlertAction => a.type === "ALERT_SALES");
  if (alerts.length === 0) return [...actions];
  const tags = sortKinds(alerts.flatMap((a) => a.tags ?? [a.kind]));
  // A LEAD or a generic "needs a person" adds nothing once a real reason is known.
  const meaningful = tags.length > 1 ? tags.filter((t) => t !== "NEEDS_PERSON" && (t !== "LEAD" || tags.every((x) => x === "LEAD" || x === "NEEDS_PERSON"))) : tags;
  const kinds = meaningful.length > 0 ? meaningful : tags;
  const reasons: string[] = [];
  for (const kind of kinds) {
    for (const a of alerts.filter((x) => x.kind === kind)) {
      const words = a.reason ?? KIND_WORDS[a.kind];
      if (!reasons.includes(words)) reasons.push(words);
    }
  }
  const merged: AlertAction = {
    type: "ALERT_SALES",
    kind: kinds[0],
    tags: kinds,
    // An alert may state its own urgency ("I want the Courage" is qualified interest; "I'll take it" is hot).
    urgency: alerts.map((a) => a.urgency ?? urgencyOf([a.kind])).reduce(maxUrgency, "normal" as AlertUrgency),
    models: uniqueModels(alerts.map((a) => a.models)),
    name: alerts.find((a) => a.name)?.name ?? null,
    phone: alerts.find((a) => a.phone)?.phone ?? null,
    slot: alerts.find((a) => a.slot)?.slot ?? null,
    reason: reasons.join(" · ").slice(0, 300),
  };
  const out: EngineAction[] = [];
  let placed = false;
  for (const a of actions) {
    if (a.type !== "ALERT_SALES") out.push(a);
    else if (!placed) {
      out.push(merged);
      placed = true;
    }
  }
  return out;
}

/** The stored alert, as far as merging needs it. */
export interface OpenAlertRow {
  kind: AlertKind;
  tags: AlertKind[];
  urgency: AlertUrgency;
  models: string[];
  customer_name: string | null;
  customer_phone: string | null;
  slot_at: string | null;
  reason: string | null;
}

export interface IncomingAlert {
  kind: AlertKind;
  tags?: readonly AlertKind[];
  urgency?: AlertUrgency;
  models: readonly string[];
  name: string | null;
  phone: string | null;
  slot: string | null;
  reason?: string | null;
}

/**
 * The open alert of a chat, with the new message's reasons added. `changed` is false when the new
 * alert says nothing the open one does not already say (the same question twice is one follow-up).
 */
export function mergeIntoOpen(open: OpenAlertRow, incoming: IncomingAlert): { row: OpenAlertRow; changed: boolean } {
  const tags = sortKinds([...open.tags, open.kind, ...(incoming.tags ?? [incoming.kind])]);
  const models = [...open.models];
  for (const m of incoming.models) if (!models.includes(m)) models.push(m);
  const reasonParts = (open.reason ?? "").split(" · ").filter(Boolean);
  for (const part of (incoming.reason ?? KIND_WORDS[incoming.kind]).split(" · ")) if (part && !reasonParts.includes(part)) reasonParts.push(part);
  const row: OpenAlertRow = {
    kind: tags[0],
    tags,
    urgency: maxUrgency(open.urgency, incoming.urgency ?? urgencyOf(incoming.tags ?? [incoming.kind])),
    models,
    customer_name: open.customer_name ?? incoming.name,
    customer_phone: open.customer_phone ?? incoming.phone,
    slot_at: incoming.slot ?? open.slot_at,
    reason: reasonParts.join(" · ").slice(0, 300) || null,
  };
  const changed =
    row.kind !== open.kind ||
    row.tags.length !== sortKinds([...open.tags, open.kind]).length ||
    row.urgency !== open.urgency ||
    row.models.length !== open.models.length ||
    row.customer_name !== open.customer_name ||
    row.customer_phone !== open.customer_phone ||
    row.slot_at !== open.slot_at;
  return { row, changed };
}

/**
 * Has a person already dealt with this alert by replying in the chat? True when a STAFF message
 * (never the bot's own) is later than the alert — except for the kinds a person closes by hand.
 */
export function closedByStaffReply(alert: { kind: AlertKind; tags?: readonly AlertKind[] | null; created_at: string }, lastStaffReplyAt: string | null): boolean {
  if (!lastStaffReplyAt) return false;
  const kinds = [alert.kind, ...(alert.tags ?? [])];
  if (kinds.some((k) => MANUAL_CLOSE.includes(k))) return false;
  const raised = Date.parse(alert.created_at);
  const replied = Date.parse(lastStaffReplyAt);
  return Number.isFinite(raised) && Number.isFinite(replied) && replied > raised;
}
