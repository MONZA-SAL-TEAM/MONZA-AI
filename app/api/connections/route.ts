import { NextResponse } from "next/server";
import type { Connector } from "@/lib/connectors/types";
import { requireStaff, isDemoIdentity } from "@/lib/auth";
import { aiDbConfigured, brainConfigured, crmConfigured } from "@/lib/env";

/**
 * GET /api/connections — the connector map, server-side.
 *
 * For every connector in the closed set we report a staff-readable status.
 * When the connector module is present we call its own status(); when it is
 * not (or it throws), we fall back to environment presence, which is the
 * honest lower bound: no CRM credentials means nothing CRM-flavoured can be
 * reachable. Secrets never leave the server — this route returns booleans
 * and plain sentences only.
 *
 * AUTHORIZATION: the connector map is an inventory of Monza's internal systems
 * and of what the assistant can be asked, so it is not public. On a deployment
 * with staff sign-in configured a valid token is required. In demo mode there
 * is no sign-in to require and the map describes an invented deployment, so it
 * is served as part of the demo — the same rule every other board route uses.
 */

export const dynamic = "force-dynamic";

interface ConnectorMeta {
  key: string;
  label: string;
  description: string;
}

/**
 * Where each connector's answers come from. All five point at the Monza CRM
 * today; when a system becomes its own application later, only this string
 * (and the connector's internals) change — the contract stays put.
 */
const SOURCE_BY_KEY: Record<string, string> = {
  crm: "Monza CRM (the Monza SAL system)",
  installments: "Monza CRM (the Monza SAL system)",
  finance: "Monza CRM (the Monza SAL system)",
  garage: "Monza CRM (the Monza SAL system)",
  inventory: "Monza CRM (the Monza SAL system)",
};

/** Plain-word overrides where a prettified tool name would mislead. */
const TOOL_LABEL_OVERRIDES: Record<string, string> = {
  recent_leads: "New customer enquiries",
};

function toolLabel(name: string): string {
  const override = TOOL_LABEL_OVERRIDES[name];
  if (override) return override;
  const words = name.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The closed set, mirroring lib/permissions/kernel.ts. Labels are staff words. */
const CONNECTORS: ConnectorMeta[] = [
  {
    key: "crm",
    label: "Customers & Sales",
    description: "Customer records, new enquiries, vehicles and sales orders.",
  },
  {
    key: "installments",
    label: "Installments & Payments",
    description: "Payment plans, upcoming dues and overdue installments.",
  },
  {
    key: "finance",
    label: "Finance",
    description: "Invoices, receipts and money-in / money-out summaries.",
  },
  {
    key: "garage",
    label: "Garage & Service",
    description: "Job cards, service history and workshop status.",
  },
  {
    key: "inventory",
    label: "Parts & Inventory",
    description: "Parts stock, accessories and vehicles on hand.",
  },
];

/** External systems that are on the roadmap but deliberately not wired yet. */
const COMING_LATER = [
  "WhatsApp (One Thread)",
  "Google Workspace",
  "Accounting",
  "Shipping & customs",
];

function looksLikeConnector(v: unknown): v is Connector {
  if (!v || typeof v !== "object") return false;
  const c = v as Partial<Connector>;
  return (
    typeof c.key === "string" &&
    typeof c.status === "function" &&
    Array.isArray(c.tools)
  );
}

/**
 * Try to load the connector module for a key. Connector implementations live
 * at lib/connectors/<key>/; if the module is not present in this build the
 * import throws and we return null — the caller falls back to env presence.
 */
async function loadConnector(key: string): Promise<Connector | null> {
  let mod: Record<string, unknown> | null = null;
  try {
    mod = await import(`@/lib/connectors/${key}`);
  } catch {
    // not built / not bundled — try the explicit index form
  }
  if (!mod) {
    try {
      mod = await import(`@/lib/connectors/${key}/index`);
    } catch {
      return null;
    }
  }
  if (!mod) return null;

  const values = Object.values(mod);
  const exact = values.find((v) => looksLikeConnector(v) && v.key === key);
  if (exact && looksLikeConnector(exact)) return exact;
  const any = values.find(looksLikeConnector);
  return any ?? null;
}

async function statusWithTimeout(
  c: Connector
): Promise<{ connected: boolean; detail: string }> {
  return Promise.race([
    c.status(),
    new Promise<{ connected: boolean; detail: string }>((resolve) =>
      setTimeout(
        () => resolve({ connected: false, detail: "Did not respond in time." }),
        4000
      )
    ),
  ]);
}

export async function GET(request: Request): Promise<NextResponse> {
  const user = await requireStaff(request);
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }

  const crm = crmConfigured();
  const demo = isDemoIdentity(user) && !aiDbConfigured() && !brainConfigured();

  const connectors = await Promise.all(
    CONNECTORS.map(async (meta) => {
      let connected = crm;
      let detail = crm
        ? "Ready — answers use your own sign-in."
        : "Waiting for connection details.";

      const impl = await loadConnector(meta.key);
      if (impl) {
        try {
          const s = await statusWithTimeout(impl);
          connected = s.connected;
          detail = s.detail || detail;
        } catch {
          connected = false;
          detail = "Could not be reached right now.";
        }
      }

      return {
        key: meta.key,
        label: meta.label,
        description: meta.description,
        connected,
        detail,
        source: SOURCE_BY_KEY[meta.key] ?? "Not set",
        tools: impl ? impl.tools.map((t) => toolLabel(t.name)) : [],
      };
    })
  );

  return NextResponse.json({
    demo,
    connectors,
    comingLater: COMING_LATER,
    signIn: "Your own Monza account — every answer follows your CRM permissions.",
    checkedAt: new Date().toISOString(),
  });
}
