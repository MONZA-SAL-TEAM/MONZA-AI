/**
 * The sales conversation flow.
 *
 * The behaviour being pinned down, in Jawad's words: a new customer asks about
 * a car, we ask which colour they want to see, and when they answer we send
 * that colour's videos plus the car's one brochure. If they say "any" — or
 * never name a colour — we pick one and send it.
 *
 * Colours are NEVER invented by the code: every colour in these tests is
 * supplied as data, exactly as the real ones will be once the sales folder is
 * imported. A car with no imported colours can never auto-send.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  INITIAL_STATE,
  MAX_COLOUR_ASKS,
  advance,
  type CarMedia,
  type SalesState,
} from "@/lib/wasales/flow";
import {
  defaultColour,
  listColourNames,
  readColourAnswer,
  sendableColours,
  type WaColour,
} from "@/lib/wasales/colours";
import type { IncomingInput, WaCar } from "@/lib/wasales/matcher";

/* ── Fixtures. Colour names here stand in for whatever the folder turns out to
      contain; nothing in lib/ ships a colour list of its own. ─────────────── */

const BLACK: WaColour = { id: "black", name: "Black", aliases: ["black", "noir"] };
const WHITE: WaColour = { id: "white", name: "White", aliases: ["white", "blanc"] };
const GREY: WaColour = { id: "grey", name: "Grey", aliases: ["grey", "gray"] };

function car(over: Partial<WaCar> & { id: string; name: string }): WaCar {
  return {
    enabled: true,
    aliases: [],
    videos: [],
    colours: [BLACK, WHITE, GREY],
    brochure: { label: "Brochure", fileName: "spec.pdf" },
    oneLiner: "",
    ...over,
  };
}

const MHERO = car({ id: "mhero", name: "MHERO 917", aliases: ["mhero", "m hero", "917"] });
const FREE = car({ id: "free", name: "Voyah Free", aliases: ["voyah free", "the free"] });
const CATALOG: WaCar[] = [MHERO, FREE];

/** Everything uploaded: a brochure and a video for all three colours. */
const FULL: CarMedia = {
  hasBrochure: true,
  videosByColour: { black: 1, white: 2, grey: 1 },
};

const media = (m: CarMedia = FULL) => () => m;

function incoming(over: Partial<IncomingInput> = {}): IncomingInput {
  return {
    text: "",
    isNewNumber: true,
    isFirstMessage: true,
    source: "direct",
    autoSendEnabled: true,
    ...over,
  };
}

/** Walk a whole conversation, returning every action in order. */
function conversation(
  messages: { text: string; first?: boolean }[],
  catalog: readonly WaCar[] = CATALOG,
  lookup = media()
) {
  let state: SalesState = INITIAL_STATE;
  const actions = [];
  for (let i = 0; i < messages.length; i++) {
    const result = advance(
      incoming({
        text: messages[i].text,
        isFirstMessage: messages[i].first ?? i === 0,
        isNewNumber: true,
      }),
      state,
      catalog,
      lookup
    );
    actions.push(result.action);
    state = result.next;
  }
  return { actions, state };
}

/* ── Reading a colour out of a message ───────────────────────────────────── */

