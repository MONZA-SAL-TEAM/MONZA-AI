/**
 * Research Lab studies (lib/insights/study.ts, query.ts): ANY within a filter, ALL across filters,
 * "not booked", CRM outcomes only when the CRM answered, grouping, and saved questions kept to the
 * closed vocabulary.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { runStudy } from "@/lib/insights/study";
import { matchesQuery, parseInsightQuery, toSearch } from "@/lib/insights/query";
import { normalizeStudyQuery } from "@/lib/insights/studies";
import type { PersonFacts } from "@/lib/insights/people";

const NOW = Date.parse("2026-10-12T12:00:00Z");
const person = (key: string, p: Partial<PersonFacts> = {}): PersonFacts => ({
  key, leadId: null, conversationIds: [key], channels: ["whatsapp"], brands: ["monza"], firstAt: "2026-10-01T09:00:00Z", lastAt: "2026-10-10T09:00:00Z",
  messages: 3, activeDays: 1, stage: "asking", language: "en", topics: [], models: [], primaryModel: null, comparedModels: [], rejectedModels: [],
  coloursWanted: [], coloursRejected: [], interior: [], budgetBand: null, budgetMin: null, budgetMax: null, budgetCurrency: null, timeline: null, city: null,
  purpose: [], competitors: [], concerns: [], needs: [], financing: [], tradeIn: false, firstTouch: null, ownerId: null, waiting: false,
  adModel: null, contextModels: [], categories: [], unresolved: [], mentions: [], colourAlternatives: [], testDrivesBooked: 0, customerType: "new", lostReason: null, colourSwitched: false, brochureThenQuiet: false, ...p,
});
const BASE = [
  person("a", { models: ["COURAGE"], coloursWanted: ["COURAGE:black"], topics: ["FINANCING"] }),
  person("b", { models: ["FREE_318"], topics: ["TEST_DRIVE"] }),
  person("c", { models: ["MHERO_1"], topics: ["TEST_DRIVE"], testDrivesBooked: 1 }),
  person("d", { contextModels: ["COURAGE"], adModel: "COURAGE" }),
];
const outcome = (p: PersonFacts) => (p.key === "a" ? "won" : null);

describe("the question", () => {
  test("several values in one filter mean ANY; different filters mean ALL", () => {
    assert.deepEqual(runStudy(BASE, parseInsightQuery(new URLSearchParams("model=COURAGE,FREE_318")), NOW, null, null).matched.map((p) => p.key), ["a", "b"]);
    assert.deepEqual(runStudy(BASE, parseInsightQuery(new URLSearchParams("model=COURAGE,FREE_318&topic=FINANCING")), NOW, null, null).matched.map((p) => p.key), ["a"]);
  });
  test("study 3: asked for a test drive but has NOT booked one", () => {
    assert.deepEqual(runStudy(BASE, parseInsightQuery(new URLSearchParams("topic=TEST_DRIVE&testDriveBooked=0")), NOW, null, null).matched.map((p) => p.key), ["b"]);
  });
  test("study 1 shape: Courage + black + installments, not bought", () => {
    const q = parseInsightQuery(new URLSearchParams("model=COURAGE&colour=black&topic=FINANCING&outcome=none,open,quoted,reserved,lost"));
    assert.equal(runStudy(BASE, q, NOW, outcome, null).total, 0, "a bought, so excluded");
  });
  test("a sales-outcome question with no CRM answer matches nobody — never everybody", () => {
    assert.equal(matchesQuery(BASE[1], { outcome: "none" }, NOW), false);
  });
  test("named or by context", () => {
    assert.deepEqual(runStudy(BASE, { anyModel: "COURAGE" }, NOW, null, null).matched.map((p) => p.key), ["a", "d"]);
  });
});

describe("the result", () => {
  test("share of everyone, distributions, grouping, CRM outcomes only when read", () => {
    const s = runStudy(BASE, {}, NOW, outcome, "model");
    assert.equal(s.total, 4);
    assert.equal(s.share, 1);
    assert.deepEqual(s.groups?.map((g) => [g.key, g.n]).sort(), [["COURAGE", 1], ["FREE_318", 1], ["MHERO_1", 1], ["—", 1]].sort());
    assert.deepEqual(s.outcomes?.map((o) => [o.key, o.n]).sort(), [["unknown", 3], ["won", 1]]);
    assert.equal(runStudy(BASE, {}, NOW, null, null).outcomes, null);
    assert.equal(s.coverage.colour, 1);
  });
});

describe("saved questions", () => {
  test("only known fields survive; the comma lists round-trip", () => {
    assert.equal(normalizeStudyQuery("?model=COURAGE,FREE_318&evil=<script>&groupBy=stage&stage=DROP"), "model=COURAGE,FREE_318&groupBy=stage");
    const q = parseInsightQuery(new URLSearchParams("model=COURAGE,FREE_318&testDriveBooked=0"));
    assert.equal(toSearch(q), "?model=COURAGE,FREE_318&testDriveBooked=0");
  });
});
