/**
 * Which car each conversation is about — PURE (Samer, 2026-10-20: "when I click on VOYAH, show me a filter to
 * choose which car to show the messages of, so I can upsell for a car I want").
 *
 * From the insights labels (sales_signals, one row per customer message, never the words): a conversation is
 * "about" a car when the customer NAMED it, asked about it BY CONTEXT (the ad's car, the car being discussed),
 * or came from its AD. Each is kept apart so the inbox can say which; the filter itself takes any of the three.
 */

export interface CarSignalRow {
  conversation_id: string;
  models: readonly string[] | null;
  context_models: readonly string[] | null;
  ad_model: string | null;
}

export interface ConversationCars {
  /** Named in their own words. */
  named: string[];
  /** Asked about by context only. */
  context: string[];
  /** The ad that brought them. */
  ad: string | null;
}

export function carsOfSignals(rows: readonly CarSignalRow[]): Map<string, ConversationCars> {
  const out = new Map<string, ConversationCars>();
  for (const r of rows) {
    const c = out.get(r.conversation_id) ?? { named: [], context: [], ad: null };
    for (const m of r.models ?? []) if (!c.named.includes(m)) c.named.push(m);
    for (const m of r.context_models ?? []) if (!c.context.includes(m) && !c.named.includes(m)) c.context.push(m);
    if (r.ad_model && !c.ad) c.ad = r.ad_model;
    out.set(r.conversation_id, c);
  }
  // A car named later is no longer "by context only".
  for (const c of out.values()) c.context = c.context.filter((m) => !c.named.includes(m));
  return out;
}

/** The one list the inbox filters on: named, by context, or from the ad — any of them. */
export function anyCar(c: ConversationCars): string[] {
  return [...new Set([...c.named, ...c.context, ...(c.ad ? [c.ad] : [])])];
}

export interface CarChoice {
  code: string;
  label: string;
  brand: "voyah" | "mhero";
}

/** The cars offered under a brand tab: the brand's own; Monza and "All" sell both marques. */
export function carsForBrand(cars: readonly CarChoice[], brand: string): CarChoice[] {
  return brand === "voyah" || brand === "mhero" ? cars.filter((c) => c.brand === brand) : [...cars];
}
