/**
 * Recommended next questions, derived from which connectors an answer
 * actually consulted. Deterministic by design: same trace in, same
 * questions out — no randomness, no model call.
 *
 * Every question here is one the demo engine can also answer (they mirror
 * the customer-facing RECOMMENDED_CHATS question set), so tapping a
 * follow-up always lands on a real answer in both demo and live modes.
 */

import type { ToolTraceEntry } from "@/lib/ai/loop";

/**
 * Per-connector follow-ups, ordered best-first. Friendly customer words —
 * always about the signed-in customer's own car, plan, or visit, or about
 * public information like the models and the showroom. Never anything that
 * would show another customer's data or company-wide figures.
 *
 * IMPORTANT: every string below is byte-identical to a question in the demo
 * engine's card set (lib/chat/demo-answers.ts), so each one is guaranteed to
 * route to a scripted demo answer — chains never dead-end.
 */
const FOLLOWUPS_BY_CONNECTOR: Record<string, string[]> = {
  garage: [
    "Is my car ready yet?",
    "How do I book a service visit?",
  ],
  installments: [
    "When is my next payment due?",
    "How much is left on my plan?",
  ],
  inventory: [
    "Tell me about the Voyah Dream",
    "Tell me about MHERO",
  ],
  crm: [
    "Can I book a test drive?",
    "How do I talk to a person?",
  ],
};

/** Used when the trace names no known connector (e.g. a pure-text answer).
 *  Drawn from the same card set above, so these always resolve too. */
const DEFAULT_FOLLOWUPS: string[] = [
  "Is my car ready yet?",
  "When is my next payment due?",
  "Can I book a test drive?",
];

const MIN_FOLLOWUPS = 2;
const MAX_FOLLOWUPS = 4;

/**
 * Map the connectors actually consulted (successfully — a denied call is not
 * an invitation to dig further into a system the customer cannot see) to 2-4
 * natural next questions. Breadth-first across connectors so a two-system
 * answer suggests both directions before doubling down on one.
 */
export function deriveFollowups(trace: ToolTraceEntry[]): string[] {
  const keys: string[] = [];
  for (const entry of trace) {
    if (entry.denied) continue;
    const sep = entry.qualifiedName.indexOf("__");
    if (sep <= 0) continue;
    const key = entry.qualifiedName.slice(0, sep);
    if (FOLLOWUPS_BY_CONNECTOR[key] && !keys.includes(key)) keys.push(key);
  }

  const out: string[] = [];
  for (let rank = 0; rank < 2 && out.length < MAX_FOLLOWUPS; rank++) {
    for (const key of keys) {
      if (out.length >= MAX_FOLLOWUPS) break;
      const question = FOLLOWUPS_BY_CONNECTOR[key][rank];
      if (question && !out.includes(question)) out.push(question);
    }
  }

  // Pad from the defaults so there are always at least two suggestions.
  for (const question of DEFAULT_FOLLOWUPS) {
    if (out.length >= MIN_FOLLOWUPS) break;
    if (!out.includes(question)) out.push(question);
  }

  return out.slice(0, MAX_FOLLOWUPS);
}
