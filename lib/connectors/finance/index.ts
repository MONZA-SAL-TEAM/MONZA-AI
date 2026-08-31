/**
 * Finance connector — sales totals and company costs from the Monza CRM,
 * queried under the signed-in user's own token (RLS applies). Read-only.
 *
 * company_costs is queried defensively: its columns are not guaranteed, and
 * if the table is not readable the tool returns an honest failure rather
 * than a guess.
 */

import type { Connector, ExecutionContext, ToolResult } from "@/lib/connectors/types";
import {
  anonStatusCheck,
  caught,
  fromDbError,
  isDemo,
  makeUserClient,
  monthStartIso,
} from "@/lib/connectors/crm";
import { demoMonthlyCostsSummary, demoSalesThisMonth } from "@/lib/connectors/demo-data";

const salesThisMonth = {
  name: "sales_this_month",
  description:
    "Count and total the car sales of the current calendar month: sales orders created this month with status confirmed, paid, or delivered (voided and cancelled orders excluded), totalled per currency and broken down by status. Use for 'how are sales this month?' or 'how much revenue did we book?'.",
  inputSchema: { type: "object", properties: {} },
  async execute(_input: Record<string, unknown>, ctx: ExecutionContext): Promise<ToolResult> {
    if (isDemo(ctx)) return demoSalesThisMonth();
    try {
      const start = monthStartIso();
      const db = makeUserClient(ctx);
      const { data, error } = await db
        .from("sales_orders")
        .select("status, selling_price, currency, created_at")
        .in("status", ["confirmed", "paid", "delivered"])
        .gte("created_at", start)
        .is("deleted_at", null)
        .is("void_at", null)
        .limit(2000);
      if (error) return fromDbError(error);

      const byStatus: Record<string, number> = {};
      const totalByCurrency: Record<string, number> = {};
      for (const r of data ?? []) {
        const s = (r.status as string | null) ?? "unknown";
        const cur = (r.currency as string | null) ?? "USD";
        byStatus[s] = (byStatus[s] ?? 0) + 1;
        totalByCurrency[cur] =
          (totalByCurrency[cur] ?? 0) + (Number(r.selling_price) || 0);
      }
      for (const k of Object.keys(totalByCurrency)) {
        totalByCurrency[k] = Math.round(totalByCurrency[k] * 100) / 100;
      }

      return {
        ok: true,
        data: {
          month_starting: start.slice(0, 10),
          orders: data?.length ?? 0,
          by_status: byStatus,
          total_by_currency: totalByCurrency,
        },
        rowCount: data?.length ?? 0,
      };
    } catch (e) {
      return caught(e);
    }
  },
};

/** Pick the first present field from a loosely-known row. */
function pick(row: Record<string, unknown>, names: string[]): unknown {
  for (const n of names) {
    if (row[n] != null) return row[n];
  }
  return null;
}

const monthlyCostsSummary = {
  name: "monthly_costs_summary",
  description:
    "Summarise company costs recorded in the current calendar month: number of entries, totals per currency, and the largest categories where recorded. Use for 'what did we spend this month?'. If cost records are not readable with the staff member's access, this says so honestly.",
  inputSchema: { type: "object", properties: {} },
  async execute(_input: Record<string, unknown>, ctx: ExecutionContext): Promise<ToolResult> {
    if (isDemo(ctx)) return demoMonthlyCostsSummary();
    try {
      const start = monthStartIso();
      const db = makeUserClient(ctx);

      // Defensive: columns are not guaranteed. Try a created_at month filter
      // first; if that column does not exist, fall back to recent rows and
      // filter on whichever date field is present.
      let rows: Array<Record<string, unknown>> | null = null;
      const first = await db
        .from("company_costs")
        .select("*")
        .gte("created_at", start)
        .limit(1000);
      if (!first.error) {
        rows = (first.data ?? []) as Array<Record<string, unknown>>;
      } else {
        const fallback = await db.from("company_costs").select("*").limit(1000);
        if (fallback.error) return fromDbError(fallback.error);
        rows = ((fallback.data ?? []) as Array<Record<string, unknown>>).filter((r) => {
          const d = pick(r, ["created_at", "date", "cost_date", "paid_at"]);
          return typeof d === "string" && d >= start.slice(0, 10);
        });
      }

      const totalByCurrency: Record<string, number> = {};
      const byCategory: Record<string, number> = {};
      for (const r of rows) {
        const amount = Number(pick(r, ["amount", "amount_usd", "total", "cost", "value"])) || 0;
        const cur = String(pick(r, ["currency"]) ?? "USD");
        const cat = String(pick(r, ["category", "type", "description", "name"]) ?? "uncategorised");
        totalByCurrency[cur] = (totalByCurrency[cur] ?? 0) + amount;
        byCategory[cat] = (byCategory[cat] ?? 0) + amount;
      }
      for (const k of Object.keys(totalByCurrency)) {
        totalByCurrency[k] = Math.round(totalByCurrency[k] * 100) / 100;
      }
      const largest = Object.entries(byCategory)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([category, total]) => ({ category, total: Math.round(total * 100) / 100 }));

      return {
        ok: true,
        data: {
          month_starting: start.slice(0, 10),
          cost_entries: rows.length,
          total_by_currency: totalByCurrency,
          largest_categories: largest,
        },
        rowCount: rows.length,
      };
    } catch (e) {
      return caught(e);
    }
  },
};

const financeConnector: Connector = {
  key: "finance",
  label: "Sales & Costs",
  description: "Monthly sales totals and a summary of recorded company costs.",
  status: () => anonStatusCheck("sales_orders"),
  tools: [salesThisMonth, monthlyCostsSummary],
};

export default financeConnector;
