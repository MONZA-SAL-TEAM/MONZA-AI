/**
 * THE CLIENTS, COUNTED — for the Monza app's Morning Briefing (Samer, 2026-11-25: "I don't want to
 * know deep details of the messaging system; instead I want the overview telling me insights about
 * all the clients").
 *
 * What `brief_client_summary()` (migration 035) answers, checked field by field. Pure. Counts only:
 * this shape has no place for a name, a number, a chat id or a word, and a test asserts it.
 *
 * A figure that did not come is `null` — never 0: "nobody wrote" and "we could not count" are
 * opposite things, and somebody decides advertising spend on this.
 */

import { MONZA_KNOWLEDGE, modelByCode } from "@/lib/wasales/knowledge";
import type { ModelCode } from "@/lib/wasales/knowledge";

export interface ClientsSummary {
  at: string;
  /** People who wrote in the last 30 days, and in the 30 days before. */
  people: { now: number; before: number };
  newPeople: number;
  returning: number;
  /** People whose first touch was an ad. */
  fromAd: { now: number; before: number };
  byChannel: Record<string, number>;
  byBrand: Record<string, number>;
  cars: { code: string; label: string; people: number }[];
  questions: { topic: string; label: string; people: number }[];
  /** For the closing-rate estimate; the sales themselves are the CRM's to count. */
  people90d: number;
  buyingQuestion90d: number;
  /** WhatsApp only; null when nothing needed an answer. */
  reply: { asked: number; answered: number; medianMinutes: number | null; withinHour: number; neverAnswered: number } | null;
}

const QUESTION_LABEL: Readonly<Record<string, string>> = {
  PRICE: "Price",
  FINANCING: "Financing",
  TEST_DRIVE: "Test drive",
  AVAILABILITY: "Availability",
  BUYING_INTENT: "Wants to buy",
  TRADE_IN: "Trade-in",
  DISCOUNT: "Offers",
};

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const count = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

function pair(v: unknown): { now: number; before: number } | null {
  const o = obj(v);
  const now = count(o?.now);
  const before = count(o?.before);
  return now === null || before === null ? null : { now, before };
}

function counts(v: unknown, allowed: readonly string[]): Record<string, number> {
  const o = obj(v) ?? {};
  const out: Record<string, number> = {};
  for (const key of allowed) {
    const n = count(o[key]);
    if (n !== null && n > 0) out[key] = n;
  }
  return out;
}

/** null when the answer is not a summary — the caller reports "not available", never an empty one. */
export function parseClientsSummary(raw: unknown): ClientsSummary | null {
  const r = obj(raw);
  const people = pair(r?.people);
  const fromAd = pair(r?.fromAd);
  if (!r || typeof r.at !== "string" || !people || !fromAd) return null;

  const cars = (Array.isArray(r.cars) ? r.cars : []).flatMap((c) => {
    const row = obj(c);
    const n = count(row?.people);
    const code = typeof row?.code === "string" ? row.code : "";
    // Only a car of the workbook is named: a code we do not know is not shown under a made-up label.
    const model = modelByCode(MONZA_KNOWLEDGE, code as ModelCode);
    return model && n ? [{ code, label: model.displayName, people: n }] : [];
  });
  const questions = (Array.isArray(r.questions) ? r.questions : []).flatMap((q) => {
    const row = obj(q);
    const n = count(row?.people);
    const topic = typeof row?.topic === "string" ? row.topic : "";
    return QUESTION_LABEL[topic] && n ? [{ topic, label: QUESTION_LABEL[topic], people: n }] : [];
  });

  const rep = obj(r.reply);
  const asked = count(rep?.asked);
  const reply =
    rep && asked !== null && asked > 0
      ? {
          asked,
          answered: count(rep.answered) ?? 0,
          medianMinutes: count(rep.medianMinutes),
          withinHour: count(rep.withinHour) ?? 0,
          neverAnswered: count(rep.neverAnswered) ?? 0,
        }
      : null;

  return {
    at: r.at,
    people,
    newPeople: count(r.newPeople) ?? 0,
    returning: count(r.returning) ?? 0,
    fromAd,
    byChannel: counts(r.byChannel, ["whatsapp", "instagram", "facebook"]),
    byBrand: counts(r.byBrand, ["voyah", "mhero", "monza"]),
    cars,
    questions,
    people90d: count(r.people90d) ?? 0,
    buyingQuestion90d: count(r.buyingQuestion90d) ?? 0,
    reply,
  };
}
