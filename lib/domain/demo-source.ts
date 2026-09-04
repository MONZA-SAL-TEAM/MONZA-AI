/**
 * The DEMO implementation of the source-system adapter.
 *
 * It invents nothing new. Every customer, vehicle, VIN, plate, plan and job
 * reference is DERIVED from lib/customers/directory-data.ts, which is already
 * the reconciled demo canon shared by the chat answers, the installment
 * tracker and the garage board. Deriving rather than re-typing is the point:
 * a fourth hand-written dataset would drift from the other three within a week.
 *
 * Everything is fixed and pure — no Date.now(), no randomness — so the server
 * and the browser can never disagree, and a test can assert exact values.
 * "Today" for the demo is DEMO_TODAY below, matching the demo canon's
 * "August 2026".
 *
 * When the real Supabase source lands it implements the same interface and
 * this file stays exactly where it is, serving the demo.
 */

import {
  DEMO_CUSTOMER_DIRECTORY,
  type DirectoryCustomer,
} from "@/lib/customers/directory-data";
import { WASALES_CATALOG } from "@/lib/wasales/catalog-data";
import type {
  ChannelHandle,
  ChannelKey,
  Customer,
  Installment,
  InstallmentStatus,
  Payment,
  SalesItem,
  Vehicle,
  VehicleStatus,
} from "@/lib/domain/types";
import {
  customerMatches,
  installmentMatches,
  vehicleMatches,
  type InstallmentQuery,
  type ReadContext,
  type SourceSystem,
  type VehicleQuery,
} from "@/lib/domain/source";

/** The demo's fixed "today". The canon's period is August 2026. */
export const DEMO_TODAY = "2026-08-20";

/* ── ids ─────────────────────────────────────────────────────────────────── */

