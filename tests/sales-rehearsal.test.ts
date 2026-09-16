/**
 * Rehearsal chats (Samer, 2026-09-16: "any time that number sends a message to
 * 70708585 always treat it as a client so that i can test all the questions").
 *
 * Two things are asserted here and they pull in opposite directions: the chat
 * must behave EXACTLY like a client's, and the one filter that exists to
 * silence test messages must not silence the person testing on purpose.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  REHEARSAL_CHATS,
  isRehearsalChat,
  type RehearsalChat,
} from "@/lib/wasales/rehearsal-chats";
import { AUTOREPLY_PILOT } from "@/lib/wasales/autoreply-pilot";
import { detectExclusion, readMessage } from "@/lib/wasales/intent";
import { normalize } from "@/lib/wasales/matcher";

const chat = (peer: string, accountId = "wa-monza", channel = "whatsapp") => ({
  channel,
  accountId,
  peerExternalId: peer,
});

describe("which chat is a rehearsal", () => {
  test("Samer's number on wa-monza, however it is written", () => {
    for (const written of [
      "9613195955",
      "+9613195955",
      "+961 3 195 955",
      "009613195955",
      "03195955",
      "03 195 955",
      "3195955",
    ]) {
      assert.equal(isRehearsalChat(chat(written)), true, written);
    }
  });

  test("another number on the same account is a customer", () => {
    for (const other of ["9613195956", "961319595", "96170708585", "9613195955123"]) {
      assert.equal(isRehearsalChat(chat(other)), false, other);
    }
  });

  test("a number that cannot be placed matches nothing", () => {
    // Never a raw-string compare: that is how one truncated number would match
    // another.
    for (const junk of ["", "   ", "abc", "0", "+1 555 0100"]) {
      assert.equal(isRehearsalChat(chat(junk)), false, JSON.stringify(junk));
    }
  });

  test("it is scoped to the account he named", () => {
    // "that number … to 70708585". The same phone writing to another account of
    // ours is not a rehearsal there until somebody says so.
    assert.equal(isRehearsalChat(chat("9613195955", "wa-voyah")), false);
  });

  test("the same digits on Instagram are a stranger", () => {
    // Instagram and Messenger ids are opaque and account-scoped; they are not
    // phone numbers however numeric they look.
    assert.equal(isRehearsalChat(chat("9613195955", "wa-monza", "instagram")), false);
  });

  test("an Instagram entry is compared exactly, on its own account", () => {
    const chats: RehearsalChat[] = [
      { accountId: "ig-voyah", channel: "instagram", peer: "17841400000000000", note: "a tester" },
    ];
    assert.equal(isRehearsalChat(chat("17841400000000000", "ig-voyah", "instagram"), chats), true);
    assert.equal(isRehearsalChat(chat("17841400000000000", "ig-mhero", "instagram"), chats), false);
    assert.equal(isRehearsalChat(chat("1784140000000000", "ig-voyah", "instagram"), chats), false);
  });

  test("the list is one WhatsApp chat today", () => {
    assert.equal(REHEARSAL_CHATS.length, 1);
  });
});

describe("what a rehearsal changes, and what it must not", () => {
  const ex = (text: string, rehearsal: boolean) =>
    detectExclusion(text, normalize(text), { rehearsal });

  test("a message that is only the word test is answered in a rehearsal", () => {
    for (const text of ["test", "testing", "Test", "hi test", "test 2", "testing please ignore"]) {
      assert.equal(ex(text, false)?.kind, "INTERNAL_TEST", `${text} — for a customer`);
      assert.equal(ex(text, true), null, `${text} — in a rehearsal`);
    }
  });

  test("readMessage carries the option through", () => {
    assert.equal(readMessage("test").exclusion?.kind, "INTERNAL_TEST");
    assert.equal(readMessage("test", null, { rehearsal: true }).exclusion, null);
    // The default is a customer: every other caller in the product is one.
    assert.equal(readMessage("test", null, {}).exclusion?.kind, "INTERNAL_TEST");
  });

  test("every OTHER exclusion still applies — a client gets them too", () => {
    const scam =
      "Meta Business Support: your page will be permanently disabled, verify your account at http://meta-verify.xyz/appeal";
    const pitch =
      "Hello, we offer SEO and social media marketing services — would you be interested in a free audit?";
    const notice = "You created this chat because you tapped an ad.";

    assert.equal(ex(scam, true)?.kind, "META_SCAM");
    assert.equal(ex(pitch, true)?.kind, "VENDOR_PITCH");
    assert.equal(ex(notice, true)?.kind, "SYSTEM_NOTICE");
  });

  test("a real question is untouched either way", () => {
    // The rehearsal flag must not change how anything is UNDERSTOOD — only
    // whether the internal-test filter fires.
    for (const text of ["how much is the free", "chou el se3er", "what is the range?", "برشور"]) {
      const asCustomer = readMessage(text);
      const asRehearsal = readMessage(text, null, { rehearsal: true });
      assert.deepEqual(asRehearsal.intents, asCustomer.intents, text);
      assert.equal(asRehearsal.language, asCustomer.language, text);
      assert.equal(asRehearsal.confidence, asCustomer.confidence, text);
    }
  });
});

describe("the rehearsal list and the pilot list are separate, one way", () => {
  test("every chat a machine may answer by itself is one of ours", () => {
    // The guard that matters while the pilot runs: no machine answers a real
    // customer without a person (CLAUDE.md rule 24). If this fails, the pilot
    // was pointed at somebody real — that is Samer's decision to take
    // deliberately, here, not a line to delete to make a test pass.
    for (const c of AUTOREPLY_PILOT.chats) {
      const channel = c.accountId.startsWith("wa-")
        ? "whatsapp"
        : c.accountId.startsWith("ig-")
          ? "instagram"
          : "facebook";
      assert.equal(
        isRehearsalChat({ channel, accountId: c.accountId, peerExternalId: c.peer }),
        true,
        `${c.accountId}:${c.peer} is answered automatically but is not a rehearsal chat`
      );
    }
  });

  test("being a rehearsal does not switch automation on", () => {
    assert.equal(
      REHEARSAL_CHATS.length >= AUTOREPLY_PILOT.chats.length,
      true,
      "the pilot cannot hold chats the rehearsal list does not"
    );
  });
});
