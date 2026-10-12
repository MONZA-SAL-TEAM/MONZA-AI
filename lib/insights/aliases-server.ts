/**
 * Words managers approve (or reject) as naming a car — SERVER ONLY (026 insight_aliases). They change the
 * INSIGHTS reader's dictionary only; the live sales bot keeps its own (lib/wasales/catalog-data.ts), so
 * nothing a manager types here can change what a customer is sent.
 *
 *   approved  an extra word for that car ("كورج" for the Courage)
 *   rejected  a dictionary word the insights reader must stop reading as that car
 * Newest decision per word wins; every decision is kept with who and when.
 */

import { channelDb } from "@/lib/channels/store";
import { matchTokens, type WaCar } from "@/lib/wasales/matcher";
import { MONZA_KNOWLEDGE, MODEL_CODES, modelByCode } from "@/lib/wasales/knowledge";
import { vocabularyWords } from "@/lib/wasales/intent";

export interface AliasDecision {
  alias: string;
  model: string;
  status: "approved" | "rejected";
  by_name: string | null;
  at: string;
}

const norm = (s: string) => matchTokens(s).join(" ");

/** The newest decision per (word, car). */
export function latestAliasDecisions(rows: readonly AliasDecision[]): AliasDecision[] {
  const m = new Map<string, AliasDecision>();
  for (const r of [...rows].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) m.set(`${norm(r.alias)}|${r.model}`, r);
  return [...m.values()];
}

/** The catalogue with every decision applied — for the insights reader only. Pure. */
export function withAliasDecisions(cars: readonly WaCar[], decisions: readonly AliasDecision[]): WaCar[] {
  if (decisions.length === 0) return [...cars];
  return cars.map((car) => {
    const model = MONZA_KNOWLEDGE.models.find((m) => m.catalogueId === car.id);
    if (!model) return car;
    const mine = decisions.filter((d) => d.model === model.code);
    const rejected = new Set(mine.filter((d) => d.status === "rejected").map((d) => norm(d.alias)));
    const added = mine.filter((d) => d.status === "approved").map((d) => d.alias);
    return { ...car, aliases: [...car.aliases.filter((a) => !rejected.has(norm(a))), ...added.filter((a) => !car.aliases.some((x) => norm(x) === norm(a)))] };
  });
}

/** Why a word cannot be approved, or null. Ordinary question words never become a car. */
export function aliasProblem(alias: string, model: string): string | null {
  if (!(MODEL_CODES as readonly string[]).includes(model)) return "Unknown car.";
  const n = norm(alias);
  if (!n || n.length < 2 || alias.length > 40 || /[<>{}]/.test(alias)) return "Type a word of 2 to 40 letters.";
  if (vocabularyWords().single.has(n)) return `“${alias}” is a question word the reader already uses (price, range…) — it cannot name a car.`;
  if (!modelByCode(MONZA_KNOWLEDGE, model as never)) return "Unknown car.";
  return null;
}

let cache: { at: number; decisions: AliasDecision[] } | null = null;

/** Every decision, newest per word (cached a few minutes for the webhook). Empty when unreadable. */
export async function readAliasDecisions(fresh = false): Promise<AliasDecision[]> {
  if (!fresh && cache && Date.now() - cache.at < 5 * 60_000) return cache.decisions;
  const sb = channelDb();
  if (!sb) return [];
  const { data, error } = await sb.from("insight_aliases").select("alias, model, status, by_name, at").order("at", { ascending: true }).limit(5000);
  if (error) return cache?.decisions ?? [];
  const decisions = latestAliasDecisions((data ?? []) as AliasDecision[]);
  cache = { at: Date.now(), decisions };
  return decisions;
}

export function forgetAliasCache(): void {
  cache = null;
}
