/**
 * A minimal client for a LOCAL Ollama server.
 *
 * Why a second AI client at all, next to lib/ai/client.ts? Because these two do
 * genuinely different jobs and must fail differently:
 *
 *   lib/ai/client.ts  the assistant. Talks to Anthropic, answers questions from
 *                     tool results, is the product's brain.
 *   this file         the sales coach. Talks to a model running on the machine
 *                     in the corner of the showroom, drafts a reply a person
 *                     then reads and decides about. It never sends anything and
 *                     nothing it produces reaches a customer unread.
 *
 * Local means a different set of failures: the server simply is not running, the
 * model was never pulled, the machine is busy and a 20B model takes half a
 * minute. Every one of those is a RETURN VALUE here, never a throw, because the
 * screen has to say which it was — "Ollama isn't running" and "that took too
 * long" need different words and different buttons.
 *
 * Nothing about a customer leaves the building: the request goes to loopback.
 */

/** Where the local Ollama server listens. */
export function ollamaUrl(): string {
  const raw = process.env.OLLAMA_URL;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return (trimmed || "http://127.0.0.1:11434").replace(/\/+$/, "");
}

/**
 * The model to draft with. Configuration, never a literal at a call site — the
 * same discipline as the assistant's model id.
 */
export function ollamaModel(): string {
  const raw = process.env.OLLAMA_MODEL;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed || DEFAULT_OLLAMA_MODEL;
}

/** The model installed on the showroom machine today. */
export const DEFAULT_OLLAMA_MODEL = "gpt-oss:20b";

/** A local model is slow. This is generous on purpose, and still bounded. */
export const DEFAULT_TIMEOUT_MS = 90_000;

/** Why a call did not produce a draft. Each needs different words on screen. */
export type OllamaFailure =
  /** Nothing is listening — Ollama is not started. */
  | "not_running"
  /** The server answered, but does not have the model we asked for. */
  | "model_missing"
  /** It took longer than we are willing to make someone wait. */
  | "timeout"
  /** It answered, but not with anything usable. */
  | "bad_response"
  /**
   * It spent its whole token budget REASONING and never got to the answer.
   *
   * gpt-oss emits a separate `thinking` stream and there is no reliable way to
   * switch it off (`think: false` is not honoured by this model — measured), so
   * the budget has to cover thinking AND the reply. Empty content next to a
   * long thinking trace means exactly one thing, and saying "try again" would
   * be wrong advice: the budget needs raising.
   */
  | "budget_exhausted";

export interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type OllamaResult =
  | {
      ok: true;
      text: string;
      model: string;
      ms: number;
      /** The model's reasoning trace, when it emits one. Kept for diagnostics
       *  and NEVER shown as part of the draft — it is not addressed to anyone. */
      thinking?: string;
    }
  | { ok: false; reason: OllamaFailure; detail: string; ms: number };

/**
 * Sampling options. Defaults are chosen for DRAFTING A REPLY, not for prose:
 * low temperature because a sales reply should be predictable and on-message,
 * and a hard token ceiling because a suggestion nobody reads to the end is
 * worse than no suggestion.
 */
export interface OllamaOptions {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  num_predict?: number;
  num_ctx?: number;
  repeat_penalty?: number;
  stop?: string[];
}

/**
 * num_predict has to cover the model's REASONING as well as the reply.
 *
 * Measured on gpt-oss:20b: a short sales reply cost ~225 tokens end to end, of
 * which roughly two thirds was thinking. 220 produced an empty answer every
 * time; 700 leaves comfortable headroom while still capping a runaway.
 */
export const DRAFTING_OPTIONS: OllamaOptions = {
  temperature: 0.3,
  top_p: 0.9,
  top_k: 40,
  repeat_penalty: 1.05,
  num_predict: 900,
  // The brief is ~900 tokens and the thread can be long; the default 2048 would
  // silently drop the FACTS block, which is the one thing that must survive.
  num_ctx: 8192,
};

/** Turn a fetch failure into the right reason. */
function classify(error: unknown): { reason: OllamaFailure; detail: string } {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (
    lower.includes("econnrefused") ||
    lower.includes("connect") ||
    lower.includes("fetch failed") ||
    lower.includes("network")
  ) {
    return { reason: "not_running", detail: message };
  }
  return { reason: "bad_response", detail: message };
}

