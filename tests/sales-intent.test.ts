/**
 * The Understanding Engine's first half: what the customer ASKED.
 *
 * Every rule of lib/wasales/intent.ts, one at a time — the vocabulary, longest
 * phrase wins, weak words, safe typos, Arabic and Arabizi, the language, the
 * button payloads, numbered answers and the hard exclusions — so a failure
 * names the rule it broke.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  INTENTS,
  detectExclusion,
  detectLanguage,
  lexiconPhrases,
  parsePayload,
  readChoiceNumber,
  readMessage,
  type Intent,
} from "@/lib/wasales/intent";
import { normalize } from "@/lib/wasales/matcher";

function intents(text: string): Intent[] {
  return readMessage(text).intents;
}

function tokens(text: string): string[] {
  const n = normalize(text);
  return n === "" ? [] : n.split(" ");
}

describe("the definition-of-done messages", () => {
  test("hp? · range? · what's the range? · what about Passion L?", () => {
    assert.deepEqual(intents("hp?"), ["HORSEPOWER"]);
    assert.deepEqual(intents("range?"), ["RANGE"]);
    assert.deepEqual(intents("what's the range?"), ["RANGE"]);
    assert.deepEqual(intents("what about Passion L?"), [], "a model, not a question");
  });
});

describe("several intents in one message", () => {
  test("all of them, in the order written", () => {
    assert.deepEqual(intents("price and range and hp of the courage?"), [
      "PRICE",
      "RANGE",
      "HORSEPOWER",
    ]);
  });

  test("the same intent twice is reported once", () => {
    assert.deepEqual(intents("hp? hp? horsepower?"), ["HORSEPOWER"]);
  });
});

describe("longest phrase wins", () => {
  test("a longer phrase swallows the words inside it", () => {
    assert.deepEqual(intents("what is your price range"), ["PRICE"]);
    assert.deepEqual(intents("number of seats?"), ["SEATS"]);
    assert.deepEqual(intents("does it have a range extender"), ["POWERTRAIN"]);
    assert.deepEqual(intents("best price?"), ["DISCOUNT"]);
    assert.deepEqual(intents("can i book a test drive"), ["TEST_DRIVE"]);
  });

  test("phrases that mean nothing make their words mean nothing", () => {
    // "range rover" is another brand's car, never a range question.
    assert.deepEqual(intents("is it like a range rover"), ["OTHER_BRAND"]);
    assert.deepEqual(intents("no problem"), []);
    assert.deepEqual(intents("no problem, thanks"), ["ACKNOWLEDGEMENT"]);
    assert.deepEqual(intents("is delivery free of charge"), ["AVAILABILITY"]);
  });
});

describe("weak words", () => {
  test("count on their own", () => {
    const r = readMessage("how much?");
    assert.deepEqual(r.intents, ["PRICE"]);
    assert.equal(r.confidence, "low");
    assert.deepEqual(intents("where?"), ["LOCATION"]);
  });

  test("yield to anything stronger in the message", () => {
    assert.deepEqual(intents("how much hp"), ["HORSEPOWER"]);
    assert.deepEqual(intents("كم حصان"), ["HORSEPOWER"]);
    assert.deepEqual(intents("where can i get the brochure"), ["BROCHURE"]);
  });
});

describe("typos — tolerated only where safe", () => {
  test("long words forgive a slip, and say so", () => {
    const r = readMessage("horspower?");
    assert.deepEqual(r.intents, ["HORSEPOWER"]);
    assert.equal(r.confidence, "medium");
    assert.deepEqual(intents("brochur please"), ["BROCHURE"]);
    assert.deepEqual(intents("do you have installmments"), ["FINANCING"]);
    assert.deepEqual(intents("priceee"), ["PRICE"]);
  });

  test("a real word is never corrected into an intent", () => {
    assert.deepEqual(intents("changing the tyres"), ["PARTS"], "changing is not charging");
    assert.deepEqual(intents("a contract"), [], "contract is not contact");
    assert.deepEqual(intents("orange"), [], "orange is not range");
    assert.deepEqual(intents("is it yours"), [], "yours is not hours");
  });

  test("short words must be exact", () => {
    assert.deepEqual(intents("rang"), []);
    assert.deepEqual(intents("hq"), []);
  });
});

describe("Arabic and Arabizi", () => {
  test("Arabic, with its attached prefixes", () => {
    assert.deepEqual(intents("سعر"), ["PRICE"]);
    assert.deepEqual(intents("والسعر؟"), ["PRICE"]);
    assert.deepEqual(intents("بالتقسيط؟"), ["FINANCING"]);
    assert.deepEqual(intents("وين موقعكم"), ["LOCATION"]);
    assert.deepEqual(intents("المواصفات"), ["SPECIFICATIONS"]);
    assert.deepEqual(intents("كم كيلو بتمشي"), ["RANGE"]);
    assert.deepEqual(intents("بدي كتالوج"), ["BROCHURE"]);
    assert.deepEqual(intents("مرحبا"), ["GREETING"]);
    assert.deepEqual(intents("في كفالة؟"), ["WARRANTY"]);
  });

  test("Arabizi", () => {
    assert.deepEqual(intents("ade se3er"), ["PRICE"]);
    assert.deepEqual(intents("fi ta2sit?"), ["FINANCING"]);
    assert.deepEqual(intents("kifak"), ["GREETING"]);
  });
});

describe("the openers the first-message study found", () => {
  const OPENERS: [string, Intent[]][] = [
    ["Can I know more info?", ["GENERAL_INFO"]],
    ["hi", ["GREETING"]],
    ["Hello good morning", ["GREETING"]],
    ["price?", ["PRICE"]],
    ["is it available?", ["AVAILABILITY"]],
    ["do you have installments?", ["FINANCING"]],
    ["where is your showroom?", ["LOCATION"]],
    ["what time do you open tomorrow?", ["OPENING_HOURS"]],
    ["send me the catalogue", ["BROCHURE"]],
    ["what colours do you have", ["COLOUR"]],
    ["is it electric or hybrid?", ["POWERTRAIN"]],
    ["how long does charging take", ["CHARGING"]],
    ["I have a problem with my car", ["COMPLAINT"]],
    ["do you take my old car in exchange", ["TRADE_IN"]],
    ["what's your whatsapp number", ["CONTACT_NUMBER"]],
  ];
  for (const [text, expected] of OPENERS) {
    test(text, () => assert.deepEqual(intents(text), expected));
  }
});

describe("the vocabulary itself", () => {
  test("every phrase belongs to exactly one intent", () => {
    const seen = new Map<string, Intent | null>();
    for (const { intent, phrase } of lexiconPhrases()) {
      if (seen.has(phrase)) {
        assert.equal(seen.get(phrase), intent, `"${phrase}" is in ${seen.get(phrase)} and ${intent}`);
      }
      seen.set(phrase, intent);
    }
  });

  test("every intent except UNKNOWN has words", () => {
    const covered = new Set(lexiconPhrases().map((p) => p.intent));
    for (const intent of INTENTS) {
      if (intent !== "UNKNOWN") assert.ok(covered.has(intent), intent);
    }
  });
});

describe("language", () => {
  test("told apart from the words alone", () => {
    assert.equal(detectLanguage(tokens("what is the range")), "en");
    assert.equal(detectLanguage(tokens("شو سعر الكوراج")), "ar");
    assert.equal(detectLanguage(tokens("kifak, ade se3er?")), "arabizi");
    assert.equal(detectLanguage(tokens("bonjour, quel est le prix?")), "fr");
    assert.equal(detectLanguage(tokens("سعر courage")), "mixed");
    assert.equal(detectLanguage(tokens("??? 🚗")), "unknown");
  });
});

describe("button payloads", () => {
  test("the two shapes, read strictly", () => {
    assert.deepEqual(parsePayload("MODEL:COURAGE"), { kind: "MODEL", model: "COURAGE" });
    assert.deepEqual(parsePayload(" model:passion_l "), { kind: "MODEL", model: "PASSION_L" });
    assert.deepEqual(parsePayload("COLOUR:COURAGE:BLACK"), {
      kind: "COLOUR",
      model: "COURAGE",
      colour: "black",
    });
  });

  test("anything else is not a payload", () => {
    for (const raw of [
      "MODEL:COURAGE; DROP TABLE",
      "MODEL:",
      "COLOUR:COURAGE:../../etc",
      "MODEL:COURAGE:BLACK",
      "courage",
      "",
      null,
      undefined,
    ]) {
      assert.equal(parsePayload(raw), null, String(raw));
    }
  });

  test("a typed payload reads as a payload, and nothing else", () => {
    const r = readMessage("MODEL:COURAGE");
    assert.deepEqual(r.payload, { kind: "MODEL", model: "COURAGE" });
    assert.deepEqual(r.intents, []);
    assert.equal(r.exclusion, null);
  });
});

describe("numbered answers", () => {
  test("just the number, in the ways people send it", () => {
    for (const text of ["2", "number 2", "#2", "option 2", "٢"]) {
      assert.equal(readChoiceNumber(tokens(text)), 2, text);
    }
  });

  test("a number inside a sentence is not an answer", () => {
    for (const text of ["2 cars please", "0", "123", "the 2 of them", ""]) {
      assert.equal(readChoiceNumber(tokens(text)), null, text);
    }
  });
});

describe("hard exclusions — on high-confidence evidence only", () => {
  const exclusion = (text: string) => detectExclusion(text, normalize(text))?.kind ?? null;

  test("fake Meta support", () => {
    assert.equal(
      exclusion(
        "Meta Business Support: your page will be permanently disabled. Appeal here https://example.com/appeal"
      ),
      "META_SCAM"
    );
    assert.equal(
      exclusion(
        "Your page has been restricted for violating our policies. Verify your account at www.page-review.example"
      ),
      "META_SCAM"
    );
  });

  test("vendor pitches", () => {
    assert.equal(
      exclusion("Hi! We offer SEO and social media management to grow your page. Would you be interested?"),
      "VENDOR_PITCH"
    );
  });

  test("Meta's own notices", () => {
    assert.equal(
      exclusion("Someone created this chat because they commented on your post"),
      "SYSTEM_NOTICE"
    );
  });

  test("internal tests", () => {
    for (const text of ["test", "Hi, test", "testing 123", "TEST MESSAGE please ignore"]) {
      assert.equal(exclusion(text), "INTERNAL_TEST", text);
    }
  });

  test("real customers, however vague, are never excluded", () => {
    for (const text of [
      "test drive?",
      "I saw your ad on instagram",
      "is this page the official one?",
      "my account was charged twice",
      "support?",
      "we are interested in the courage",
      "?",
      "hi",
      "my friend works at meta, is the free good?",
    ]) {
      assert.equal(exclusion(text), null, text);
    }
  });
});
