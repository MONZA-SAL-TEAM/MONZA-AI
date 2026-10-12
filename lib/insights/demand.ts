/**
 * The demand record with NO client data — PURE (Samer, 2026-10-12: "I want the data about the models,
 * colours and more to be saved and stored, not client data"). Labels in, anonymous daily counts out:
 * per Beirut day × brand × channel × what was asked, how many people and how many messages. A person is
 * used only to count them once per day and is dropped; no row carries anything that points to a customer.
 * Stored by lib/insights/demand-server.ts in insight_demand_daily (027). Tested in tests/insights-demand.test.ts.
 */

import type { ObservationRow, SignalRow } from "@/lib/insights/insights";
import { beirutTime } from "@/lib/wasales/booking";

export interface DemandRow {
  /** "day": a Beirut day; "month": a calendar month, `day` its first day. People are distinct within it. */
  period: "day" | "month";
  day: string;
  brand: string;
  channel: string;
  dimension: string;
  model: string;
  value: string;
  people: number;
  messages: number;
}

/** The Beirut calendar day of an instant, "YYYY-MM-DD". */
export function beirutDay(iso: string): string {
  const w = beirutTime(Date.parse(iso));
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

/** What each dimension means — shown on the page beside the numbers. */
export const DIMENSIONS: Readonly<Record<string, string>> = {
  activity: "People who wrote",
  car_named: "Named the car in their own words",
  car_context: "Asked about the car by context (its ad, the car being discussed) in a message that did not name it",
  car_interest: "Named it or asked about it by context",
  ad_car: "Wrote from this car's ad",
  topic: "Asked about this topic",
  language: "Wrote in this language",
  colour_wanted: "Wanted or asked about this exterior colour, for this car",
  colour_interior: "Interior colour, for this car",
  colour_rejected: "Said they do not want this colour",
  colour_alternative: "Would accept this colour as a second choice",
  colour_question: "Asked which colours exist",
  category: "Asked for this kind of car",
  budget: "Stated this budget band",
  timeline: "Said they would buy",
  city: "Said they live here",
  competitor: "Mentioned this other brand",
  concern: "Raised this concern",
  need: "Asked for this",
  purpose: "Said the car is for",
  financing: "Said about paying",
  trade_in: "Trade-in",
  mention: "Named the car with this word",
};

const OBS_DIMENSION: Readonly<Record<string, string>> = {
  category: "category",
  budget: "budget",
  timeline: "timeline",
  city: "city",
  competitor: "competitor",
  concern: "concern",
  need: "need",
  purpose: "purpose",
  financing: "financing",
  trade_in: "trade_in",
  mention: "mention",
};

/**
 * Daily anonymous counts. Only days in `days` (when given) are produced, so a day can be rewritten whole.
 * `personOf` only de-duplicates: the result holds no person.
 */
export function demandRows(signals: readonly SignalRow[], observations: readonly ObservationRow[], personOf: (conv: string) => string, days?: ReadonlySet<string>, period: "day" | "month" = "day"): DemandRow[] {
  const bucket = (iso: string) => (period === "month" ? `${beirutDay(iso).slice(0, 7)}-01` : beirutDay(iso));
  const acc = new Map<string, { people: Set<string>; messages: Set<string> }>();
  const add = (day: string, brand: string, channel: string, dimension: string, model: string, value: string, who: string, message: string) => {
    if (days && !days.has(day)) return;
    if (!/^[A-Za-z0-9_:]{1,60}$/.test(value) || !["voyah", "mhero", "monza"].includes(brand) || !["whatsapp", "instagram", "facebook"].includes(channel)) return;
    const k = `${day}|${brand}|${channel}|${dimension}|${model}|${value}`;
    const a = acc.get(k) ?? acc.set(k, { people: new Set(), messages: new Set() }).get(k)!;
    a.people.add(who);
    a.messages.add(message);
  };

  const convMeta = new Map<string, { brand: string; channel: string }>();
  for (const s of signals) {
    convMeta.set(s.conversation_id, { brand: s.brand, channel: s.channel });
    const day = bucket(s.at);
    const who = personOf(s.conversation_id);
    const msg = `${s.conversation_id}|${s.at}`;
    const put = (dimension: string, model: string, value: string) => add(day, s.brand, s.channel, dimension, model, value, who, msg);
    put("activity", "", "wrote");
    const named = [...new Set(s.models)];
    const context = [...new Set((s.context_models ?? []).filter((m) => !named.includes(m)))];
    for (const m of named) put("car_named", m, m);
    for (const m of context) put("car_context", m, m);
    for (const m of new Set([...named, ...context])) put("car_interest", m, m);
    if (s.ad_model) put("ad_car", s.ad_model, s.ad_model);
    for (const t of new Set(s.intents)) if (t !== "UNKNOWN") put("topic", "", t);
    if (s.language) put("language", "", s.language);
  }

  for (const o of observations) {
    const meta = convMeta.get(o.conversation_id);
    if (!meta) continue;
    const day = bucket(o.at);
    const who = personOf(o.conversation_id);
    const msg = `${o.conversation_id}|${o.external_message_id ?? o.at}`;
    const put = (dimension: string, model: string, value: string) => add(day, meta.brand, meta.channel, dimension, model, value, who, msg);
    if (o.kind === "colour") {
      if (o.value === "which") put("colour_question", o.model ?? "", "which");
      else if (o.value === "any") continue;
      else if (o.stance === "rejects") put("colour_rejected", o.model ?? "", o.value);
      else if (o.stance === "alternative") put("colour_alternative", o.model ?? "", o.value);
      else if (o.part === "interior") put("colour_interior", o.model ?? "", o.value);
      else put("colour_wanted", o.model ?? "", o.value);
      continue;
    }
    const dim = OBS_DIMENSION[o.kind];
    if (!dim) continue;
    if (o.kind === "competitor" && o.stance) put(dim, "", `${o.value}:${o.stance}`);
    else put(dim, o.kind === "mention" ? (o.model ?? "") : "", o.value);
  }

  return [...acc.entries()].map(([k, a]) => {
    const [day, brand, channel, dimension, model, value] = k.split("|");
    return { period, day, brand, channel, dimension, model, value, people: a.people.size, messages: a.messages.size };
  });
}
