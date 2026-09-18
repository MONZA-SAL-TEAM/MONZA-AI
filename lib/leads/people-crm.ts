/**
 * The CRM's customers for /customers — SERVER ONLY, read AS THE STAFF MEMBER.
 *
 * MONZA AI holds no master key to the CRM. The read runs with the signed-in
 * person's own CRM token (lib/connectors/crm `makeUserClient`), so the CRM's
 * row-level security decides what comes back: somebody who may not see
 * customers gets none, and the screen says the CRM gave nothing — it never
 * borrows somebody else's access. Nothing read here is stored.
 *
 * Three reads: customers, their sales orders with the car, and active payment
 * plans — the same tables and columns the staff assistant's connectors use.
 */

import { crmEnv, makeUserClient, rel } from "@/lib/connectors/crm";
import type { StaffIdentity } from "@/lib/connectors/types";
import type { CrmRecord } from "@/lib/leads/people";

export type CrmRead =
  | { state: "ok"; customers: CrmRecord[] }
  /** No CRM configured here, or the credential-free demo sign-in. */
  | { state: "not_connected" }
  /** The CRM refused or failed: shown as "could not be read", never as "no customers". */
  | { state: "unavailable" };

const PAGE = 1000;
const MAX = 20_000;

export async function listCrmCustomers(identity: StaffIdentity): Promise<CrmRead> {
  if (crmEnv() === null || identity.crmAccessToken === "demo") return { state: "not_connected" };
  try {
    const db = makeUserClient({ user: identity, conversationId: null, turnId: "customers-page" });
    const pages = async (table: string, select: string, filter: (q: any) => any): Promise<Record<string, unknown>[]> => {
      const out: Record<string, unknown>[] = [];
      for (let from = 0; from < MAX; from += PAGE) {
        const { data, error } = await filter(db.from(table).select(select)).range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = (data ?? []) as Record<string, unknown>[];
        out.push(...rows);
        if (rows.length < PAGE) break;
      }
      return out;
    };

    const [customers, orders, plans] = await Promise.all([
      pages("customers", "id, first_name, last_name, phone_primary, email, lead_source, created_at", (q) => q.is("deleted_at", null).order("created_at", { ascending: false })),
      pages("sales_orders", "customer_id, status, cars ( brand, model, model_year, plate_number, status )", (q) => q.is("deleted_at", null)),
      pages("payment_plans", "customer_id, status", (q) => q.eq("status", "active")),
    ]);

    const carsByCustomer = new Map<string, string[]>();
    for (const o of orders) {
      const car = rel<Record<string, unknown>>(o.cars);
      if (!car || !o.customer_id) continue;
      const label = [[car.brand, car.model, car.model_year].filter(Boolean).join(" "), car.plate_number ? `plate ${String(car.plate_number)}` : null, o.status ? String(o.status).replace(/_/g, " ") : null]
        .filter(Boolean)
        .join(" · ");
      const list = carsByCustomer.get(String(o.customer_id)) ?? [];
      if (label && !list.includes(label)) list.push(label);
      carsByCustomer.set(String(o.customer_id), list);
    }
    const plansByCustomer = new Map<string, number>();
    for (const p of plans) if (p.customer_id) plansByCustomer.set(String(p.customer_id), (plansByCustomer.get(String(p.customer_id)) ?? 0) + 1);

    return {
      state: "ok",
      customers: customers.map((c) => ({
        customerId: String(c.id),
        name: [c.first_name, c.last_name].filter((x) => typeof x === "string" && x.trim() !== "").join(" ").trim(),
        phone: typeof c.phone_primary === "string" && c.phone_primary.trim() !== "" ? c.phone_primary : null,
        email: typeof c.email === "string" && c.email.trim() !== "" ? c.email : null,
        leadSource: typeof c.lead_source === "string" && c.lead_source.trim() !== "" ? c.lead_source : null,
        since: typeof c.created_at === "string" ? c.created_at : null,
        cars: carsByCustomer.get(String(c.id)) ?? [],
        activePlans: plansByCustomer.get(String(c.id)) ?? 0,
      })),
    };
  } catch (e) {
    console.error("[people] the CRM read failed:", e instanceof Error ? e.message : "unknown error");
    return { state: "unavailable" };
  }
}