describe("readColourAnswer", () => {
  const colours = [BLACK, WHITE, GREY];

  test("a colour we have is recognised", () => {
    const a = readColourAnswer("black please", colours);
    assert.equal(a.kind, "one");
    assert.equal(a.kind === "one" && a.colour.id, "black");
  });

  test("an alias in another language works", () => {
    const a = readColourAnswer("noir", colours);
    assert.equal(a.kind === "one" && a.colour.id, "black");
  });

  test("a typo is tolerated", () => {
    const a = readColourAnswer("whitte", colours);
    assert.equal(a.kind, "one");
    assert.equal(a.kind === "one" && a.colour.id, "white");
    assert.equal(a.kind === "one" && a.fuzzy, true);
  });

  test("a short colour word is NOT fuzzy-matched", () => {
    // "red" and "grey" are close enough that slack would confuse them.
    const a = readColourAnswer("gray", colours);
    assert.equal(a.kind === "one" && a.colour.id, "grey", "exact alias still works");
  });

  test("'any' is an ANSWER, not a failure to understand", () => {
    for (const text of [
      "any",
      "any colour",
      "whatever you have",
      "you choose",
      "doesnt matter",
      "3adi",
    ]) {
      assert.equal(readColourAnswer(text, colours).kind, "no_preference", text);
    }
  });

  test("two colours at once is a comparison, not a choice", () => {
    const a = readColourAnswer("black or white?", colours);
    assert.equal(a.kind, "several");
  });

  test("a colour we do NOT have is told apart from nonsense", () => {
    assert.equal(readColourAnswer("do you have it in red", colours).kind, "unavailable");
    assert.equal(readColourAnswer("how much is it", colours).kind, "none");
  });

  test("an empty message answers nothing", () => {
    assert.equal(readColourAnswer("", colours).kind, "none");
  });
});

describe("colour helpers", () => {
  test("only colours with a video can be offered", () => {
    const sendable = sendableColours([BLACK, WHITE, GREY], { black: 1, white: 0 });
    assert.deepEqual(sendable.map((c) => c.id), ["black"]);
  });

  test("the default pick is the FIRST sendable colour, always the same", () => {
    const pick = defaultColour([BLACK, WHITE, GREY], { white: 3, grey: 1 });
    assert.equal(pick?.id, "white", "catalogue order decides, never randomness");
    for (let i = 0; i < 20; i++) {
      assert.equal(defaultColour([BLACK, WHITE, GREY], { white: 3, grey: 1 })?.id, "white");
    }
  });

  test("no sendable colour means no default", () => {
    assert.equal(defaultColour([BLACK], {}), null);
  });

  test("colour names read as a sentence", () => {
    assert.equal(listColourNames([BLACK, WHITE, GREY]), "Black, White or Grey");
    assert.equal(listColourNames([BLACK, WHITE]), "Black or White");
    assert.equal(listColourNames([BLACK]), "Black");
    assert.equal(listColourNames([]), "");
  });
});

/* ── The flow Jawad described ────────────────────────────────────────────── */

describe("THE FLOW: ask the colour, then send it", () => {
  test("a first message about one car asks which colour", () => {
    const { actions, state } = conversation([
      { text: "can i get more information about the mhero" },
    ]);
    assert.equal(actions[0].kind, "ask_colour");
    assert.equal(actions[0].kind === "ask_colour" && actions[0].car.id, "mhero");
    assert.match(
      actions[0].kind === "ask_colour" ? actions[0].message : "",
      /Black, White or Grey/
    );
    assert.equal(state.stage, "awaiting_colour");
  });

  test("the answer sends THAT colour plus the car's brochure", () => {
    const { actions, state } = conversation([
      { text: "can i get more information about the mhero" },
      { text: "black" },
    ]);
    const send = actions[1];
    assert.equal(send.kind, "send");
    assert.equal(send.kind === "send" && send.colour.id, "black");
    assert.equal(send.kind === "send" && send.car.id, "mhero");
    assert.equal(send.kind === "send" && send.chosenForThem, false);
    assert.deepEqual(state, { stage: "sent", carId: "mhero", colourId: "black" });
  });

  test("'any' sends our pick, and says we picked", () => {
    const { actions } = conversation([
      { text: "info about the mhero please" },
      { text: "any" },
    ]);
    const send = actions[1];
    assert.equal(send.kind, "send");
    assert.equal(send.kind === "send" && send.chosenForThem, true);
    assert.equal(send.kind === "send" && send.colour.id, "black", "first sendable");
  });

  test("naming the colour in the FIRST message skips the question", () => {
    // Asking something they already answered is what makes a robot obvious.
    const { actions, state } = conversation([
      { text: "can i get information about the black mhero" },
    ]);
    assert.equal(actions[0].kind, "send");
    assert.equal(actions[0].kind === "send" && actions[0].colour.id, "black");
    assert.equal(state.stage, "sent");
  });

  test("a car with only ONE colour never asks a pointless question", () => {
    const { actions } = conversation(
      [{ text: "the mhero please" }],
      CATALOG,
      media({ hasBrochure: true, videosByColour: { grey: 1 } })
    );
    assert.equal(actions[0].kind, "send");
    assert.equal(actions[0].kind === "send" && actions[0].colour.id, "grey");
  });

  test("with only one colour, the message never NAMES it or offers another", () => {
    // Two real cases: Voyah Dream, whose videos are not in colour folders at
    // all, and Mhero 1, whose Black folder is empty. Advertising a choice that
    // does not exist invites a request we then have to refuse.
    const { actions } = conversation(
      [{ text: "the mhero please" }],
      CATALOG,
      media({ hasBrochure: true, videosByColour: { grey: 1 } })
    );
    const message = actions[0].kind === "send" ? actions[0].message : "";
    assert.doesNotMatch(message, /Grey/i, "no colour is named");
    assert.doesNotMatch(message, /another colour/i, "no choice is implied");
    assert.match(message, /test drive/i, "still offers a next step");
  });

  test("with several colours, the message DOES name the one chosen", () => {
    const { actions } = conversation([
      { text: "mhero info" },
      { text: "white" },
    ]);
    const message = actions[1].kind === "send" ? actions[1].message : "";
    assert.match(message, /in White/);
    assert.match(message, /another colour/i);
  });

  test("THE SECOND MESSAGE IS ALLOWED — the first-message guard does not fire", () => {
    // The old rule refused anything that was not the first message. That would
    // have left the robot asking a question and then ignoring the answer.
    const { actions } = conversation([
      { text: "mhero info", first: true },
      { text: "white", first: false },
    ]);
    assert.equal(actions[1].kind, "send");
    assert.equal(actions[1].kind === "send" && actions[1].colour.id, "white");
  });
});

