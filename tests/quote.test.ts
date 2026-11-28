/** What MONZA quoted, as numbers (lib/wasales/quote.ts). Invented figures only — this repository is public. */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { readQuote } from "@/lib/wasales/quote";
import { quoteRow } from "@/lib/insights/quotes-server";

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

describe("the quote reader (Samer, 2026-11-28)", () => {
  test("the team's usual offer: total, down payment, monthly and months — and nothing else", () => {
    assert.deepEqual(readQuote(OFFER), { kind: "offer", totalMin: 41_000, totalMax: 41_000, down: 17_000, monthly: 600, months: 40 });
  });

  test("the remaining balance, a registration fee and the warranty years are never the price", () => {
    const q = readQuote("Total: $41,000\n$17,000 downpayment\n$1,500 registration\nRemaining $24,000\nWarranty 10 years");
    assert.equal(q?.totalMin, 41_000);
    assert.equal(q?.totalMax, 41_000);
    assert.equal(q?.down, 17_000);
  });

  test("a total that INCLUDES registration is still the total", () => {
    assert.equal(readQuote("$46,000 including VAT & registration")?.totalMin, 46_000);
    assert.equal(readQuote("$41,000 + $1,500 registration")?.totalMax, 41_000);
  });

  test("a figure alone is a price; terms alone are terms", () => {
    assert.deepEqual(readQuote("$52,000"), { kind: "price", totalMin: 52_000, totalMax: 52_000, down: null, monthly: null, months: null });
    assert.equal(readQuote("Priced at $61,000 free registration")?.kind, "price");
    assert.deepEqual(readQuote("Minimum downpayment is $17,000"), { kind: "terms", totalMin: null, totalMax: null, down: 17_000, monthly: null, months: null });
    assert.deepEqual(readQuote("Downpayment: $30,000\nMonthly: $1,900"), { kind: "terms", totalMin: null, totalMax: null, down: 30_000, monthly: 1_900, months: null });
    assert.equal(readQuote("$20,000 deposit")?.down, 20_000);
  });

  test("two prices in one message are a range, never a sum", () => {
    const q = readQuote("If with leather $52,000\nIf with alcantara $50,000");
    assert.equal(q?.totalMin, 50_000);
    assert.equal(q?.totalMax, 52_000);
    assert.equal(readQuote("Between $48,000 to $52,000")?.totalMin, 48_000);
  });

  test("\"k\" with a dollar sign is thousands", () => {
    assert.equal(readQuote("it is $52k")?.totalMin, 52_000);
    assert.equal(readQuote("52k usd")?.totalMin, 52_000);
  });

  test("no dollar, no quote: a year, a mileage, a phone number, a range in km", () => {
    for (const text of ["The 2026 model arrives next month", "180k. Km", "Call 70 708 585", "Range 550 km", "38 months warranty", "It has 318 hp"]) {
      assert.equal(readQuote(text), null, text);
    }
  });

  test("another make's car, or one colleague briefing another, is not our quote", () => {
    for (const text of ["Porsche $20,000 and can go lower", "Denali 2018 | Asking price $35,000", "Mercedes asking price $25,000 can be sold for $30,000", "Tell him it will be sold at cost exactly $40,000", "He wants to pay $50,000 now"]) {
      assert.equal(readQuote(text), null, text);
    }
  });

  test("a small or absurd amount with no cue is ignored", () => {
    assert.equal(readQuote("$200 for the mats"), null);
    assert.equal(readQuote("Price: $140,00 full option"), null, "a typo is not guessed at");
    assert.equal(readQuote("$9,000,000"), null);
  });
});

describe("a quote as a row", () => {
  const m = { conversationId: "c1", accountId: "wa-monza", brand: "monza", externalMessageId: "wamid.1", at: "2026-11-01T10:00:00.000Z" };

  test("the car the message names wins; else the car being discussed; else none", () => {
    assert.deepEqual(
      [quoteRow({ ...m, text: OFFER }, ["COURAGE"], "DREAM")?.model, quoteRow({ ...m, text: OFFER }, ["COURAGE"], "DREAM")?.model_binding],
      ["COURAGE", "message"]
    );
    assert.deepEqual([quoteRow({ ...m, text: "$52,000" }, [], "DREAM")?.model, quoteRow({ ...m, text: "$52,000" }, [], "DREAM")?.model_binding], ["DREAM", "conversation"]);
    assert.deepEqual([quoteRow({ ...m, text: "$52,000" }, [], null)?.model, quoteRow({ ...m, text: "$52,000" }, [], null)?.model_binding], [null, null]);
  });

  test("a message naming several cars is skipped: which price is whose cannot be told", () => {
    assert.equal(quoteRow({ ...m, text: "M-Hero II\n$61,000\nM-Hero I\n$99,000" }, ["MHERO_2", "MHERO_1"], null), null);
  });

  test("a message with no quote makes no row, and a row never carries the words", () => {
    assert.equal(quoteRow({ ...m, text: "Good morning, how can we help?" }, [], "DREAM"), null);
    const row = quoteRow({ ...m, text: OFFER }, ["COURAGE"], null);
    assert.ok(row);
    assert.ok(!JSON.stringify(row).includes("Hello"));
    assert.ok(!JSON.stringify(row).toLowerCase().includes("warranty"));
  });
});
