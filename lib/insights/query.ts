/**
 * The Research Lab's question, as a URL — PURE. Every count on every Insights page links to
 * /insights/lab?<this>, which opens exactly the people it counted. Closed vocabulary only: anything that
 * is not a known shape is dropped, never passed to the database.
 */

import type { PersonFacts } from "@/lib/insights/people";

export interface InsightQuery {
  model?: string;
  /** And ALSO named this car (cross-shopping). */
  alsoModel?: string;
  /** A colour family, wanted or asked ("black"); with `model`, on that car. */
  colour?: string;
  rejectedColour?: string;
  interior?: string;
  rejectedModel?: string;
  comparedModel?: string;
  topic?: string;
  stage?: string;
  budget?: string;
  timeline?: string;
  city?: string;
  purpose?: string;
  competitor?: string;
  concern?: string;
  need?: string;
  financing?: string;
  channel?: string;
  brand?: string;
  language?: string;
  firstTouch?: string;
  tradeIn?: boolean;
  waiting?: boolean;
  /** "none" = unowned, else a staff id. */
  owner?: string;
  /** Last message within this many days; 0 = any time. */
  days?: number;
}

const KEY = /^[a-z0-9_]{1,40}$/;
const CODE = /^[A-Z0-9_]{1,20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FIELDS: ReadonlyArray<[keyof InsightQuery, RegExp]> = [
  ["model", CODE],
  ["alsoModel", CODE],
  ["colour", KEY],
  ["rejectedColour", KEY],
  ["interior", KEY],
  ["rejectedModel", CODE],
  ["comparedModel", CODE],
  ["topic", CODE],
  ["stage", KEY],
  ["budget", KEY],
  ["timeline", KEY],
  ["city", KEY],
  ["purpose", KEY],
  ["competitor", KEY],
  ["concern", KEY],
  ["need", KEY],
  ["financing", KEY],
  ["channel", KEY],
  ["brand", KEY],
  ["language", KEY],
  ["firstTouch", KEY],
];

export function parseInsightQuery(sp: URLSearchParams | Record<string, string | string[] | undefined>): InsightQuery {
  const get = (k: string): string | null => {
    if (sp instanceof URLSearchParams) return sp.get(k);
    const v = sp[k];
    return typeof v === "string" ? v : null;
  };
  const q: InsightQuery = {};
  for (const [field, re] of FIELDS) {
    const v = get(field);
    if (v && re.test(v)) (q as Record<string, unknown>)[field] = v;
  }
  if (get("tradeIn") === "1") q.tradeIn = true;
  if (get("waiting") === "1") q.waiting = true;
  const owner = get("owner");
  if (owner && (owner === "none" || UUID.test(owner))) q.owner = owner;
  const days = Number(get("days"));
  if ([7, 30, 90, 365].includes(days)) q.days = days;
  return q;
}

export function toSearch(q: InsightQuery): string {
  const p = new URLSearchParams();
  for (const [field] of FIELDS) {
    const v = q[field];
    if (typeof v === "string") p.set(field, v);
  }
  if (q.tradeIn) p.set("tradeIn", "1");
  if (q.waiting) p.set("waiting", "1");
  if (q.owner) p.set("owner", q.owner);
  if (q.days) p.set("days", String(q.days));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const labHref = (q: InsightQuery) => `/insights/lab${toSearch(q)}`;

/** Does this person answer the question? (Also what the database filter does, for tests and fallbacks.) */
export function matchesQuery(p: PersonFacts, q: InsightQuery, nowMs: number): boolean {
  const colourOn = (list: readonly string[], fam: string) => list.some((c) => c.endsWith(`:${fam}`) && (!q.model || c.startsWith(`${q.model}:`)));
  if (q.model && !p.models.includes(q.model)) return false;
  if (q.alsoModel && !p.models.includes(q.alsoModel)) return false;
  if (q.colour && !colourOn(p.coloursWanted, q.colour)) return false;
  if (q.rejectedColour && !colourOn(p.coloursRejected, q.rejectedColour)) return false;
  if (q.interior && !colourOn(p.interior, q.interior)) return false;
  if (q.rejectedModel && !p.rejectedModels.includes(q.rejectedModel)) return false;
  if (q.comparedModel && !p.comparedModels.includes(q.comparedModel)) return false;
  if (q.topic && !p.topics.includes(q.topic)) return false;
  if (q.stage && p.stage !== q.stage) return false;
  if (q.budget && p.budgetBand !== q.budget) return false;
  if (q.timeline && p.timeline !== q.timeline) return false;
  if (q.city && p.city !== q.city) return false;
  if (q.purpose && !p.purpose.includes(q.purpose)) return false;
  if (q.competitor && !p.competitors.includes(q.competitor)) return false;
  if (q.concern && !p.concerns.includes(q.concern)) return false;
  if (q.need && !p.needs.includes(q.need)) return false;
  if (q.financing && !p.financing.includes(q.financing)) return false;
  if (q.channel && !p.channels.includes(q.channel)) return false;
  if (q.brand && !p.brands.includes(q.brand)) return false;
  if (q.language && p.language !== q.language) return false;
  if (q.firstTouch && p.firstTouch !== q.firstTouch) return false;
  if (q.tradeIn && !p.tradeIn) return false;
  if (q.waiting && !p.waiting) return false;
  if (q.owner === "none" && p.ownerId) return false;
  if (q.owner && q.owner !== "none" && p.ownerId !== q.owner) return false;
  if (q.days && nowMs - Date.parse(p.lastAt) > q.days * 86_400_000) return false;
  return true;
}
