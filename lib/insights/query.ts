/**
 * The Research Lab's question, as a URL — PURE. Every count on every Insights page links to
 * /insights/lab?<this>, which opens exactly the people it counted. Closed vocabulary only: anything that
 * is not a known shape is dropped, never passed to the database.
 *
 * Within one filter, several values mean ANY of them ("model=COURAGE,FREE_318"); different filters must
 * ALL hold. `testDriveBooked=0` means "has NOT booked one". `outcome` is what the CRM recorded (read as
 * the viewer at query time; "none" = no CRM order).
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
  /** true: has a booked test-drive slot; false: has NOT. */
  testDriveBooked?: boolean;
  /** Came from this car's ad. */
  adModel?: string;
  /** Asked for this kind of car (suv, mpv, bev…). */
  category?: string;
  customerType?: string;
  /** Asked about this car by context, or named it. */
  anyModel?: string;
  /** Named a car with this dictionary word: "MHERO_1:917". */
  mention?: string;
  /** What the CRM recorded: won, reserved, quoted, open, lost, none. */
  outcome?: string;
  /** Why a person recorded the lead as lost. */
  lostReason?: string;
  /** Wanted one colour for a car, then later another. */
  colourSwitched?: boolean;
  /** Got a brochure from us and has not written since (3+ days). */
  brochureThenQuiet?: boolean;
  /** "none" = unowned, else a staff id. */
  owner?: string;
  /** Last message within this many days; 0 = any time. */
  days?: number;
}

