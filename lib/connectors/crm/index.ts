/**
 * CRM connector — customers, leads and their car ownership, straight from the
 * Monza CRM under the SIGNED-IN USER'S OWN token (rule 1: identity
 * pass-through, never a service key). Row-level security in the CRM decides
 * what each staff member actually sees.
 *
 * Also home of the shared helpers the other connectors import:
 *   makeUserClient(ctx)  — per-call Supabase client with the user's token
 *   isDemo(ctx)          — env missing or the demo identity
 *   fromDbError / caught — uniform failed ToolResults (RLS reads as "access")
 *   anonStatusCheck      — status() probe with the ANON key only
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Connector, ExecutionContext, ToolResult } from "@/lib/connectors/types";
import { crmAnonKey, crmUrl } from "@/lib/env";
import {
  demoSearchCustomers,
  demoCustomerSummary,
  demoRecentLeads,
} from "@/lib/connectors/demo-data";

/* ── Shared helpers (imported by the other four connectors) ─────────────── */

export function crmEnv(): { url: string; anon: string } | null {
  const url = crmUrl();
  const anon = crmAnonKey();
  if (!url || !anon) return null;
  return { url, anon };
}

/** Demo mode: no CRM configured, or the reviewable no-credentials identity. */
export function isDemo(ctx: ExecutionContext): boolean {
  return crmEnv() === null || ctx.user.crmAccessToken === "demo";
}

/**
 * A fresh client per call, authenticated AS THE USER. The anon key is only
 * the project handshake; the Authorization header carries the user's own
 * access token, so CRM RLS applies to every row returned.
 */
