/**
 * The one place the ConnectorRegistry is assembled, and the translation from
 * the connector contract to the Anthropic tool format.
 *
 * The registry is CLOSED: only the five connectors imported here exist. A
 * tool name the model invents resolves to nothing and becomes an error
 * result, never an execution (see lib/ai/loop.ts).
 */

import {
  buildRegistry,
  qualifiedName,
  type Connector,
  type ConnectorRegistry,
} from "@/lib/connectors/types";
import type { AnthropicToolSpec } from "@/lib/ai/client";

import crm from "@/lib/connectors/crm";
import installments from "@/lib/connectors/installments";
import garage from "@/lib/connectors/garage";
import inventory from "@/lib/connectors/inventory";
import finance from "@/lib/connectors/finance";

const ALL_CONNECTORS: Connector[] = [
  crm,
  installments,
  garage,
  inventory,
  finance,
];

/** Build the closed registry from every connector module. */
export function buildMonzaRegistry(): ConnectorRegistry {
  return buildRegistry(ALL_CONNECTORS);
}

/**
 * Map connector tools to the Anthropic tool format — but ONLY the tools whose
 * qualified name is in the precomputed layer-1 allow-set. A tool the user may
 * not use is not merely refused at call time; the model never sees it, so it
 * cannot even be tempted.
 */
export function toAnthropicTools(
  registry: ConnectorRegistry,
  allowedQualifiedNames: ReadonlySet<string>
): AnthropicToolSpec[] {
  const tools: AnthropicToolSpec[] = [];
  for (const connector of registry.connectors) {
    for (const tool of connector.tools) {
      const name = qualifiedName(connector.key, tool.name);
      if (!allowedQualifiedNames.has(name)) continue;
      tools.push({
        name,
        description: `[${connector.label}] ${tool.description}`,
        input_schema: tool.inputSchema,
      });
    }
  }
  return tools;
}
