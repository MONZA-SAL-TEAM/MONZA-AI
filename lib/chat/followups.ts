/**
 * Recommended next questions, derived from which connectors an answer
 * actually consulted. Deterministic by design: same trace in, same
 * questions out — no randomness, no model call.
 *
 * Every question here is one the demo engine can also answer (they mirror
 * the RECOMMENDED_CHATS question set), so tapping a follow-up always lands
 * on a real answer in both demo and live modes.
 */

import type { ToolTraceEntry } from "@/lib/ai/loop";

/**
 * Per-connector follow-ups, ordered best-first. Plain staff words only.
 * IMPORTANT: every string below is verbatim from the demo engine's
 * RECOMMENDED_CHATS question set (lib/chat/demo-answers.ts), so each one is
 * guaranteed to route to a scripted demo answer — chains never dead-end.
 */
const FOLLOWUPS_BY_CONNECTOR: Record<string, string[]> = {
  installments: [
    "How much did we collect this month?",
    "How are our payment plans doing overall?",
  ],
  crm: [
    "Where are our leads coming from?",
    "Which customers have overdue installments over $2,000?",
  ],
  garage: [
    "Which cars are waiting for repair or parts?",
    "How many jobs are open in the garage right now?",
  ],
  inventory: [
    "Which parts are running low?",
    "How many cars do we have in stock?",
  ],
  finance: [
    "How were sales this month?",
    "What did we spend this month?",
  ],
};

/** Used when the trace names no known connector (e.g. a pure-text answer). */
const DEFAULT_FOLLOWUPS: string[] = [
  "Which customers have overdue installments over $2,000?",
  "Which cars are waiting for repair or parts?",
  "How much did we collect this month?",
];

const MIN_FOLLOWUPS = 2;
const MAX_FOLLOWUPS = 4;

/**
 * Map the connectors actually consulted (successfully — a denied call is not
 * an invitation to dig further into a system the person cannot use) to 2-4
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
