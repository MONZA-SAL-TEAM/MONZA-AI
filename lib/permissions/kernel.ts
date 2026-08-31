import type { ExecutionContext, ToolResult } from "@/lib/connectors/types";

/**
 * The two permission layers, in order:
 *
 *   user ──► LAYER 1: MONZA AI tool permission ──► LAYER 2: the system's own
 *            (may this user use this tool           permissions (RLS under the
 *             through the AI at all?)                user's OWN token)
 *
 * Layer 2 is not implemented here — that is the whole point. It lives in the
 * connected system and applies because connectors query with the user's own
 * credentials. A Marketing employee who asks for overdue installments is
 * stopped at layer 1 if the tool is not granted to them; even if layer 1 were
 * misconfigured wide open, layer 2 returns only the rows the CRM lets THEM
 * see. Two independent layers; neither trusts the other.
 *
 * Layer-1 policy, v1:
 *   - Owners: every tool.
 *   - Everyone else: a tool is allowed when its connector maps to a capability
 *     the user holds (the same de-facto mapping the CRM uses), unless an
 *     explicit per-user rule in tool_permissions says otherwise.
 *   - DENY WINS. An explicit deny beats any grant, and an unknown connector
 *     is denied — fail closed, like everything else in this family of tools.
 */

/** Connector → CRM capability that makes it visible through the AI. */
const CONNECTOR_CAPABILITY: Record<string, string[]> = {
  crm: ["sales", "manage_team", "view_reports"],
  installments: ["cashier", "manage_team", "view_reports"],
  finance: ["cashier", "view_reports", "manage_team"],
  garage: ["garage", "manage_team", "view_reports"],
  inventory: ["inventory", "garage", "sales", "manage_team", "view_reports"],
};

export interface ToolRule {
  connector_key: string;
  /** '*' covers every tool on the connector. */
  tool_name: string;
  effect: "allow" | "deny";
}

export interface PermissionDecision {
  allowed: boolean;
  /** Written to the audit log; shown to the user when denied. */
  reason: string;
}

export function decideToolAccess(
  ctx: ExecutionContext,
  connectorKey: string,
  toolName: string,
  userRules: ToolRule[]
): PermissionDecision {
  const { appRole, capabilities } = ctx.user;

  const matches = (r: ToolRule) =>
    r.connector_key === connectorKey && (r.tool_name === "*" || r.tool_name === toolName);

  // Explicit deny beats everything — including owner. If an owner denied a
  // tool to themselves, that was a decision.
  if (userRules.some((r) => r.effect === "deny" && matches(r))) {
    return { allowed: false, reason: "explicitly_denied" };
  }

  if (appRole === "owner") {
    return { allowed: true, reason: "owner" };
  }

  if (userRules.some((r) => r.effect === "allow" && matches(r))) {
    return { allowed: true, reason: "explicit_grant" };
  }

  const caps = CONNECTOR_CAPABILITY[connectorKey];
  if (!caps) {
    return { allowed: false, reason: "unknown_connector" };
  }
  if (caps.some((c) => capabilities.includes(c))) {
    return { allowed: true, reason: "capability" };
  }

  return { allowed: false, reason: "no_capability_for_connector" };
}

/** The uniform result a denied call produces — a normal outcome, not a crash. */
export function deniedResult(decision: PermissionDecision): ToolResult {
  return {
    ok: false,
    denied: true,
    error:
      decision.reason === "explicitly_denied"
        ? "You do not have access to this through Monza AI."
        : "Your role does not include access to this system.",
  };
}