/**
 * Which models this Ollama actually has. Used by the settings/diagnostics view
 * so "the coach is unavailable" can say WHICH thing is missing.
 */
export async function listModels(
  timeoutMs = 5_000
): Promise<{ ok: true; models: string[] } | { ok: false; reason: OllamaFailure; detail: string }> {
  const controller = new AbortController();
  // Cleared in `finally` — an uncleared timer keeps a serverless invocation
  // alive after the work is done, which is a bug this project already fixed
  // once in the assistant's tool loop.
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${ollamaUrl()}/api/tags`, {
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, reason: "bad_response", detail: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { models?: { name?: unknown }[] };
    const models = Array.isArray(body.models)
      ? body.models
          .map((m) => (typeof m.name === "string" ? m.name : ""))
          .filter((n) => n !== "")
      : [];
    return { ok: true, models };
  } catch (e) {
    if (controller.signal.aborted) {
      return { ok: false, reason: "timeout", detail: `no answer in ${timeoutMs}ms` };
    }
    const { reason, detail } = classify(e);
    return { ok: false, reason, detail };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the local model for one completion.
 *
 * `stream: false` deliberately: a draft is read all at once, and streaming a
 * suggestion into a box that a person is not yet looking at buys nothing but
 * complexity. If drafting ever moves in front of the composer as you type, that
 * is the moment to revisit this.
 */
export async function chat(args: {
  messages: OllamaMessage[];
  model?: string;
  options?: OllamaOptions;
  timeoutMs?: number;
  /**
   * A JSON schema. llama.cpp compiles it to a grammar, so the model CANNOT
   * emit anything that does not match — far stronger than asking it nicely,
   * which a 20B ignores roughly one time in five.
   */
  format?: unknown;
  /** How long to keep the model in memory. A cold 13GB load costs ~30s. */
  keepAlive?: string;
}): Promise<OllamaResult> {
  const model = args.model ?? ollamaModel();
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${ollamaUrl()}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: args.messages,
        stream: false,
        options: { ...DRAFTING_OPTIONS, ...args.options },
        ...(args.format ? { format: args.format } : {}),
        keep_alive: args.keepAlive ?? "30m",
      }),
    });

    const ms = Date.now() - started;

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: unknown };
        if (typeof body.error === "string") detail = body.error;
      } catch {
        /* not JSON — the status is all we have */
      }
      // Ollama says so in words when the model was never pulled; that deserves
      // its own message on screen ("run: ollama pull ...") rather than a
      // generic failure.
      const missing =
        res.status === 404 || /not found|no such model|try pulling/i.test(detail);
      return {
        ok: false,
        reason: missing ? "model_missing" : "bad_response",
        detail,
        ms,
      };
    }

    const body = (await res.json()) as {
      message?: { content?: unknown; thinking?: unknown };
      error?: unknown;
    };
    const text =
      typeof body.message?.content === "string" ? body.message.content.trim() : "";
    const thinking =
      typeof body.message?.thinking === "string" ? body.message.thinking : "";

    if (text === "") {
      // Long reasoning and no answer is a budget problem, not a broken model.
      const exhausted = thinking.length > 0;
      return {
        ok: false,
        reason: exhausted ? "budget_exhausted" : "bad_response",
        detail: exhausted
          ? `the model reasoned for ${thinking.length} characters without reaching an answer`
          : "the model returned nothing",
        ms,
      };
    }
    return { ok: true, text, model, ms, ...(thinking ? { thinking } : {}) };
  } catch (e) {
    const ms = Date.now() - started;
    if (controller.signal.aborted) {
      return {
        ok: false,
        reason: "timeout",
        detail: `no answer in ${Math.round(timeoutMs / 1000)}s`,
        ms,
      };
    }
    const { reason, detail } = classify(e);
    return { ok: false, reason, detail, ms };
  } finally {
    clearTimeout(timer);
  }
}

/** Plain words for each failure, for the person at the screen. */
export const FAILURE_MESSAGE: Readonly<Record<OllamaFailure, string>> = {
  not_running:
    "The local AI isn't running. Start Ollama on this machine and try again.",
  model_missing:
    "The drafting model isn't installed on this machine yet.",
  timeout:
    "The local AI took too long to answer. It may be busy — try again.",
  bad_response:
    "The local AI answered with something unusable. Try again.",
  budget_exhausted:
    "The local AI ran out of room before finishing the reply. Try again — if it keeps happening, the draft length limit needs raising.",
};
