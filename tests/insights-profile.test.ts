/**
 * The PROFILE observer (lib/wasales/observe-profile.ts): budget, timeline, purpose, city, other brands,
 * trade-in, financing, needs and concerns — from real Lebanese customer phrasing (English, Arabizi,
 * Arabic), read through the real engine so the intents are the bot's own.
 *
 * Samer, 2026-10-12: "I want to know all data of clients and leads … and more."
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Observation } from "@/lib/wasales/observe";
import { factsOf } from "@/tests/_profile";

const of = (kind: Observation["kind"], ...lines: string[]) => factsOf(...lines).filter((o) => o.kind === kind);

describe("budget", () => {
  test("'my budget is 40k' is 40,000 dollars, in the 40–50k band", () => {
    const [b] = of("budget", "my budget is 40k");
    assert.equal(b.amountMin, 40000);
    assert.equal(b.amountMax, 40000);
    assert.equal(b.currency, "USD");
    assert.equal(b.amountKind, "total");
    assert.equal(b.value, "total_40k_50k");
  });

  test("Arabizi and Arabic: 'ma32oul 50 alf dollar', 'بحدود ٥٠ ألف دولار'", () => {
    assert.equal(of("budget", "ma32oul 50 alf dollar")[0]?.amountMin, 50000);
    assert.equal(of("budget", "بحدود ٥٠ ألف دولار")[0]?.amountMin, 50000);
    assert.equal(of("budget", "budget 45,000$")[0]?.amountMin, 45000);
  });

  test("a range: 'between 35 and 45k'", () => {
    const [b] = of("budget", "between 35 and 45k");
    assert.deepEqual([b.amountMin, b.amountMax, b.value], [35000, 45000, "total_40k_50k"]);
    assert.equal(of("budget", "30-40k max")[0]?.amountMax, 40000);
  });

  test("a monthly amount, and a down payment with the rest in instalments", () => {
    const [m] = of("budget", "I can pay 800$ per month");
    assert.deepEqual([m.amountKind, m.amountMin, m.value], ["monthly", 800, "monthly_500_1000"]);
    const facts = factsOf("dafe3 20 alf w l ba2e ta2sit");
    const down = facts.find((o) => o.kind === "budget");
    assert.deepEqual([down?.amountKind, down?.amountMin], ["down_payment", 20000]);
    assert.ok(facts.some((o) => o.kind === "financing" && o.value === "interested"));
    assert.ok(facts.some((o) => o.kind === "financing" && o.value === "down_payment"));
  });

  test("lira is kept as lira, never converted", () => {
    const [b] = of("budget", "budget 3 milyar lira"); // a word we do not read as a unit: nothing guessed
    assert.equal(b, undefined);
    assert.equal(of("budget", "my budget is 500 million LBP")[0]?.currency, "LBP");
  });
});

describe("timeline: only alongside buying", () => {
  test("'bade eshtere ba3d shahrein' is one to three months", () => {
    assert.deepEqual(of("timeline", "bade eshtere ba3d shahrein").map((o) => o.value), ["1_3_months"]);
  });
  test("now, this month, later, and in N months", () => {
    assert.deepEqual(of("timeline", "I want to buy it this week").map((o) => o.value), ["now"]);
    assert.deepEqual(of("timeline", "planning to buy end of the month").map((o) => o.value), ["this_month"]);
    assert.deepEqual(of("timeline", "I'll buy next year").map((o) => o.value), ["later"]);
    assert.deepEqual(of("timeline", "I want to buy in 6 months").map((o) => [o.value, o.months]), [["later", 6]]);
  });
  test("just looking needs no buying verb", () => {
    assert.deepEqual(of("timeline", "just asking about the courage").map((o) => o.value), ["just_looking"]);
  });
});

describe("purpose, city, financing", () => {
  test("'for my company, we need 5 cars' is a fleet of 5", () => {
    assert.deepEqual(of("purpose", "for my company, we need 5 cars").map((o) => [o.value, o.detail]), [["fleet", "5 cars"]]);
    assert.deepEqual(of("purpose", "it's for the family, 3 kids").map((o) => o.value), ["family"]);
    assert.deepEqual(of("purpose", "a gift for my wife").map((o) => o.value), ["gift"]);
  });
  test("'ana bel metn' is Metn; a cued ambiguous place is read", () => {
    assert.deepEqual(of("city", "ana bel metn").map((o) => o.value), ["metn"]);
    assert.deepEqual(of("city", "I'm from tyre").map((o) => o.value), ["tyre"]);
    assert.deepEqual(of("city", "ana sakin bi jounieh").map((o) => [o.value, o.detail]), [["kesrouan", "Kesrouan"]]);
    assert.deepEqual(of("city", "I live in dubai").map((o) => o.value), ["abroad"]);
  });
  test("cash, and a term in years", () => {
    assert.deepEqual(of("financing", "I'll pay cash").map((o) => o.value), ["cash"]);
    const term = of("financing", "installments over 5 years?").find((o) => o.value === "term");
    assert.equal(term?.months, 60);
  });
});

describe("other brands and the trade-in", () => {
  test("'better than the BYD Song?' is BYD, compared", () => {
    assert.deepEqual(of("competitor", "is it better than the BYD Song?").map((o) => [o.value, o.stance]), [["byd", "compared"]]);
  });
  test("'3andi BMW X5 2018 120000 km for trade in' is a BMW trade-in, 2018, 100–150k km", () => {
    const facts = factsOf("3andi BMW X5 2018 120000 km for trade in");
    assert.deepEqual(facts.filter((o) => o.kind === "competitor").map((o) => [o.value, o.stance]), [["bmw", "trading_in"]]);
    assert.deepEqual(facts.filter((o) => o.kind === "trade_in").map((o) => o.value), ["bmw", "year_2018", "km_100k_150k"]);
  });
  test("a car they own", () => {
    assert.deepEqual(of("competitor", "I have a tesla model 3, how does the free compare").map((o) => [o.value, o.stance]), [["tesla", "owns"]]);
  });
});

describe("concerns and needs", () => {
  test("'ghali ktir' is price too high; 'not expensive' is not", () => {
    assert.ok(of("concern", "ghali ktir").some((o) => o.value === "price_too_high"));
    assert.ok(!of("concern", "it's not expensive").some((o) => o.value === "price_too_high"));
  });
  test("power cuts, resale, Chinese brand trust", () => {
    assert.ok(of("concern", "what about the power cuts? I only have eshtirak").some((o) => o.value === "power_cuts"));
    assert.ok(of("concern", "what is the resale value").some((o) => o.value === "resale"));
    assert.ok(of("concern", "is it chinese?").some((o) => o.value === "brand_trust"));
  });
  test("'sayara kahraba' is an electric car, not a power cut", () => {
    assert.ok(!of("concern", "bade sayara kahraba").some((o) => o.value === "power_cuts"));
  });
  test("needs: 'a 7 seater family car'", () => {
    assert.ok(of("need", "I need a family car").some((o) => o.value === "family"));
  });
});