const KEY = /^[a-z0-9_]{1,40}$/;
const CODE = /^[A-Z0-9_]{1,20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const QUERY_FIELDS: ReadonlyArray<[keyof InsightQuery, RegExp]> = [
  ["model", CODE],
  ["alsoModel", CODE],
  ["anyModel", CODE],
  ["adModel", CODE],
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
  ["category", KEY],
  ["customerType", KEY],
  ["mention", /^[A-Z0-9_]{1,20}:[a-z0-9_]{1,40}$/],
  ["outcome", /^(won|reserved|quoted|open|lost|none)$/],
  ["lostReason", KEY],
];

/** A field's values: "a,b" → ["a","b"]; each must match, at most 12. */
function list(raw: string | null, re: RegExp): string | null {
  if (!raw) return null;
  const items = [...new Set(raw.split(",").map((s) => s.trim()).filter((s) => re.test(s)))].slice(0, 12);
  return items.length ? items.join(",") : null;
}

export function parseInsightQuery(sp: URLSearchParams | Record<string, string | string[] | undefined>): InsightQuery {
  const get = (k: string): string | null => {
    if (sp instanceof URLSearchParams) return sp.get(k);
    const v = sp[k];
    return typeof v === "string" ? v : Array.isArray(v) ? v.join(",") : null;
  };
  const q: InsightQuery = {};
  for (const [field, re] of QUERY_FIELDS) {
    const v = list(get(field), re);
    if (v) (q as Record<string, unknown>)[field] = v;
  }
  if (get("tradeIn") === "1") q.tradeIn = true;
  if (get("waiting") === "1") q.waiting = true;
  if (get("colourSwitched") === "1") q.colourSwitched = true;
  if (get("brochureThenQuiet") === "1") q.brochureThenQuiet = true;
  const booked = get("testDriveBooked");
  if (booked === "1") q.testDriveBooked = true;
  if (booked === "0") q.testDriveBooked = false;
  const owner = get("owner");
  if (owner && (owner === "none" || UUID.test(owner))) q.owner = owner;
  const days = Number(get("days"));
  if ([7, 30, 60, 90, 365].includes(days)) q.days = days;
  return q;
}

export function toSearch(q: InsightQuery): string {
  const p = new URLSearchParams();
  for (const [field] of QUERY_FIELDS) {
    const v = q[field];
    if (typeof v === "string") p.set(field, v);
  }
  if (q.tradeIn) p.set("tradeIn", "1");
  if (q.waiting) p.set("waiting", "1");
  if (q.colourSwitched) p.set("colourSwitched", "1");
  if (q.brochureThenQuiet) p.set("brochureThenQuiet", "1");
  if (q.testDriveBooked !== undefined) p.set("testDriveBooked", q.testDriveBooked ? "1" : "0");
  if (q.owner) p.set("owner", q.owner);
  if (q.days) p.set("days", String(q.days));
  const s = p.toString().replace(/%2C/g, ",").replace(/%3A/g, ":");
  return s ? `?${s}` : "";
}

export const labHref = (q: InsightQuery) => `/insights/lab${toSearch(q)}`;

/** Whether the question needs the CRM (read as the viewer) to be answered. */
export const needsCrm = (q: InsightQuery) => Boolean(q.outcome);

const any = (field: string | undefined) => (field ? field.split(",") : null);

/**
 * Does this person answer the question? (Also what the database's coarse filter is checked against.)
 * `outcomeOf` gives the CRM's furthest outcome for a person, or null when they have no order.
 */
export function matchesQuery(p: PersonFacts, q: InsightQuery, nowMs: number, outcomeOf?: (p: PersonFacts) => string | null): boolean {
  const has = (values: string[] | null, ok: (v: string) => boolean) => !values || values.some(ok);
  const models = any(q.model);
  // A colour is tied to a car: with a car in the question, only that car's colour counts.
  const colourCars = models ?? any(q.anyModel);
  const colourOn = (list: readonly string[], fam: string) => list.some((c) => c.endsWith(`:${fam}`) && (!colourCars || colourCars.some((m) => c.startsWith(`${m}:`))));
  if (!has(models, (m) => p.models.includes(m))) return false;
  if (!has(any(q.alsoModel), (m) => p.models.includes(m))) return false;
  if (!has(any(q.anyModel), (m) => p.models.includes(m) || p.contextModels.includes(m))) return false;
  if (!has(any(q.adModel), (m) => p.adModel === m)) return false;
  if (!has(any(q.colour), (f) => colourOn(p.coloursWanted, f))) return false;
  if (!has(any(q.rejectedColour), (f) => colourOn(p.coloursRejected, f))) return false;
  if (!has(any(q.interior), (f) => colourOn(p.interior, f))) return false;
  if (!has(any(q.rejectedModel), (m) => p.rejectedModels.includes(m))) return false;
  if (!has(any(q.comparedModel), (m) => p.comparedModels.includes(m))) return false;
  if (!has(any(q.topic), (t) => p.topics.includes(t))) return false;
  if (!has(any(q.stage), (s) => p.stage === s)) return false;
  if (!has(any(q.budget), (b) => p.budgetBand === b)) return false;
  if (!has(any(q.timeline), (t) => p.timeline === t)) return false;
  if (!has(any(q.city), (c) => p.city === c)) return false;
  if (!has(any(q.purpose), (x) => p.purpose.includes(x))) return false;
  if (!has(any(q.competitor), (x) => p.competitors.includes(x))) return false;
  if (!has(any(q.concern), (x) => p.concerns.includes(x))) return false;
  if (!has(any(q.need), (x) => p.needs.includes(x))) return false;
  if (!has(any(q.financing), (x) => p.financing.includes(x))) return false;
  if (!has(any(q.channel), (x) => p.channels.includes(x))) return false;
  if (!has(any(q.brand), (x) => p.brands.includes(x))) return false;
  if (!has(any(q.language), (x) => p.language === x)) return false;
  if (!has(any(q.firstTouch), (x) => (p.firstTouch ?? "direct") === x)) return false;
  if (!has(any(q.category), (x) => p.categories.includes(x))) return false;
  if (!has(any(q.customerType), (x) => p.customerType === x)) return false;
  if (!has(any(q.mention), (x) => p.mentions.includes(x))) return false;
  if (q.tradeIn && !p.tradeIn) return false;
  if (q.colourSwitched && !p.colourSwitched) return false;
  if (q.brochureThenQuiet && !p.brochureThenQuiet) return false;
  if (!has(any(q.lostReason), (x) => p.lostReason === x)) return false;
  if (q.waiting && !p.waiting) return false;
  if (q.testDriveBooked === true && !(p.testDrivesBooked > 0)) return false;
  if (q.testDriveBooked === false && p.testDrivesBooked > 0) return false;
  if (q.owner === "none" && p.ownerId) return false;
  if (q.owner && q.owner !== "none" && p.ownerId !== q.owner) return false;
  if (q.days && nowMs - Date.parse(p.lastAt) > q.days * 86_400_000) return false;
  if (q.outcome) {
    if (!outcomeOf) return false; // a question about sales with no CRM answer matches nobody — never everybody
    const o = outcomeOf(p) ?? "none";
    if (!q.outcome.split(",").includes(o)) return false;
  }
  return true;
}
