/**
 * Garage connector — job cards from the Monza CRM, queried under the
 * signed-in user's own token (RLS applies). Read-only.
 */

import type { Connector, ExecutionContext, ToolResult } from "@/lib/connectors/types";
import {
  anonStatusCheck,
  caught,
  fromDbError,
  isDemo,
  makeUserClient,
  rel,
} from "@/lib/connectors/crm";
import {
  demoJobLookup,
  demoJobsWaitingParts,
  demoOpenJobsSummary,
} from "@/lib/connectors/demo-data";

const JOB_SELECT =
  "id, job_number, status, priority, complaint, created_at, " +
  "cars ( brand, model, model_year, vin, plate_number ), " +
  "customers ( first_name, last_name, phone_primary )";

function shapeJob(row: Record<string, unknown>) {
  const car = rel<Record<string, unknown>>(row.cars);
  const cust = rel<Record<string, unknown>>(row.customers);
  const carLabel = car
    ? [car.brand, car.model, car.plate_number ? `— ${car.plate_number}` : null]
        .filter(Boolean)
        .join(" ")
    : null;
  return {
    job_number: row.job_number,
    status: row.status,
    priority: row.priority,
    complaint: row.complaint,
    created_at: row.created_at,
    car: carLabel,
    vin: (car?.vin as string | null) ?? null,
    customer: cust
      ? `${cust.first_name ?? ""} ${cust.last_name ?? ""}`.trim() || null
      : null,
    customer_phone: (cust?.phone_primary as string | null) ?? null,
  };
}

const jobsWaitingParts = {
  name: "jobs_waiting_parts",
  description:
    "List garage jobs currently stuck waiting for parts, each with the car (brand, model, plate), the customer, the complaint, and how long the job has been open. This answers questions like 'which cars are waiting for repair?' or 'what's blocked on parts in the garage?'.",
  inputSchema: { type: "object", properties: {} },
  async execute(_input: Record<string, unknown>, ctx: ExecutionContext): Promise<ToolResult> {
    if (isDemo(ctx)) return demoJobsWaitingParts();
    try {
      const db = makeUserClient(ctx);
      const { data, error } = await db
        .from("garage_jobs")
        .select(JOB_SELECT)
        .eq("status", "waiting_parts")
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(50);
      if (error) return fromDbError(error);
      const jobs = ((data ?? []) as unknown as Array<Record<string, unknown>>).map(shapeJob);
      return { ok: true, data: { jobs_waiting_parts: jobs }, rowCount: jobs.length };
    } catch (e) {
      return caught(e);
    }
  },
};

const openJobsSummary = {
  name: "open_jobs_summary",
  description:
    "Count open garage jobs (pending, in progress, waiting for parts) broken down by status and by priority. Use for 'how busy is the garage?' or 'how many jobs are open right now?'. For the specific cars stuck on parts, use jobs_waiting_parts instead.",
  inputSchema: { type: "object", properties: {} },
  async execute(_input: Record<string, unknown>, ctx: ExecutionContext): Promise<ToolResult> {
    if (isDemo(ctx)) return demoOpenJobsSummary();
    try {
      const db = makeUserClient(ctx);
      const { data, error } = await db
        .from("garage_jobs")
        .select("status, priority")
        .in("status", ["pending", "in_progress", "waiting_parts"])
        .is("deleted_at", null)
        .limit(2000);
      if (error) return fromDbError(error);

      const byStatus: Record<string, number> = {};
      const byPriority: Record<string, number> = {};
      for (const r of data ?? []) {
        const s = (r.status as string | null) ?? "unknown";
        const p = String(r.priority ?? "unspecified");
        byStatus[s] = (byStatus[s] ?? 0) + 1;
        byPriority[p] = (byPriority[p] ?? 0) + 1;
      }
      return {
        ok: true,
        data: {
          open_jobs_by_status: byStatus,
          open_jobs_by_priority: byPriority,
          total_open: data?.length ?? 0,
        },
        rowCount: data?.length ?? 0,
      };
    } catch (e) {
      return caught(e);
    }
  },
};

const jobLookup = {
  name: "job_lookup",
  description:
    "Look up one garage job by its job number (e.g. 'GJ-2026-0142') and return its status, priority, complaint, the car and the customer. Use when the staff member references a specific job card.",
  inputSchema: {
    type: "object",
    properties: {
      job_number: {
        type: "string",
        description: "The exact job number written on the job card.",
      },
    },
    required: ["job_number"],
  },
  async execute(input: Record<string, unknown>, ctx: ExecutionContext): Promise<ToolResult> {
    const jobNumber = String(input.job_number ?? "").trim();
    if (isDemo(ctx)) return demoJobLookup(jobNumber);
    if (!jobNumber) return { ok: false, error: "A job number is required." };
    try {
      const db = makeUserClient(ctx);
      const { data, error } = await db
        .from("garage_jobs")
        .select(JOB_SELECT)
        .eq("job_number", jobNumber)
        .is("deleted_at", null)
        .limit(1);
      if (error) return fromDbError(error);
      if (!data || data.length === 0) {
        return {
          ok: true,
          data: { found: false, message: `No garage job matches "${jobNumber}".` },
          rowCount: 0,
        };
      }
      return {
        ok: true,
        data: { found: true, job: shapeJob(data[0] as unknown as Record<string, unknown>) },
        rowCount: 1,
      };
    } catch (e) {
      return caught(e);
    }
  },
};

const garageConnector: Connector = {
  key: "garage",
  label: "Garage & Service",
  description: "See open job cards, cars waiting for parts, and look up specific jobs.",
  status: () => anonStatusCheck("garage_jobs"),
  tools: [jobsWaitingParts, openJobsSummary, jobLookup],
};

export default garageConnector;
