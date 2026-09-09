/**
 * Identity resolution.
 *
 * This is the code allowed to conclude, with no human involved, that two
 * records are one person. A wrong conclusion writes one customer's
 * conversations onto another customer's profile and nobody finds out for
 * weeks. So the tests here are mostly about what the matcher REFUSES to do.
 *
 * Three properties are under test:
 *
 *  1. Every shape a Lebanese number arrives in reduces to one string, and
 *     anything the file does not genuinely understand reduces to nothing.
 *  2. Only a MOBILE number can auto-link. Landlines and names cannot, ever.
 *  3. A name match is ranked usefully but is never, under any score, a link.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  formatLebanesePhone,
  isAutoLinkable,
  isLebaneseNational,
  isMobileNational,
  normalizeLebanesePhone,
  samePhone,
} from "@/lib/leads/phone";
import {
  MAX_SUGGESTIONS,
  SUGGESTION_FLOOR,
  decide,
  nameScore,
  nameTokens,
  type MatchCandidate,
} from "@/lib/leads/matching";

describe("Lebanese phone normalisation", () => {
  test("the four shapes one number actually arrives in all agree", () => {
    // Samer's own number, as WhatsApp sends it, as the CRM stores it, as a
    // staff member types it, and as a customer writes it.
    const shapes = [
      "96170708585",
      "+961 70 708 585",
      "+961-70-708-585",
      "00961 70 708 585",
      "70 708 585",
      "70708585",
      "070 708 585",
    ];
    for (const s of shapes) {
      assert.equal(
        normalizeLebanesePhone(s),
        "96170708585",
        `${s} should normalise to 96170708585`
      );
    }
  });

  test("the trunk zero is dropped, not absorbed into the country code", () => {
    // The classic bug: "03 123456" becoming "9610312 3456".
    assert.equal(normalizeLebanesePhone("03 123456"), "9613123456");
    assert.equal(normalizeLebanesePhone("3123456"), "9613123456");
    assert.equal(normalizeLebanesePhone("+961 3 123 456"), "9613123456");
    // Even when somebody wrongly writes the country code AND the trunk zero.
    assert.equal(normalizeLebanesePhone("+961 03 123456"), "9613123456");
  });

  test("every Lebanese mobile prefix is recognised", () => {
    for (const p of ["70", "71", "76", "78", "79", "81"]) {
      const n = normalizeLebanesePhone(`${p}123456`);
      assert.equal(n, `961${p}123456`, `prefix ${p} should normalise`);
      assert.ok(isMobileNational(`${p}123456`), `prefix ${p} should be mobile`);
    }
    assert.ok(isMobileNational("3123456"), "03 range should be mobile");
  });

  test("landlines normalise but are not mobile", () => {
    assert.equal(normalizeLebanesePhone("01 123456"), "9611123456");
    assert.ok(isLebaneseNational("1123456"));
    assert.equal(isMobileNational("1123456"), false);
  });

  test("what it does not understand, it refuses", () => {
    const rejected = [
      "",
      "   ",
      "abc",
      "12",                  // too short to be anything
      "961",                 // country code alone
      "1234",                // no valid national shape
      "+33 6 12 34 56 78",   // French — a real number, but not ours to read
      "+1 415 555 0100",     // American
      "9612123456",          // 2 is not a Lebanese area or mobile prefix
      "707085850000",        // too long
    ];
    for (const r of rejected) {
      assert.equal(
        normalizeLebanesePhone(r),
        null,
        `${JSON.stringify(r)} should be refused, not guessed at`
      );
    }
    assert.equal(normalizeLebanesePhone(null), null);
    assert.equal(normalizeLebanesePhone(undefined), null);
  });

  test("two numbers that both fail to normalise are NOT equal", () => {
    // Comparing raw strings would call these a match and link two strangers.
    assert.equal(samePhone("abc", "abc"), false);
    assert.equal(samePhone("", ""), false);
    assert.equal(samePhone("12", "12"), false);
    assert.equal(samePhone(null, null), false);
  });

  test("only mobiles are auto-linkable", () => {
    assert.ok(isAutoLinkable("+961 70 708 585"), "mobile links itself");
    assert.ok(isAutoLinkable("03 123456"), "the 03 range is mobile");
    // A landline is a household: a husband, a wife and an office share it.
    assert.equal(isAutoLinkable("01 123456"), false, "landline must not link");
    assert.equal(isAutoLinkable("+33 6 12 34 56 78"), false, "foreign must not link");
    assert.equal(isAutoLinkable(null), false);
  });

  test("the display form is never used for comparison", () => {
    assert.equal(formatLebanesePhone("96170708585"), "+961 70 708 585");
    assert.equal(formatLebanesePhone("3123456"), "+961 3 123 456");
    // Something it cannot parse comes back as typed, rather than vanishing
    // from a staff member's screen.
    assert.equal(formatLebanesePhone("+33 6 12 34 56 78"), "+33 6 12 34 56 78");
  });
});

describe("name tokens", () => {
  test("Instagram display-name decoration is stripped", () => {
    assert.deepEqual(nameTokens("K a r i m ✨"), []);
    assert.deepEqual(nameTokens("karim.haddad_92"), ["karim", "haddad"]);
    assert.deepEqual(nameTokens("🔥 Karim Haddad 🔥"), ["karim", "haddad"]);
  });

  test("transliteration families collapse", () => {
    assert.deepEqual(nameTokens("Mohammad"), nameTokens("Mohamed"));
    assert.deepEqual(nameTokens("Kareem"), nameTokens("Karim"));
    assert.deepEqual(nameTokens("Khalid"), nameTokens("Khaled"));
  });

  test("words that describe everybody are dropped", () => {
    assert.deepEqual(nameTokens("Voyah Lebanon Official"), ["voyah"]);
    assert.deepEqual(nameTokens("Mr Elie El Khoury"), ["elie", "khoury"]);
  });
});

describe("name scoring", () => {
  test("a first name alone is capped below trust", () => {
    // Every Karim in the book scores here. That is fine — it ranks a queue —
    // but it must never look like a confident answer.
    const s = nameScore("Karim", "Karim Haddad");
    assert.ok(s > 0, "a shared given name is worth showing");
    assert.ok(s <= 0.55, `a lone given name must stay weak, got ${s}`);
  });

  test("given name AND surname is the case worth surfacing", () => {
    const s = nameScore("Karim Haddad", "Karim Haddad");
    assert.ok(s >= 0.9, `full-name agreement should rank high, got ${s}`);
    assert.ok(nameScore("Kareem Hadad", "Karim Haddad") >= 0.9, "spelling variants too");
  });

  test("short similar names do NOT collapse into each other", () => {
    // One edit apart, and different people. Tolerance on four-letter tokens
    // would merge half of Lebanon.
    assert.equal(nameScore("Sami", "Rami"), 0);
    assert.equal(nameScore("Ali", "Adi"), 0);
  });

  test("nothing to compare scores nothing", () => {
    assert.equal(nameScore(null, "Karim Haddad"), 0);
    assert.equal(nameScore("", "Karim Haddad"), 0);
    assert.equal(nameScore("✨🔥", "Karim Haddad"), 0);
  });
});

/* ── The decision itself ─────────────────────────────────────────────────── */