describe("the flow refuses to send anything it cannot back up", () => {
  test("NO COLOURS IMPORTED YET means no auto-send", () => {
    const noColours = [{ ...MHERO, colours: [] }];
    const { actions } = conversation(
      [{ text: "mhero info" }],
      noColours,
      media({ hasBrochure: true, videosByColour: {} })
    );
    assert.equal(actions[0].kind, "hold");
    assert.match(actions[0].kind === "hold" ? actions[0].reason : "", /videos/);
  });

  test("a colour with no video is never offered", () => {
    const { actions } = conversation(
      [{ text: "mhero info" }],
      CATALOG,
      media({ hasBrochure: true, videosByColour: { black: 1, grey: 1 } })
    );
    assert.equal(actions[0].kind, "ask_colour");
    const offered =
      actions[0].kind === "ask_colour" ? actions[0].colours.map((c) => c.id) : [];
    assert.deepEqual(offered, ["black", "grey"], "White has no video, so it is not offered");
  });

  test("no brochure means no auto-send, whatever the videos", () => {
    const { actions } = conversation(
      [{ text: "mhero info" }],
      CATALOG,
      media({ hasBrochure: false, videosByColour: { black: 3 } })
    );
    assert.equal(actions[0].kind, "hold");
    assert.match(actions[0].kind === "hold" ? actions[0].reason : "", /brochure/);
  });

  test("material disappearing mid-conversation is a hold, not a broken send", () => {
    let state: SalesState = INITIAL_STATE;
    const first = advance(incoming({ text: "mhero info" }), state, CATALOG, media());
    assert.equal(first.action.kind, "ask_colour");
    state = first.next;

    const gone = advance(
      incoming({ text: "black", isFirstMessage: false }),
      state,
      CATALOG,
      media({ hasBrochure: false, videosByColour: {} })
    );
    assert.equal(gone.action.kind, "hold");
  });
});

