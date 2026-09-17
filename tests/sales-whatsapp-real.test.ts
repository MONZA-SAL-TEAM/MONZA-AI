/**
 * Real WhatsApp messages to 70 70 85 85 (15–16 September 2026) that the
 * engine answered wrongly, and the words it did not know. Each case is the
 * customer's wording, with names left out.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { runConversation } from "@/lib/wasales/flow";
import { readMessage } from "@/lib/wasales/intent";
import { MONZA_KNOWLEDGE } from "@/lib/wasales/knowledge";
import { folderMedia, loadCatalog } from "@/lib/wasales/catalog";
import { actionLabel } from "@/lib/wasales/templates";
import type { EngineInput } from "@/lib/wasales/engine";

const DEPS = { knowledge: MONZA_KNOWLEDGE, catalog: loadCatalog(), media: folderMedia, ttlHours: 72 };
const SEND = {
  channel: "whatsapp" as const,
  autoSendEnabled: true,
  replyWindowOpen: true,
  humanLock: false,
  liveSending: true,
  attachmentsSupported: true,
};

type Msg = string | Partial<EngineInput>;

/** The actions of the LAST message of a WhatsApp chat on the Monza number. */
function last(msgs: Msg[]): string[] {
  const inputs = msgs.map((m, i) => ({
    text: "",
    brand: "monza",
    conversationIsNew: i === 0,
    now: new Date(Date.UTC(2026, 8, 16, 9, i)).toISOString(),
    ...(typeof m === "string" ? { text: m } : m),
  })) as EngineInput[];
  const { turns } = runConversation(inputs, DEPS, SEND);
  return turns[turns.length - 1].decision.actions.map(actionLabel);
}

const noBrochure = (labels: string[]) => labels.every((l) => !l.includes("BROCHURE"));

describe("a car is never picked from ordinary words", () => {
  test("“the first payment” is not the first car in the list", () => {
    const a = last(["Can I know more info?", "800$ per month, what about the first payment"]);
    assert.ok(noBrochure(a), a.join(" | "));
    assert.ok(a.some((l) => l.includes("FINANCING")), a.join(" | "));
  });

  test("“the first one” still picks the first car offered", () => {
    const a = last(["mhero", "the first one"]);
    assert.ok(a.includes("SEND MHERO 1 BROCHURE"), a.join(" | "));
  });

  test("“i will pass by soon” is not the Passion", () => {
    assert.ok(noBrochure(last(["Hi", "Will stay in contact and i will pass by soon"])));
  });

  test("“pasion” is still the Passion", () => {
    assert.ok(last(["pasion"]).includes("SEND PASSION BROCHURE"));
  });

  test("a forwarded offer's “free maintenance” is not the Free 318", () => {
    const offer =
      "Hello \n\nVoyah courage 2026 Full option AWD\n\nLast 4 units\n\nTotal: $53,000 including VAT \n2 years free maintenance";
    const a = last([offer]);
    assert.ok(a.includes("SEND COURAGE BROCHURE"), a.join(" | "));
    assert.ok(!a.some((l) => l.includes("FREE 318")), a.join(" | "));
  });
});

describe("what the customer meant", () => {
  test("their car's mileage is a trade-in, not a range question", () => {
    assert.deepEqual(readMessage("64000 km").intents, ["TRADE_IN"]);
    assert.deepEqual(readMessage("165,000 km ofo").intents, ["TRADE_IN"]);
    assert.deepEqual(readMessage("470 km?").intents, ["RANGE"]);
    assert.deepEqual(readMessage("how many km").intents, ["RANGE"]);
  });

  test("“Okay deal” is agreeing, not asking for a discount", () => {
    assert.deepEqual(readMessage("Okay deal").intents, ["ACKNOWLEDGEMENT"]);
    assert.deepEqual(last(["courage", "Okay deal"]), [], "agreeing reopens nothing");
    assert.deepEqual(readMessage("any deals?").intents, ["DISCOUNT"]);
  });

  test("“the price of each” after MHERO 1 and 2 hands off the price of just those two", () => {
    const a = last(["Hello, I would like to get more details about MHERO I and II", "Please can I know the price of each"]);
    assert.deepEqual(a, [
      "SAY PRICE HANDOFF (MHERO 1, MHERO 2)",
      "SHOW MODEL CHOICES (MHERO 1, MHERO 2)",
      "ALERT SALES — PRICE (MHERO 1, MHERO 2)",
    ]);
  });

  test("vendors are not customers", () => {
    for (const v of [
      "Hi dear, I'm from a freight company. I'm sharing our company profile for your reference. We'd be happy to offer you our best services and rates on your upcoming shipments.",
      "Hello we would like to do business with ya",
    ]) {
      assert.equal(readMessage(v).exclusion?.kind, "VENDOR_PITCH", v);
    }
  });

  test("words customers really wrote", () => {
    const cases: [string, string][] = [
      ["sabaho", "GREETING"],
      ["Thk U", "ACKNOWLEDGEMENT"],
      ["Pricr", "PRICE"],
      ["kif as3ar", "PRICE"],
      ["في ارخص ؟", "PRICE"],
      ["Adai daf3a oula", "FINANCING"],
      ["I wnt to ask about the 0% interest", "FINANCING"],
      ["كيف طريقة الدفع", "FINANCING"],
      ["More inf", "GENERAL_INFO"],
      ["Plz badna tafasil aktar law samahto", "GENERAL_INFO"],
    ];
    for (const [text, intent] of cases) {
      assert.ok(readMessage(text).intents.includes(intent as never), `${text} → ${readMessage(text).intents.join(",")}`);
    }
  });
});
