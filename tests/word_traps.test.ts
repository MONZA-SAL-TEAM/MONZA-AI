/**
 * WORD TRAPS (Samer, 2026-09-18) — "your actual model names are also normal words".
 *
 * FREE, DREAM, PASSION and COURAGE are HIGH-RISK tokens: they need stronger evidence than TAISHAN,
 * MHERO 1 or FREE 318 before they are a car. And the command words (price, range, battery, charge,
 * service, available, open, call, buy, sell, trade, finance, key, part…) are ordinary words too.
 *
 * Every candidate is in one of four states, and only the first two may act:
 *
 *   EXPLICIT     clearly the model / the intent                   → act
 *   CONTEXTUAL   the conversation (or the ad) makes it clear       → act
 *   AMBIGUOUS    could be either                                   → clarify, nothing else
 *   INCIDENTAL   an ordinary word                                  → ignored as a trigger
 *
 * THE SAFETY RULE: an ambiguous or incidental match NEVER sends a brochure, a video or colours, and
 * never opens a price flow, an alert about a car, an appointment or a department hand-off.
 *
 * The lists below are Samer's, word for word. They are data: a fix that names a sentence instead of
 * stating a rule will pass one line here and fail its neighbour.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { runConversation } from "@/lib/wasales/flow";
import type { EngineInput } from "@/lib/wasales/engine";
import type { AlertKind, EngineAction } from "@/lib/wasales/actions";
import { MONZA_KNOWLEDGE } from "@/lib/wasales/knowledge";
import { catalog, media } from "@/tests/_current-library";
import type { OutboundPart } from "@/lib/wasales/templates";
import { classify } from "@/lib/wasales/classify";
import { readMessage, readCategories, readNeeds, type Intent } from "@/lib/wasales/intent";
import { resolveModels } from "@/lib/wasales/entities";
import { vocabularyWords } from "@/lib/wasales/intent";

const DEPS = { knowledge: MONZA_KNOWLEDGE, catalog, media, ttlHours: 72 };
const NOW = "2026-09-17T09:00:00.000Z"; // Thursday noon in Beirut
const SEND = { autoSendEnabled: true, replyWindowOpen: true, humanLock: false, liveSending: true, attachmentsSupported: true, linkOversize: true } as const;

type Msg = string | Partial<EngineInput>;
function converse(messages: Msg[]) {
  const t0 = Date.parse(NOW);
  const inputs: EngineInput[] = messages.map((m, i) => ({
    text: "",
    brand: "monza",
    channel: "whatsapp",
    conversationIsNew: i === 0,
    now: new Date(t0 + i * 60_000).toISOString(),
    ...(typeof m === "string" ? { text: m } : m),
  }));
  return runConversation(inputs, DEPS, { channel: "whatsapp", ...SEND }).turns;
}
const last = (messages: Msg[]) => {
  const turns = converse(messages);
  return turns[turns.length - 1];
};
type Turn = ReturnType<typeof last>;
const words = (t: Turn) =>
  t.plan
    .filter((p): p is Extract<OutboundPart, { kind: "text" }> => p.kind === "text")
    .map((p) => [p.text, ...p.choices.map((c) => c.title)].join("\n"))
    .join("\n");
const files = (t: Turn) => t.plan.filter((p) => p.kind !== "text");
const alerts = (t: Turn) => t.decision.actions.filter((a): a is Extract<EngineAction, { type: "ALERT_SALES" }> => a.type === "ALERT_SALES");
const tags = (t: Turn): AlertKind[] => alerts(t).flatMap((a) => a.tags ?? [a.kind]);
const modelOf = (t: Turn) => t.decision.understanding.model;
const keys = (t: Turn) => t.decision.actions.filter((a): a is Extract<EngineAction, { type: "SEND_TEXT" }> => a.type === "SEND_TEXT").map((a) => a.key);
const asked = (text: string): Intent[] => {
  const r = readMessage(text, null);
  return classify(r.intents, r).intents;
};

/** Incidental: no car believed, no material, no alert about a car, and never a "did you mean" either. */
function incidental(text: string) {
  const t = last([text]);
  assert.equal(modelOf(t), null, `"${text}" → believed ${modelOf(t)}`);
  assert.deepEqual(t.decision.understanding.models, [], text);
  assert.deepEqual(t.decision.understanding.weakModels, [], `"${text}" → a "did you mean" for an ordinary word`);
  assert.equal(files(t).length, 0, `"${text}" → a file was sent`);
  assert.ok(alerts(t).every((a) => a.models.length === 0), `"${text}" → an alert names a car`);
  assert.ok(!t.decision.actions.some((a) => a.type === "SEND_BROCHURE" || a.type === "SEND_COLOUR_VIDEO" || a.type === "SHOW_COLOUR_CHOICES"), text);
}
function isCar(text: string, code: string) {
  const t = last([text]);
  assert.equal(modelOf(t), code, `"${text}" → ${modelOf(t)}`);
}
/** Nothing a customer did not ask for: no file, no alert. */
function nothingPushed(t: Turn, why: string) {
  assert.equal(files(t).length, 0, `${why}: a file was sent`);
  assert.equal(alerts(t).length, 0, `${why}: an alert was raised (${tags(t).join(",")})`);
}

