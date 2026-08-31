/**
 * The brain: one assistant turn, run as a Claude tool-use loop.
 *
 * Invariants enforced here (see the project rules):
 *  - Layer 1 (decideToolAccess) runs before EVERY execution; a denial is a
 *    normal tool result fed back to the model, not an exception.
 *  - Every tool call — allowed, denied, or unknown — writes one audit row.
 *  - The closed registry: a qualified name that does not resolve returns an
 *    error result and executes nothing.
 *  - This function never throws. Whatever goes wrong, the staff member gets
 *    an honest sentence and the trace of what actually happened.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseQualifiedName,
  qualifiedName,
  type ConnectorRegistry,
  type ExecutionContext,
  type StaffIdentity,
  type ToolResult,
} from "@/lib/connectors/types";
import {
  decideToolAccess,
  deniedResult,
  type ToolRule,
} from "@/lib/permissions/kernel";
import {
  callClaude,
  isTextBlock,
  isToolUseBlock,
  type ClaudeMessage,
  type ClaudeToolUseBlock,
} from "@/lib/ai/client";
import { toAnthropicTools } from "@/lib/tools/registry";

/** Cap on how much of one tool result is fed back to the model. */
const RESULT_CHAR_LIMIT = 4000;

export interface ToolTraceEntry {
  qualifiedName: string;
  input: Record<string, unknown>;
  rowCount: number | null;
  denied: boolean;
  durationMs: number;
}

export interface AssistantTurnDeps {
  registry: ConnectorRegistry;
  userRules: ToolRule[];
  /** The AI's OWN database (service client) — null in demo mode. */
  aiDb: SupabaseClient | null;
  settings: {
    /** From ai_settings 'monza_ai.model' or env — never a literal in code. */
    model: string;
    maxToolCalls: number;
  };
}

export interface AssistantTurnArgs {
  identity: StaffIdentity;
  conversationId: string | null;
  userMessage: string;
  /** Prior turns of this conversation, already in wire format. */
  history: ClaudeMessage[];
  deps: AssistantTurnDeps;
}

export interface AssistantTurnResult {
  text: string;
  trace: ToolTraceEntry[];
  model: string;
}

function buildSystemPrompt(today: string): string {
  return [
    "You are MONZA AI, an internal assistant for Monza SAL staff.",
    "You answer ONLY from the results of the tools you call. If you have not called a tool that returns a figure, you do not know that figure.",
    "If a tool result says the user's access is denied, say plainly that their access does not include that system. Never speculate about what the numbers might be.",
    "Currency is USD unless a tool result says otherwise.",
    "Be concise. Staff want the answer, not a preamble.",
    `Today's date is ${today}.`,
  ].join("\n");
}

/**
 * Precompute the layer-1 allow-set: every registry tool the signed-in user
 * passes decideToolAccess for. Tools outside this set are never shown to the
 * model. Layer 1 still runs again per call — two checks, neither trusting
 * the other's timing.
 */
function computeAllowedSet(
  ctx: ExecutionContext,
  registry: ConnectorRegistry,
  userRules: ToolRule[]
): Set<string> {
  const allowed = new Set<string>();
  for (const connector of registry.connectors) {
    for (const tool of connector.tools) {
      const decision = decideToolAccess(ctx, connector.key, tool.name, userRules);
      if (decision.allowed) {
        allowed.add(qualifiedName(connector.key, tool.name));
      }
    }
  }
  return allowed;
}

/** Compact a tool result for the model; big payloads get truncated honestly. */
function serializeResult(result: ToolResult): string {
  let text: string;
  try {
    text = JSON.stringify({
      ok: result.ok,
      denied: result.denied ?? false,
      rowCount: result.rowCount ?? null,
      error: result.error ?? null,
      data: result.data ?? null,
    });
  } catch {
    text = JSON.stringify({ ok: false, error: "unserializable_tool_result" });
  }
  if (text.length > RESULT_CHAR_LIMIT) {
    return (
      text.slice(0, RESULT_CHAR_LIMIT) +
      `\n[truncated: result exceeded ${RESULT_CHAR_LIMIT} characters; refine the query to see more]`
    );
  }
  return text;
}

