/**
 * The connector contract — the only way MONZA AI reaches any system.
 *
 * Architecture:
 *
 *     MONZA AI  ──►  connector  ──►  the system, AS THE SIGNED-IN USER
 *
 * Two properties are enforced by these types rather than by convention:
 *
 * 1. IDENTITY PASS-THROUGH. Every tool receives an ExecutionContext carrying
 *    the signed-in user's OWN token for the target system. A connector that
 *    talks to the Monza CRM queries with that token, so the CRM's row-level
 *    security applies to every answer. There is deliberately no service-role
 *    escape hatch in this contract: the AI cannot read what the user cannot.
 *
 * 2. READ-ONLY V1. ToolDefinition has no mutation channel. A tool returns
 *    data; it never writes to a connected system. Write-capable actions are a
 *    later, separately-permissioned surface — not a flag on this one.
 */

export interface StaffIdentity {
  /** auth.users id in the CRM project — the shared staff identity. */
  userId: string;
  email: string | null;
  /** The user's own CRM access token. Passed through, never replaced. */
  crmAccessToken: string;
  /** Resolved from the CRM profiles table at sign-in. */
  appRole: string | null;
  capabilities: string[];
}

export interface ExecutionContext {
  user: StaffIdentity;
  /** The conversation this call belongs to, for the audit trail. */
  conversationId: string | null;
  /** Correlates all tool calls of one assistant turn. */
  turnId: string;
}

/** What a tool call produces. Rows are data for the model to summarise. */
export interface ToolResult {
  ok: boolean;
  /** Compact, model-readable result. Keep it small; summarise in SQL, not JS. */
  data?: unknown;
  /** Row count when data is tabular — shown to the user in the trace. */
  rowCount?: number;
  /** Human-readable failure. 'permission_denied' is a NORMAL outcome. */
  error?: string;
  denied?: boolean;
}

export interface ToolDefinition {
  /** Unique within the connector: e.g. "overdue_installments". */
  name: string;
  /** Written FOR THE MODEL: when to call this, what it returns. */
  description: string;
  /** JSON Schema for the input, enforced by the tool-use API. */
  inputSchema: Record<string, unknown>;
  /**
   * Execute with the caller's identity. Implementations must route every
   * query through ctx.user.crmAccessToken (or the equivalent per-system
   * user credential) — never a server secret.
   */
  execute(input: Record<string, unknown>, ctx: ExecutionContext): Promise<ToolResult>;
}

export interface Connector {
  /** Stable key: "crm", "installments", "garage", "inventory", "finance". */
  key: string;
  /** Staff-facing name: "Customers & Sales". */
  label: string;
  /** One sentence for the connections screen. */
  description: string;
  /** Is the underlying system reachable with current configuration? */
  status(): Promise<{ connected: boolean; detail: string }>;
  tools: ToolDefinition[];
}

/**
 * The registry is CLOSED, mirroring the router-intent lesson from One Thread:
 * the model may only call tools that exist here. A hallucinated tool name is
 * an error, never an execution.
 */
export interface ConnectorRegistry {
  connectors: Connector[];
  find(connectorKey: string, toolName: string): ToolDefinition | null;
}

export function buildRegistry(connectors: Connector[]): ConnectorRegistry {
  return {
    connectors,
    find(connectorKey, toolName) {
      const c = connectors.find((x) => x.key === connectorKey);
      return c?.tools.find((t) => t.name === toolName) ?? null;
    },
  };
}

/** Fully-qualified tool name as the model sees it: "crm__search_customers". */
export function qualifiedName(connectorKey: string, toolName: string): string {
  return `${connectorKey}__${toolName}`;
}

export function parseQualifiedName(
  qualified: string
): { connectorKey: string; toolName: string } | null {
  const i = qualified.indexOf("__");
  if (i <= 0) return null;
  return { connectorKey: qualified.slice(0, i), toolName: qualified.slice(i + 2) };
}
