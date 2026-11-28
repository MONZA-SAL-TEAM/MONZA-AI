/** What MONZA quoted, as numbers (lib/wasales/quote.ts). Invented figures only — this repository is public. */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { mayHoldQuote, readQuote, splitByCar } from "@/lib/wasales/quote";
import { quoteRows } from "@/lib/insights/quotes-server";

const OFFER = [
  "Hello!",
  "",
  "Voyah courage 2026 Full option AWD",
  "",
  "Last units",
  "",
  "Total: $41,000 including VAT ",
  "2 years free maintenance",
  "",
  "In-house financing with 0% interest:",
  "",
  "$17,000 downpayment (+$1,500 registration)",
  "",
  "Remaining $24,000",
  "",
  "Monthly: $600 (40 months)",
  "",
  "Warranty: ",
  "6 years on the vehicle",
  "10 years on the battery",
].join("\n");

const opt = (down: number | null, monthly: number | null, months: number | null) => ({ down, monthly, months });

describe("the quote reader (Samer, 2026-11-28)", () => {
  test("the team's usual offer: total, down payment, monthly and months — and nothing else", () => {
    assert.deepEqual(readQuote(OFFER), { kind: "offer", totalMin: 41_000, totalMax: 41_000, listPrice: null, options: [opt(17_000, 600, 40)], confidence: "high" });
  });

  test("the remaining balance, a registration fee and the warranty years are never the price", () => {
    const q = readQuote("Total: $41,000\n$17,000 downpayment\n$1,500 registration\nRemaining $24,000\nWarranty 10 years");
    assert.deepEqual([q?.totalMin, q?.totalMax, q?.options], [41_000, 41_000, [opt(17_000, null, null)]]);
    assert.deepEqual(readQuote("Place a downpayment of $17,000 + $1,500 registration")?.options, [opt(17_000, null, null)]);
    assert.deepEqual(readQuote("Downpayment: At least $20,000 + registration")?.options, [opt(20_000, null, null)], "a fee word after the figure does not make a down payment a total");
  });

  test("a total that INCLUDES registration is still the total", () => {
    assert.equal(readQuote("$46,000 including VAT & registration")?.totalMin, 46_000);
    assert.equal(readQuote("$41,000 + $1,500 registration")?.totalMax, 41_000);
    assert.equal(readQuote("$41,000 including VAT + $1,500 registration")?.totalMax, 41_000);
  });

  test("a figure alone is a price; terms alone are terms", () => {
    assert.equal(readQuote("Priced at $61,000 free registration")?.kind, "price");
    assert.deepEqual(readQuote("Minimum downpayment is $17,000"), { kind: "terms", totalMin: null, totalMax: null, listPrice: null, options: [opt(17_000, null, null)], confidence: "high" });
    assert.deepEqual(readQuote("Downpayment: $30,000\nMonthly: $1,900")?.options, [opt(30_000, 1_900, null)]);
    assert.deepEqual(readQuote("$20,000 deposit")?.options, [opt(20_000, null, null)]);
  });

  test("a bare figure is kept, at LOW confidence: numbers alone cannot say who it was for", () => {
    assert.deepEqual(readQuote("$52,000"), { kind: "price", totalMin: 52_000, totalMax: 52_000, listPrice: null, options: [], confidence: "low" });
    assert.equal(readQuote("No it is $52,000")?.confidence, "low");
    assert.equal(readQuote("Priced at $52,000")?.confidence, "high");
    assert.equal(readQuote("$52,000 including VAT")?.confidence, "high");
    assert.equal(readQuote(OFFER)?.confidence, "high");
  });

  test("an original price beside the offer is kept apart, never as a range", () => {
    assert.deepEqual(
      [readQuote("Original price $60,000, now $55,000 including VAT")?.totalMin, readQuote("Original price $60,000, now $55,000 including VAT")?.totalMax, readQuote("Original price $60,000, now $55,000 including VAT")?.listPrice],
      [55_000, 55_000, 60_000]
    );
    assert.equal(readQuote("Was $60,000\nTotal: $55,000")?.listPrice, 60_000);
    assert.equal(readQuote("Original price will be $60,000"), null, "a list price alone is not an offer");
  });

  test("two prices with nothing marking one as the original are a range, never a sum", () => {
    const q = readQuote("If with leather $52,000\nIf with alcantara $50,000");
    assert.deepEqual([q?.totalMin, q?.totalMax, q?.listPrice], [50_000, 52_000, null]);
    assert.equal(readQuote("Between $48,000 to $52,000")?.totalMin, 48_000);
  });

  test("several ways to pay are each kept, with their own months", () => {
    const q = readQuote("Total: $41,000\nOption 1: $10,000 downpayment, $900 monthly (36 months)\nOption 2: $20,000 downpayment, $600 monthly (24 months)");
    assert.deepEqual(q?.options, [opt(10_000, 900, 36), opt(20_000, 600, 24)]);
    assert.equal(q?.kind, "offer");
    assert.deepEqual(readQuote("Total $41,000 downpayment $17,000 monthly $600 for 40 months")?.options, [opt(17_000, 600, 40)]);
  });

  test("\"k\" with a dollar sign is thousands; USD and dollars count without the sign", () => {
    assert.equal(readQuote("it is $52k")?.totalMin, 52_000);
    assert.equal(readQuote("52k usd")?.totalMin, 52_000);
    assert.equal(readQuote("The price is 52,000 USD")?.totalMin, 52_000);
    assert.equal(readQuote("52,000 dollars cash")?.totalMin, 52_000);
    assert.ok(mayHoldQuote("The price is 52,000 USD"), "the first look must not demand a dollar sign");
    assert.ok(mayHoldQuote("٥٢ ألف دولار"));
    assert.ok(!mayHoldQuote("Good morning"));
  });

  test("Arabic and Arabizi: digits, thousands, the dollar word and the payment words", () => {
    assert.equal(readQuote("٥٢ ألف دولار")?.totalMin, 52_000);
    assert.deepEqual([readQuote("السعر 52,000 دولار دفعة أولى 20,000 دولار")?.totalMin, readQuote("السعر 52,000 دولار دفعة أولى 20,000 دولار")?.options], [52_000, [opt(20_000, null, null)]]);
    assert.deepEqual(readQuote("daf3a $20,000 w shahri $700")?.options, [opt(20_000, 700, null)]);
    assert.deepEqual(readQuote("الباقي $30,000"), null, "the remaining balance in Arabic is not a price");
  });

  test("no money word, no quote: a year, a mileage, a phone number, a range in km", () => {
    for (const text of ["The 2026 model arrives next month", "180k. Km", "Call 70 708 585", "Range 550 km", "38 months warranty", "It has 318 hp"]) {
      assert.equal(readQuote(text), null, text);
    }
  });

  test("another make's car, a trade-in valuation, or one colleague briefing another, is not our quote", () => {
    for (const text of [
      "Porsche $20,000 and can go lower",
      "Denali 2018 | Asking price $35,000",
      "Mercedes asking price $25,000 can be sold for $30,000",
      "Tell him it will be sold at cost exactly $40,000",
      "He wants to pay $50,000 now",
      "Trade-in valuation: $18,000",
      "We can give him $22,000 for his car",
    ]) {
      assert.equal(readQuote(text), null, text);
    }
  });

  test("a small or absurd amount with no cue is ignored", () => {
    assert.equal(readQuote("$200 for the mats"), null);
    assert.equal(readQuote("Price: $140,00 full option"), null, "a typo is not guessed at");
    assert.equal(readQuote("$9,000,000"), null);
  });
});