interface AuditRow {
  connectorKey: string;
  toolName: string;
  input: Record<string, unknown>;
  allowed: boolean;
  denyReason: string | null;
  rowCount: number | null;
  error: string | null;
  durationMs: number;
}

/** Write one audit row. Auditing failures never break the turn. */
async function writeAudit(
  deps: AssistantTurnDeps,
  ctx: ExecutionContext,
  row: AuditRow
): Promise<void> {
  if (!deps.aiDb) return; // demo mode: nothing to write to
  try {
    await deps.aiDb.from("audit_logs").insert({
      crm_user_id: ctx.user.userId,
      conversation_id: ctx.conversationId,
      turn_id: ctx.turnId,
      connector_key: row.connectorKey,
      tool_name: row.toolName,
      input: row.input,
      allowed: row.allowed,
      deny_reason: row.denyReason,
      row_count: row.rowCount,
      error: row.error,
      duration_ms: row.durationMs,
    });
  } catch {
    // The audit table being unreachable must not take the assistant down.
  }
}

/** Resolve and run ONE tool_use block; always audited, never throws. */
async function handleToolUse(
  block: ClaudeToolUseBlock,
  ctx: ExecutionContext,
  deps: AssistantTurnDeps,
  trace: ToolTraceEntry[]
): Promise<ToolResult> {
  const input = (block.input ?? {}) as Record<string, unknown>;
  const parsed = parseQualifiedName(block.name);
  const started = Date.now();

  // Closed registry: an unresolvable name executes nothing.
  const tool = parsed
    ? deps.registry.find(parsed.connectorKey, parsed.toolName)
    : null;
  if (!parsed || !tool) {
    const durationMs = Date.now() - started;
    await writeAudit(deps, ctx, {
      connectorKey: parsed?.connectorKey ?? "unknown",
      toolName: parsed?.toolName ?? block.name,
      input,
      allowed: false,
      denyReason: "unknown_tool",
      rowCount: null,
      error: "unknown_tool",
      durationMs,
    });
    trace.push({
      qualifiedName: block.name,
      input,
      rowCount: null,
      denied: false,
      durationMs,
    });
    return { ok: false, error: "This tool does not exist." };
  }

  // Layer 1, per call. Deny wins; a denial is a normal, audited outcome.
  const decision = decideToolAccess(
    ctx,
    parsed.connectorKey,
    parsed.toolName,
    deps.userRules
  );
  if (!decision.allowed) {
    const durationMs = Date.now() - started;
    await writeAudit(deps, ctx, {
      connectorKey: parsed.connectorKey,
      toolName: parsed.toolName,
      input,
      allowed: false,
      denyReason: decision.reason,
      rowCount: null,
      error: null,
      durationMs,
    });
    trace.push({
      qualifiedName: block.name,
      input,
      rowCount: null,
      denied: true,
      durationMs,
    });
    return deniedResult(decision);
  }

  // Allowed: execute with the caller's identity, timed.
  let result: ToolResult;
  try {
    result = await tool.execute(input, ctx);
  } catch (e) {
    result = {
      ok: false,
      error: e instanceof Error ? e.message : "tool_execution_failed",
    };
  }
  const durationMs = Date.now() - started;

  await writeAudit(deps, ctx, {
    connectorKey: parsed.connectorKey,
    toolName: parsed.toolName,
    input,
    allowed: true,
    denyReason: null,
    rowCount: result.rowCount ?? null,
    error: result.ok ? null : result.error ?? "unknown_error",
    durationMs,
  });
  trace.push({
    qualifiedName: block.name,
    input,
    rowCount: result.rowCount ?? null,
    denied: false,
    durationMs,
  });
  return result;
}

