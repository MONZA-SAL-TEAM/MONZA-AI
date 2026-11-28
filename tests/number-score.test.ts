/** How memorable a Lebanese mobile number is (lib/leads/number-score.ts). Invented numbers only. */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { classOf, scoreNumber, strongestPattern } from "@/lib/leads/number-score";

const cls = (n: string) => scoreNumber(n)?.cls ?? null;
const score = (n: string) => scoreNumber(n)?.score ?? null;

describe("the number class (Samer, 2026-11-28)", () => {
  test("Samer's examples land in the classes he gave them", () => {
    assert.equal(cls("03 111 111"), "S");
    assert.equal(cls("03 777 777"), "S");
    assert.equal(cls("03 123 456"), "S");
    assert.equal(cls("03 111 222"), "S");
    assert.equal(cls("03 100 000"), "S");
    assert.equal(cls("03 123 123"), "S", "90 for the repeated block, plus the 03 prefix");
    assert.equal(cls("70 777 777"), "S", "an exceptional number on another prefix qualifies");
    assert.equal(cls("70 123 123"), "S");
    assert.equal(cls("71 121 212"), "A");
    assert.equal(cls("76 123 321"), "A");
    assert.equal(cls("03 555 124"), "A", "a triple (65) on the 03 prefix (15)");
    assert.equal(cls("71 555 124"), "B");
    assert.equal(cls("78 418 000"), "B");
    assert.equal(cls("71 418 593"), "C");
    assert.equal(cls("03 418 593"), "C", "the 03 prefix alone never leaves the standard class");
    assert.equal(score("03 418 593"), 15);
    assert.equal(score("71 418 593"), 0);
  });

  test("every Lebanese mobile prefix is scored, however the number is written", () => {
    for (const p of ["70", "71", "76", "78", "79", "81"]) assert.equal(cls(`${p} 777 777`), "S", p);
    const forms = ["+961 3 111 111", "009613111111", "9613111111", "03111111", "03-111-111", "3111111"];
    for (const f of forms) assert.deepEqual(scoreNumber(f), { score: 100, cls: "S", reasons: ["six identical digits", "the original 03 prefix"] }, f);
  });

  test("overlapping patterns are not added up: one strongest pattern, and the score never passes 100", () => {
    // 111111 is also two triples, a mirror and one distinct digit — it is scored once.
    assert.deepEqual(strongestPattern("111111"), { points: 100, reason: "six identical digits" });
    assert.deepEqual(strongestPattern("123321"), { points: 85, reason: "a mirrored number" });
    assert.deepEqual(strongestPattern("121212"), { points: 85, reason: "the same pair three times" });
    assert.deepEqual(strongestPattern("112233"), { points: 65, reason: "three pairs" });
    assert.equal(strongestPattern("418593"), null);
    assert.equal(strongestPattern("12345"), null);
    assert.equal(score("03 111 111"), 100);
    assert.deepEqual([classOf(90), classOf(89), classOf(75), classOf(74), classOf(50), classOf(49)], ["S", "A", "A", "B", "B", "C"]);
  });

  test("what is not a Lebanese mobile gets NO score — never 'standard'", () => {
    assert.equal(scoreNumber("01 111 111"), null, "a Beirut landline");
    assert.equal(scoreNumber("+33 6 11 11 11 11"), null, "a foreign number");
    assert.equal(scoreNumber("17841111111111111"), null, "an Instagram id is not a phone");
    assert.equal(scoreNumber(""), null);
    assert.equal(scoreNumber(null), null);
    assert.equal(scoreNumber("not a number"), null);
  });

  test("the wording never claims wealth or status", () => {
    const all = ["03 111 111", "70 123 123", "76 123 321", "71 555 124", "03 418 593"].flatMap((n) => scoreNumber(n)!.reasons).join(" ");
    assert.doesNotMatch(all, /rich|wealth|status|vip|afford|important/i);
  });
});
