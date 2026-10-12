/**
 * Saved studies — PURE helpers. A saved study is the Lab's question re-written through its own parser, so
 * nothing outside the closed vocabulary can be stored or replayed.
 */

import { parseInsightQuery, toSearch } from "@/lib/insights/query";
import { GROUP_BY } from "@/lib/insights/study";

/** "?model=COURAGE&evil=1&groupBy=stage" → "model=COURAGE&groupBy=stage" (known fields only). */
export function normalizeStudyQuery(raw: string): string {
  const sp = new URLSearchParams(raw.replace(/^\?/, ""));
  const q = toSearch(parseInsightQuery(sp)).replace(/^\?/, "");
  const groupBy = sp.get("groupBy");
  const extra = groupBy && GROUP_BY.some(([k]) => k === groupBy) ? `groupBy=${groupBy}` : "";
  return [q, extra].filter(Boolean).join("&").slice(0, 2000);
}
