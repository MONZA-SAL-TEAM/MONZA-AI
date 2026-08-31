/**
 * Installments connector — payment plans and installment collections, queried
 * from the Monza CRM under the signed-in user's own token (RLS applies).
 * Read-only; a cashier's question like "who is overdue over $2,000?" is
 * answered by overdue_installments.
 */

import type { Connector, ExecutionContext, ToolResult } from "@/lib/connectors/types";
import {
  anonStatusCheck,
  caught,
  fromDbError,
  isDemo,
  makeUserClient,
  monthStartIso,
  rel,
} from "@/lib/connectors/crm";
import {
  demoCollectionsThisMonth,
  demoOverdueInstallments,
  demoPlanStatusSummary,
} from "@/lib/connectors/demo-data";

const UNPAID_STATUSES = ["upcoming", "due", "overdue", "partial"];

const overdueInstallments = {
  name: "overdue_installments",
  description:
    "List customers with overdue (or partially paid past-due) installments, grouped per customer with the total amount still owed, sorted largest first. Pass min_amount_usd to keep only customers owing at least that much — this directly answers questions like 'customers with overdue installments over $2,000'. Each customer entry includes name, phone, the individual overdue installments and the remaining amount on each.",
  inputSchema: {
    type: "object",
    properties: {
      min_amount_usd: {
        type: "number",
        description:
          "Only include customers whose total overdue remainder is at least this amount. Default 0 (everyone overdue).",
      },
    },
  },
  async execute(input: Record<string, unknown>, ctx: ExecutionContext): Promise<ToolResult> {
    const minAmount = Math.max(0, Number(input.min_amount_usd) || 0);
    if (isDemo(ctx)) return demoOverdueInstallments(minAmount);
    try {
      const db = makeUserClient(ctx);
      const { data, error } = await db
        .from("installment_payments")
        .select(
          "id, installment_no, due_date, amount_due, paid_amount, status, " +
            "payment_plans!inner ( id, customer_id, status, " +
            "customers!inner ( id, first_name, last_name, phone_primary ) )"
        )
        .in("status", ["overdue", "partial"])
        .is("deleted_at", null)
        .order("due_date", { ascending: true })
        .limit(1000);
      if (error) return fromDbError(error);

      type Group = {
        customer_id: string;
        customer: string;
        phone: string | null;
        overdue_installments: number;
        total_overdue_usd: number;
        oldest_due_date: string | null;
        details: Array<{
          installment_no: unknown;
          due_date: unknown;
          amount_due: number;
          paid: number;
          remaining: number;
          status: unknown;
        }>;
      };
      const groups = new Map<string, Group>();

      const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
      for (const row of rows) {
        const plan = rel<Record<string, unknown>>(row.payment_plans);
        const cust = rel<Record<string, unknown>>(plan?.customers);
        const custId = String(cust?.id ?? plan?.customer_id ?? "unknown");
        const amountDue = Number(row.amount_due) || 0;
        const paid = Number(row.paid_amount) || 0;
        const remaining = Math.max(0, amountDue - paid);
        if (remaining <= 0) continue;

        let g = groups.get(custId);
        if (!g) {
          g = {
            customer_id: custId,
            customer: `${cust?.first_name ?? ""} ${cust?.last_name ?? ""}`.trim() || "Unknown",
            phone: (cust?.phone_primary as string | null) ?? null,
            overdue_installments: 0,
            total_overdue_usd: 0,
            oldest_due_date: null,
            details: [],
          };
          groups.set(custId, g);
        }
        g.overdue_installments += 1;
        g.total_overdue_usd += remaining;
        const due = row.due_date as string | null;
        if (due && (!g.oldest_due_date || due < g.oldest_due_date)) g.oldest_due_date = due;
        if (g.details.length < 12) {
          g.details.push({
            installment_no: row.installment_no,
            due_date: row.due_date,
            amount_due: amountDue,
            paid,
            remaining,
            status: row.status,
          });
        }
      }

      const customers = [...groups.values()]
        .filter((g) => g.total_overdue_usd >= minAmount)
        .sort((a, b) => b.total_overdue_usd - a.total_overdue_usd)
        .slice(0, 50);

      return {
        ok: true,
        data: {
          min_amount_usd: minAmount,
          customers_with_overdue: customers,
          grand_total_overdue_usd: customers.reduce((s, g) => s + g.total_overdue_usd, 0),
        },
        rowCount: customers.length,
      };
    } catch (e) {
      return caught(e);
    }
  },
};

