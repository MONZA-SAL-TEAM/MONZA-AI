/**
 * How customers describe our cars — PURE (Samer, 2026-10-12 master prompt, part 5). Built from the
 * mention facts: WHICH dictionary word named each car (a key of our own dictionary — never the customer's
 * text), kinds of car asked for with no model, and car names that could be ordinary words (unresolved,
 * never counted as interest). Tested in tests/insights-language.test.ts.
 */

import type { ObservationRow } from "@/lib/insights/insights";
import type { InsightQuery } from "@/lib/insights/query";
import type { AliasEntry } from "@/lib/wasales/aliases";

export interface ExpressionRow {
  key: string;
  /** Our dictionary word ("كوريج", "917"), or a description for "fuzzy". */
  text: string;
  script: "latin" | "arabic" | "digits" | "misspelling" | "retired";
  people: number;
  messages: number;
  channels: Record<string, number>;
  /** People per week, oldest first. */
  weekly: number[];
  q: InsightQuery;
}

export interface ModelLanguage {
  code: string;
  name: string;
  people: number;
  expressions: ExpressionRow[];
  /** People who wrote a car name that could be an ordinary word and was NOT taken as this car. */
  unresolvedPeople: number;
}

export interface CategoryRow {
  key: string;
  label: string;
  /** Asked for this kind of car without naming any model. */
  onlyCategory: number;
  /** Asked for it alongside a model. */
  withModel: number;
  q: InsightQuery;
}

const WEEKS = 12;
const CATEGORY_LABEL: Readonly<Record<string, string>> = { suv: "SUV", mpv: "MPV / van", sedan: "Sedan", off_road: "Off-road", bev: "Fully electric", erev: "Range extender (EREV)", phev: "Plug-in hybrid", hybrid: "Hybrid" };

export function vehicleLanguage(
  observations: readonly ObservationRow[],
  channelOf: (conv: string) => string,
  personOf: (conv: string) => string,
  index: readonly AliasEntry[],
  modelOfCar: (carId: string) => string | null,
  models: readonly { code: string; name: string }[],
  nowMs: number
): { models: ModelLanguage[]; categories: CategoryRow[] } {
  const byKey = new Map(index.map((a) => [a.key, a]));
  const mentions = observations.filter((o) => o.kind === "mention" && o.model);
  const result = models.map((m) => {
    const its = mentions.filter((o) => o.model === m.code);
    const groups = new Map<string, ObservationRow[]>();
    for (const o of its) (groups.get(o.value) ?? groups.set(o.value, []).get(o.value)!).push(o);
    const expressions: ExpressionRow[] = [...groups.entries()].map(([key, list]) => {
      const entry = byKey.get(key);
      const ownsIt = entry ? modelOfCar(entry.carId) === m.code : false;
      const weekly = Array.from({ length: WEEKS }, () => new Set<string>());
      const channels: Record<string, number> = {};
      for (const o of list) {
        const w = WEEKS - 1 - Math.floor((nowMs - Date.parse(o.at)) / (7 * 86_400_000));
        if (w >= 0 && w < WEEKS) weekly[w].add(personOf(o.conversation_id));
        const ch = channelOf(o.conversation_id);
        channels[ch] = (channels[ch] ?? 0) + 1;
      }
      return {
        key,
        text: key === "fuzzy" ? "A misspelling the reader tolerated" : entry ? entry.text : "A word no longer in the dictionary",
        script: key === "fuzzy" ? "misspelling" : entry && ownsIt ? entry.script : "retired",
        people: new Set(list.map((o) => personOf(o.conversation_id))).size,
        messages: new Set(list.map((o) => `${o.conversation_id}|${o.external_message_id ?? o.at}`)).size,
        channels,
        weekly: weekly.map((s) => s.size),
        q: { model: m.code, mention: `${m.code}:${key}` },
      };
    });
    expressions.sort((a, b) => b.people - a.people || b.messages - a.messages || a.text.localeCompare(b.text));
    return {
      code: m.code,
      name: m.name,
      people: new Set(its.map((o) => personOf(o.conversation_id))).size,
      expressions,
      unresolvedPeople: new Set(observations.filter((o) => o.kind === "unresolved" && o.model === m.code).map((o) => personOf(o.conversation_id))).size,
    };
  });

  const cats = new Map<string, { only: Set<string>; with: Set<string> }>();
  for (const o of observations) {
    if (o.kind !== "category") continue;
    const c = cats.get(o.value) ?? cats.set(o.value, { only: new Set(), with: new Set() }).get(o.value)!;
    (o.rule === "category.only" ? c.only : c.with).add(personOf(o.conversation_id));
  }
  const categories = [...cats.entries()]
    .map(([key, s]) => ({ key, label: CATEGORY_LABEL[key] ?? key, onlyCategory: s.only.size, withModel: s.with.size, q: { category: key } }))
    .sort((a, b) => b.onlyCategory + b.withModel - (a.onlyCategory + a.withModel));
  return { models: result.sort((a, b) => b.people - a.people), categories };
}