/* ═════════════ 1–4 · the four high-risk model tokens ═════════════ */

describe("1. FREE", () => {
  for (const text of [
    "Is the service free?", "Is delivery free?", "Do I get a free charger?", "Free maintenance?", "Is registration free?", "Can you give me something for free?",
    "Free warranty?", "Free test drive?", "Is the first service free?", "Do you have free parking?", "Feel free to call me.", "Are you free tomorrow?",
    "I'm free after 5.", "Free on Saturday?", "When are you free?", "You can call me when you're free.", "Is CarPlay free?", "Is charging free?",
    "Any free accessories?", "Free insurance?", "Free installation?", "Is roadside assistance free?",
  ]) test(`incidental: ${text}`, () => incidental(text));
  for (const text of ["Free 318", "Voyah Free", "Voyah Free 318", "Free price", "Free range", "the Free 318", "I want the Free", "show me the Voyah Free"]) {
    test(`explicit: ${text}`, () => isCar(text, "FREE_318"));
  }
  test("'Free' by itself: asked, never media — unless the conversation already points at it", () => {
    const t = last(["Free"]);
    assert.equal(modelOf(t), null);
    assert.equal(files(t).length, 0);
    assert.match(words(t), /Did you mean the VOYAH Free 318\?/);
    // Contextual: the bot had just offered the models.
    assert.equal(modelOf(last(["what models do you have", "Free"])), "FREE_318");
    assert.equal(last(["Free", "yes"]).decision.nextState.activeModel, "FREE_318");
  });
});

describe("2. DREAM", () => {
  for (const text of [
    "It's my dream car.", "That's my dream.", "My dream is to own one.", "Dream car.", "I've always dreamed of this.", "This car is a dream.", "A dream to drive.",
    "Dream specification.", "My dream SUV.", "That would be a dream.", "You guys made my dream come true.", "I dream about buying one.", "Dream big.",
    "This is literally my dream car.", "The Voyah is my dream car.",
  ]) test(`incidental: ${text}`, () => incidental(text));
  for (const text of ["Voyah Dream", "Dream price", "Dream MPV", "Dream warranty", "Dream range", "Dream seats", "I want the Dream", "Is the Dream available?"]) {
    test(`explicit: ${text}`, () => isCar(text, "DREAM"));
  }
});

describe("3. PASSION and PASSION L", () => {
  for (const text of [
    "Cars are my passion.", "Driving is my passion.", "It's a passion of mine.", "I have a passion for cars.", "Your passion for cars shows.", "Passion for luxury cars.",
    "I love cars with a passion.", "Motorsport is my passion.", "This company has passion.", "Passion project.", "Made with passion.",
  ]) test(`incidental: ${text}`, () => incidental(text));
  for (const text of ["Voyah Passion", "Passion price", "Passion warranty", "Passion range", "Passion sedan", "I want the Passion"]) {
    test(`explicit: ${text}`, () => isCar(text, "PASSION"));
  }
  test("Passion L is never shortened to Passion, and 'L' alone is never the Passion L", () => {
    for (const text of ["Passion L", "voyah passion l price", "the passion l range"]) isCar(text, "PASSION_L");
    for (const text of ["size L", "L size", "large", "L/XL", "letter L", "L plate", "L mode"]) {
      const t = last([text]);
      assert.equal(modelOf(t), null, text);
      assert.equal(files(t).length, 0, text);
    }
  });
});

describe("4. COURAGE", () => {
  for (const text of [
    "Courage to ask...", "I finally got the courage to message you.", "Have some courage.", "It takes courage.", "Courageous design.", "I need the courage to buy it.",
    "Give me courage to tell my wife.", "Courage to ask: what's the discount?", "Thanks for your courage.", "I admire your courage.",
  ]) test(`incidental: ${text}`, () => incidental(text));
  for (const text of ["Voyah Courage", "Courage price", "Courage range", "Courage SUV", "the Courage", "I want a Courage", "Is Courage available?"]) {
    test(`explicit: ${text}`, () => isCar(text, "COURAGE"));
  }
});

/* ═════════════ 5–7 · the safer names still have traps ═════════════ */