const collectionsThisMonth = {
  name: "collections_this_month",
  description:
    "Total installment money collected in the current calendar month: the sum of amounts actually paid on installments (paid_at falls in this month) plus the number of payments. Use for 'how much did we collect this month?'.",
  inputSchema: { type: "object", properties: {} },
  async execute(_input: Record<string, unknown>, ctx: ExecutionContext): Promise<ToolResult> {
    if (isDemo(ctx)) return demoCollectionsThisMonth();
    try {
      const start = monthStartIso();
      const db = makeUserClient(ctx);
      const { data, error } = await db
        .from("installment_payments")
        .select("paid_amount, paid_at")
        .is("deleted_at", null)
        .not("paid_at", "is", null)
        .gte("paid_at", start)
        .limit(2000);
      if (error) return fromDbError(error);

      const total = (data ?? []).reduce((s, r) => s + (Number(r.paid_amount) || 0), 0);
      return {
        ok: true,
        data: {
          month_starting: start.slice(0, 10),
          payments_received: data?.length ?? 0,
          total_collected_usd: Math.round(total * 100) / 100,
        },
        rowCount: data?.length ?? 0,
      };
    } catch (e) {
      return caught(e);
    }
  },
};

const planStatusSummary = {
  name: "plan_status_summary",
  description:
    "Overview of all payment plans: how many are active, completed, defaulted or cancelled, plus the total amount still outstanding across unpaid installments (upcoming, due, overdue and partial). Use for portfolio-level questions like 'how are our payment plans doing?' or 'how much is still owed to us?'.",
  inputSchema: { type: "object", properties: {} },
  async execute(_input: Record<string, unknown>, ctx: ExecutionContext): Promise<ToolResult> {
    if (isDemo(ctx)) return demoPlanStatusSummary();
    try {
      const db = makeUserClient(ctx);

      const { data: plans, error: pErr } = await db
        .from("payment_plans")
        .select("status")
        .limit(2000);
      if (pErr) return fromDbError(pErr);
      const byStatus: Record<string, number> = {};
      for (const p of plans ?? []) {
        const s = (p.status as string | null) ?? "unknown";
        byStatus[s] = (byStatus[s] ?? 0) + 1;
      }

      const { data: unpaid, error: uErr } = await db
        .from("installment_payments")
        .select("amount_due, paid_amount")
        .in("status", UNPAID_STATUSES)
        .is("deleted_at", null)
        .limit(5000);
      if (uErr) return fromDbError(uErr);
      const outstanding = (unpaid ?? []).reduce(
        (s, r) => s + Math.max(0, (Number(r.amount_due) || 0) - (Number(r.paid_amount) || 0)),
        0
      );

      return {
        ok: true,
        data: {
          plans_by_status: byStatus,
          total_plans: plans?.length ?? 0,
          total_outstanding_usd: Math.round(outstanding * 100) / 100,
        },
        rowCount: plans?.length ?? 0,
      };
    } catch (e) {
      return caught(e);
    }
  },
};

const installmentsConnector: Connector = {
  key: "installments",
  label: "Installments & Collections",
  description: "Track overdue installments, monthly collections, and payment-plan health.",
  status: () => anonStatusCheck("installment_payments"),
  tools: [overdueInstallments, collectionsThisMonth, planStatusSummary],
};

export default installmentsConnector;