/** "Rami Kanaan" -> "rami-kanaan". Stable, so ids survive a rebuild. */
export function customerIdFor(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** One vehicle per customer in the demo, keyed off the same slug. */
function vehicleIdFor(name: string): string {
  return `veh-${customerIdFor(name)}`;
}

function planIdFor(name: string): string {
  return `plan-${customerIdFor(name)}`;
}

/* ── dates ───────────────────────────────────────────────────────────────── */

/** Add whole months to an ISO "YYYY-MM-DD", clamping the day to the month. */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map((n) => Number.parseInt(n, 10));
  const zeroBased = m - 1 + months;
  const year = y + Math.floor(zeroBased / 12);
  const month = ((zeroBased % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** A deterministic, plausible receipt number. Stable across rebuilds. */
function receiptSeq(customerId: string, installmentNumber: number): number {
  let sum = 0;
  for (const ch of customerId) sum = (sum * 31 + ch.charCodeAt(0)) % 9000;
  return 1000 + ((sum + installmentNumber * 7) % 8999);
}

/** A deterministic due day per customer — no clock, no randomness. */
function dueDayFor(name: string): number {
  const days = [5, 10, 12, 18, 25];
  let sum = 0;
  for (const ch of name) sum += ch.charCodeAt(0);
  return days[sum % days.length];
}

/* ── the demo's channel identities ───────────────────────────────────────── */

/**
 * Which channels each demo customer can be reached on. Everyone has WhatsApp
 * (the phone the source system already holds); the two who arrived through
 * Instagram also carry an Instagram handle, and one referral came through
 * Facebook — so the unified inbox has all three channels to show without
 * pretending Monza has more social presence than it does.
 */
function handlesFor(c: DirectoryCustomer): {
  handles: ChannelHandle[];
  preferred: ChannelKey;
} {
  const handles: ChannelHandle[] = [
    { channel: "whatsapp", address: c.phone, displayName: c.name },
  ];
  let preferred: ChannelKey = "whatsapp";

  if (c.source === "Instagram") {
    const at = `@${customerIdFor(c.name).replace(/-/g, "_")}`;
    handles.push({ channel: "instagram", address: at, displayName: c.name });
    preferred = "instagram";
  }
  if (c.source === "Referral") {
    handles.push({
      channel: "facebook",
      address: `fb.${customerIdFor(c.name)}`,
      displayName: c.name,
    });
  }
  return { handles, preferred };
}

/* ── mapping the canon onto the domain ───────────────────────────────────── */

/** The garage board's plain words -> the statuses communication cares about. */
function statusFromGarage(c: DirectoryCustomer): VehicleStatus {
  if (!c.garage) return "with_customer";
  switch (c.garage.status) {
    case "Waiting for parts":
      return "waiting_parts";
    case "Ready for pickup":
      return "ready_for_pickup";
    case "In progress":
    case "Waiting to start":
      return "in_service";
    default:
      return "in_service";
  }
}

function toCustomer(c: DirectoryCustomer): Customer {
  const { handles, preferred } = handlesFor(c);
  return {
    id: customerIdFor(c.name),
    name: c.name,
    phone: c.phone,
    handles,
    origin: c.source,
    firstContact: c.firstContact,
    preferredChannel: preferred,
  };
}

function toVehicle(c: DirectoryCustomer): Vehicle {
  return {
    id: vehicleIdFor(c.name),
    customerId: customerIdFor(c.name),
    label: c.carLabel,
    vin: c.vin,
    plate: c.plate,
    status: statusFromGarage(c),
    jobReference: c.garage?.jobNumber ?? null,
    awaitingPart: c.garage?.neededPart ?? null,
  };
}

/**
 * Expand a plan snapshot into its individual installments.
 *
 * The schedule is anchored so that the FIRST UNPAID installment falls in the
 * demo's current month — which is what makes the tracker, the chat answers and
 * the inbox all describe the same month. `behindCount` decides how many of the
 * unpaid ones read as overdue rather than merely due.
 */
function toInstallments(c: DirectoryCustomer): Installment[] {
  const plan = c.plan;
  if (!plan) return [];

  const customerId = customerIdFor(c.name);
  const planId = planIdFor(c.name);
  const day = dueDayFor(c.name);
  const anchor = `${DEMO_TODAY.slice(0, 7)}-${String(day).padStart(2, "0")}`;
  const behind = plan.behind ? Math.max(0, plan.behindCount ?? 1) : 0;

  // Anchor the schedule so that EXACTLY `behind` unpaid installments have a due
  // date in the past — which is what "3 installments behind" means to the
  // person reading it.
  //
  // The subtlety: whether this month's installment is already late depends on
  // whether its due day has passed. For a plan due on the 10th, "next not-yet-
  // due" is next month; for one due on the 25th it is still this month. Getting
  // this wrong made an on-time plan look overdue and a 3-behind plan look 4.
  const todayDay = Number.parseInt(DEMO_TODAY.slice(8, 10), 10);
  const nextNotYetDue = day <= todayDay ? addMonths(anchor, 1) : anchor;
  const firstUnpaidDate = addMonths(nextNotYetDue, -behind);

  const out: Installment[] = [];
  for (let n = 1; n <= plan.totalCount; n++) {
    const offsetFromFirstUnpaid = n - (plan.paidCount + 1);
    const dueDate = addMonths(firstUnpaidDate, offsetFromFirstUnpaid);

    let status: InstallmentStatus;
    if (n <= plan.paidCount) status = "paid";
    else if (dueDate < DEMO_TODAY) status = "overdue";
    else if (dueDate.slice(0, 7) === DEMO_TODAY.slice(0, 7)) status = "due";
    else status = "upcoming";

    out.push({
      id: `${planId}-${n}`,
      planId,
      customerId,
      vehicleId: vehicleIdFor(c.name),
      number: n,
      totalCount: plan.totalCount,
      amountUsd: plan.monthlyUsd,
      dueDate,
      status,
      paidDate: status === "paid" ? dueDate : null,
      // Shaped like a receipt a customer would recognise on a slip, because
      // this string is read out in a message to them — not an internal id.
      receiptRef:
        status === "paid"
          ? `RC-${dueDate.slice(0, 4)}-${String(receiptSeq(customerId, n)).padStart(4, "0")}`
          : null,
    });
  }
  return out;
}

function toPayments(c: DirectoryCustomer): Payment[] {
  return toInstallments(c)
    .filter((i) => i.status === "paid")
    .map((i) => ({
      id: `pay-${i.id}`,
      installmentId: i.id,
      customerId: i.customerId,
      amountUsd: i.amountUsd,
      receivedDate: i.paidDate as string,
      receiptRef: i.receiptRef,
    }));
}

/* ── the fixed dataset, built once ───────────────────────────────────────── */

const DIRECTORY = DEMO_CUSTOMER_DIRECTORY.customers;

const CUSTOMERS: Customer[] = DIRECTORY.map(toCustomer);
const VEHICLES: Vehicle[] = DIRECTORY.map(toVehicle);
const INSTALLMENTS: Installment[] = DIRECTORY.flatMap(toInstallments);
const PAYMENTS: Payment[] = DIRECTORY.flatMap(toPayments);

/** The sales catalogue, derived from the WhatsApp Sales catalog. */
const SALES: SalesItem[] = WASALES_CATALOG.map((car) => ({
  id: car.id,
  name: car.name,
  aliases: car.aliases,
  oneLiner: car.oneLiner,
  videoCount: car.videos.length,
  hasBrochure: car.brochure !== null,
  autoReplyEnabled: car.enabled,
}));

/* ── the adapter ─────────────────────────────────────────────────────────── */

/**
 * The demo source. Async like a real one so no caller can accidentally depend
 * on data arriving synchronously; `ctx` is accepted and ignored, because there
 * is nothing here worth protecting.
 */
export const demoSource: SourceSystem = {
  kind: "demo",
  label: "Example data (no system connected)",

  async getCustomer(id: string): Promise<Customer | null> {
    return CUSTOMERS.find((c) => c.id === id) ?? null;
  },

  async listCustomers(_ctx: ReadContext, search?: string): Promise<Customer[]> {
    return CUSTOMERS.filter((c) => customerMatches(c, search));
  },

  async getVehicle(id: string): Promise<Vehicle | null> {
    return VEHICLES.find((v) => v.id === id) ?? null;
  },

  async listVehicles(_ctx: ReadContext, query?: VehicleQuery): Promise<Vehicle[]> {
    return VEHICLES.filter((v) => vehicleMatches(v, query));
  },

  async getVehicleStatus(id: string): Promise<VehicleStatus | null> {
    return VEHICLES.find((v) => v.id === id)?.status ?? null;
  },

  async getInstallment(id: string): Promise<Installment | null> {
    return INSTALLMENTS.find((i) => i.id === id) ?? null;
  },

  async listInstallments(
    _ctx: ReadContext,
    query?: InstallmentQuery
  ): Promise<Installment[]> {
    return INSTALLMENTS.filter((i) => installmentMatches(i, query));
  },

  async listPayments(_ctx: ReadContext, customerId?: string): Promise<Payment[]> {
    return customerId === undefined
      ? PAYMENTS
      : PAYMENTS.filter((p) => p.customerId === customerId);
  },

  async getSalesCatalog(): Promise<SalesItem[]> {
    return SALES;
  },
};

/** Exported for tests and for screens that want the whole fixed set. */
export const DEMO_DATASET = {
  today: DEMO_TODAY,
  customers: CUSTOMERS,
  vehicles: VEHICLES,
  installments: INSTALLMENTS,
  payments: PAYMENTS,
  sales: SALES,
};