describe("5–7. TAISHAN, MHERO, 318", () => {
  test("Mount Taishan is a mountain", () => {
    for (const text of ["Mount Taishan", "Taishan mountain", "Taishan China", "Taishan tourism", "where is Mount Tai?", "Taishan restaurant", "Taishan company"]) {
      const t = last([text]);
      assert.equal(modelOf(t), null, text);
      assert.equal(files(t).length, 0, text);
    }
    for (const text of ["Tai Shan", "Taishan", "Voyah Taishan", "Voyah Tai Shan", "Taisan", "Taishen"]) isCar(text, "TAISHAN");
    for (const text of ["taiwan", "thailand", "tarzan", "tasha", "train"]) assert.equal(modelOf(last([text])), null, `${text} is not the Taishan`);
  });

  test("a hero is not an MHERO; 'option 2' and 'the second one' are nothing without a list", () => {
    for (const text of ["my hero", "he's my hero", "superhero", "you are a hero", "number one", "number two", "model 2", "option 1", "option 2", "first one", "the second one"]) {
      const t = last([text]);
      assert.equal(modelOf(t), null, text);
      assert.equal(files(t).length, 0, text);
    }
    for (const [text, code] of [["MHERO 1", "MHERO_1"], ["M Hero 1", "MHERO_1"], ["MHERO One", "MHERO_1"], ["MHERO 2", "MHERO_2"], ["M Hero 2", "MHERO_2"], ["MHERO Two", "MHERO_2"], ["mhero1", "MHERO_1"], ["mhero2", "MHERO_2"]]) isCar(text, code);
    // "MHERO" alone: which one? — and THEN "the second one" is the second one offered.
    const which = last(["MHERO"]);
    assert.equal(modelOf(which), null);
    assert.equal(files(which).length, 0);
    assert.match(words(which), /MHERO 1/);
    assert.equal(last(["MHERO", "the second one"]).decision.nextState.activeModel, "MHERO_2");
  });

  test("318 is a number before it is a car", () => {
    for (const text of ["BMW 318", "BMW 318i", "318 km", "$318", "invoice 318", "order 318", "ticket 318", "318 horsepower", "318 days", "plate 318", "number 318"]) {
      const t = last([text]);
      assert.equal(modelOf(t), null, text);
      assert.equal(files(t).length, 0, text);
    }
    for (const text of ["Free 318", "Voyah 318", "the 318", "318 range?"]) isCar(text, "FREE_318");
  });
});

/* ═════════════ 8–14 · command words that are ordinary words ═════════════ */

describe("8–14. price · range · battery · charge · service · warranty · available", () => {
  test("8. 'cost' is not the vehicle-price flow", () => {
    for (const text of [
      "charging cost", "battery replacement cost", "service cost", "maintenance price", "tire price", "spare key price", "insurance cost", "registration cost",
      "charger cost", "spare parts cost", "repair cost", "paint cost", "delivery cost",
    ]) {
      const t = last(["courage", text]);
      assert.ok(!asked(text).includes("PRICE"), `${text} → ${asked(text).join(",")}`);
      assert.ok(!keys(t).includes("PRICE_HANDOFF"), text);
      assert.ok(!tags(t).includes("PRICE"), text);
      assert.equal(files(t).length, 0, text);
    }
    for (const text of ["price", "how much", "quote", "quotation", "is it expensive", "best deal?"]) assert.ok(asked(`courage ${text}`).some((i) => i === "PRICE" || i === "DISCOUNT"), text);
  });

  test("9. 'range' is not always the driving range", () => {
    for (const text of ["price range", "range of colours", "range of cars", "product range", "model range", "range of services", "wide range", "range of prices"]) {
      assert.ok(!asked(text).includes("RANGE"), `${text} → ${asked(text).join(",")}`);
    }
    for (const text of ["range", "how far", "how many km", "battery range", "electric range", "total range"]) assert.ok(asked(text).includes("RANGE"), text);
    // Four separate fields — never "price range".
    const four = asked("price, range, seats and warranty");
    for (const i of ["PRICE", "RANGE", "SEATS", "WARRANTY"] as const) assert.ok(four.includes(i), `${i} in ${four.join(",")}`);
  });

  test("10. 'battery' is ten different questions", () => {
    const kwh = (text: string) => /kWh/.test(words(last(["courage", text])));
    for (const text of ["How big is the battery?", "battery size", "battery capacity", "battery?"]) assert.ok(kwh(text), `${text} is the capacity`);
    for (const text of [
      "Is the battery safe?", "How long does the battery last?", "What happens when battery dies?", "Battery replacement cost?",
      "Does battery degrade?", "Can the battery catch fire?", "battery health", "battery temperature", "12V battery",
    ]) assert.ok(!kwh(text), `${text} must not be answered with the kWh figure`);
    assert.match(words(last(["courage", "Battery warranty?"])), /10 years on the battery/);
    // The workbook's own battery line names the chemistry, so "what battery does it use?" is answered by it — word for word.
    assert.match(words(last(["free 318", "What battery does it use?"])), /CATL ternary lithium/);
  });

  test("11. 'charge' as a fee is not EV charging", () => {
    for (const text of ["What do you charge for service?", "How much do you charge?", "Will you charge me extra?", "Is there an extra charge?", "no additional charge"]) {
      assert.ok(!asked(text).some((i) => i === "CHARGING" || i === "CHARGING_COST" || i === "HOME_CHARGING" || i === "PUBLIC_CHARGING"), `${text} → ${asked(text).join(",")}`);
      assert.doesNotMatch(words(last(["courage", text])), /approved charging information/, text);
    }
    for (const text of ["charging time", "DC fast charging", "AC charging", "charging speed"]) assert.ok(asked(text).includes("CHARGING"), text);
  });

  test("12. 'service' is not always the workshop", () => {
    for (const text of ["good service", "great service thank you", "service quality is excellent"]) {
      const t = last(["courage", text]);
      assert.doesNotMatch(words(t), /76 877 278/, text);
      nothingPushed(t, text);
    }
    for (const text of ["first service", "scheduled maintenance", "service interval", "I need a repair"]) assert.match(words(last([text])), /76 877 278/, text);
  });

  test("13. a rejected warranty claim is after-sales, not the warranty's length", () => {
    const t = last(["My warranty claim was rejected."]);
    assert.match(words(t), /76 877 278/);
    assert.doesNotMatch(words(t), /6 years/);
    assert.equal(files(t).length, 0);
  });

  test("14. 'available' needs an object: a car", () => {
    for (const text of ["are you available?", "salesman available?", "when are you available?", "service available?", "parts available?", "charger available?", "colours available?", "appointment available?", "financing available?"]) {
      assert.ok(!asked(text).includes("AVAILABILITY"), `${text} → ${asked(text).join(",")}`);
      assert.ok(!tags(last([text])).includes("STOCK"), text);
    }
    for (const text of ["in stock?", "is the courage available?", "do you have one available now", "any units?", "can I get one today?"]) assert.ok(asked(text).includes("AVAILABILITY"), `${text} → ${asked(text).join(",")}`);
  });
});