export async function runAssistantTurn(
  args: AssistantTurnArgs
): Promise<AssistantTurnResult> {
  const { identity, conversationId, userMessage, history, deps } = args;
  const model = deps.settings.model;
  const trace: ToolTraceEntry[] = [];

  try {
    const ctx: ExecutionContext = {
      user: identity,
      conversationId,
      turnId: crypto.randomUUID(),
    };

    const today = new Date().toISOString().slice(0, 10);
    const system = buildSystemPrompt(today);
    const allowedSet = computeAllowedSet(ctx, deps.registry, deps.userRules);
    const tools = toAnthropicTools(deps.registry, allowedSet);

    const messages: ClaudeMessage[] = [
      ...history,
      { role: "user", content: userMessage },
    ];

    let toolCallsUsed = 0;

    for (;;) {
      const response = await callClaude({ model, system, messages, tools });
      if (!response.ok) {
        return {
          text: "I could not reach the assistant service just now. Nothing was changed; please try again in a moment.",
          trace,
          model,
        };
      }

      const toolUses = response.content.filter(isToolUseBlock);

      if (response.stopReason !== "tool_use" || toolUses.length === 0) {
        const text = response.content
          .filter(isTextBlock)
          .map((b) => b.text)
          .join("\n")
          .trim();
        return {
          text:
            text ||
            "I was unable to put together an answer for that. Please try rephrasing the question.",
          trace,
          model,
        };
      }

      // Echo the assistant content back unchanged (including any block types
      // this wrapper does not model), then answer every tool_use in ONE user
      // message, as the API requires.
      messages.push({ role: "assistant", content: response.content });

      const resultBlocks: unknown[] = [];
      for (const block of toolUses) {
        toolCallsUsed += 1;
        if (toolCallsUsed > deps.settings.maxToolCalls) {
          // The circuit breaker is a denial like any other: it writes an
          // audit row and appears in the trace. "Every tool call — allowed,
          // denied, or unknown — writes one audit row" has no exceptions.
          const parsed = parseQualifiedName(block.name);
          const input =
            block.input && typeof block.input === "object"
              ? (block.input as Record<string, unknown>)
              : {};
          await writeAudit(deps, ctx, {
            connectorKey: parsed?.connectorKey ?? block.name,
            toolName: parsed?.toolName ?? "",
            input,
            allowed: false,
            denyReason: "tool_call_limit",
            rowCount: null,
            error: null,
            durationMs: 0,
          });
          trace.push({
            qualifiedName: block.name,
            input,
            rowCount: null,
            denied: true,
            durationMs: 0,
          });
          resultBlocks.push({
            type: "tool_result",
            tool_use_id: block.id,
            content:
              "Tool-call limit for this question reached; this call was not run.",
          });
          continue;
        }
        const result = await handleToolUse(block, ctx, deps, trace);
        resultBlocks.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: serializeResult(result),
        });
      }
      messages.push({ role: "user", content: resultBlocks });

      if (toolCallsUsed >= deps.settings.maxToolCalls) {
        // Circuit breaker: one final call WITHOUT tools, asking for a summary
        // of what it already has.
        messages.push({
          role: "user",
          content:
            "You have used all the tool calls available for this question. Summarise the answer from the results you already have, and say plainly if anything is incomplete.",
        });
        const finalResponse = await callClaude({ model, system, messages });
        if (!finalResponse.ok) {
          return {
            text: "I gathered some data but could not finish composing the answer. Please try again.",
            trace,
            model,
          };
        }
        const text = finalResponse.content
          .filter(isTextBlock)
          .map((b) => b.text)
          .join("\n")
          .trim();
        return {
          text:
            text ||
            "I gathered some data but could not finish composing the answer. Please try again.",
          trace,
          model,
        };
      }
    }
  } catch {
    // The loop must never throw into the chat path.
    return {
      text: "Something went wrong while answering that. Nothing was changed; please try again.",
      trace,
      model,
    };
  }
}
