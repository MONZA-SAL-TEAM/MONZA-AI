/**
 * Our own test chats (Samer, 2026-09-16: "treat the following number as a test
 * number 03195955"): which messages are ours rather than a customer's, and the
 * one-way relationship between that list and the autoreply pilot's.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { TEST_CHATS, isTestChat, testPhonesE164, type TestChat } from "@/lib/channels/test-chats";
import { AUTOREPLY_PILOT } from "@/lib/wasales/autoreply-pilot";
import { normalizeLebanesePhone } from "@/lib/leads/phone";

const wa = (peer: string) => ({ channel: "whatsapp", accountId: "wa-monza", peerExternalId: peer });

describe("the listed numbers", () => {
  test("03195955 is a test number, however it is written", () => {
    // WhatsApp sends it one way; a person writes it five.
    for (const written of [
      "9613195955",
      "+9613195955",
      "+961 3 195 955",
      "009613195955",
      "03195955",
      "03 195 955",
      "3195955",
    ]) {
      assert.equal(isTestChat(wa(written)), true, written);
    }
  });

  test("it is the same number on any WhatsApp account of ours", () => {
    // A phone belongs to a person, not to the account they wrote to.
    assert.equal(isTestChat({ ...wa("9613195955"), accountId: "wa-voyah" }), true);
  });

  test("another number is a customer", () => {
    for (const other of ["9613195956", "961319595", "96170708585", "9613195955123"]) {
      assert.equal(isTestChat(wa(other)), false, other);
    }
  });

  test("nothing unplaceable matches", () => {
    // A number that cannot be normalised matches NOTHING — comparing raw
    // strings is how one truncated number would match another.
    for (const junk of ["", "   ", "abc", "0", "+1 555 0100"]) {
      assert.equal(isTestChat(wa(junk)), false, JSON.stringify(junk));
    }
  });

  test("the same digits on Instagram are a stranger, not the test number", () => {
    // Instagram ids are account-scoped opaque ids; they are not phone numbers
    // however numeric they look (lib/leads/store.ts).
    assert.equal(
      isTestChat({ channel: "instagram", accountId: "ig-voyah", peerExternalId: "9613195955" }),
      false
    );
    assert.equal(
      isTestChat({ channel: "facebook", accountId: "fb-monza", peerExternalId: "9613195955" }),
      false
    );
  });

  test("every listed WhatsApp number can actually be normalised", () => {
    // An entry that does not normalise matches nothing and would sit in the
    // list looking like protection it does not give.
    for (const t of TEST_CHATS) {
      if (t.channel !== "whatsapp") continue;
      assert.notEqual(normalizeLebanesePhone(t.phone), null, t.phone);
    }
    assert.deepEqual(testPhonesE164(), ["9613195955"]);
  });

  test("an Instagram or Messenger entry is scoped to one account", () => {
    const chats: TestChat[] = [
      { channel: "instagram", accountId: "ig-voyah", peer: "17841400000000000", note: "a tester" },
    ];
    const at = (accountId: string) => ({
      channel: "instagram",
      accountId,
      peerExternalId: "17841400000000000",
    });
    assert.equal(isTestChat(at("ig-voyah"), chats), true);
    assert.equal(isTestChat(at("ig-mhero"), chats), false, "the same id on another account is someone else");
  });
});

describe("the pilot and the test list are separate, one way", () => {
  test("every chat the pilot may answer by itself is one of ours", () => {
    // The guard that matters during the pilot: no machine answers a real
    // customer without a person (CLAUDE.md rule 24). If this ever fails it is
    // because the pilot was widened — that is Samer's decision to make
    // deliberately, here, not a line to delete to make a test pass.
    for (const chat of AUTOREPLY_PILOT.chats) {
      const channel = chat.accountId.startsWith("wa-")
        ? "whatsapp"
        : chat.accountId.startsWith("ig-")
          ? "instagram"
          : "facebook";
      assert.equal(
        isTestChat({ channel, accountId: chat.accountId, peerExternalId: chat.peer }),
        true,
        `${chat.accountId}:${chat.peer} is answered automatically but is not a listed test chat`
      );
    }
  });

  test("being a test number does not switch automation on", () => {
    // The dependency runs one way. Listing a number here says "not a
    // customer"; it never says "a machine may answer it".
    assert.equal(
      TEST_CHATS.length >= AUTOREPLY_PILOT.chats.length,
      true,
      "the pilot cannot hold chats the test list does not"
    );
  });
});