/* ═════════════ 15–27 ═════════════ */

describe("15–27. colour · video · brochure · person · call · buy · sell · trade · finance · test drive · visit · days · numbers", () => {
  test("15. a black screen is a fault, not a colour", () => {
    for (const text of ["black screen", "screen went black", "my courage has a black screen"]) {
      const t = last(["courage", text]);
      assert.ok(!t.decision.actions.some((a) => a.type === "SEND_COLOUR_VIDEO"), text);
      assert.match(words(t), /76 877 278/, text);
    }
  });

  test("16–17. a negative command about a video or a brochure sends neither", () => {
    for (const text of ["no video", "don't send a video", "without video", "stop sending videos", "I already saw the video", "video not needed"]) {
      const t = last(["courage", text]);
      nothingPushed(t, text);
      assert.equal(t.decision.nextState.noVideo, true, text);
    }
    for (const text of ["no brochure", "don't send the brochure", "already have the brochure", "don't need the PDF"]) {
      const t = last(["courage", text]);
      nothingPushed(t, text);
      assert.equal(t.decision.nextState.noBrochure, true, text);
    }
    for (const text of ["brochure isn't opening", "brochure is wrong", "the pdf won't open"]) {
      const t = last(["courage", text]);
      assert.equal(files(t).length, 0, `${text}: the same file is not pushed again`);
      assert.deepEqual(tags(t), ["NEEDS_PERSON"], text);
    }
  });

  test("18. 'person' is a head count too", () => {
    for (const text of ["one person", "five-person family", "7 persons", "person capacity", "per person", "I'm not the right person"]) {
      assert.ok(!asked(text).includes("HUMAN_HANDOFF"), `${text} → ${asked(text).join(",")}`);
      assert.ok(!tags(last([text])).includes("HUMAN"), text);
    }
    for (const text of ["can I talk to a person", "human please", "I want a salesperson", "talk to someone", "representative"]) assert.ok(asked(text).includes("HUMAN_HANDOFF"), text);
  });

  test("19. 'call': the negative form wins", () => {
    for (const text of ["stop calling me", "don't call me", "do not call me again"]) {
      const t = last(["courage", text]);
      assert.ok(!tags(t).includes("CALLBACK"), text);
      nothingPushed(t, text);
    }
    for (const text of ["what do you call this?", "it's called the courage", "I called yesterday", "missed call", "wrong number called me"]) {
      assert.ok(!asked(text).includes("CALLBACK"), `${text} → ${asked(text).join(",")}`);
    }
    for (const text of ["call me", "can someone call?", "give me a call"]) assert.ok(asked(text).includes("CALLBACK"), text);
  });

  test("20–22. buying from Monza ≠ Monza buying my car; trade ≠ exchange rate", () => {
    for (const text of ["do you buy cars?", "will you buy my BMW?", "buy my old car", "can MONZA purchase my car?", "I want to sell my car.", "Can I sell you my BMW?", "part exchange"]) {
      assert.ok(asked(text).includes("TRADE_IN"), `${text} → ${asked(text).join(",")}`);
      assert.ok(!asked(text).includes("BUYING_INTENT"), text);
      assert.ok(!tags(last([text])).includes("BUYING"), text);
    }
    for (const text of ["trade price", "international trade", "exchange rate", "currency exchange", "exchange the battery", "exchange this part"]) {
      assert.ok(!asked(text).includes("TRADE_IN"), `${text} → ${asked(text).join(",")}`);
    }
    assert.ok(asked("Do you sell parts?").includes("PARTS"));
    assert.ok(!asked("Do you sell MHERO?").includes("TRADE_IN"));
  });

  test("23. accounts and existing payments are Administration, not a new-car financing lead", () => {
    for (const text of ["finance department", "bank transfer", "bank account", "payment completed", "I paid monthly already", "outstanding installment on an existing purchase"]) {
      const t = last([text]);
      assert.ok(!tags(t).includes("FINANCING"), `${text} → ${tags(t).join(",")}`);
      assert.ok(!keys(t).includes("FINANCING_INFO"), text);
    }
    for (const text of ["finance", "financing", "loan", "installments", "monthly payments", "down payment", "payment plan"]) assert.ok(asked(text).includes("FINANCING"), text);
  });

  test("24. a test drive they WATCHED, already HAD or do NOT want is not a request", () => {
    for (const text of ["I watched a test drive", "test-drive review", "YouTube test drive", "during my previous test drive I liked it", "I already test drove it", "don't need a test drive", "No test drive."]) {
      const t = last(["courage", text]);
      assert.ok(!tags(t).includes("TEST_DRIVE"), `${text} → ${tags(t).join(",")}`);
      assert.ok(!keys(t).includes("TEST_DRIVE_REQUEST"), text);
    }
    for (const text of ["test drive", "can I drive it?", "try the car", "book a drive"]) assert.ok(asked(text).includes("TEST_DRIVE"), text);
  });

  test("25. 'come' is not always a showroom visit", () => {
    for (const text of ["mechanic can come to me?", "delivery comes tomorrow?", "when will my car come?", "car is coming from China", "I'll come back to you", "I came yesterday"]) {
      assert.ok(!asked(text).includes("VISIT"), `${text} → ${asked(text).join(",")}`);
      assert.ok(!tags(last([text])).includes("VISIT"), text);
    }
  });

  test("26–27. a day or a number alone is not an appointment", () => {
    for (const text of ["I'm travelling tomorrow.", "Payment tomorrow?", "I'll decide tomorrow.", "at 4", "3", "4 seats", "5 years"]) {
      const t = last(["courage", text]);
      assert.ok(!tags(t).includes("TEST_DRIVE") && !tags(t).includes("VISIT"), `${text} → ${tags(t).join(",")}`);
    }
    // After a test-drive request, a sentence that merely CONTAINS a day is not a preferred day.
    for (const text of ["I'm travelling tomorrow.", "I'll decide tomorrow."]) {
      const t = last(["courage", "test drive", text]);
      assert.equal(t.decision.nextState.pendingDay, null, text);
      assert.doesNotMatch(words(t), /Noted|passed/, text);
    }
    assert.equal(last(["courage", "test drive", "tomorrow"]).decision.nextState.pendingDay, "2026-09-18");
  });
});

