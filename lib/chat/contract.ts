import type { ToolTraceEntry } from "@/lib/ai/loop";

/**
 * THE chat contract — the single source of truth for what the chat API
 * returns and what the chat screen renders. Both sides import THESE types;
 * neither side invents its own field names. (The first build shipped with the
 * client reading fields the API never sent — this file exists so that class
 * of defect cannot come back.)
 */

/** One table of rows shown under an answer. Small by design: the model (or
 *  the demo engine) picks at most ~10 rows; the answer text carries the rest. */
export interface AnswerTable {
  /** Plain-words heading, e.g. "Overdue installments over $2,000". */
  title: string;
  columns: string[];
  rows: (string | number | null)[][];
}

/** What POST /api/chat returns for one turn, and what a stored assistant
 *  message can reproduce. Field names are load-bearing. */
export interface ChatTurnResponse {
  conversationId: string | null;
  /** The assistant's answer, plain text. */
  text: string;
  /** Tables to render under the text. Always present, possibly empty. */
  tables: AnswerTable[];
  /** Recommended next questions, ready to send verbatim. Max 4. */
  followups: string[];
  /** Which systems were consulted — rendered as chips by ToolTrace. */
  trace: ToolTraceEntry[];
}

/** A recommended conversation on the welcome screen: one department, its
 *  plain-words label, and questions staff actually ask. */
export interface RecommendedChat {
  /** Connector key, used only to pick an icon/colour — never shown raw. */
  key: "crm" | "installments" | "garage" | "inventory" | "finance";
  label: string;
  blurb: string;
  questions: string[];
}
