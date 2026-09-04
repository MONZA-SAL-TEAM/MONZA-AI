/**
 * Minimal fetch-based wrapper around the Anthropic Messages API.
 *
 * Deliberately no SDK: the app talks to POST /v1/messages directly so the
 * dependency surface stays exactly what package.json says it is. The wrapper
 * types only what the tool-use loop needs (text and tool_use content blocks,
 * stop_reason) and passes everything else through untouched — unknown block
 * types (e.g. thinking blocks) are preserved so they can be echoed back to
 * the model on the next request of the same turn.
 *
 * A failed call is a RETURN VALUE, never a throw: the chat path must always
 * end in an honest sentence to the staff member, not a stack trace.
 */

import { anthropicApiKey } from "@/lib/env";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/** A content block the loop understands. */
export interface ClaudeTextBlock {
  type: "text";
  text: string;
}

export interface ClaudeToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * The union is intentionally open: the API may return block types this
 * wrapper does not model (thinking, etc.). They are kept and echoed back,
 * never dropped.
 */
export type ClaudeContentBlock =
  | ClaudeTextBlock
  | ClaudeToolUseBlock
  | { type: string };

export function isTextBlock(b: ClaudeContentBlock): b is ClaudeTextBlock {
  return b.type === "text";
}

export function isToolUseBlock(b: ClaudeContentBlock): b is ClaudeToolUseBlock {
  return b.type === "tool_use";
}

/**
 * One message on the wire. Content is either a plain string or an array of
 * wire-format blocks (content blocks going out, tool_result blocks coming
 * back). Typed loosely on purpose — this is the transport, not the domain.
 */
export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string | unknown[];
}

/** Anthropic tool format, as produced by lib/tools/registry.ts. */
export interface AnthropicToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface CallClaudeArgs {
  model: string;
  system: string;
  messages: ClaudeMessage[];
  /** Omit or pass an empty array for a tools-free call. */
  tools?: AnthropicToolSpec[];
  maxTokens?: number;
}

export type ClaudeResponse =
  | {
      ok: true;
      content: ClaudeContentBlock[];
      stopReason: string | null;
      model: string;
    }
  | {
      ok: false;
      /** HTTP status, or 0 when the request never completed. */
      status: number;
      error: string;
    };

export async function callClaude(args: CallClaudeArgs): Promise<ClaudeResponse> {
  const apiKey = anthropicApiKey();
  if (!apiKey) {
    return { ok: false, status: 0, error: "missing_api_key" };
  }

  const body: Record<string, unknown> = {
    model: args.model,
    max_tokens: args.maxTokens ?? 4096,
    system: args.system,
    messages: args.messages,
  };
  if (args.tools && args.tools.length > 0) {
    body.tools = args.tools;
  }

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: e instanceof Error ? e.message : "network_error",
    };
  }

  if (!res.ok) {
    let detail = "";
    try {
      const errJson = (await res.json()) as {
        error?: { type?: string; message?: string };
      };
      detail = errJson?.error?.message ?? errJson?.error?.type ?? "";
    } catch {
      // Body was not JSON; the status code is all we have.
    }
    return {
      ok: false,
      status: res.status,
      error: detail || `anthropic_http_${res.status}`,
    };
  }

  let json: { content?: unknown; stop_reason?: unknown; model?: unknown };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    return { ok: false, status: res.status, error: "invalid_json_response" };
  }

  const content = Array.isArray(json.content)
    ? (json.content as ClaudeContentBlock[])
    : [];

  return {
    ok: true,
    content,
    stopReason: typeof json.stop_reason === "string" ? json.stop_reason : null,
    model: typeof json.model === "string" ? json.model : args.model,
  };
}
