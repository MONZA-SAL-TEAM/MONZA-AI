/**
 * How customers describe our cars (lib/insights/language.ts): dictionary words per car in people and
 * messages, kinds of car with no model kept apart from model demand.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { vehicleLanguage } from "@/lib/insights/language";
import type { ObservationRow } from "@/lib/insights/insights";
import { aliasIndex, aliasKey } from "@/lib/wasales/aliases";
import { loadCatalog } from "@/lib/wasales/catalog";
import { engineCars } from "@/lib/wasales/engine";
import { MONZA_KNOWLEDGE, modelByCatalogueId } from "@/lib/wasales/knowledge";

const NOW = Date.parse("2026-10-12T12:00:00Z");
const ob = (conv: string, kind: string, value: string, model: string | null, extra: Partial<ObservationRow> = {}): ObservationRow => ({
  conversation_id: conv, at: "2026-10-10T09:00:00Z", kind, stance: "named", model, binding: null, part: null, value, detail: null, external_message_id: `${conv}-${value}`, ...extra,
});

describe("vehicle language", () => {
  const index = aliasIndex(engineCars(MONZA_KNOWLEDGE, loadCatalog()));
  const v = vehicleLanguage(
    [
      ob("c1", "mention", "917", "MHERO_1"),
      ob("c2", "mention", "917", "MHERO_1"),
      ob("c3", "mention", aliasKey("mhero 1"), "MHERO_1"),
      ob("c3", "mention", "fuzzy", "COURAGE"),
      ob("c4", "category", "suv", null, { rule: "category.only" }),
      ob("c5", "category", "suv", null, { rule: "category.with_model" }),
      ob("c6", "unresolved", "dream", "DREAM"),
    ],
    () => "whatsapp",
    (c) => `chat:${c}`,
    index,
    (carId) => modelByCatalogueId(MONZA_KNOWLEDGE, carId)?.code ?? null,
    MONZA_KNOWLEDGE.models.map((m) => ({ code: m.code, name: m.displayName })),
    NOW
  );
  test("917 is how most MHERO 1 customers named it — people, not messages", () => {
    const m = v.models.find((x) => x.code === "MHERO_1")!;
    assert.equal(m.people, 3);
    assert.deepEqual(m.expressions[0], { ...m.expressions[0], key: "917", text: "917", script: "digits", people: 2, messages: 2 });
    assert.deepEqual(m.expressions[0].q, { model: "MHERO_1", mention: "MHERO_1:917" });
  });
  test("a misspelling is shown as one, with no text", () => {
    assert.equal(v.models.find((x) => x.code === "COURAGE")!.expressions[0].script, "misspelling");
  });
  test("a kind of car with no model is kept apart from model demand", () => {
    assert.deepEqual(v.categories.map((c) => [c.key, c.onlyCategory, c.withModel]), [["suv", 1, 1]]);
  });
  test("an unresolved car word is counted apart, never as interest", () => {
    const dream = v.models.find((x) => x.code === "DREAM")!;
    assert.equal(dream.people, 0);
    assert.equal(dream.unresolvedPeople, 1);
  });
});
