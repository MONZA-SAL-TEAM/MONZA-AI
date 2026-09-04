/**
 * The auto-reply brain: which car is a first message about, and may anything
 * be sent without a person looking?
 *
 * The one failure mode this logic must never have is WRONG-BUT-CONFIDENT —
 * sending a customer the material for a car they did not ask about. Several
 * tests below encode defects that were caught in review and would otherwise be
 * easy to reintroduce, so each is labelled with what it protects.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  decide,
  editDistance,
  isBareGreeting,
  matchModel,
  normalize,
  type IncomingInput,
  type WaCar,
} from "@/lib/wasales/matcher";

function car(over: Partial<WaCar> & { id: string; name: string }): WaCar {
  return {
    enabled: true,
    aliases: [],
    videos: [{ label: "Walkaround", fileName: "clip.mp4" }],
    colours: [],
    brochure: { label: "Brochure", fileName: "spec.pdf" },
    oneLiner: "",
    ...over,
  };
}

const CATALOG: WaCar[] = [
  car({ id: "free", name: "Voyah Free", aliases: ["free", "voyah free"] }),
  car({ id: "dream", name: "Voyah Dream", aliases: ["dream", "dreem"] }),
  car({ id: "passion", name: "Voyah Passion", aliases: ["passion", "pasion"] }),
  car({
    id: "passion-l",
    name: "Voyah Passion L",
    aliases: ["passion l", "pasion l"],
  }),
  car({ id: "mhero", name: "MHERO 917", aliases: ["m hero", "917", "mhero"] }),
];

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

describe("normalize", () => {
  test("lowercases, strips punctuation and emoji, collapses whitespace", () => {
    assert.equal(normalize("Pasion-L!!  😍 "), "pasion l");
    assert.equal(normalize("MHERO   917?"), "mhero 917");
  });

  test("a message of only symbols normalizes to nothing", () => {
    assert.equal(normalize("!!! ??? 🚗"), "");
  });
});

describe("editDistance", () => {
  test("counts single edits", () => {
    assert.equal(editDistance("passion", "passion", 2), 0);
    assert.equal(editDistance("passion", "pasion", 2), 1);
  });

  test("bails out past the bound rather than computing a big distance", () => {
    assert.ok(editDistance("free", "completely-different", 1) > 1);
  });
});

describe("matchModel", () => {
  test("an exact name is matched exactly, and says so", () => {
    const m = matchModel("do you have the Voyah Free?", CATALOG);
    assert.equal(m.decision, "send");
    assert.equal(m.model?.id, "free");
    assert.equal(m.confidence, "exact");
  });

  test("a typo is corrected and reported as fuzzy", () => {
    const m = matchModel("info about the pashon please", CATALOG);
    assert.equal(m.decision, "send");
    assert.equal(m.model?.id, "passion");
    assert.equal(m.confidence, "fuzzy");
    assert.match(m.reason, /typo-tolerant/);
  });

  test("A VERBATIM ALIAS IS EXACT, not fuzzy", () => {
    // Telling a salesperson "we corrected a spelling" when nothing was
    // corrected is a false sentence on screen.
    const m = matchModel("m hero 917 details", CATALOG);
    assert.equal(m.confidence, "exact");
    assert.doesNotMatch(m.reason, /typo-tolerant/);
  });

  test("MOST-SPECIFIC-WINS: 'passion l' is the Passion L, not both", () => {
    const m = matchModel("price on the passion l", CATALOG);
    assert.equal(m.decision, "send");
    assert.equal(m.model?.id, "passion-l");
  });

  test("plain 'passion' is the Passion, never the variant", () => {
    const m = matchModel("tell me about the passion", CATALOG);
    assert.equal(m.decision, "send");
    assert.equal(m.model?.id, "passion");
  });

  test("two different cars is a hold naming both", () => {
    const m = matchModel("free or dream, which is better?", CATALOG);
    assert.equal(m.decision, "hold");
    assert.equal(m.contenders?.length, 2);
    assert.match(m.reason, /more than one car/);
  });

  test("no car mentioned is a hold", () => {
    assert.equal(matchModel("what are your opening hours?", CATALOG).decision, "hold");
    assert.equal(matchModel("", CATALOG).decision, "hold");
  });

  test("digits never fuzzy-match: 911 is not the 917", () => {
    assert.equal(matchModel("is the 911 available", CATALOG).decision, "hold");
  });

  test("a one-letter variant marker must be typed exactly", () => {
    // "passion k" must not fuzz onto "passion l" — one edit on a one-letter
    // token would match essentially anything.
    const m = matchModel("passion k", CATALOG);
    assert.equal(m.model?.id, "passion", "falls back to the base model");
  });

  test("A DISABLED CAR STILL COMPETES for the match", () => {
    // If disabled cars were filtered before resolution, a sibling model could
    // claim their words and the customer would receive the WRONG car.
    const withDisabled = CATALOG.map((c) =>
      c.id === "passion" ? { ...c, enabled: false } : c
    );
    const m = matchModel("the passion please", withDisabled);
    assert.equal(m.model?.id, "passion", "not silently reassigned to Passion L");
  });

  test("matchedText reports the words that actually identified the car", () => {
    const m = matchModel("hello, the passion l brochure please", CATALOG);
    assert.equal(m.matchedText, "passion l");
  });
});

describe("isBareGreeting", () => {
  test("greetings in several languages are recognised", () => {
    for (const t of ["hi", "Hello good morning", "marhaba", "merci!!", "kifak"]) {
      assert.equal(isBareGreeting(t), true, t);
    }
  });

  test("a greeting plus a real question is not bare", () => {
    assert.equal(isBareGreeting("hi, the voyah free please"), false);
  });

  test("an empty message is not a greeting", () => {
    assert.equal(isBareGreeting("   "), false);
  });
});

describe("decide — the guard rails, in order", () => {
  test("everything aligned sends", () => {
    const d = decide(incoming({ text: "the voyah free please" }), CATALOG);
    assert.equal(d.decision, "send");
    assert.equal(d.model?.id, "free");
  });

  test("(1) the master switch beats a perfect match", () => {
    const d = decide(
      incoming({ text: "the voyah free please", autoSendEnabled: false }),
      CATALOG
    );
    assert.equal(d.decision, "hold");
    assert.match(d.reason, /switched off/);
  });

  test("(2) a known number is never interrupted", () => {
    const d = decide(
      incoming({ text: "the voyah free please", isNewNumber: false }),
      CATALOG
    );
    assert.equal(d.decision, "hold");
    assert.match(d.reason, /already has a conversation/);
  });

  test("(3) only the first message of a thread can auto-send", () => {
    const d = decide(
      incoming({ text: "the voyah free please", isFirstMessage: false }),
      CATALOG
    );
    assert.equal(d.decision, "hold");
    assert.match(d.reason, /first message/);
  });

  test("(4) a bare greeting gets the greeting reason, not 'no car'", () => {
    const d = decide(incoming({ text: "hi" }), CATALOG);
    assert.equal(d.decision, "hold");
    assert.match(d.reason, /greeting/);
  });

  test("(5) two cars is a hold even when both are perfectly matched", () => {
    const d = decide(incoming({ text: "free vs dream" }), CATALOG);
    assert.equal(d.decision, "hold");
    assert.match(d.reason, /more than one car/);
  });

  test("(7) a disabled car HOLDS — it never sends a different car", () => {
    const withDisabled = CATALOG.map((c) =>
      c.id === "free" ? { ...c, enabled: false } : c
    );
    const d = decide(incoming({ text: "the voyah free please" }), withDisabled);
    assert.equal(d.decision, "hold");
    assert.match(d.reason, /switched off/);
  });

  test("(7) a car missing its brochure holds and says which piece is missing", () => {
    const noBrochure = CATALOG.map((c) =>
      c.id === "free" ? { ...c, brochure: null } : c
    );
    const d = decide(incoming({ text: "the voyah free please" }), noBrochure);
    assert.equal(d.decision, "hold");
    assert.match(d.reason, /brochure/);
  });

  test("(7) a car with no videos holds", () => {
    const noVideos = CATALOG.map((c) =>
      c.id === "free" ? { ...c, videos: [] } : c
    );
    const d = decide(incoming({ text: "the voyah free please" }), noVideos);
    assert.equal(d.decision, "hold");
    assert.match(d.reason, /videos/);
  });

  test("guard order: the master switch is checked before anything else", () => {
    // Everything else is also wrong here; the reason must still be the switch.
    const d = decide(
      incoming({
        text: "free or dream",
        autoSendEnabled: false,
        isNewNumber: false,
        isFirstMessage: false,
      }),
      CATALOG
    );
    assert.match(d.reason, /switched off/);
  });

  test("an ad prefill counts as ordinary evidence, whatever the source", () => {
    // Click-to-WhatsApp buttons prefill the first message; the matcher reads
    // the words and the source never changes the decision.
    for (const source of ["facebook", "instagram", "website", "direct"] as const) {
      const d = decide(
        incoming({ text: "More information about the Voyah Free please", source }),
        CATALOG
      );
      assert.equal(d.decision, "send", source);
      assert.equal(d.model?.id, "free");
    }
  });

  test("every hold carries a sentence a salesperson can read aloud", () => {
    const holds = [
      incoming({ text: "hi" }),
      incoming({ text: "free vs dream" }),
      incoming({ text: "what are your hours" }),
      incoming({ text: "voyah free", isNewNumber: false }),
      incoming({ text: "voyah free", autoSendEnabled: false }),
    ];
    for (const input of holds) {
      const d = decide(input, CATALOG);
      assert.equal(d.decision, "hold");
      assert.ok(d.reason.length > 20, d.reason);
      assert.doesNotMatch(d.reason, /_|null|undefined/, d.reason);
    }
  });

  test("an empty catalog can never send", () => {
    assert.equal(decide(incoming({ text: "voyah free" }), []).decision, "hold");
  });

  test("the same input always produces the same decision", () => {
    const input = incoming({ text: "pasion l please" });
    const first = decide(input, CATALOG);
    for (let i = 0; i < 25; i++) {
      assert.deepEqual(decide(input, CATALOG), first);
    }
  });
});
