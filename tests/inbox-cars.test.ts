/** Which car a chat is about, from the labels (lib/inbox/cars.ts): named, by context, from the ad — kept apart. */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { anyCar, carsForBrand, carsOfSignals } from "@/lib/inbox/cars";

describe("cars of a conversation", () => {
  const rows = [
    { conversation_id: "c1", models: [], context_models: ["COURAGE"], ad_model: "COURAGE" },
    { conversation_id: "c1", models: ["FREE_318"], context_models: [], ad_model: "COURAGE" },
    { conversation_id: "c1", models: ["COURAGE"], context_models: [], ad_model: "COURAGE" },
    { conversation_id: "c2", models: null, context_models: null, ad_model: null },
    { conversation_id: "c3", models: [], context_models: [], ad_model: "MHERO_1" },
  ];
  const m = carsOfSignals(rows);
  test("named wins over context; the ad is kept apart; a chat with no car has none", () => {
    assert.deepEqual(m.get("c1"), { named: ["FREE_318", "COURAGE"], context: [], ad: "COURAGE" });
    assert.deepEqual(m.get("c2"), { named: [], context: [], ad: null });
    assert.deepEqual(anyCar(m.get("c2")!), []);
    assert.deepEqual(anyCar(m.get("c3")!), ["MHERO_1"], "an ad click alone still puts the chat under its car");
    assert.deepEqual(anyCar(m.get("c1")!), ["FREE_318", "COURAGE"]);
  });
  test("the brand tab decides which cars are offered; Monza and All offer both marques", () => {
    const cars = [
      { code: "COURAGE", label: "VOYAH Courage", brand: "voyah" as const },
      { code: "MHERO_1", label: "MHERO 1", brand: "mhero" as const },
    ];
    assert.deepEqual(carsForBrand(cars, "voyah").map((c) => c.code), ["COURAGE"]);
    assert.deepEqual(carsForBrand(cars, "mhero").map((c) => c.code), ["MHERO_1"]);
    assert.deepEqual(carsForBrand(cars, "monza").map((c) => c.code), ["COURAGE", "MHERO_1"]);
    assert.deepEqual(carsForBrand(cars, "all").map((c) => c.code), ["COURAGE", "MHERO_1"]);
  });
});