export function makeUserClient(ctx: ExecutionContext): SupabaseClient {
  const env = crmEnv();
  if (!env) throw new Error("CRM connection is not configured.");
  return createClient(env.url, env.anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${ctx.user.crmAccessToken}` } },
  });
}

/** Map a PostgREST error to a normal failed result. RLS denial is not a crash. */
export function fromDbError(error: { message: string; code?: string }): ToolResult {
  const m = (error.message || "").toLowerCase();
  const permission =
    error.code === "42501" ||
    m.includes("permission") ||
    m.includes("row-level security") ||
    m.includes("policy") ||
    m.includes("jwt");
  if (permission) {
    return { ok: false, error: "Your account does not have access to this information." };
  }
  return { ok: false, error: `The query could not be completed: ${error.message}` };
}

/** Wrap a thrown exception (network, bad token) as a failed result. */
export function caught(e: unknown): ToolResult {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.toLowerCase().includes("access")) {
    return { ok: false, error: "Your account does not have access to this information." };
  }
  return { ok: false, error: `Could not reach the system: ${msg}` };
}

/**
 * status() probe shared by all five connectors: a cheap head count on the
 * connector's main table using ONLY the anon key (never a service key, and no
 * user token here — this answers "is the system configured and reachable?",
 * not "what can you see?"). An RLS refusal still proves reachability.
 */
export async function anonStatusCheck(
  table: string
): Promise<{ connected: boolean; detail: string }> {
  const env = crmEnv();
  if (!env) {
    return { connected: false, detail: "Not connected — answers use sample data." };
  }
  try {
    const anon = createClient(env.url, env.anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await anon.from(table).select("id", { count: "exact", head: true });
    if (error) {
      const m = (error.message || "").toLowerCase();
      if (m.includes("does not exist") || m.includes("not found") || m.includes("schema")) {
        return { connected: false, detail: "Connected, but the expected data was not found." };
      }
      // Permission/RLS errors mean the system answered — it is reachable.
      return { connected: true, detail: "Connected." };
    }
    return { connected: true, detail: "Connected." };
  } catch {
    return { connected: false, detail: "The system could not be reached." };
  }
}

/** ilike patterns go inside .or() strings — strip PostgREST syntax characters. */
export function sanitizeIlike(q: string): string {
  return q.replace(/[,()%]/g, " ").trim();
}

export function monthStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Nested PostgREST relations arrive as object OR single-element array. */
export function rel<T = Record<string, unknown>>(v: unknown): T | null {
  if (v == null) return null;
  if (Array.isArray(v)) return (v[0] as T) ?? null;
  return v as T;
}

/* ── Tools ──────────────────────────────────────────────────────────────── */

const searchCustomers = {
  name: "search_customers",
  description:
    "Find customers in the Monza CRM by name or phone number. Use this when the staff member mentions a customer by name or phone and you need their record or their id for a follow-up question. Matches partial names and phone digits, returns up to 20 non-deleted customers with name, phone, email, lead source and creation date.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Part of a first name, last name, or phone number.",
      },
    },
    required: ["query"],
  },
  async execute(input: Record<string, unknown>, ctx: ExecutionContext): Promise<ToolResult> {
    const raw = String(input.query ?? "").trim();
    if (isDemo(ctx)) return demoSearchCustomers(raw);
    if (!raw) return { ok: false, error: "A name or phone number to search for is required." };
    try {
      const q = sanitizeIlike(raw);
      const db = makeUserClient(ctx);
      const { data, error } = await db
        .from("customers")
        .select("id, first_name, last_name, phone_primary, email, lead_source, created_at")
        .is("deleted_at", null)
        .or(
          `first_name.ilike.%${q}%,last_name.ilike.%${q}%,phone_primary.ilike.%${q}%`
        )
        .limit(20);
      if (error) return fromDbError(error);
      return { ok: true, data: { customers: data }, rowCount: data?.length ?? 0 };
    } catch (e) {
      return caught(e);
    }
  },
};

const customerSummary = {
  name: "customer_summary",
  description:
    "Get one customer's full picture: their contact record, the cars linked to them through sales orders (brand, model, VIN, plate, order status and price), and how many active payment plans they have. Use this after search_customers gives you a customer_id, or whenever the staff member asks 'tell me about <customer>'.",
  inputSchema: {
    type: "object",
    properties: {
      customer_id: {
        type: "string",
        description: "The customer's id, usually from search_customers.",
      },
    },
    required: ["customer_id"],
  },
  async execute(input: Record<string, unknown>, ctx: ExecutionContext): Promise<ToolResult> {
    const customerId = String(input.customer_id ?? "").trim();
    if (isDemo(ctx)) return demoCustomerSummary(customerId);
    if (!customerId) return { ok: false, error: "A customer_id is required." };
    try {
      const db = makeUserClient(ctx);

      const { data: customer, error: cErr } = await db
        .from("customers")
        .select("id, first_name, last_name, phone_primary, email, lead_source, created_at")
        .eq("id", customerId)
        .is("deleted_at", null)
        .maybeSingle();
      if (cErr) return fromDbError(cErr);
      if (!customer) {
        return { ok: true, data: { found: false, message: "No customer with that id is visible to you." }, rowCount: 0 };
      }

      const { data: orders, error: oErr } = await db
        .from("sales_orders")
        .select(
          "id, status, selling_price, currency, created_at, cars ( brand, model, model_year, vin, plate_number, status )"
        )
        .eq("customer_id", customerId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(20);
      if (oErr) return fromDbError(oErr);

      const { count: activePlans, error: pErr } = await db
        .from("payment_plans")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", customerId)
        .eq("status", "active");
      if (pErr) return fromDbError(pErr);

      const cars = (orders ?? []).map((o: Record<string, unknown>) => {
        const car = rel<Record<string, unknown>>(o.cars);
        return {
          order_status: o.status,
          selling_price: o.selling_price,
          currency: o.currency,
          order_date: o.created_at,
          brand: car?.brand ?? null,
          model: car?.model ?? null,
          model_year: car?.model_year ?? null,
          vin: car?.vin ?? null,
          plate_number: car?.plate_number ?? null,
          car_status: car?.status ?? null,
        };
      });

      return {
        ok: true,
        data: { found: true, customer, cars, active_payment_plans: activePlans ?? 0 },
        rowCount: cars.length,
      };
    } catch (e) {
      return caught(e);
    }
  },
};

const recentLeads = {
  name: "recent_leads",
  description:
    "Count and list new customers added in the last N days (default 30), broken down by lead source (Instagram, showroom walk-in, referral, website, ...). Use this for questions like 'how many new leads this month?' or 'where are our leads coming from?'.",
  inputSchema: {
    type: "object",
    properties: {
      days: {
        type: "number",
        description: "How many days back to look. Default 30.",
      },
    },
  },
  async execute(input: Record<string, unknown>, ctx: ExecutionContext): Promise<ToolResult> {
    const days = Math.max(1, Math.min(365, Number(input.days) || 30));
    if (isDemo(ctx)) return demoRecentLeads(days);
    try {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const db = makeUserClient(ctx);
      const { data, error, count } = await db
        .from("customers")
        .select("first_name, last_name, lead_source, created_at", { count: "exact" })
        .is("deleted_at", null)
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) return fromDbError(error);

      const bySource: Record<string, number> = {};
      for (const row of data ?? []) {
        const src = (row.lead_source as string | null) ?? "unspecified";
        bySource[src] = (bySource[src] ?? 0) + 1;
      }
      const recent = (data ?? []).slice(0, 25).map((r) => ({
        name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
        lead_source: r.lead_source ?? "unspecified",
        created_at: r.created_at,
      }));

      return {
        ok: true,
        data: {
          period_days: days,
          total_new_customers: count ?? data?.length ?? 0,
          by_lead_source: bySource,
          breakdown_based_on_most_recent: data?.length ?? 0,
          recent,
        },
        rowCount: count ?? data?.length ?? 0,
      };
    } catch (e) {
      return caught(e);
    }
  },
};

/* ── Connector ──────────────────────────────────────────────────────────── */

const crmConnector: Connector = {
  key: "crm",
  label: "Customers & Leads",
  description: "Look up customers, their cars, and where new leads are coming from.",
  status: () => anonStatusCheck("customers"),
  tools: [searchCustomers, customerSummary, recentLeads],
};

export default crmConnector;
