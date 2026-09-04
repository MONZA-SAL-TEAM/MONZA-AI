/**
 * THE DATA BOUNDARY — the vocabulary MONZA AI uses to talk about the business.
 *
 * MONZA AI is a communication and automation layer. It is not an ERP, not an
 * accounting system, not a garage system and not a CRM. The line, precisely:
 *
 *   READ from the source systems (authoritative there, never here)
 *     customer · vehicle · installment · payment · vehicle status · sales data
 *
 *   OWNED by MONZA AI (authoritative here, nowhere else)
 *     conversations · messages · channel identities · message status ·
 *     assignment · templates · automations · execution history ·
 *     communication history · the media library · AI interactions · audit
 *
 * Everything in THIS file is the first list: shapes we READ. They are
 * deliberately thin — just enough to say something accurate to a customer.
 * There is no balance to recompute, no work order to manage, no ledger. If a
 * field here ever becomes something MONZA AI decides rather than reports, that
 * is the moment this has turned into a second ERP and the change is wrong.
 *
 * Nothing here writes. The interface in lib/domain/source.ts has no mutation.
 */

/** A messaging channel MONZA AI can reach a customer on. */
export type ChannelKey = "whatsapp" | "instagram" | "facebook";

export const CHANNELS: readonly ChannelKey[] = [
  "whatsapp",
  "instagram",
  "facebook",
];

/** Staff-facing name for a channel. */
export const CHANNEL_LABEL: Readonly<Record<ChannelKey, string>> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
};

/** One way of reaching a person on one channel. */
export interface ChannelHandle {
  channel: ChannelKey;
  /** Phone digits for WhatsApp, an account handle for Instagram/Facebook. */
  address: string;
  /** What the person is called on that channel, when it differs. */
  displayName?: string;
}

/**
 * A person, as the communication layer needs them. NOT a CRM record: no
 * pipeline stage, no deal value, no ownership history, no notes field that
 * competes with the source system's.
 */
export interface Customer {
  id: string;
  name: string;
  /** Digits only, no plus — ready for a wa.me link. Null when unknown. */
  phone: string | null;
  handles: ChannelHandle[];
  /** Where they first came from, in the source system's words. */
  origin: string;
  /** Plain string as the source system reports it, e.g. "25 Aug 2026". */
  firstContact: string;
  /** The customer's preferred channel, when the source system knows one. */
  preferredChannel: ChannelKey;
}

/**
 * Vehicle status, reduced to the transitions COMMUNICATION cares about.
 *
 * The garage system has far more states than this and keeps every one of them.
 * MONZA AI needs the handful that change what a customer should be told —
 * above all the arrival at "ready for pickup".
 */
export type VehicleStatus =
  | "with_customer"
  | "in_service"
  | "waiting_parts"
  | "ready_for_pickup"
  | "delivered";

export const VEHICLE_STATUS_LABEL: Readonly<Record<VehicleStatus, string>> = {
  with_customer: "With the customer",
  in_service: "In service",
  waiting_parts: "Waiting for parts",
  ready_for_pickup: "Ready for pickup",
  delivered: "Delivered",
};

export interface Vehicle {
  id: string;
  customerId: string | null;
  /** Plain words, e.g. "Voyah Free 2025". */
  label: string;
  vin: string;
  plate: string | null;
  status: VehicleStatus;
  /** The source system's own reference for the open job, when there is one. */
  jobReference: string | null;
  /** Which part is being waited on, when that is the status. */
  awaitingPart: string | null;
}

export type InstallmentStatus = "upcoming" | "due" | "overdue" | "paid";

/**
 * One installment on one payment plan, AS REPORTED by the source system.
 *
 * MONZA AI never decides any of these values. It does not compute a balance,
 * it does not decide that something is overdue, and it does not mark anything
 * paid. It reads the status in order to know whether a reminder is due and
 * what the reminder should say.
 */
export interface Installment {
  id: string;
  planId: string;
  customerId: string;
  vehicleId: string | null;
  /** Which installment of the plan this is, and how many there are. */
  number: number;
  totalCount: number;
  amountUsd: number;
  /** ISO date, "YYYY-MM-DD" — comparable without parsing a human string. */
  dueDate: string;
  status: InstallmentStatus;
  /** ISO date, when the source system says it was paid. */
  paidDate: string | null;
  /** The source system's receipt reference, when one exists. */
  receiptRef: string | null;
}

/** A payment the source system recorded. Read-only, like everything here. */
export interface Payment {
  id: string;
  installmentId: string;
  customerId: string;
  amountUsd: number;
  /** ISO date. */
  receivedDate: string;
  receiptRef: string | null;
}

/**
 * A model in the sales catalogue, from the communication layer's point of
 * view: what can be SENT about it. Pricing, stock and specification stay in
 * the source system — this is "do we have material to send".
 */
export interface SalesItem {
  id: string;
  name: string;
  /** Spelling variants the auto-responder should recognise. */
  aliases: string[];
  oneLiner: string;
  videoCount: number;
  hasBrochure: boolean;
  /** Whether staff have switched this model on for automatic replies. */
  autoReplyEnabled: boolean;
}
