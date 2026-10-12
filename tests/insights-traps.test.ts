/**
 * Word traps for the PROFILE observer: things that look like a budget, a city, a brand or a timeline
 * and are not. Close a new trap with a rule, never an exception for one sentence.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { factsOf } from "@/tests/_profile";
import type { Observation } from "@/lib/wasales/observe";

const none = (kind: Observation["kind"], line: string) => assert.deepEqual(factsOf(line).filter((o) => o.kind === kind), [], `"${line}" read as ${kind}`);

describe("not budgets", () => {
  for (const line of ["Free 318", "how much is the free 318", "318 km range?", "I have a BMW 318", "call me 70 708 585", "is it a 2025 model?", "40 kWh battery?", "what is the 0-100 time", "I want 2 brochures"]) {
    test(line, () => none("budget", line));
  }
  test("a price quoted back is a price question, not a budget", () => none("budget", "is the courage 40k$?"));
});

describe("not cities", () => {
  for (const line of ["send me the صور", "what is the tyre pressure", "chouf el video", "nharak saida", "fi sowar?"]) {
    test(line, () => none("city", line));
  }
});

describe("not other brands", () => {
  for (const line of ["what is the range of colours", "how many seats", "seat heating?", "bade jeep", "fuel tank size", "mini cooper vibes"]) {
    test(line, () => none("competitor", line));
  }
});

describe("not a timeline", () => {
  for (const line of ["test drive tomorrow", "can I come today", "open now?", "send it later"]) {
    test(line, () => none("timeline", line));
  }
});

describe("not a fleet", () => {
  test("comparing two cars is not two cars bought", () => none("purpose", "compare 2 cars: courage vs free"));
});
