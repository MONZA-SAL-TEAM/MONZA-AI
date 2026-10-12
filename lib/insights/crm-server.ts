/**
 * The CRM's cars for Insights — SERVER ONLY, read AS THE STAFF MEMBER looking (makeUserClient, their own
 * token: the CRM's row-level security decides). Nothing read here is stored, and no price is read.
 * The shaping is pure in lib/insights/crm.ts.
 *
 * Every read answers ok / not_connected / unavailable: a CRM that refused is never shown as "no car".
 */

import { crmEnv, makeUserClient, rel } from "@/lib/connectors/crm";
import type { StaffIdentity } from "@/lib/connectors/types";
import { isAutoLinkable, normalizeLebanesePhone } from "@/lib/leads/phone";
import { crmModelCode, STOCK_INBOUND, STOCK_NOW, type CrmPurchase, type CrmResult, type StockRow } from "@/lib/insights/crm";

const connected = (identity: StaffIdentity) => crmEnv() !== null && identity.crmAccessToken !== "demo";
const why = (e: unknown) => (e instanceof Error ? e.message : JSON.stringify(e));

/** The cars the CRM sold or reserved to whoever owns these MOBILE numbers. Never a name, never a landline. */
export async function readCrmPurchases(identity: StaffIdentity, phones: readonly string[]): Promise<CrmResult<CrmPurchase[]>> {
  if (!connected(identity)) return { state: "not_connected" };
  const mobiles = [...new Set(phones.filter((p) => isAutoLinkable(p)).map((p) => normalizeLebanesePhone(p)!))];
  if (mobiles.length === 0) return { state: "ok", data: [] };
  try {
    const db = makeUserClient({ user: identity, conversationId: null, turnId: "insights-profile" });
    // A narrow first read by the last digits (they survive any spacing), then an exact comparison here.
    const filters = mobiles.flatMap((m) => [`phone_primary.ilike.%${m.slice(-3)}`, `phone_secondary.ilike.%${m.slice(-3)}`]).join(",");
    const { data: found, error } = await db.from("customers").select("id, first_name, last_name, phone_primary, phone_secondary").is("deleted_at", null).or(filters).limit(500);
    if (error) throw error;
    const customers = ((found ?? []) as Record<string, unknown>[]).filter((c) =>
      [c.phone_primary, c.phone_secondary].some((p) => typeof p === "string" && isAutoLinkable(p) && mobiles.includes(normalizeLebanesePhone(p)!))
    );
    if (customers.length === 0) return { state: "ok", data: [] };
    const nameOf = new Map(customers.map((c) => [String(c.id), [c.first_name, c.last_name].filter((x) => typeof x === "string" && x.trim()).join(" ").trim()]));
    // sales_orders points at cars twice (car_id and vin): the join must be named (PGRST201).
    const { data: orders, error: e2 } = await db
      .from("sales_orders")
      .select("customer_id, status, sale_date, created_at, delivered_at, cars!sales_orders_car_id_fkey ( brand, model, model_year, exterior_color, interior_color, status )")
      .in("customer_id", [...nameOf.keys()])
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50);
    if (e2) throw e2;
    const data: CrmPurchase[] = ((orders ?? []) as Record<string, unknown>[]).map((o) => {
      const car = rel<Record<string, unknown>>(o.cars);
      const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
      return {
        customerName: nameOf.get(String(o.customer_id)) ?? "",
        model: crmModelCode(str(car?.model)),
        carLabel: [str(car?.brand), str(car?.model), car?.model_year ? String(car.model_year) : null].filter(Boolean).join(" "),
        exterior: str(car?.exterior_color),
        interior: str(car?.interior_color),
        orderStatus: str(o.status),
        carStatus: str(car?.status),
        at: str(o.sale_date) ?? str(o.created_at),
        deliveredAt: str(o.delivered_at),
      };
    });
    return { state: "ok", data };
  } catch (e) {
    console.error("[insights] the CRM read of a client's cars failed:", why(e));
    return { state: "unavailable" };
  }
}

/** The CRM's cars that can be sold now or are on their way: model, colours, status. No price, no VIN. */
export async function readCrmStock(identity: StaffIdentity): Promise<CrmResult<StockRow[]>> {
  if (!connected(identity)) return { state: "not_connected" };
  try {
    const db = makeUserClient({ user: identity, conversationId: null, turnId: "insights-stock" });
    const out: StockRow[] = [];
    for (let from = 0; from < 20_000; from += 1000) {
      const { data, error } = await db
        .from("cars")
        .select("model, exterior_color, interior_color, status")
        .is("deleted_at", null)
        .in("status", [...STOCK_NOW, ...STOCK_INBOUND])
        .range(from, from + 999);
      if (error) throw error;
      const rows = (data ?? []) as StockRow[];
      out.push(...rows);
      if (rows.length < 1000) break;
    }
    return { state: "ok", data: out };
  } catch (e) {
    console.error("[insights] the CRM stock read failed:", why(e));
    return { state: "unavailable" };
  }
}