/* ═════════════ 28–56 ═════════════ */

describe("28–56. where · open · closed · screen · CarPlay · key · part · delivery · accident · tyre · software · electric · seats · size…", () => {
  test("28. 'where' is not the showroom", () => {
    for (const text of ["where is Voyah from?", "where is the battery located?", "charger location", "where is the car made?", "where is the VIN?", "where is the charging port?"]) {
      assert.ok(!asked(text).includes("LOCATION"), `${text} → ${asked(text).join(",")}`);
      assert.doesNotMatch(words(last([text])), /Horch Tabet/, text);
    }
    for (const text of ["where are you?", "address", "location", "where is MONZA?", "send me the pin", "map"]) assert.ok(asked(text).includes("LOCATION"), text);
  });

  test("29–30. 'open' and 'closed' are not always opening hours", () => {
    for (const text of [
      "open the trunk", "door won't open", "sunroof won't open", "open the brochure", "link won't open", "app won't open", "charging flap won't open", "open a financing file",
      "deal is closed", "door closed", "account closed", "financing closed", "road closed",
    ]) assert.ok(!asked(text).includes("OPENING_HOURS"), `${text} → ${asked(text).join(",")}`);
    for (const text of ["are you open?", "open today?", "when do you open?", "opening hours", "closed Sunday?"]) assert.ok(asked(text).includes("OPENING_HOURS"), text);
  });

  test("31–32, 39–41, 54–56. a fault beats a feature: after-sales, never sales material", () => {
    for (const text of [
      "screen frozen", "screen won't turn on", "screen is lagging", "screen restarted", "screen cracked", "CarPlay isn't working", "CarPlay disconnected", "can't connect CarPlay",
      "CarPlay stopped working", "flat tire", "tire damaged", "puncture", "update failed", "software bug", "car won't update", "app isn't working", "airbag warning light",
      "airbag deployed", "airbag fault", "engine light", "battery light is on", "light isn't working", "I had an accident.", "minor accident", "car was hit", "bumper damaged", "someone hit me",
      "key not working", "lost key", "spare key",
    ]) {
      const t = last(["courage", text]);
      assert.match(words(t), /76 877 278/, `${text} → ${words(t).slice(0, 80)}`);
      assert.equal(files(t).length, 0, text);
      assert.equal(alerts(t).length, 0, `${text}: not a sales alert`);
    }
    for (const text of ["screen size", "Does it have CarPlay?", "wireless CarPlay?", "tire size", "keyless entry", "digital key", "does the car have an app?", "OTA updates?", "how many airbags?"]) {
      const t = last(["courage", text]);
      assert.doesNotMatch(words(t), /76 877 278/, `${text} is a pre-sales question`);
      assert.equal(files(t).length, 0, text);
    }
    for (const text of ["key feature", "key difference", "what's the key advantage?", "thanks for warning me", "light colour"]) {
      assert.doesNotMatch(words(last(["courage", text])), /76 877 278/, text);
    }
  });

  test("34–35. 'part' and 'delivery'", () => {
    for (const text of ["which part of Lebanon?", "part of the warranty", "this part of the car", "part payment", "first part"]) assert.ok(!asked(text).includes("PARTS"), `${text} → ${asked(text).join(",")}`);
    for (const text of ["spare parts", "replacement part", "parts availability"]) assert.ok(asked(text).includes("PARTS"), text);
    for (const text of ["power delivery", "torque delivery"]) assert.ok(!asked(text).includes("DELIVERY_LOCATION"), text);
    for (const text of ["my vehicle hasn't been delivered", "delivery date of my ordered car"]) {
      const t = last([text]);
      assert.equal(files(t).length, 0, text);
      assert.ok(!t.decision.actions.some((a) => a.type === "SHOW_MODEL_CHOICES"), `${text}: an existing order is not a new sale`);
      assert.equal(alerts(t).length, 1, text);
    }
  });

  test("43–46, 48. fast · biggest · best · family · electric", () => {
    for (const text of ["reply fast", "delivery fast", "service is fast"]) assert.deepEqual(readNeeds(readMessage(text, null).tokens), [], text);
    for (const text of ["family owns one", "my family business", "family member will call"]) assert.ok(!readNeeds(readMessage(text, null).tokens).includes("FAMILY"), text);
    for (const text of ["family car", "best family option", "a car for my family"]) assert.ok(readNeeds(readMessage(text, null).tokens).includes("FAMILY"), text);
    for (const text of ["Does it have electric seats?", "electric doors", "electric tailgate", "electric steering", "electric motor", "electric charger"]) {
      assert.deepEqual(readCategories(readMessage(text, null).tokens), [], text);
    }
    for (const text of ["electric cars", "EVs", "fully electric", "BEV"]) assert.ok(readCategories(readMessage(text, null).tokens).includes("EV"), text);
    // "better than BYD" cannot be answered from the workbook, and no verdict is ever given.
    const byd = last(["is the courage better than BYD?"]);
    assert.doesNotMatch(words(byd), /\bbetter\b|\bbest\b/i);
    for (const text of ["biggest screen", "biggest wheels"]) assert.doesNotMatch(words(last([text])), /5,315|mm/, `${text} is not the longest car`);
  });

  test("50–52. seats · size · guarantee", () => {
    for (const text of ["heated seats", "ventilated seats", "massage seats", "child seat", "seat memory"]) assert.ok(!asked(text).includes("SEATS"), `${text} → ${asked(text).join(",")}`);
    for (const text of ["seats?", "how many seats", "seating capacity"]) assert.ok(asked(text).includes("SEATS"), text);
    assert.ok(asked("trunk size").includes("DIMENSIONS"));
    assert.ok(asked("battery size").includes("BATTERY"));
    for (const text of ["wheel size", "screen size", "tire size"]) assert.ok(!asked(text).includes("DIMENSIONS"), text);
    for (const text of ["guarantee?", "how long is it covered?", "what's the coverage"]) assert.ok(asked(text).includes("WARRANTY"), `${text} → ${asked(text).join(",")}`);
  });
});

