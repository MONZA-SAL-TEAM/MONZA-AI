/**
 * The stored demand record as a table — PURE. Months across, one line per car / colour / question…, people
 * per month. Rows from different brands or channels are added together: a person who wrote on two
 * channels in the same month counts once on each (said on the page).
 */

import type { StoredDemand } from "@/lib/insights/demand-server";
import { carName, valueLabel } from "@/lib/insights/facts";
import { topicLabel } from "@/lib/wasales/signal";

export interface DemandLine {
  key: string;
  label: string;
  values: number[];
  messages: number[];
}

const LANGUAGE: Readonly<Record<string, string>> = { en: "English", ar: "Arabic", arabizi: "Arabizi", fr: "French", mixed: "Mixed", unknown: "Unknown" };
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function demandLabel(dimension: string, model: string, value: string): string {
  const car = model ? carName(model) : "";
  switch (dimension) {
    case "activity": return "People who wrote";
    case "car_named": case "car_context": case "car_interest": case "ad_car": return carName(value);
    case "topic": return topicLabel(value);
    case "language": return LANGUAGE[value] ?? value;
    case "colour_wanted": case "colour_interior": case "colour_rejected": case "colour_alternative":
      return `${capital(value)}${car ? ` · ${car}` : " · no car"}`;
    case "colour_question": return car ? `Which colours? · ${car}` : "Which colours? · no car";
    case "competitor": {
      const [brand, stance] = value.split(":");
      return `${valueLabel("competitor", brand)}${stance ? ` (${stance.replace("_", " ")})` : ""}`;
    }
    case "mention": return `${car} · ${value}`;
    case "category": return ({ suv: "SUV", mpv: "MPV / van", sedan: "Sedan", off_road: "Off-road", bev: "Fully electric", erev: "Range extender", phev: "Plug-in hybrid", hybrid: "Hybrid" } as Record<string, string>)[value] ?? value;
    default: return valueLabel(dimension, value);
  }
}

export function demandTable(rows: readonly StoredDemand[], dimension: string, filter: { brand?: string | null; channel?: string | null } = {}): { months: string[]; lines: DemandLine[] } {
  const its = rows.filter((r) => r.dimension === dimension && (!filter.brand || r.brand === filter.brand) && (!filter.channel || r.channel === filter.channel));
  const months = [...new Set(rows.filter((r) => r.period === "month").map((r) => r.day))].sort();
  const at = new Map(months.map((m, i) => [m, i]));
  const lines = new Map<string, DemandLine>();
  for (const r of its) {
    const i = at.get(r.day);
    if (i === undefined) continue;
    const key = `${r.model}|${r.value}`;
    const line = lines.get(key) ?? lines.set(key, { key, label: demandLabel(dimension, r.model, r.value), values: months.map(() => 0), messages: months.map(() => 0) }).get(key)!;
    line.values[i] += r.people;
    line.messages[i] += r.messages;
  }
  return { months, lines: [...lines.values()].sort((a, b) => b.values.reduce((x, y) => x + y, 0) - a.values.reduce((x, y) => x + y, 0) || a.label.localeCompare(b.label)) };
}
