/**
 * The words the sales engine reads: model names as customers type them —
 * Latin, Arabic and Arabizi — a brand with no model ("the mhero"), "which
 * one" answers, and open enquiries.
 *
 * The engine tests prove the conversation; these prove the reading underneath
 * it, one rule at a time, so a failure names the rule rather than a step.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  familyMentioned,
  isOpenEnquiry,
  matchModel,
  matchTokens,
  normalize,
  pickAmong,
  sameWord,
  wordForms,
  type WaCar,
} from "@/lib/wasales/matcher";

function car(id: string, name: string, aliases: string[]): WaCar {
  return {
    id,
    name,
    enabled: true,
    aliases,
    videos: [],
    colours: [],
    brochure: null,
    oneLiner: "",
  };
}

const MHERO_1 = car("mhero-1", "Mhero 1", ["mhero 1", "917"]);
const MHERO_2 = car("mhero-2", "Mhero 2", ["mhero 2", "817"]);
const FREE = car("free", "Voyah Free Comp", ["free", "voyah free", "فري"]);
const DREAM = car("dream", "Voyah Dream", ["dream"]);
const COURAGE = car("courage", "Voyah Courage", ["courage", "كوراج"]);
const PASSION = car("passion", "Voyah Passion", ["passion", "باشن"]);
const PASSION_L = car("passion-l", "Voyah Passion L", ["passion l", "باشن l"]);
const CATALOG = [MHERO_1, MHERO_2, FREE, DREAM, COURAGE, PASSION, PASSION_L];

describe("normalize — Unicode-aware, Arabic kept", () => {
  test("Latin punctuation, emoji and accents", () => {
    assert.equal(normalize("Pasion-L!!  😍 "), "pasion l");
    assert.equal(normalize("Café, s'il vous plaît"), "cafe s il vous plait");
    assert.equal(normalize("ＦＲＥＥ"), "free", "fullwidth letters");
  });

  test("Arabic survives, with its spelling variants folded", () => {
    assert.equal(normalize("سعر الكوراج؟"), "سعر الكوراج");
    assert.equal(normalize("أسعار"), "اسعار", "hamza on alef");
    assert.equal(normalize("إلى"), "الي", "hamza below, alef maksura");
    assert.equal(normalize("سيارة"), "سياره", "taa marbuta");
    assert.equal(normalize("مرحبـــا"), "مرحبا", "tatweel");
    assert.equal(normalize("مَرْحَبًا"), "مرحبا", "harakat");
  });

  test("Arabic-Indic digits become western digits", () => {
    assert.equal(normalize("فري ٣١٨"), "فري 318");
    assert.equal(normalize("۸۱۷"), "817");
  });

  test("invisible format characters never split a word", () => {
    assert.equal(normalize("pass‌ion"), "passion");
  });

  test("Arabizi digits stay inside their words", () => {
    assert.equal(normalize("Ade se3er?"), "ade se3er");
  });
});

describe("Arabic prefixes", () => {
  test("'and', 'the', 'with the' come off the front", () => {
    assert.deepEqual(wordForms("والسعر"), ["والسعر", "سعر", "السعر"]);
    assert.ok(sameWord("كوراج", "الكوراج"));
    assert.ok(sameWord("اسود", "بالاسود"));
    assert.ok(!sameWord("كوراج", "كاراج"), "garage is not Courage");
  });

  test("a Latin word has one form", () => {
    assert.deepEqual(wordForms("courage"), ["courage"]);
  });
});

describe("matchTokens", () => {
  test("glued model numbers come apart", () => {
    assert.deepEqual(matchTokens("MHERO1?"), ["mhero", "1"]);
    assert.deepEqual(matchTokens("the 2nd"), ["the", "2", "nd"]);
    assert.deepEqual(matchTokens("917"), ["917"]);
  });

  test("'mhero1' finds the Mhero 1", () => {
    assert.equal(matchModel("price of mhero1", CATALOG).model?.id, "mhero-1");
  });
});

describe("models in Arabic", () => {
  test("the Arabic name, with or without 'the', finds the car", () => {
    assert.equal(matchModel("سعر الكوراج", CATALOG).model?.id, "courage");
    assert.equal(matchModel("كوراج", CATALOG).model?.id, "courage");
    assert.equal(matchModel("بدي الفري", CATALOG).model?.id, "free");
  });

  test("Arabic is never typo-matched: 'garage' is not the Courage", () => {
    assert.equal(matchModel("وين الكاراج", CATALOG).decision, "hold");
  });

  test("the Passion L still needs its L, in Arabic too", () => {
    assert.equal(matchModel("باشن", CATALOG).model?.id, "passion");
    assert.equal(matchModel("باشن L", CATALOG).model?.id, "passion-l");
  });
});

describe("'free' is the car, except in everyday phrases", () => {
  test("customers asking for the Free get it", () => {
    for (const text of ["is the free available?", "free", "info about free please"]) {
      assert.equal(matchModel(text, CATALOG).model?.id, "free", text);
    }
  });

  test("'feel free', 'for free', 'are you free' mean nothing", () => {
    for (const text of [
      "feel free to call me",
      "is the test drive for free?",
      "are you free tomorrow",
      "is delivery free of charge",
    ]) {
      assert.equal(matchModel(text, CATALOG).decision, "hold", text);
    }
  });

  test("the car still wins when a phrase sits beside it", () => {
    assert.equal(matchModel("feel free to send the free brochure", CATALOG).model?.id, "free");
  });
});

describe("familyMentioned", () => {
  test("a brand with two models returns both, in catalogue order", () => {
    for (const text of ["the mhero", "m hero?", "MHERO", "mhiro info"]) {
      assert.deepEqual(
        familyMentioned(text, CATALOG).map((c) => c.id),
        ["mhero-1", "mhero-2"],
        text
      );
    }
  });

  test("'voyah' alone is the Voyah line", () => {
    assert.deepEqual(
      familyMentioned("voyah?", CATALOG).map((c) => c.id),
      ["free", "dream", "courage", "passion", "passion-l"]
    );
  });

  test("ordinary words are not brands", () => {
    for (const text of ["hi", "where are you", "hello there", "yeah"]) {
      assert.deepEqual(familyMentioned(text, CATALOG), [], text);
    }
  });
});

describe("pickAmong", () => {
  const TWO = [MHERO_1, MHERO_2];

  test("the part that tells them apart is an answer", () => {
    assert.equal(pickAmong("2", TWO)?.id, "mhero-2");
    assert.equal(pickAmong("number 1 please", TWO)?.id, "mhero-1");
  });

  test("ordinals point at the order they were offered in", () => {
    assert.equal(pickAmong("the second one", TWO)?.id, "mhero-2");
    assert.equal(pickAmong("1st", TWO)?.id, "mhero-1");
    assert.equal(pickAmong("the first", TWO)?.id, "mhero-1");
  });

  test("no answer, or both, is null", () => {
    assert.equal(pickAmong("not sure", TWO), null);
    assert.equal(pickAmong("1 or 2?", TWO), null);
    assert.equal(pickAmong("2", [MHERO_2]), null, "nothing to choose between");
  });
});

describe("isOpenEnquiry", () => {
  test("asking about the cars without naming one", () => {
    for (const text of [
      "hi can i get more information",
      "what cars do you have?",
      "I'm interested, send me the catalogue",
    ]) {
      assert.equal(isOpenEnquiry(text), true, text);
    }
  });

  test("real questions a person should answer are not enquiries", () => {
    for (const text of [
      "what time do you open tomorrow?",
      "how much is it",
      "where is your showroom",
      "hi",
      "",
    ]) {
      assert.equal(isOpenEnquiry(text), false, text);
    }
  });
});
