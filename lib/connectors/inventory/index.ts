/**
 * Inventory connector — cars and parts stock from the Monza CRM, queried
 * under the signed-in user's own token (RLS applies). Read-only.
 *
 * The parts table's exact columns are not guaranteed, so low_stock_parts
 * reads defensively: select('*') and pick whichever expected fields exist.
 */

import type { Connector, ExecutionContext, ToolResult } from "@/lib/connectors/types";
import {
  anonStatusCheck,
  caught,
  fromDbError,
  isDemo,
  makeUserClient,
  sanitizeIlike,
} from "@/lib/connectors/crm";
import {
  demoCarLookup,
  demoCarsInStockSummary,
  demoLowStockParts,
} from "@/lib/connectors/demo-data";

const carsInStockSummary = {
  name: "cars_in_stock_summary",
  description:
    "Count all cars in the system broken down by status (in stock, showroom, reserved, inbound, sold, delivered, in service, ...) and by brand (Voyah, MHero). Use for 'how many cars do we have?', 'what's in stock?', or 'how many Voyahs vs MHeros?'. For a specific car, use car_lookup instead.",
  inputSchema: { type: "object", properties: {} },
  async execute(_input: Record<string, unknown>, ctx: ExecutionContext): Promise<ToolResult> {
    if (isDemo(ctx)) return demoCarsInStockSummary();
    try {
      const db = makeUserClient(ctx);
      const { data, error } = await db.from("cars").select("brand, status").limit(5000);
      if (error) return fromDbError(error);

      const byStatus: Record<string, number> = {};
      const byBrand: Record<string, number> = {};
      for (const r of data ?? []) {
        const s = (r.status as string | null) ?? "unknown";
        const b = (r.brand as string | null) ?? "unknown";
        byStatus[s] = (byStatus[s] ?? 0) + 1;
        byBrand[b] = (byBrand[b] ?? 0) + 1;
      }
      return {
        ok: true,
        data: {
          cars_by_status: byStatus,
          cars_by_brand: byBrand,
          total_cars: data?.length ?? 0,
        },
        rowCount: data?.length ?? 0,
      };
    } catch (e) {
      return caught(e);
    }
  },
};

const lowStockParts = {
  name: "low_stock_parts",
  description:
    "List spare parts whose quantity on hand is at or below their minimum stock level — the parts that need reordering. Use for 'what parts are running low?' or 'what do we need to reorder?'.",
  inputSchema: { type: "object", properties: {} },
  async execute(_input: Record<string, unknown>, ctx: ExecutionContext): Promise<ToolResult> {
    if (isDemo(ctx)) return demoLowStockParts();
    try {
      const db = makeUserClient(ctx);
      // Defensive: the parts table's columns are not guaranteed, so take
      // whole rows and pick the fields that exist.
      const { data, error } = await db.from("parts").select("*").limit(1000);
      if (error) return fromDbError(error);

      const rows = (data ?? []) as Array<Record<string, unknown>>;
      const shaped = rows.map((r) => ({
        name: (r.name as string | null) ?? (r.part_name as string | null) ?? null,
        part_number: (r.part_number as string | null) ?? null,
        quantity: r.quantity != null ? Number(r.quantity) : null,
        min_quantity: r.min_quantity != null ? Number(r.min_quantity) : null,
      }));

      const hasMin = shaped.some((r) => r.min_quantity != null);
      const low = hasMin
        ? shaped.filter(
            (r) => r.quantity != null && r.min_quantity != null && r.quantity <= r.min_quantity
          )
        : shaped.filter((r) => r.quantity != null && r.quantity <= 0);

      return {
        ok: true,
        data: {
          low_stock_parts: low.slice(0, 100),
          note: hasMin
            ? undefined
            : "Minimum stock levels are not recorded, so this lists parts that are out of stock.",
        },
        rowCount: low.length,
      };
    } catch (e) {
      return caught(e);
    }
  },
};

const carLookup = {
  name: "car_lookup",
  description:
    "Find specific cars by VIN, plate number, or model name (partial matches allowed). Returns up to 10 cars with brand, model, year, VIN, plate and current status. Use when the staff member asks about a particular car ('where is plate B 123456?', 'do we have a Voyah Dream?').",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Part of a VIN, a plate number, or a model name.",
      },
    },
    required: ["query"],
  },
  async execute(input: Record<string, unknown>, ctx: ExecutionContext): Promise<ToolResult> {
    const raw = String(input.query ?? "").trim();
    if (isDemo(ctx)) return demoCarLookup(raw);
    if (!raw) return { ok: false, error: "A VIN, plate number, or model to search for is required." };
    try {
      const q = sanitizeIlike(raw);
      const db = makeUserClient(ctx);
      const { data, error } = await db
        .from("cars")
        .select("id, brand, model, model_year, vin, plate_number, status, date_arrived")
        .or(`vin.ilike.%${q}%,plate_number.ilike.%${q}%,model.ilike.%${q}%`)
        .limit(10);
      if (error) return fromDbError(error);
      return { ok: true, data: { cars: data }, rowCount: data?.length ?? 0 };
    } catch (e) {
      return caught(e);
    }
  },
};

const inventoryConnector: Connector = {
  key: "inventory",
  label: "Cars & Parts Stock",
  description: "Check car stock by status and brand, find specific cars, and spot low parts.",
  status: () => anonStatusCheck("cars"),
  tools: [carsInStockSummary, lowStockParts, carLookup],
};

export default inventoryConnector;