/* ═════════════ 57–65 · words that mean nothing without the conversation ═════════════ */

describe("57–65. yes · no · same · other · it · and… · what about… · send it", () => {
  test("57. every 'yes' resolves the pending question", () => {
    for (const yes of ["yes", "yeah", "yep", "yup", "sure", "okay", "ok", "absolutely", "please", "yes please", "go ahead", "why not", "send it", "do it", "fine", "sounds good"]) {
      assert.equal(last(["what EVs do you have", yes]).decision.nextState.activeModel, "COURAGE", yes);
    }
  });
  test("58. every 'no' negates the pending action", () => {
    for (const no of ["no", "nope", "nah", "no thanks", "not now", "don't", "don't send it", "no need", "maybe later", "already have it"]) {
      const t = last(["what EVs do you have", no]);
      assert.equal(t.decision.nextState.activeModel, null, no);
      nothingPushed(t, no);
    }
  });
  test("59–63. same · the other one · it · and… · what about…", () => {
    assert.deepEqual(tags(last(["courage", "price", "same for Taishan"])), ["PRICE"]);
    assert.equal(modelOf(last(["courage", "price", "same price for the dream?"])), "DREAM");
    assert.equal(modelOf(last(["courage", "dream", "what about the other one?"])), "COURAGE");
    assert.equal(modelOf(last(["courage", "dream", "the previous one"])), "COURAGE");
    for (const q of ["how much is it?", "is it available?", "what's its range?"]) assert.equal(modelOf(last(["taishan", q])), "TAISHAN", q);
    assert.match(words(last(["courage", "range?", "and warranty?"])), /6 years on the vehicle/);
    assert.ok(last(["courage", "and in black?"]).decision.actions.some((a) => a.type === "SEND_COLOUR_VIDEO"));
    assert.deepEqual(tags(last(["courage", "price", "and financing?"])), ["FINANCING"]);
    assert.match(words(last(["courage", "range?", "what about warranty?"])), /6 years on the vehicle/);
    // Nothing to inherit from: asked, never guessed.
    const bare = last(["how much is it?"]);
    assert.equal(modelOf(bare), null);
    assert.match(words(bare), /Which model/);
  });
});

/* ═════════════ negation before action ═════════════ */