const CANDIDATES: MatchCandidate[] = [
  { crmCustomerId: "c-karim", name: "Karim Haddad", phones: ["+961 70 708 585"] },
  { crmCustomerId: "c-karim2", name: "Karim Khoury", phones: ["03 123456"] },
  { crmCustomerId: "c-rana", name: "Rana Saad", phones: ["+961 71 400 400"] },
  { crmCustomerId: "c-office", name: "Haddad Trading", phones: ["01 123456"] },
];

describe("the match decision", () => {
  test("a mobile match links, with no human asked", () => {
    const d = decide({ displayName: "whoever", phone: "96170708585" }, CANDIDATES);
    assert.equal(d.kind, "link");
    if (d.kind !== "link") return;
    assert.equal(d.crmCustomerId, "c-karim");
    assert.equal(d.method, "phone_exact");
    assert.equal(d.confidence, 1);
  });

  test("a phone match wins even when another customer shares the name", () => {
    // The subject is called "Karim Khoury" but writes from Karim Haddad's
    // number. Certainty must not be demoted to a suggestion by a name clash.
    const d = decide(
      { displayName: "Karim Khoury", phone: "+961 70 708 585" },
      CANDIDATES
    );
    assert.equal(d.kind, "link");
    if (d.kind !== "link") return;
    assert.equal(d.crmCustomerId, "c-karim", "the NUMBER decides, not the name");
  });

  test("a landline never links, however exactly it matches", () => {
    const d = decide({ displayName: "Haddad Trading", phone: "01 123456" }, CANDIDATES);
    assert.notEqual(d.kind, "link", "a shared household line is not an identity");
  });

  test("a name match is ALWAYS a suggestion, never a link", () => {
    // Instagram: no phone number exists at all. This is the common case.
    const d = decide({ displayName: "Karim Haddad", phone: null }, CANDIDATES);
    assert.equal(d.kind, "suggest");
    if (d.kind !== "suggest") return;
    assert.ok(d.suggestions.length >= 1);
    for (const s of d.suggestions) {
      assert.equal(s.method, "name_similar");
      assert.ok(s.score >= SUGGESTION_FLOOR);
    }
    // The strongest one is the right person — the queue is ordered usefully.
    assert.equal(d.suggestions[0].crmCustomerId, "c-karim");
  });

  test("no decision path can ever return a name-based link", () => {
    // The property, stated directly: sweep a wide range of subjects and assert
    // that every LINK produced is a phone one. This is the invariant the
    // database also enforces; if either ever gives way, the other holds.
    const subjects = [
      { displayName: "Karim Haddad", phone: null },
      { displayName: "Karim Haddad", phone: "01 123456" },
      { displayName: "Karim Haddad", phone: "abc" },
      { displayName: "Karim Haddad", phone: "+33 6 12 34 56 78" },
      { displayName: "Rana Saad", phone: "" },
      { displayName: "Haddad Trading", phone: "01 123456" },
    ];
    for (const s of subjects) {
      const d = decide(s, CANDIDATES);
      if (d.kind === "link") {
        assert.equal(
          d.method,
          "phone_exact",
          `${JSON.stringify(s)} produced a non-phone link`
        );
        assert.ok(
          isAutoLinkable(s.phone),
          `${JSON.stringify(s)} linked on a number that is not auto-linkable`
        );
      }
    }
  });

  test("a stranger produces nothing rather than a bad guess", () => {
    const d = decide({ displayName: "Wassim Chehab", phone: null }, CANDIDATES);
    assert.equal(d.kind, "none");
  });

  test("the queue is bounded", () => {
    const many: MatchCandidate[] = Array.from({ length: 40 }, (_, i) => ({
      crmCustomerId: `c-${i}`,
      name: "Karim Haddad",
      phones: [],
    }));
    const d = decide({ displayName: "Karim Haddad", phone: null }, many);
    assert.equal(d.kind, "suggest");
    if (d.kind !== "suggest") return;
    assert.ok(
      d.suggestions.length <= MAX_SUGGESTIONS,
      "forty identical names must not all be shown"
    );
  });

  test("no candidates is not an error", () => {
    assert.equal(decide({ displayName: "Karim", phone: "70708585" }, []).kind, "none");
  });
});