describe("a message pricing several cars", () => {
  const carsOf = (line: string) => [...(/alpha/i.test(line) ? ["ALPHA"] : []), ...(/beta/i.test(line) ? ["BETA"] : [])];

  test("is split per car, from the line naming it", () => {
    assert.deepEqual(splitByCar("Hello\nAlpha\n$61,000\nBeta\n$99,000", carsOf), [
      { car: "ALPHA", text: "Alpha\n$61,000" },
      { car: "BETA", text: "Beta\n$99,000" },
    ]);
  });

  test("one car, or none, keeps the whole text", () => {
    assert.deepEqual(splitByCar("Hello\nAlpha 2026\nTotal: $61,000", carsOf), [{ car: "ALPHA", text: "Hello\nAlpha 2026\nTotal: $61,000" }]);
    assert.deepEqual(splitByCar("$61,000", carsOf), [{ car: null, text: "$61,000" }]);
  });

  test("a line naming two cars cannot be split: nothing is kept", () => {
    assert.equal(splitByCar("Alpha or Beta: $61,000", carsOf), null);
  });
});

describe("a quote as rows", () => {
  const m = { conversationId: "c1", accountId: "wa-monza", brand: "monza", externalMessageId: "wamid.1", at: "2026-11-01T10:00:00.000Z" };
  const none = () => [] as string[];
  const alpha = (line: string) => (/courage/i.test(line) ? ["COURAGE"] : []);

  test("the car the message names wins; else the car being discussed; else none", () => {
    const named = quoteRows({ ...m, text: OFFER }, alpha, "DREAM");
    assert.deepEqual([named[0]?.model, named[0]?.model_binding], ["COURAGE", "message"]);
    const context = quoteRows({ ...m, text: "$52,000" }, none, "DREAM");
    assert.deepEqual([context[0]?.model, context[0]?.model_binding], ["DREAM", "conversation"]);
    const unknown = quoteRows({ ...m, text: "$52,000" }, none, null);
    assert.deepEqual([unknown[0]?.model, unknown[0]?.model_binding, unknown[0]?.confidence], [null, null, "low"]);
  });

  test("one row per payment option, numbered, each carrying the total", () => {
    const rows = quoteRows({ ...m, text: "Total: $41,000\n$10,000 downpayment, $900 monthly (36 months)\n$20,000 downpayment, $600 monthly (24 months)" }, none, "DREAM");
    assert.deepEqual(rows.map((r) => [r.option_no, r.total_min, r.down_payment, r.monthly, r.months]), [
      [1, 41_000, 10_000, 900, 36],
      [2, 41_000, 20_000, 600, 24],
    ]);
  });

  test("a message pricing two cars is a row per car, each with its own price", () => {
    const carsOf = (line: string) => (/hero ii/i.test(line) ? ["MHERO_2"] : /hero i\b/i.test(line) ? ["MHERO_1"] : []);
    const rows = quoteRows({ ...m, text: "M-Hero II\n$61,000\nM-Hero I\n$99,000" }, carsOf, null);
    assert.deepEqual(rows.map((r) => [r.option_no, r.model, r.total_min]), [
      [1, "MHERO_2", 61_000],
      [2, "MHERO_1", 99_000],
    ]);
  });

  test("a message with no quote makes no row, and a row never carries the words", () => {
    assert.deepEqual(quoteRows({ ...m, text: "Good morning, how can we help?" }, none, "DREAM"), []);
    const rows = quoteRows({ ...m, text: OFFER }, alpha, null);
    assert.equal(rows.length, 1);
    assert.ok(!JSON.stringify(rows).includes("Hello"));
    assert.ok(!JSON.stringify(rows).toLowerCase().includes("warranty"));
  });
});
