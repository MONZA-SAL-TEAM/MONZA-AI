/**
 * The inbox batch of 2026-10-20 (Samer): what a reply answers, the ad a customer came from, "mark as unread",
 * replying after 24 hours (Instagram / Messenger Human Agent tag; WhatsApp templates), and the speed changes'
 * guard rails. Pure parts only — no network.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseWhatsApp, quoteReplies, whatsappMessageRow } from "@/lib/channels/whatsapp";
import { sendMessenger } from "@/lib/channels/messenger";
import { humanAgentWindow, windowExplanation, type ChannelAccount } from "@/lib/channels/types";
import { adOfRaw, metaLinkAlive } from "@/lib/channels/ad-creative";
import { blanksOf, paramsProblem, renderTemplate, templateProblem } from "@/lib/channels/wa-templates";
import { matchesView, type ViewContext } from "@/lib/inbox/sync";
import { apiRuleOf } from "@/lib/access/access";
import type { Conversation, InboxMessage } from "@/lib/inbox/types";

const ACCOUNTS: ChannelAccount[] = [{ id: "wa-monza", brand: "monza", channel: "whatsapp", displayName: "Monza", externalId: "984244264767607", portfolio: "x", tokenEnv: "T" } as ChannelAccount];
const delivery = (messages: unknown[]) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "1502691630809243", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "984244264767607" }, messages } }] }],
});

describe("what a reply answers (WhatsApp context)", () => {
  test("the quoted message's id is read and stored", () => {
    const [e] = parseWhatsApp(delivery([{ from: "96170123456", id: "wamid.2", timestamp: "1757930400", type: "text", text: { body: "how much?" }, context: { from: "96170708585", id: "wamid.1" } }]), ACCOUNTS);
    assert.equal(e.replyTo, "wamid.1");
    assert.equal(whatsappMessageRow({ conversationId: "c", brand: "monza", accountId: "wa-monza", event: e }).reply_to, "wamid.1");
    const [plain] = parseWhatsApp(delivery([{ from: "96170123456", id: "wamid.3", timestamp: "1757930400", type: "text", text: { body: "hi" } }]), ACCOUNTS);
    assert.equal("reply_to" in whatsappMessageRow({ conversationId: "c", brand: "monza", accountId: "wa-monza", event: plain }), false);
  });
  const msg = (id: string, over: Partial<InboxMessage> = {}): InboxMessage => ({ id, externalId: id, conversationId: "t", direction: "in", author: "customer", text: "", at: "2026-10-20T10:00:00Z", status: "received", ...over });
  test("the reply gets the message it answers — words cut short, a photo's link, or 'missing', never guessed", () => {
    const photo = msg("w1", { direction: "out", author: "staff", text: "", attachments: [{ kind: "image", state: "ready", url: "https://x/p.jpg" }] });
    const long = msg("w2", { text: "a".repeat(200) });
    const [, , r1, r2, r3] = quoteReplies([photo, long, msg("w3", { replyToId: "w1" }), msg("w4", { replyToId: "w2" }), msg("w5", { replyToId: "gone" })]);
    assert.deepEqual(r1.replyTo, { author: "staff", text: "", kind: "image", thumbUrl: "https://x/p.jpg" });
    assert.equal(r2.replyTo?.text.length, 140);
    assert.equal(r3.replyTo?.missing, true);
    const [found] = quoteReplies([msg("w6", { replyToId: "old" })], [msg("old", { text: "earlier" })]);
    assert.equal(found.replyTo?.text, "earlier", "an older message read separately is found");
  });
});

describe("the ad a customer came from", () => {
  test("WhatsApp's referral and Instagram's ads_context_data, Meta's own CDN only", () => {
    const wa = adOfRaw({ source_id: "120", headline: "Voyah COURAGE", body: "Drive it", media_type: "image", image_url: "https://scontent.fbey5-2.fna.fbcdn.net/x.jpg?oe=6ADCCF2D", source_url: "https://fb.me/x" });
    assert.deepEqual([wa?.sourceId, wa?.headline, wa?.mediaType], ["120", "Voyah COURAGE", "image"]);
    assert.ok(wa?.picture?.includes("fbcdn.net"));
    const ig = adOfRaw({ ad_id: "9", ads_context_data: { ad_title: "Voyah FREE", photo_url: "https://scontent.cdninstagram.com/p.jpg" } });
    assert.deepEqual([ig?.sourceId, ig?.headline], ["9", "Voyah FREE"]);
    assert.equal(adOfRaw({ image_url: "https://evil.example/x.jpg", headline: "x" })?.picture, null, "never another host");
    assert.equal(adOfRaw({}), null);
  });
  test("Meta's link is used only before its expiry", () => {
    assert.equal(metaLinkAlive("https://x.fbcdn.net/a.jpg?oe=6ADCCF2D", Date.parse("2026-10-20T00:00:00Z")), true);
    assert.equal(metaLinkAlive("https://x.fbcdn.net/a.jpg?oe=6ADCCF2D", Date.parse("2027-01-01T00:00:00Z")), false);
  });
});

describe("mark as unread", () => {
  const c = (id: string): Conversation => ({ id, customerId: "", customerName: "x", channel: "instagram", channelAddress: "", assignedTo: null, assignedToName: null, status: "open", unreadCount: 0, lastMessage: { text: "hi", at: "2026-09-01T00:00:00Z", direction: "in", author: "customer" }, hasAutomatedMessage: false, accountId: "ig-voyah" });
  const ctx: ViewContext = { accounts: [], seen: { a: "2026-10-01T00:00:00Z" }, baselineAt: "2026-10-01T00:00:00Z", dayOf: (iso) => iso.slice(0, 10) };
  const unread = { brand: "all", channel: "all", show: "unread" } as unknown as Parameters<typeof matchesView>[1];
  test("a read chat marked unread shows under Unread until opened", () => {
    assert.equal(matchesView(c("a"), unread, ctx), false);
    assert.equal(matchesView(c("a"), unread, { ...ctx, markedUnread: new Set(["a"]) }), true);
  });
});

describe("replying after 24 hours", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  test("Instagram / Messenger: a person's own reply between 24 hours and 7 days", () => {
    assert.equal(humanAgentWindow("2026-10-20T00:00:00Z", now), false, "still inside 24 h: an ordinary reply");
    assert.equal(humanAgentWindow("2026-10-17T12:00:00Z", now), true);
    assert.equal(humanAgentWindow("2026-10-12T12:00:00Z", now), false, "past 7 days");
    assert.match(windowExplanation({ open: false, reason: "expired" }, "instagram"), /7 days/);
  });
  test("Messenger: the HUMAN_AGENT tag only when asked; RESPONSE otherwise", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fake = (async (_: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ message_id: "m" }), { status: 200 });
    }) as typeof fetch;
    await sendMessenger({ accountId: "fb-voyah", toExternalId: "PSID", text: "hello" }, "K", fake);
    await sendMessenger({ accountId: "fb-voyah", toExternalId: "PSID", text: "hello", humanAgent: true }, "K", fake);
    assert.equal(bodies[0].messaging_type, "RESPONSE");
    assert.equal(bodies[0].tag, undefined);
    assert.deepEqual([bodies[1].messaging_type, bodies[1].tag], ["MESSAGE_TAG", "HUMAN_AGENT"]);
  });
  test("the tag is never used by a sales suggestion or the autoreply", () => {
    for (const f of ["lib/wasales/executor.ts", "lib/wasales/autoreply.ts", "lib/channels/meta-send.ts"]) {
      assert.doesNotMatch(readFileSync(join(process.cwd(), f), "utf8"), /HUMAN_AGENT|humanAgent/, f);
    }
  });
  test("WhatsApp templates: blanks in order, filled before sending, shown as they go", () => {
    assert.deepEqual(blanksOf("Hi {{1}}, the {{2}} is ready"), { count: 2, ok: true });
    assert.equal(blanksOf("Hi {{2}}").ok, false);
    assert.equal(renderTemplate("Hi {{1}}, the {{2}}", ["Rami", "Courage\nnew"]), "Hi Rami, the Courage new");
    assert.equal(paramsProblem({ params: 2 }, ["Rami", " "]), "Fill in blank {{2}}.");
    assert.equal(templateProblem({ name: "Follow Up", language: "en", label: "x", body: "y" }) !== null, true);
    assert.equal(templateProblem({ name: "follow_up_1", language: "en_US", label: "Follow-up", body: "Hi {{1}}" }), null);
  });
  test("sending a template is a send: inbox page and the send action", () => {
    assert.deepEqual(apiRuleOf("/api/channels/templates", "POST"), { page: "inbox", action: "send_messages", event: "template_sent" });
    assert.equal(apiRuleOf("/api/admin/templates", "POST")?.page, "admin");
  });
});

describe("faster sending", () => {
  test("a reply shows at once and a failed one offers Try again and Delete", () => {
    const tsx = readFileSync(join(process.cwd(), "app/inbox/InboxClient.tsx"), "utf8");
    assert.match(tsx, /pendingState: "sending"/);
    assert.match(tsx, /Try again/);
    assert.match(tsx, /dropPending/);
  });
  test("the token's claimed id only starts reads early; the verified id decides", () => {
    const src = readFileSync(join(process.cwd(), "lib/auth.ts"), "utf8");
    assert.match(src, /claimed === data\.user\.id \? await early/);
    assert.match(src, /earlyAccess && claimed === user\.userId \? await earlyAccess/);
  });
});
