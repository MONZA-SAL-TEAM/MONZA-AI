/**
 * The Decision Center (lib/insights/decisions.ts): fixed rules, one item per chat, stock rules only when the
 * CRM was read, data-health items, the five morning numbers and the four levels of demand — never a price.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { demandLevels, describe as describeItem, findDecisions, morningNumbers, RULES, type DecisionInput } from "@/lib/insights/decisions";
import type { PersonFacts } from "@/lib/insights/people";

// Tuesday 13 October 2026, 15:00 in Beirut.
const NOW = Date.parse("2026-10-13T12:00:00Z");
const person = (key: string, p: Partial<PersonFacts> = {}): PersonFacts => ({
  key, leadId: null, conversationIds: [key], channels: ["whatsapp"], brands: ["voyah"], firstAt: "2026-10-01T09:00:00Z", lastAt: "2026-10-13T07:00:00Z",
  messages: 3, activeDays: 1, stage: "asking", language: "en", topics: [], models: [], primaryModel: null, comparedModels: [], rejectedModels: [],
  coloursWanted: [], coloursRejected: [], interior: [], budgetBand: null, budgetMin: null, budgetMax: null, budgetCurrency: null, timeline: null, city: null,
  purpose: [], competitors: [], concerns: [], needs: [], financing: [], tradeIn: false, firstTouch: null, ownerId: null, waiting: false,
  adModel: null, contextModels: [], categories: [], unresolved: [], mentions: [], colourAlternatives: [], testDrivesBooked: 0, customerType: "new", lostReason: null, colourSwitched: false, brochureThenQuiet: false, ...p,
});
const buyer = { models: ["COURAGE"], topics: ["PRICE"], stage: "pricing" as const };
const PEOPLE = [
  person("p1", buyer),
  person("p2", { topics: ["GREETING"] }),
  person("p3", buyer),
  person("p4", { contextModels: ["DREAM"], topics: ["TEST_DRIVE"] }),
  person("p5", { contextModels: ["DREAM"], topics: ["TEST_DRIVE"] }),
  person("p6", { topics: ["GENERAL_INFO"] }),
  person("p7", { ...buyer, coloursWanted: ["COURAGE:white"], ownerId: "s1" }),
  person("p8", { ...buyer, coloursWanted: ["COURAGE:white"], adModel: "COURAGE", testDrivesBooked: 1 }),
];
const conv = (id: string, lastInboundAt: string | null, lastMessageAt: string | null) => ({ id, lastInboundAt, lastMessageAt, ownerId: null });
const BASE: DecisionInput = {
  nowMs: NOW,
  people: PEOPLE,
  conversations: [
    conv("p1", "2026-10-13T07:00:00Z", "2026-10-13T07:00:00Z"), // a buyer, waiting 5 business hours
    conv("p2", "2026-10-13T07:00:00Z", "2026-10-13T07:00:00Z"), // only said hello
    conv("p3", "2026-10-13T07:00:00Z", "2026-10-13T08:00:00Z"), // a person answered
    conv("p4", "2026-10-12T05:00:00Z", "2026-10-12T06:00:00Z"),
    conv("p5", "2026-10-12T05:00:00Z", "2026-10-12T06:00:00Z"),
    conv("p6", "2026-10-11T05:00:00Z", "2026-10-11T08:00:00Z"),
  ],
  personOf: (c) => c,
  openAlerts: [
    { conversation_ref: "p1", kind: "TEST_DRIVE", created_at: "2026-10-11T08:00:00Z" },
    { conversation_ref: "p4", kind: "TEST_DRIVE", created_at: "2026-10-12T06:00:00Z" },
    { conversation_ref: "p5", kind: "TEST_DRIVE", created_at: "2026-10-12T06:00:00Z" },
    { conversation_ref: "p6", kind: "NEEDS_PERSON", created_at: "2026-10-11T06:00:00Z" },
  ],
  bookedConvs: new Set(["p5"]),
  stock: { COURAGE: { now: 0, inbound: 1, reserved: 1, subDealer: 0, colours: [] }, FREE_318: { now: 5, inbound: 0, reserved: 0, subDealer: 0, colours: [{ key: "white", n: 5 }] } },
  health: { rereadPending: false, instagramAccounts: 3, instagramSignals7d: 0, demandLastStored: "2026-10-13T02:00:00Z", withMobile: 100, crmMatched: 1 },
};
const run = findDecisions(BASE);
const hit = (rule: string, subject?: string) => run.hits.find((h) => h.rule === rule && (!subject || h.subject === subject));

describe("customers waiting", () => {
  test("a qualified buyer who wrote last and waited past 2 business hours — the most urgent rule wins per chat", () => {
    const h = hit("buyer_waiting", "p1")!;
    assert.equal(h.severity, "high");
    assert.equal(h.facts.businessMinutesWaiting, 300);
    assert.equal(run.hits.filter((x) => x.subject === "p1").length, 1, "the old test-drive alert on the same chat is not a second item");
    assert.equal(hit("buyer_waiting", "p2"), undefined, "a hello is not a buyer");
    assert.equal(hit("buyer_waiting", "p3"), undefined, "a person answered");
  });
  test("a test drive asked for with no booking; a booked one is only an alert to close", () => {
    assert.ok(hit("test_drive_unbooked", "p4"));
    assert.equal(hit("test_drive_unbooked", "p5"), undefined);
    assert.equal(hit("alert_overdue", "p5")?.facts.kind, "TEST_DRIVE");
  });
  test("an alert a person already answered says so, at normal severity", () => {
    const h = hit("alert_overdue", "p6")!;
    assert.equal(h.facts.answered, true);
    assert.equal(h.severity, "normal");
    assert.match(describeItem("alert_overdue", h.facts, null), /close it/);
  });
  test("qualified people with no salesperson are one item with a count", () => {
    assert.equal(hit("unowned_qualified")?.facts.people, 5);
  });
});

describe("stock and demand", () => {
  test("more buyers than cars, a wanted colour not in stock, cars nobody asked about", () => {
    assert.deepEqual(hit("demand_over_stock", "COURAGE")?.facts, { intent: 4, inStock: 0, inbound: 1, reserved: 1 });
    assert.ok(hit("colour_unavailable", "COURAGE:white"));
    assert.ok(hit("stock_without_demand", "FREE_318"));
  });
  test("an unreadable CRM checks no stock rule, so no stock item can clear itself", () => {
    const r = findDecisions({ ...BASE, stock: null });
    assert.equal(r.hits.some((h) => RULES[h.rule].group === "stock"), false);
    assert.equal(r.evaluated.includes("demand_over_stock"), false);
    assert.equal(run.evaluated.includes("demand_over_stock"), true);
  });
});

describe("can the numbers be trusted", () => {
  test("Instagram silent and the CRM unlinkable are items; a stored demand record is not", () => {
    assert.ok(hit("data_instagram_silent"));
    assert.ok(hit("data_crm_unlinked"));
    assert.equal(hit("data_demand_not_stored"), undefined);
    assert.equal(hit("data_reread"), undefined);
  });
  test("a pending re-read is critical, and the demand record is not nagged about meanwhile", () => {
    const r = findDecisions({ ...BASE, health: { ...BASE.health, rereadPending: true, demandLastStored: null } });
    assert.equal(r.hits.find((h) => h.rule === "data_reread")?.severity, "critical");
    assert.equal(r.hits.some((h) => h.rule === "data_demand_not_stored"), false);
  });
});

describe("the morning numbers and the four levels", () => {
  test("conversion is unknown — never zero — when no chat links to a CRM sale", () => {
    const m = morningNumbers({ nowMs: NOW, people: PEOPLE, hits: run.hits, stock: BASE.stock, outcomeOf: () => null });
    assert.equal(m.conversionKnown, false);
    assert.ok(m.conversion.every((c) => c.won === null));
    assert.equal(m.demandVsStock.find((d) => d.code === "COURAGE")?.inStock, 0);
    assert.ok(m.overdue >= 3);
  });
  test("exposure, named, context, intent and committed are counted apart", () => {
    const l = demandLevels({ people: PEOPLE, stock: BASE.stock, sales: null, orderedModels: null }).find((x) => x.code === "COURAGE")!;
    assert.deepEqual([l.exposure, l.named, l.context, l.intent, l.committed], [1, 4, 0, 4, 1]);
    assert.equal(l.sales, null, "sales unread: unknown");
    const dream = demandLevels({ people: PEOPLE, stock: null, sales: null, orderedModels: null }).find((x) => x.code === "DREAM")!;
    assert.deepEqual([dream.named, dream.context, dream.intent, dream.stock], [0, 2, 2, null]);
  });
});

describe("what is stored", () => {
  test("decision items hold no words, no price, and go with the person", () => {
    const sql = readFileSync(join(process.cwd(), "database/migrations/028_decisions_activity.sql"), "utf8");
    assert.match(sql, /conversation_id uuid references public\.channel_conversations\(id\) on delete cascade/);
    assert.doesNotMatch(sql, /price|amount|body|text_/i);
    assert.equal((sql.match(/enable row level security/g) ?? []).length, 3);
    assert.doesNotMatch(sql, /create policy/i);
    for (const h of run.hits) for (const v of Object.values(h.facts)) assert.ok(v === null || ["number", "boolean"].includes(typeof v) || /^[A-Za-z_0-9:\-.TZ]+$/.test(String(v)), `a fact is a label: ${v}`);
  });
});
