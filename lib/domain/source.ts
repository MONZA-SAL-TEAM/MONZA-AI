/**
 * THE SOURCE-SYSTEM ADAPTER — the only way MONZA AI reads business data.
 *
 * Today there is exactly one implementation, the demo one. Tomorrow there will
 * be a Supabase one. Nothing above this interface changes when that happens,
 * because nothing above this interface knows a table name.
 *
 * THREE RULES, enforced by this file's shape rather than by discipline:
 *
 *  1. READ ONLY. There is no method here that changes anything. Payments are
 *     recorded in the source system, vehicles are moved by the garage system,
 *     customers are created wherever they are created. MONZA AI reads, decides
 *     what to SAY, and sends messages — which it does own.
 *
 *  2. NO CACHING, NO REPLICATION. Every call asks the source. There is no
 *     shadow copy of a customer or a balance in the AI's database, so the two
 *     can never disagree. If a cache is ever needed it will be a deliberate,
 *     documented decision — not something that accumulated by accident.
 *
 *  3. THE ANSWER MAY BE "I DON'T KNOW". Every getter can return null and every
 *     list can be empty. A source system that is unreachable must produce a
 *     screen that says so, never an invented figure.
 *
 * Identity: reads happen on behalf of a staff member, so `identity` carries
 * their own source-system token. The Supabase implementation will pass it
 * through exactly as lib/connectors does today, so the source system's own
 * row-level security decides what comes back. The demo implementation ignores
 * it — it has nothing real to protect.
 */

import type {
  Customer,
  Installment,
  InstallmentStatus,
  Payment,
  SalesItem,
  Vehicle,
  VehicleStatus,
} from "@/lib/domain/types";
import type { StaffIdentity } from "@/lib/connectors/types";
import { numberContains, searchIntent, textContains } from "@/lib/search";

/** Who the read runs as. The demo source ignores it; a live one must not. */
export interface ReadContext {
  identity: StaffIdentity;
}

export interface InstallmentQuery {
  customerId?: string;
  planId?: string;
  status?: InstallmentStatus | InstallmentStatus[];
  /** ISO date, inclusive. */
  dueOnOrBefore?: string;
  /** ISO date, inclusive. */
  dueOnOrAfter?: string;
}

export interface VehicleQuery {
  customerId?: string;
  status?: VehicleStatus | VehicleStatus[];
}

/**
 * What a source system must be able to answer. Small on purpose: every method
 * here exists because a communication decision needs it, and adding one should
 * require naming the message it makes possible.
 */
export interface SourceSystem {
  /** "demo" until a real system is wired. Screens use it to label themselves. */
  readonly kind: "demo" | "supabase";
  /** Staff-facing name of where the answers come from. */
  readonly label: string;

  getCustomer(id: string, ctx: ReadContext): Promise<Customer | null>;
  listCustomers(ctx: ReadContext, search?: string): Promise<Customer[]>;

  getVehicle(id: string, ctx: ReadContext): Promise<Vehicle | null>;
  listVehicles(ctx: ReadContext, query?: VehicleQuery): Promise<Vehicle[]>;
  getVehicleStatus(id: string, ctx: ReadContext): Promise<VehicleStatus | null>;

  getInstallment(id: string, ctx: ReadContext): Promise<Installment | null>;
  listInstallments(
    ctx: ReadContext,
    query?: InstallmentQuery
  ): Promise<Installment[]>;

  listPayments(ctx: ReadContext, customerId?: string): Promise<Payment[]>;

  getSalesCatalog(ctx: ReadContext): Promise<SalesItem[]>;
}

/* ── Shared query helpers ────────────────────────────────────────────────────
 * Pure predicates, so every implementation filters identically and the demo
 * source cannot quietly behave differently from a live one. */

function statusMatches<T extends string>(
  value: T,
  wanted: T | T[] | undefined
): boolean {
  if (wanted === undefined) return true;
  return Array.isArray(wanted) ? wanted.includes(value) : wanted === value;
}

export function installmentMatches(
  i: Installment,
  q: InstallmentQuery | undefined
): boolean {
  if (!q) return true;
  if (q.customerId !== undefined && i.customerId !== q.customerId) return false;
  if (q.planId !== undefined && i.planId !== q.planId) return false;
  if (!statusMatches(i.status, q.status)) return false;
  // ISO dates compare correctly as strings — no parsing, no time zone.
  if (q.dueOnOrBefore !== undefined && i.dueDate > q.dueOnOrBefore) return false;
  if (q.dueOnOrAfter !== undefined && i.dueDate < q.dueOnOrAfter) return false;
  return true;
}

export function vehicleMatches(
  v: Vehicle,
  q: VehicleQuery | undefined
): boolean {
  if (!q) return true;
  if (q.customerId !== undefined && v.customerId !== q.customerId) return false;
  if (!statusMatches(v.status, q.status)) return false;
  return true;
}

/**
 * Does this customer match a free-text search? Name, phone and channel
 * addresses — the three things a person actually types when looking someone
 * up. Digits are compared with separators stripped so "+961 3 100 001" finds
 * "9613100001".
 */
export function customerMatches(c: Customer, search?: string): boolean {
  const intent = searchIntent(search);
  switch (intent.kind) {
    case "empty":
      return true;
    case "number_too_short":
      return false;
    case "number":
      return (
        numberContains(c.phone, intent.digits) ||
        c.handles.some((h) => numberContains(h.address, intent.digits))
      );
    case "text":
      return (
        textContains(c.name, intent.text) ||
        c.handles.some((h) => textContains(h.address, intent.text))
      );
  }
}