describe("a negative beats the keyword it contains", () => {
  for (const text of [
    "Don't send the Dream brochure.", "I don't want to buy it.", "Don't call me.", "I don't need financing.", "No test drive.", "Stop sending videos.", "I'm not interested in the Courage.",
    "ma bade video", "ma bade brochure", "ma bade eshtere", "ما بدي فيديو", "لا تبعتلي بروشور", "مش مهتم", "وقفوا رسائل", "ما تتصلوا فيي",
  ]) {
    test(`"${text}" does nothing`, () => {
      const t = last(["taishan", text]);
      nothingPushed(t, text);
      assert.ok(!t.decision.actions.some((a) => a.type === "SHOW_COLOUR_CHOICES" || a.type === "SHOW_MODEL_CHOICES"), text);
      assert.notEqual(t.decision.nextState.activeModel, text.includes("Dream") ? "DREAM" : text.includes("Courage") ? "COURAGE" : "—", `${text}: the car named in a refusal is not activated`);
    });
  }
});

/* ═════════════ owners ═════════════ */

describe("an existing owner with a problem is never sent sales media", () => {
  for (const text of [
    "My Voyah Free screen is frozen.", "I own a courage and it's not working", "I bought a Dream from you and there's a noise", "we took delivery last month and the key is lost",
    "our car has a vibration", "problem with my taishan", "issue with my mhero 1", "my free is broken", "my courage shows an error", "service my courage please", "my passion was damaged in an accident",
    "عندي مشكلة بالـ Free", "الشاشة علقت", "السيارة ما عم تشتغل", "عندي مطالبة كفالة", "siyarte ma 3am teshtghil", "screen 3ale2",
  ]) {
    test(text, () => {
      const t = last([text]);
      assert.equal(files(t).length, 0, text);
      assert.ok(!t.decision.actions.some((a) => a.type === "SHOW_COLOUR_CHOICES" || a.type === "SEND_COLOUR_VIDEO" || a.type === "SEND_BROCHURE"), text);
      assert.match(words(t), /76 877 278/, text);
      assert.equal(t.decision.nextState.activeModel, null, text);
    });
  }
});

/* ═════════════ one alert ═════════════ */

describe("many intents in one message are ONE alert", () => {
  for (const text of [
    "I want to buy the Courage if you have it in stock. Can I finance it over 5 years and test drive tomorrow?",
    "How much is the Taishan, do you have black, and can I come tomorrow?",
    "I want a Dream, trade my BMW and pay the rest monthly.",
    "Is the MHERO 2 available? I'll buy one if you can finance it.",
    "Can you reserve a Courage and call me at 71222333?",
  ]) {
    test(text, () => {
      const t = last([text]);
      assert.equal(alerts(t).length, 1, tags(t).join(","));
      assert.ok((alerts(t)[0].tags ?? []).length >= 2, `every reason is a tag: ${tags(t).join(",")}`);
      assert.equal(alerts(t)[0].models.length, 1);
    });
  }
  test("the phone number typed with a reservation reaches Sales, normalised", () => {
    assert.equal(alerts(last(["Can you reserve a Courage and call me at 71222333?"]))[0].phone, "96171222333");
  });
});

/* ═════════════ typos ═════════════ */

describe("typos help, and never invent a car", () => {
  test("a misspelt model is that model or nothing — never another one", () => {
    for (const [text, code] of [
      ["drream", "DREAM"], ["dreem", "DREAM"], ["drem", "DREAM"], ["pasion", "PASSION"], ["passon", "PASSION"], ["courrage", "COURAGE"], ["corage", "COURAGE"],
      ["free318", "FREE_318"], ["free 31", "FREE_318"], ["taishen", "TAISHAN"], ["taisan", "TAISHAN"], ["mhero1", "MHERO_1"], ["mhero2", "MHERO_2"],
    ]) {
      const got = modelOf(last([`${text} price`]));
      assert.ok(got === code || got === null, `${text} → ${got}`);
    }
    for (const [text, code] of [["corage price", "COURAGE"], ["taishen range", "TAISHAN"], ["free318 rnge", "FREE_318"], ["mhero1 hp", "MHERO_1"]]) isCar(text, code);
    assert.equal(modelOf(last(["m hero"])), null, "'m hero' alone asks which MHERO");
  });
  test("misspelt questions are still the question", () => {
    for (const [text, intent] of [
      ["batery", "BATTERY"], ["battrey", "BATTERY"], ["charing", "CHARGING"], ["chargng", "CHARGING"], ["rnge", "RANGE"], ["warrnty", "WARRANTY"], ["waranty", "WARRANTY"],
      ["instalment", "FINANCING"], ["installment", "FINANCING"], ["instalmnt", "FINANCING"], ["avilable", "AVAILABILITY"], ["availble", "AVAILABILITY"],
      ["brocher", "BROCHURE"], ["brochur", "BROCHURE"], ["colur", "COLOUR"], ["collor", "COLOUR"],
    ] as const) assert.ok(readMessage(`courage ${text}`, null).intents.includes(intent), `${text} → ${readMessage(`courage ${text}`, null).intents.join(",")}`);
  });
});

/* ═════════════ Arabizi and Arabic ═════════════ */