describe("the flow knows when to stop", () => {
  test("asking for a colour we do not have gets an honest answer, once", () => {
    const { actions, state } = conversation([
      { text: "mhero info" },
      { text: "do you have it in red" },
    ]);
    assert.equal(actions[1].kind, "reask_colour");
    assert.match(
      actions[1].kind === "reask_colour" ? actions[1].message : "",
      /do not have/
    );
    assert.equal(state.stage === "awaiting_colour" && state.timesAsked, 2);
  });

  test("asking twice is the limit — then a person takes over", () => {
    const { actions, state } = conversation([
      { text: "mhero info" },
      { text: "red" },
      { text: "purple" },
    ]);
    assert.equal(actions[2].kind, "hold");
    assert.equal(state.stage, "human");
    assert.equal(MAX_COLOUR_ASKS, 2);
  });

  test("changing the subject hands over rather than guessing", () => {
    const { actions, state } = conversation([
      { text: "mhero info" },
      { text: "actually what is the price and can i pay monthly" },
    ]);
    assert.equal(actions[1].kind, "hold");
    assert.equal(state.stage, "human");
  });

  test("two colours at once hands over — a comparison needs a person", () => {
    const { actions } = conversation([
      { text: "mhero info" },
      { text: "black or white" },
    ]);
    assert.equal(actions[1].kind, "hold");
    assert.match(actions[1].kind === "hold" ? actions[1].reason : "", /Black and White/);
  });

  test("ONCE THE MATERIAL IS SENT the robot goes quiet", () => {
    const { actions, state } = conversation([
      { text: "mhero info" },
      { text: "black" },
      { text: "thanks! can i see it tomorrow?" },
    ]);
    assert.equal(actions[2].kind, "hold");
    assert.equal(state.stage, "human");
  });

  test("the kill switch silences every stage, mid-conversation included", () => {
    let state: SalesState = INITIAL_STATE;
    state = advance(incoming({ text: "mhero info" }), state, CATALOG, media()).next;
    const off = advance(
      incoming({ text: "black", isFirstMessage: false, autoSendEnabled: false }),
      state,
      CATALOG,
      media()
    );
    assert.equal(off.action.kind, "hold");
    assert.match(off.action.kind === "hold" ? off.action.reason : "", /switched off/);
    assert.deepEqual(off.next, state, "the conversation is not advanced by a refusal");
  });

  test("the original first-message guards still hold at the start", () => {
    const known = advance(
      incoming({ text: "mhero info", isNewNumber: false }),
      INITIAL_STATE,
      CATALOG,
      media()
    );
    assert.equal(known.action.kind, "hold");
    assert.match(
      known.action.kind === "hold" ? known.action.reason : "",
      /already has a conversation/
    );

    const later = advance(
      incoming({ text: "mhero info", isFirstMessage: false }),
      INITIAL_STATE,
      CATALOG,
      media()
    );
    assert.match(
      later.action.kind === "hold" ? later.action.reason : "",
      /first message/
    );
  });

  test("a greeting, two cars, or no car still hold as before", () => {
    for (const text of ["hi", "mhero or the free?", "what are your hours"]) {
      const r = advance(incoming({ text }), INITIAL_STATE, CATALOG, media());
      assert.equal(r.action.kind, "hold", text);
    }
  });

  test("a switched-off car holds and never sends a sibling", () => {
    const offCatalog = CATALOG.map((c) =>
      c.id === "mhero" ? { ...c, enabled: false } : c
    );
    const { actions } = conversation([{ text: "mhero info" }], offCatalog);
    assert.equal(actions[0].kind, "hold");
    assert.match(actions[0].kind === "hold" ? actions[0].reason : "", /switched off/);
  });
});

describe("determinism", () => {
  test("the same conversation always produces the same actions", () => {
    const once = conversation([{ text: "mhero info" }, { text: "any" }]);
    for (let i = 0; i < 20; i++) {
      assert.deepEqual(conversation([{ text: "mhero info" }, { text: "any" }]), once);
    }
  });

  test("every message that goes out is real words, with no placeholders", () => {
    const { actions } = conversation([{ text: "mhero info" }, { text: "black" }]);
    for (const a of actions) {
      const text =
        a.kind === "hold" ? a.reason : "message" in a ? a.message : "";
      assert.ok(text.length > 20, a.kind);
      assert.doesNotMatch(text, /undefined|null|\{\{|_/, `${a.kind}: ${text}`);
    }
  });
});
