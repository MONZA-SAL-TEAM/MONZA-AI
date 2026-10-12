/**
 * Customers & Leads (lib/insights/leads.ts): what people said vs what the calendar and the CRM recorded,
 * each stage defined, an unreadable CRM shown as unknown — never as zero.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { leadsView } from "@/lib/insights/leads";
import { furthestOutcome, orderOutcome } from "@/lib/insights/crm";
import type { PersonFacts } from "@/lib/insights/people";

const NOW = Date.parse("2026-10-12T12:00:00Z");
const person = (key: string, p: Partial<PersonFacts> = {}): PersonFacts => ({
  key, leadId: null, conversationIds: [key], channels: ["whatsapp"], brands: ["monza"], firstAt: "2026-10-01T09:00:00Z", lastAt: "2026-10-10T09:00:00Z",
  messages: 3, activeDays: 1, stage: "asking", language: "en", topics: [], models: [], primaryModel: null, comparedModels: [], rejectedModels: [],
  coloursWanted: [], coloursRejected: [], interior: [], budgetBand: null, budgetMin: null, budgetMax: null, budgetCurrency: null, timeline: null, city: null,
  purpose: [], competitors: [], concerns: [], needs: [], financing: [], tradeIn: false, firstTouch: null, ownerId: null, waiting: false,
  adModel: null, contextModels: [], categories: [], unresolved: [], mentions: [], colourAlternatives: [], testDrivesBooked: 0, customerType: "new", ...p,
});

const PEOPLE = [
  person("a", { topics: ["GREETING_X"] }),
  person("b", { topics: ["PRICE"], contextModels: ["COURAGE"], adModel: "COURAGE", firstTouch: "ad_click" }),
  person("c", { topics: ["TEST_DRIVE"], models: ["DREAM"], stage: "test_drive", testDrivesBooked: 1 }),
  person("d", { topics: ["BUYING_INTENT"], models: ["COURAGE"], stage: "buying", waiting: true, lastAt: "2026-10-01T09:00:00Z" }),
];
const phones: Record<string, string> = { c: "96171000001", d: "96171000002" };
const base = { people: PEOPLE, alerted: new Set(["c", "d"]), phoneOf: (p: PersonFacts) => phones[p.key] ?? null, sinceMs: 0, nowMs: NOW };

describe("the funnel", () => {
  test("each stage counts the people who meet its written definition", () => {
    const v = leadsView({ ...base, crm: { state: "ok", byPhone: { "96171000001": { outcome: "won", firstOrderAt: "2026-10-05T00:00:00Z", quoteSentAt: null, wonAt: "2026-10-08T00:00:00Z", models: ["DREAM"] } } } });
    const n = Object.fromEntries(v.stages.map((s) => [s.def.key, s.n]));
    assert.deepEqual(n, { wrote: 4, asked: 4, interest: 3, qualified: 3, handoff: 2, test_drive_asked: 1, test_drive_booked: 1, quoted: 1, reserved: 1, won: 1 });
    assert.equal(v.stages.find((s) => s.def.key === "interest")?.fromPrevious, 0.75);
    assert.equal(v.existingCustomers, 1);
    assert.equal(v.outcomeUnknown, 3, "no CRM order is unknown, not lost");
    assert.equal(v.lost, 0);
    assert.equal(v.medianDaysToOrder, 3.6);
  });
  test("a CRM that cannot be read makes its stages unknown — never 0", () => {
    const v = leadsView({ ...base, crm: { state: "unavailable" } });
    for (const k of ["quoted", "reserved", "won"]) assert.equal(v.stages.find((s) => s.def.key === k)?.n, null, k);
    assert.equal(v.existingCustomers, null);
    assert.equal(v.byModel.find((b) => b.key === "COURAGE")?.won, null);
  });
  test("ready now and neglected", () => {
    const v = leadsView({ ...base, crm: { state: "ok", byPhone: {} } });
    assert.deepEqual(v.readyNow.map((p) => p.key).sort(), ["c", "d"]);
    assert.deepEqual(v.neglected.map((p) => p.key).sort(), ["b", "c", "d"]);
  });
  test("by car counts context interest too, and by source keeps ads apart from untracked", () => {
    const v = leadsView({ ...base, crm: { state: "ok", byPhone: {} } });
    assert.equal(v.byModel.find((b) => b.key === "COURAGE")?.people, 2);
    assert.deepEqual(v.bySource.map((b) => [b.key, b.people]).sort(), [["ad_click", 1], ["direct", 3]]);
  });
});

describe("CRM outcomes", () => {
  test("an order's status, and the furthest across orders", () => {
    assert.equal(orderOutcome({ status: "delivered", quoteSentAt: null, deliveredAt: null }), "won");
    assert.equal(orderOutcome({ status: "draft", quoteSentAt: "2026-10-01", deliveredAt: null }), "quoted");
    assert.equal(orderOutcome({ status: "cancelled", quoteSentAt: "2026-10-01", deliveredAt: null }), "lost");
    assert.equal(furthestOutcome([{ status: "cancelled", quoteSentAt: null, deliveredAt: null }, { status: "paid", quoteSentAt: null, deliveredAt: null }]), "won");
    assert.equal(furthestOutcome([]), null);
  });
});
