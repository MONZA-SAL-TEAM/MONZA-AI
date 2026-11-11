/**
 * Samer, 2026-11-11: "reply to a specific message", and Instagram photos that read "Photo, video or
 * attachment". What must hold: a reply names the message it answers in each platform's own shape (WhatsApp
 * `context.message_id`, Instagram `reply_to.mid`, never on Messenger); the quote above the composer never
 * invents words; and on the Instagram-login route a message's content is read PER MESSAGE and merged back,
 * remembered, refused gracefully, never a word in a record.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { quoteOf, replyableId } from "@/lib/inbox/quote";
import { isStandIn, NO_TEXT, WA_ATTACHMENT_ONLY } from "@/lib/inbox/no-content";
import { isWamid, replyContext, sendWhatsAppMedia, sendWhatsAppText, whatsappSentRow } from "@/lib/channels/whatsapp";
import { isInstagramMessageId, sendInstagram, sendInstagramLogin } from "@/lib/channels/instagram";
import { sendMessenger } from "@/lib/channels/messenger";
import { mergeMessageDetails, undescribedMessageIds, mapThread } from "@/lib/channels/live-map";
import { detailInstagramMessages, detailNote, type ThreadAskRecord } from "@/lib/channels/live";
import type { InboxMessage } from "@/lib/inbox/types";

const msg = (id: string, over: Partial<InboxMessage> = {}): InboxMessage => ({ id, conversationId: "t", direction: "in", author: "customer", text: "hello", at: "2026-11-11T10:00:00Z", status: "received", ...over });

type Call = { url: string; body: Record<string, unknown> };
function fake(calls: Call[], answer: unknown = { messages: [{ id: "wamid.sent" }], message_id: "m.sent" }): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("the quote above the composer", () => {
  test("words cut to a line; a stand-in sentence counts as no words; a photo keeps its thumbnail; a deleted message says so", () => {
    assert.deepEqual(quoteOf(msg("a", { text: "  how   much? " }), isStandIn), { author: "customer", text: "how much?" });
    assert.equal(quoteOf(msg("b", { text: "x".repeat(300) }), isStandIn).text.length, 140);
    assert.deepEqual(quoteOf(msg("c", { text: NO_TEXT, attachments: [{ kind: "image", state: "ready", url: "https://x/p.jpg" }] }), isStandIn), { author: "customer", text: "", kind: "image", thumbUrl: "https://x/p.jpg" });
    assert.equal(quoteOf(msg("d", { text: WA_ATTACHMENT_ONLY, attachments: [{ kind: "video", state: "pending" }] }), isStandIn).text, "");
    assert.equal(quoteOf(msg("e", { deleted: true, text: "" }), isStandIn).text, "This message was deleted");
  });
  test("what can be quoted: a WhatsApp row by its wamid, an Instagram message by Meta's id, never Messenger, never a stand-in row", () => {
    assert.equal(replyableId(msg("x", { externalId: "wamid.1" }), "whatsapp"), "wamid.1");
    assert.equal(replyableId(msg("x"), "whatsapp"), null, "no wamid, no quote");
    assert.equal(replyableId(msg("aWdGGiblWZ"), "instagram"), "aWdGGiblWZ");
    assert.equal(replyableId(msg("aWdGGiblWZ"), "facebook"), null);
    assert.equal(replyableId({ ...msg("pending-1"), pendingState: "sending" } as InboxMessage, "instagram"), null);
    assert.equal(replyableId(msg("x", { externalId: "wamid.1", deleted: true }), "whatsapp"), null);
  });
});

describe("WhatsApp: a contextual reply", () => {
  test("context.message_id on text and on media, a wamid only; the sent row keeps reply_to", async () => {
    const calls: Call[] = [];
    await sendWhatsAppText({ phoneNumberId: "984244264767607", to: "96170123456", text: "Yes.", replyTo: "wamid.HBgLMTY0NjcwNDM1OTUVAgASGBQzQTdCNTg5" }, "KEY", fake(calls));
    assert.deepEqual(calls[0].body, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "96170123456",
      context: { message_id: "wamid.HBgLMTY0NjcwNDM1OTUVAgASGBQzQTdCNTg5" },
      type: "text",
      text: { preview_url: false, body: "Yes." },
    });
    await sendWhatsAppMedia({ phoneNumberId: "984244264767607", to: "96170123456", kind: "image", mediaId: "77", caption: "this one", replyTo: "wamid.abcdefgh" }, "KEY", fake(calls));
    assert.deepEqual(calls[1].body.context, { message_id: "wamid.abcdefgh" });
    assert.deepEqual(calls[1].body.image, { id: "77", caption: "this one" });
    await sendWhatsAppText({ phoneNumberId: "984244264767607", to: "96170123456", text: "plain" }, "KEY", fake(calls));
    assert.equal("context" in calls[2].body, false, "no quote, no context");
    assert.deepEqual(replyContext("not-a-wamid"), {}, "an id that is not WhatsApp's is never sent");
    assert.equal(isWamid("wamid.HBgLMTY0NjcwNDM1OTUVAgASGBQzQTdCNTg5RjY1MEMyRjlGMjRGNgA="), true);
    const row = whatsappSentRow({ conversationId: "c", brand: "monza", accountId: "wa-monza", externalMessageId: "wamid.sent", text: "Yes.", at: "2026-11-11T10:00:00Z", staffName: "samer", replyTo: "wamid.abcdefgh" });
    assert.equal(row.reply_to, "wamid.abcdefgh");
    assert.equal("reply_to" in whatsappSentRow({ conversationId: "c", brand: "monza", accountId: "wa-monza", externalMessageId: "wamid.sent", text: "Yes.", at: "2026-11-11T10:00:00Z", staffName: "samer" }), false);
  });
});

describe("Instagram and Messenger", () => {
  test("Instagram, both routes: reply_to.mid beside the message; Messenger never carries one", async () => {
    const calls: Call[] = [];
    await sendInstagramLogin({ accountId: "ig-voyah", toExternalId: "IGSID", text: "Yes.", replyTo: "aWdGGiblWZ.abc" }, "K", fake(calls));
    await sendInstagram({ accountId: "ig-voyah", toExternalId: "IGSID", text: "Yes.", replyTo: "aWdGGiblWZ.abc" }, "K", fake(calls));
    for (const c of calls) assert.deepEqual(c.body, { recipient: { id: "IGSID" }, message: { text: "Yes." }, reply_to: { mid: "aWdGGiblWZ.abc" } });
    await sendMessenger({ accountId: "fb-voyah", toExternalId: "PSID", text: "Yes.", replyTo: "m_abcdefgh" }, "K", fake(calls));
    assert.equal("reply_to" in calls[2].body, false);
    assert.equal(isInstagramMessageId("aWdGGiblWZ.abc"), true);
    assert.equal(isInstagramMessageId("<script>"), false);
  });
});

describe("Instagram login: a message's content is read per message", () => {
  const SELF = ["17841457996874250"];
  const nested = {
    participants: { data: [{ id: "999", username: "rami" }, { id: SELF[0] }] },
    messages: {
      data: [
        { id: "m1", created_time: "2026-11-11T09:00:00+0000", from: { id: "999" } },
        { id: "m2", created_time: "2026-11-11T08:00:00+0000", from: { id: "999" }, message: "hi" },
        { id: "m3", created_time: "2026-11-11T07:00:00+0000", from: { id: SELF[0] }, attachments: { data: [{ id: "a", image_data: { url: "https://scontent.cdninstagram.com/ours.jpg" } }] } },
      ],
    },
  };
  const photo = (id: string) => ({ id, created_time: "2026-11-11T09:00:00+0000", from: { id: "999" }, attachments: { data: [{ id: "a1", image_data: { url: `https://lookaside.fbsbx.com/${id}.jpg` } }] } });
  type Answer = { ok: true; json: unknown } | { ok: false; problem: string; retryLighter: boolean; meta?: string | null; throttled?: boolean; transient?: boolean };
  const REFUSED: Answer = { ok: false, problem: "Meta said: (#100) Tried accessing nonexisting field (story)", retryLighter: false, meta: 'code 100 "(#100) Tried accessing nonexisting field (story)"' };
  let n = 0;
  const key = () => `ig-test:${++n}:${Math.random()}`;
  function scripted(answer: (id: string, fields: string) => Answer) {
    const asked: { id: string; fields: string }[] = [];
    return { asked, route: { token: "t", get: async (path: string, params: Record<string, string>) => (asked.push({ id: path, fields: params.fields }), answer(path, params.fields)) } };
  }

  test("only the messages Meta described with no content key are asked about, and their answers are merged back", () => {
    assert.deepEqual(undescribedMessageIds(nested), ["m1", "m2"], "m3 already carries attachments");
    const merged = mergeMessageDetails(nested, new Map([["m1", photo("m1")]]));
    const shown = mapThread(merged, "ig-voyah~1", SELF);
    const m1 = shown.find((m) => m.id === "m1");
    assert.equal(m1?.attachments?.[0]?.kind, "image");
    assert.equal(m1?.text, "");
    assert.equal(shown.find((m) => m.id === "m2")?.text, "hi", "a message without a detail is left as it was");
    assert.equal(mergeMessageDetails(nested, new Map()), nested, "nothing to merge: the same object");
  });

  test("the fuller fields first; a refusal naming a field moves to the plainer set; the answer is remembered per message", async () => {
    const k = key();
    const { asked, route } = scripted((id, fields) => (fields.includes("story") ? REFUSED : { ok: true, json: photo(id) }));
    const records: ThreadAskRecord[] = [];
    const d = await detailInstagramMessages(route, nested, k, (a) => records.push(a));
    assert.equal(d.undescribed, 0);
    assert.equal(d.ok, 2);
    assert.ok(asked.some((a) => a.fields.includes("story")), "the fuller set was tried");
    assert.ok(asked.filter((a) => !a.fields.includes("story")).length >= 2, "then the plainer set for each");
    assert.ok(records.every((r) => r.limit === 1), "per-message asks are recorded as such");
    assert.ok(!JSON.stringify(records).includes("lookaside"), "no link in a record");
    const again = await detailInstagramMessages(route, nested, k);
    assert.equal(again.asked, 0, "remembered: nothing asked the second time");
    assert.equal(again.undescribed, 0);
  });

  test("a second refusal pauses the asking, and the thread says what it could not read", async () => {
    const k = key();
    const { asked, route } = scripted(() => REFUSED);
    const d = await detailInstagramMessages(route, nested, k);
    assert.equal(d.undescribed, 2);
    assert.ok(asked.length <= 4, `stops after the second refusal (asked ${asked.length})`);
    assert.match(d.problem ?? "", /#100/);
    assert.match(detailNote(d), /2 messages could not be read in full from Instagram/);
    const paused = await detailInstagramMessages(route, nested, k);
    assert.equal(paused.asked, 0, "paused: nothing is asked for a while");
  });

  test("Meta's rate limit stops the pass at once and remembers nothing", async () => {
    const k = key();
    const { asked, route } = scripted(() => ({ ok: false, problem: "limit", retryLighter: false, meta: "code 4", throttled: true }));
    const d = await detailInstagramMessages(route, nested, k);
    assert.equal(d.undescribed, 2);
    assert.ok(asked.length <= 2);
    const next = scripted((id) => ({ ok: true, json: photo(id) }));
    const d2 = await detailInstagramMessages(next.route, nested, k);
    assert.equal(d2.ok, 2, "the next refresh asks again");
  });
});