describe("Arabizi and Arabic", () => {
  test("Arabizi", () => {
    // "bade Free": "I want the Free" or "I want it free" — ambiguous: asked, never media.
    const bade = last(["bade Free"]);
    assert.equal(modelOf(bade), null);
    assert.equal(files(bade).length, 0);
    for (const text of ["hayda free?", "service free?", "3ande dream car", "passion taba3e lal cars"]) incidental(text);
    isCar("bade dream", "DREAM");
    isCar("3andkon Courage?", "COURAGE");
    assert.match(words(last(["3andkon siyarat kahraba?"])), /fully electric/);
    for (const [text, intent] of [
      ["ade se3ra?", "PRICE"], ["ade range?", "RANGE"], ["fi stock?", "AVAILABILITY"], ["bade 7ada ye7kine", "HUMAN_HANDOFF"], ["fik tetsel fine?", "CALLBACK"], ["ma bade video", "NO_VIDEO"],
      ["ma bade brochure", "NO_BROCHURE"], ["bade eshtere", "BUYING_INTENT"], ["bade badel siyarte", "TRADE_IN"], ["btishtro siyarat?", "TRADE_IN"], ["fi ta2sit?", "FINANCING"],
      ["wen ma7alkon?", "LOCATION"], ["fat7in lyom?", "OPENING_HOURS"], ["bade service", "SERVICE"],
    ] as const) assert.ok(asked(text).includes(intent), `${text} → ${asked(text).join(",")}`);
    assert.ok(!asked("ma bade eshtere").includes("BUYING_INTENT"));
    assert.ok(last(["courage", "fi black?"]).decision.actions.some((a) => a.type === "SEND_COLOUR_VIDEO"));
    // A day and an hour in Arabizi, once a test drive is being arranged.
    assert.match(words(last(["courage", "test drive", "bokra 3al 4"])), /passed Fri 18 Sep, 16:00/);
    assert.match(words(last(["courage", "test drive", "a7ad 3al 3"])), /closed on Sundays/);
  });

  test("Arabic", () => {
    for (const text of ["الخدمة مجانية؟", "الشاحن مجاني؟", "هيدي سيارة أحلامي", "السيارات شغفي"]) incidental(text);
    isCar("عندكم سيارة Free؟", "FREE_318");
    isCar("بدي الـ Free 318", "FREE_318");
    isCar("عندكم Passion؟", "PASSION");
    for (const [text, intent] of [
      ["ما بدي فيديو", "NO_VIDEO"], ["لا تبعتلي بروشور", "NO_BROCHURE"], ["مش مهتم", "NOT_INTERESTED"], ["وقفوا رسائل", "OPT_OUT"], ["ما تتصلوا فيي", "DECLINE"], ["بدي حدا يحكيني", "HUMAN_HANDOFF"],
      ["بدي اشتري", "BUYING_INTENT"], ["بتشتروا سيارات؟", "TRADE_IN"], ["بدي بدل سيارتي", "TRADE_IN"], ["في تقسيط؟", "FINANCING"], ["في تمويل؟", "FINANCING"], ["خمس سنين؟", "FINANCING"],
      ["وين فيني إشحن؟", "PUBLIC_CHARGING"], ["الشاحن بيجي معها؟", "CHARGER_INCLUDED"], ["البطارية آمنة؟", "SAFETY"], ["قديش عمر البطارية؟", "BATTERY_LIFE"], ["البطارية قديش حجمها؟", "BATTERY"],
      ["عندي مطالبة كفالة", "WARRANTY_CLAIM"], ["الشاشة علقت", "OWNER_ISSUE"], ["السيارة ما عم تشتغل", "OWNER_ISSUE"], ["وين موقعكم؟", "LOCATION"], ["وين بتنصنع Voyah؟", "BRAND_ORIGIN"], ["مين بيصنع Voyah؟", "BRAND_ORIGIN"],
    ] as const) assert.ok(asked(text).includes(intent), `${text} → ${asked(text).join(",")}`);
  });
});

/* ═════════════ the four states ═════════════ */

describe("the four states, as the resolver reports them", () => {
  const v = vocabularyWords();
  const ctx = { offeredCarIds: [] as string[], discussedCarIds: [] as string[], adCarId: null as string | null, intentWords: v.single, carTalkWords: v.carTalk };
  const dreamId = "voyah-dream";
  test("explicit · contextual · ambiguous · incidental", () => {
    assert.equal(resolveModels("voyah dream", catalog, ctx).mentions[0].state, "explicit");
    assert.equal(resolveModels("dream price", catalog, ctx).mentions[0].state, "explicit");
    assert.equal(resolveModels("dream is nice", catalog, { ...ctx, discussedCarIds: [dreamId] }).mentions[0].state, "contextual");
    assert.equal(resolveModels("dream is nice", catalog, { ...ctx, offeredCarIds: [dreamId] }).mentions[0].state, "contextual");
    assert.equal(resolveModels("dream is nice", catalog, { ...ctx, adCarId: dreamId }).mentions[0].state, "contextual");
    assert.equal(resolveModels("dream is nice", catalog, ctx).mentions[0].state, "ambiguous");
    const incidentalUse = resolveModels("it's my dream car", catalog, ctx);
    assert.equal(incidentalUse.mentions.length, 0);
    assert.equal(incidentalUse.rejected[0].state, "incidental");
    // Only explicit and contextual are "strong": the engine acts on nothing else.
    for (const m of resolveModels("dream is nice", catalog, ctx).mentions) assert.equal(m.confidence, "weak");
  });
});
