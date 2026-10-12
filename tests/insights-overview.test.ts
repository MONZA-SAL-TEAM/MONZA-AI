/**
 * The Executive Overview (lib/insights/overview.ts): people counted once, new vs returning by the first
 * message EVER, the previous period beside every figure, CRM figures unknown when the CRM is unreadable,
 * and stock unknown — never zero — without the CRM.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { executiveOverview, KPI_DEFINITIONS } from "@/lib/insights/overview";
import type { PersonFacts } from "@/lib/insights/people";
import type { SignalRow } from "@/lib/insights/insights";

const NOW = Date.parse("2026-10-12T12:00:00Z");
const WINDOW = { sinceMs: NOW - 30 * 86_400_000, untilMs: NOW };
const person = (key: string, p: Partial<PersonFacts> = {}): PersonFacts => ({
  key, leadId: null, conversationIds: [key], channels: ["whatsapp"], brands: ["monza"], firstAt: "2026-10-01T09:00:00Z", lastAt: "2026-10-10T09:00:00Z",
  messages: 3, activeDays: 1, stage: "asking", language: "en", topics: [], models: [], primaryModel: null, comparedModels: [], rejectedModels: [],
  coloursWanted: [], coloursRejected: [], interior: [], budgetBand: null, budgetMin: null, budgetMax: null, budgetCurrency: null, timeline: null, city: null,
  purpose: [], competitors: [], concerns: [], needs: [], financing: [], tradeIn: false, firstTouch: null, ownerId: null, waiting: false,
  adModel: null, contextModels: [], categories: [], unresolved: [], mentions: [], colourAlternatives: [], testDrivesBooked: 0, customerType: "new", ...p,
});
const sig = (conv: string, at: string, intents: string[] = []): SignalRow => ({ account_id: "wa-monza", brand: "monza", channel: "whatsapp", conversation_id: conv, at, language: "en", intents, models: [], weak_models: [], colour: null, has_media: false, alert_kind: null, alert_tags: [], offered: [], silenced: [] });

const people = [
  person("a", { models: ["COURAGE"], topics: ["PRICE"], stage: "pricing", coloursWanted: ["COURAGE:black"] }),
  person("b", { contextModels: ["COURAGE"], topics: ["BUYING_INTENT"], stage: "buying" }),
  person("c", { models: ["TAISHAN"] }),
];
const base = {
  people,
  previous: [person("a", { models: ["COURAGE"] })],
  signals: [sig("a", "2026-10-02T09:00:00Z", ["PRICE"]), sig("b", "2026-10-03T09:00:00Z", ["BUYING_INTENT"]), sig("c", "2026-10-04T09:00:00Z")],
  previousSignals: [sig("a", "2026-09-05T09:00:00Z")],
  firstEver: new Map([["a", "2026-08-01T09:00:00Z"], ["b", "2026-10-03T09:00:00Z"], ["c", "2026-10-04T09:00:00Z"]]),
  overdueKeys: new Set<string>(),
  window: WINDOW,
  nowMs: NOW,
};

describe("the executive overview", () => {
  const o = executiveOverview({ ...base, outcomeOf: (p) => (p.key === "b" ? "won" : null), stock: { COURAGE: { now: 2, inbound: 0, colours: [] } } });
  const k = (key: string) => o.kpis.find((x) => x.key === key)!;
  test("people once; new is the first message EVER in the period", () => {
    assert.equal(k("people").value, 3);
    assert.equal(k("new").value, 2, "a wrote before the period");
    assert.equal(k("returning").value, 1);
    assert.equal(k("people").previous, 1);
  });
  test("interest includes context; qualified needs a qualifying question", () => {
    assert.equal(k("interested").value, 3);
    assert.equal(k("qualified").value, 2);
    assert.equal(k("buying").value, 1);
    assert.equal(k("won").value, 1);
  });
  test("demand by car: named or by context, beside the previous period and stock", () => {
    const courage = o.demand.find((d) => d.key === "COURAGE")!;
    assert.deepEqual([courage.n, courage.previous, courage.stockNow], [2, 1, 2]);
    assert.equal(o.demand.find((d) => d.key === "TAISHAN")?.stockNow, 0, "the CRM was read: no Taishan in stock is a real 0");
  });
  test("without the CRM: its figures and stock are unknown, never 0", () => {
    const x = executiveOverview({ ...base, outcomeOf: null, stock: null });
    assert.equal(x.kpis.find((y) => y.key === "won")?.value, null);
    assert.equal(x.kpis.find((y) => y.key === "quoted")?.value, null);
    assert.equal(x.demand[0].stockNow, null);
    assert.equal(x.outcomes, null);
  });
  test("every figure has a written definition", () => {
    for (const kp of o.kpis) assert.ok(KPI_DEFINITIONS[kp.key], kp.key);
  });
});
