/**
 * Customers OUTSIDE the pilot (Samer, 2026-09-17): the bot never answers them,
 * and they never disappear. Every new WhatsApp message is read, classified and
 * marked for a person; nothing is sent.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { triageInbound } from "@/lib/wasales/triage";
import { runAutoreply } from "@/lib/wasales/autoreply";
import { folderMedia, loadCatalog } from "@/lib/wasales/catalog";
import { MONZA_KNOWLEDGE } from "@/lib/wasales/knowledge";
import type { FreshInbound } from "@/lib/channels/store";

const DEPS = { knowledge: MONZA_KNOWLEDGE, catalog: loadCatalog(), media: folderMedia, ttlHours: 72 };
const NOW = "2026-09-17T09:00:00.000Z";
const triage = (text: string, hasMedia = false, brand = "monza") => triageInbound({ text, hasMedia, brand, now: NOW }, DEPS);

describe("what a non-pilot message is about", () => {
  test("a sales question is filed under its kind, with the car", () => {
    assert.deepEqual(triage("price of the courage please"), {
      kind: "PRICE",
      models: ["COURAGE"],
      reason: "Bot not switched on for this chat: the customer asked about the price (COURAGE).",
    });
    assert.equal(triage("do you have installments?")?.kind, "FINANCING");
    assert.equal(triage("can i book a test drive for the taishan")?.kind, "TEST_DRIVE");
    assert.equal(triage("can someone call me")?.kind, "CALLBACK");
    assert.equal(triage("i want to talk to a human")?.kind, "HUMAN");
    assert.equal(triage("do you deliver to tripoli")?.kind, "QUESTION");
  });

  test("anything else is 'needs a person', with what was understood", () => {
    assert.deepEqual(triage("hi")?.reason, "Bot not switched on for this chat: the customer said hello.");
    assert.equal(triage("courage hp?")?.reason, "Bot not switched on for this chat: the customer asked about horsepower (COURAGE).");
    assert.equal(triage("asdkjh")?.reason, "Bot not switched on for this chat: the customer wrote something the bot does not recognise.");
    assert.equal(triage("", true)?.reason, "Bot not switched on for this chat: the customer sent a photo, video or file.");
  });

  test("the reason never carries the customer's words", () => {
    const t = triage("my name is Rabih and my number is 03123456, call me about the courage");
    assert.ok(t);
    assert.ok(!/rabih|03123456/i.test(t?.reason ?? ""), t?.reason);
  });

  test("scams, vendors, Meta notices and tests are not customers", () => {
    assert.equal(triage("Meta Business Support: your page will be disabled. Appeal here https://example.com/x"), null);
    assert.equal(triage("We are a growth agency helping car dealers get more leads"), null);
    assert.equal(triage("Facebook created this chat because someone commented on your post"), null);
    assert.equal(triage("hello test"), null);
  });
});

describe("the webhook path", () => {
  const pilot: FreshInbound = { accountId: "wa-monza", channel: "whatsapp", conversationId: "c-pilot", peerExternalId: "9613195955", at: NOW };
  const other: FreshInbound = { accountId: "wa-monza", channel: "whatsapp", conversationId: "c-other", peerExternalId: "96170123456", at: NOW };
  const other2: FreshInbound = { accountId: "wa-monza", channel: "whatsapp", conversationId: "c-other", peerExternalId: "96170123456", at: "2026-09-17T09:00:05.000Z" };

  test("pilot chats are answered; every other chat is marked for a person, never answered", async () => {
    const answered: string[] = [];
    const marked: string[] = [];
    const r = await runAutoreply([pilot, other, other2], 5_000, {
      autoreply: async (threadId) => {
        answered.push(threadId);
        return { sent: 1, rounds: 1, stopped: "done" };
      },
      markForPerson: async (f) => {
        marked.push(f.conversationId);
        return true;
      },
    });
    assert.deepEqual(answered, ["wa-monza~c-pilot"]);
    assert.deepEqual(marked, ["c-other"], "one mark per chat per delivery, never the pilot chat");
    assert.deepEqual(r, { chats: 1, sent: 1, marked: 1 });
  });

  test("with the bot switched off, customers are still marked", async () => {
    const before = process.env.SALES_AUTOREPLY_MODE;
    process.env.SALES_AUTOREPLY_MODE = "off";
    try {
      const marked: string[] = [];
      const r = await runAutoreply([pilot, other], 5_000, {
        autoreply: async () => {
          throw new Error("must not answer");
        },
        markForPerson: async (f) => {
          marked.push(f.conversationId);
          return true;
        },
      });
      assert.deepEqual(marked, ["c-other"]);
      assert.deepEqual(r, { chats: 0, sent: 0, marked: 1 });
    } finally {
      if (before === undefined) delete process.env.SALES_AUTOREPLY_MODE;
      else process.env.SALES_AUTOREPLY_MODE = before;
    }
  });

  test("a failure to mark one chat does not stop the others", async () => {
    const third: FreshInbound = { ...other, conversationId: "c-third", peerExternalId: "96171000000" };
    const marked: string[] = [];
    const r = await runAutoreply([other, third], 5_000, {
      autoreply: async () => ({ sent: 0, rounds: 0, stopped: "" }),
      markForPerson: async (f) => {
        if (f.conversationId === "c-other") throw new Error("db down");
        marked.push(f.conversationId);
        return true;
      },
    });
    assert.deepEqual(marked, ["c-third"]);
    assert.equal(r.marked, 1);
  });
});
