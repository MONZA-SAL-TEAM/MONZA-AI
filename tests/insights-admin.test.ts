/**
 * The "not built yet" list (2026-10-12): approved / rejected car words (insights reader only), the two new
 * studies, lost reasons, market trends with cost per lead from real spend, and the Excel export.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { aliasProblem, latestAliasDecisions, withAliasDecisions, type AliasDecision } from "@/lib/insights/aliases-server";
import { brochureThenQuietOf, colourSwitchedOf } from "@/lib/insights/people";
import { isLostReason } from "@/lib/insights/outcomes";
import { marketTrends } from "@/lib/insights/trends";
import { xlsxBytes } from "@/lib/insights/xlsx";
import { labTable } from "@/lib/insights/lab";
import { matchesQuery, parseInsightQuery } from "@/lib/insights/query";
import { loadCatalog } from "@/lib/wasales/catalog";
import { readConversation, type Turn } from "@/lib/wasales/reader";
import { MONZA_KNOWLEDGE } from "@/lib/wasales/knowledge";
import { liveMedia } from "@/tests/_live-library";
import type { ObservationRow, SignalRow } from "@/lib/insights/insights";
import type { PersonFacts } from "@/lib/insights/people";

const NOW = Date.parse("2026-10-12T12:00:00Z");
const person = (key: string, p: Partial<PersonFacts> = {}): PersonFacts => ({
  key, leadId: null, conversationIds: [key], channels: ["whatsapp"], brands: ["voyah"], firstAt: "2026-10-01T09:00:00Z", lastAt: "2026-10-10T09:00:00Z",
  messages: 3, activeDays: 1, stage: "asking", language: "en", topics: [], models: [], primaryModel: null, comparedModels: [], rejectedModels: [],
  coloursWanted: [], coloursRejected: [], interior: [], budgetBand: null, budgetMin: null, budgetMax: null, budgetCurrency: null, timeline: null, city: null,
  purpose: [], competitors: [], concerns: [], needs: [], financing: [], tradeIn: false, firstTouch: null, ownerId: null, waiting: false,
  adModel: null, contextModels: [], categories: [], unresolved: [], mentions: [], colourAlternatives: [], testDrivesBooked: 0, customerType: "new",
  lostReason: null, colourSwitched: false, brochureThenQuiet: false, ...p,
});
const decision = (p: Partial<AliasDecision>): AliasDecision => ({ alias: "kourage", model: "COURAGE", status: "approved", by_name: "Rami", at: "2026-10-12T09:00:00Z", ...p });

describe("car words approved by a manager (insights reader only)", () => {
  test("an approved word is read as the car; a rejected dictionary word stops counting", () => {
    const deps = (cars = loadCatalog()) => ({ knowledge: MONZA_KNOWLEDGE, catalog: cars, media: liveMedia, ttlHours: 72 });
    const read = (text: string, cars = loadCatalog()) => {
      const turns: Turn[] = [{ author: "customer", text, hasMedia: false, at: "2026-10-12T09:00:00Z", externalMessageId: "m1" }];
      return readConversation(turns, { accountId: "wa-monza", brand: "monza", channel: "whatsapp", conversationId: "c" }, deps(cars)).results[0]?.signal.models ?? [];
    };
    assert.deepEqual(read("kourage price?"), [], "unknown word before approval");
    assert.deepEqual(read("kourage price?", withAliasDecisions(loadCatalog(), [decision({})])), ["COURAGE"]);
    assert.deepEqual(read("curage price?", withAliasDecisions(loadCatalog(), [decision({ alias: "curage", status: "rejected" })])).includes("COURAGE"), false);
  });
  test("the newest decision wins; question words can never become a car", () => {
    const latest = latestAliasDecisions([decision({ at: "2026-10-10T00:00:00Z" }), decision({ status: "rejected", at: "2026-10-11T00:00:00Z" })]);
    assert.deepEqual(latest.map((d) => d.status), ["rejected"]);
    assert.match(aliasProblem("price", "COURAGE") ?? "", /question word/);
    assert.equal(aliasProblem("kourage", "NOPE"), "Unknown car.");
    assert.equal(aliasProblem("kourage", "COURAGE"), null);
  });
});

describe("the two studies", () => {
  const colour = (value: string, at: string, p: Partial<ObservationRow> = {}): ObservationRow => ({ conversation_id: "c", at, kind: "colour", stance: "wants", model: "COURAGE", binding: "same_clause", part: "exterior", value, detail: null, ...p });
  test("changed their colour: wished one, then another, for the same car", () => {
    assert.equal(colourSwitchedOf([colour("black", "2026-10-01T00:00:00Z"), colour("white", "2026-10-05T00:00:00Z")]), true);
    assert.equal(colourSwitchedOf([colour("black", "2026-10-01T00:00:00Z"), colour("black", "2026-10-05T00:00:00Z")]), false);
    assert.equal(colourSwitchedOf([colour("black", "2026-10-01T00:00:00Z"), colour("white", "2026-10-05T00:00:00Z", { stance: "asked" })]), false, "asking is not wishing");
  });
  test("got a brochure, then went quiet for 3+ days", () => {
    assert.equal(brochureThenQuietOf(["2026-10-05T00:00:00Z"], "2026-10-04T00:00:00Z", NOW), true);
    assert.equal(brochureThenQuietOf(["2026-10-05T00:00:00Z"], "2026-10-06T00:00:00Z", NOW), false, "they wrote after it");
    assert.equal(brochureThenQuietOf(["2026-10-11T00:00:00Z"], "2026-10-04T00:00:00Z", NOW), false, "not 3 days yet");
    assert.equal(brochureThenQuietOf([], "2026-10-04T00:00:00Z", NOW), false);
  });
  test("the Lab asks them, and lost reasons", () => {
    const q = parseInsightQuery(new URLSearchParams("brochureThenQuiet=1&topic=PRICE&lostReason=price_too_high"));
    assert.equal(matchesQuery(person("a", { brochureThenQuiet: true, topics: ["PRICE"], lostReason: "price_too_high" }), q, NOW), true);
    assert.equal(matchesQuery(person("b", { brochureThenQuiet: true, topics: ["PRICE"] }), q, NOW), false);
    assert.equal(isLostReason("price_too_high"), true);
    assert.equal(isLostReason("cleared"), true);
    assert.equal(isLostReason("they hated us"), false);
  });
});

describe("market trends and cost per lead", () => {
  const sig = (conv: string, at: string, models: string[] = [], intents: string[] = []): SignalRow => ({ account_id: "wa-monza", brand: "voyah", channel: "whatsapp", conversation_id: conv, at, language: "en", intents, models, weak_models: [], colour: null, has_media: false, alert_kind: null, alert_tags: [], offered: [], silenced: [] });
  const people = [person("a", { firstTouch: "ad_click", models: ["COURAGE"], topics: ["PRICE"] }), person("b", { firstTouch: "ad_click" }), person("c", { firstTouch: "direct", firstAt: "2026-09-02T00:00:00Z" })];
  const t = marketTrends({
    people,
    signals: [sig("a", "2026-10-01T09:00:00Z", ["COURAGE"], ["PRICE"]), sig("b", "2026-10-02T09:00:00Z"), sig("c", "2026-09-02T09:00:00Z", ["DREAM"])],
    observations: [],
    personOf: (c) => c,
    firstEver: new Map(people.map((p) => [p.key, p.firstAt])),
    spend: [{ month: "2026-10-01", brand: "voyah", channel: "all", amount: 300 }],
    outcomeOf: (p) => (p.key === "a" ? "won" : null),
    nowMs: NOW,
  });
  test("new leads per month and demand per car", () => {
    assert.equal(t.months.at(-1), "2026-10-01");
    assert.equal(t.newLeads.at(-1), 2);
    assert.equal(t.newLeads.at(-2), 1);
    assert.equal(t.demand.find((d) => d.code === "COURAGE")?.series.at(-1), 1);
  });
  test("cost per lead from real spend: $300 over 2 ad leads, 1 qualified, 1 sale", () => {
    assert.deepEqual([t.spend[0].adLeads, t.spend[0].costPerLead, t.spend[0].costPerQualified, t.spend[0].costPerSale], [2, 150, 300, 300]);
  });
  test("a zero baseline is 'new', never an infinite percentage", () => {
    const g = t.growth30.find((x) => x.key === "COURAGE");
    assert.equal(g?.change, null);
  });
});

describe("the Excel file", () => {
  test("a real .xlsx (zip) with the header and a defused formula cell", () => {
    const table = labTable([{ ...person("a", { models: ["COURAGE"] }), name: "=HYPERLINK(1)", phone: "96171222333" }]);
    const bytes = xlsxBytes("Research Lab", table.header, table.rows);
    assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04], "zip signature");
    const text = new TextDecoder().decode(bytes);
    assert.match(text, /xl\/worksheets\/sheet1\.xml/);
    assert.match(text, /t="inlineStr"[^>]*><is><t xml:space="preserve">=HYPERLINK\(1\)<\/t>/, "a formula-looking name is stored as text");
    assert.doesNotMatch(text, /<f>/, "no formula cell at all");
    const dir = join(tmpdir(), "monza-ai-xlsx-test");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "lab.xlsx"), bytes);
  });
});

describe("joining and separating people", () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  test("a join is human_confirmed and recorded; a split gets its own lead with no phone (the webhook cannot re-attach it)", () => {
    const s = src("lib/leads/identity-server.ts");
    assert.match(s, /method: "human_confirmed"/);
    assert.match(s, /from\("insight_identity_events"\)\.insert\(\{ action: "merge"/);
    assert.match(s, /from\("insight_identity_events"\)\.insert\(\{ action: "split"/);
    assert.equal((s.match(/phone: null \}\)\.select\("id"\)/g) ?? []).length, 2, "both new leads are made with no phone");
    assert.doesNotMatch(s, /name_similar/);
  });
  test("only a manager or the owner may join, separate, approve words or enter spend", () => {
    for (const p of ["app/api/insights/identity/route.ts", "app/api/insights/aliases/route.ts", "app/api/insights/spend/route.ts"]) assert.match(src(p), /canManage\(/, p);
  });
});
