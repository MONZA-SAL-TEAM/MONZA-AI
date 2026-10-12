/**
 * The review queue (lib/insights/review.ts): which facts need a person, and a person's decision applied
 * to every page — confirm, correct, remove — newest decision winning.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { applyOverrides, latestOverrides, reviewReason, type Override } from "@/lib/insights/review";
import type { ObservationRow } from "@/lib/insights/insights";

const ob = (p: Partial<ObservationRow>): ObservationRow => ({ conversation_id: "c1", at: "2026-10-10T09:00:00Z", kind: "colour", stance: "wants", model: "COURAGE", binding: "same_clause", part: "exterior", value: "black", detail: null, account_id: "wa-monza", external_message_id: "m1", rule: "colour.wants", ...p });
const decision = (p: Partial<Override>): Override => ({ account_id: "wa-monza", external_message_id: "m1", kind: "colour", value: "black", model: "COURAGE", action: "confirm", new_value: null, new_model: null, by_name: "Rami", at: "2026-10-12T09:00:00Z", ...p });

describe("what needs review", () => {
  test("uncertain facts only", () => {
    assert.equal(reviewReason(ob({})), null, "a colour the customer tied to a car in their own words");
    assert.equal(reviewReason(ob({ binding: "conversation" })), "colour_by_context");
    assert.equal(reviewReason(ob({ model: null, binding: "none" })), "colour_no_car");
    assert.equal(reviewReason(ob({ kind: "unresolved", value: "dream", model: "DREAM" })), "unresolved_car");
    assert.equal(reviewReason(ob({ kind: "mention", value: "fuzzy" })), "misspelling");
    assert.equal(reviewReason(ob({ kind: "category", value: "suv", model: null, rule: "category.only" })), "kind_only");
    assert.equal(reviewReason(ob({ value: "which" })), null);
  });
});

describe("decisions", () => {
  test("remove, correct, confirm — the newest wins", () => {
    const remove = applyOverrides([ob({})], latestOverrides([decision({ action: "mark_unknown" })]));
    assert.deepEqual(remove, []);
    const corrected = applyOverrides([ob({ binding: "conversation" })], latestOverrides([decision({ action: "mark_unknown", at: "2026-10-11T00:00:00Z" }), decision({ action: "correct", new_model: "DREAM", at: "2026-10-12T00:00:00Z" })]));
    assert.deepEqual([corrected[0].model, corrected[0].binding, corrected[0].rule], ["DREAM", "same_clause", "review.corrected"]);
    const confirmed = applyOverrides([ob({ kind: "unresolved", value: "dream", model: "DREAM", stance: "mentioned" })], latestOverrides([decision({ kind: "unresolved", value: "dream", model: "DREAM" })]));
    assert.deepEqual([confirmed[0].kind, confirmed[0].value, confirmed[0].model], ["model", "dream", "DREAM"], "a confirmed car word becomes a car the customer named");
  });
  test("a decision is about ONE message's fact — others are untouched", () => {
    const out = applyOverrides([ob({}), ob({ external_message_id: "m2" })], latestOverrides([decision({ action: "mark_unknown" })]));
    assert.deepEqual(out.map((o) => o.external_message_id), ["m2"]);
  });
});
