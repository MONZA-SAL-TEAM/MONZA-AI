/**
 * Instagram and Facebook get what WhatsApp got (Samer, 2026-09-15): files and
 * voice notes out, posts shown as the post, and who the customer is. Pinned:
 *
 *   - each channel's own rules: Instagram takes PDF and no Word, Messenger a ZIP;
 *   - a voice note becomes a valid one-channel WAV (Instagram/Facebook take no Ogg);
 *   - Facebook posts, videos and reels become Facebook's embed; links pasted in
 *     the words become embeds too, and nothing else does;
 *   - a file goes to Meta by link, on Messenger with messaging_type RESPONSE;
 *   - a profile keeps only what Meta said, and only an https picture.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { checkOutbound, classifyFile, rulesFor, sniff, verifiedType } from "@/lib/channels/wa-media";
import { downmix, encodeWav, resample, voiceWav, VOICE_SAMPLE_RATE } from "@/lib/media/wav";
import { embeddableLinks, facebookEmbedUrl } from "@/lib/inbox/media";
import { mapCustomerProfile, PROFILE_FIELDS } from "@/lib/channels/live-map";
import { outboundMessagePart } from "@/lib/channels/types";
import { sendInstagramLogin, sendInstagram } from "@/lib/channels/instagram";
import { sendMessenger } from "@/lib/channels/messenger";

const MB = 1024 * 1024;

describe("each channel's own rules", () => {
  test("Instagram: PDF only, photos to 8 MB, no MP3 or OGG", () => {
    assert.equal(checkOutbound("document", "application/pdf", MB, "instagram").ok, true);
    const docx = checkOutbound("document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", MB, "instagram");
    assert.equal(docx.ok, false);
    assert.match(!docx.ok ? docx.problem : "", /^Instagram only accepts PDF/);
    assert.equal(checkOutbound("image", "image/jpeg", 7 * MB, "instagram").ok, true, "WhatsApp's 5 MB is not Instagram's");
    assert.equal(checkOutbound("image", "image/jpeg", 9 * MB, "instagram").ok, false);
    assert.equal(checkOutbound("audio", "audio/mpeg", MB, "instagram").ok, false);
    assert.equal(checkOutbound("audio", "audio/ogg", MB, "instagram").ok, false);
    assert.equal(checkOutbound("audio", "audio/wav", MB, "instagram").ok, true);
    assert.equal(checkOutbound("video", "video/quicktime", 20 * MB, "instagram").ok, true, "an iPhone MOV is fine here");
  });

  test("Facebook: most files to 25 MB, a ZIP included", () => {
    assert.equal(checkOutbound("document", "application/zip", 20 * MB, "facebook").ok, true);
    assert.equal(checkOutbound("document", "application/zip", 30 * MB, "facebook").ok, false);
    assert.equal(checkOutbound("audio", "audio/mpeg", MB, "facebook").ok, true);
  });

  test("WhatsApp is unchanged", () => {
    assert.equal(checkOutbound("image", "image/jpeg", 6 * MB).ok, false);
    assert.equal(checkOutbound("audio", "audio/ogg", MB, "whatsapp").ok, true);
    assert.equal(rulesFor("anything else"), rulesFor("whatsapp"));
  });

  test("a picked file is judged by the conversation's channel", () => {
    assert.equal((classifyFile({ name: "offer.docx", type: "", size: MB }, "instagram") as { ok: boolean }).ok, false);
    assert.deepEqual(classifyFile({ name: "car.jpg", type: "image/jpeg", size: 7 * MB }, "instagram"), {
      ok: true,
      kind: "image",
      mime: "image/jpeg",
      convert: false,
    });
    assert.equal((classifyFile({ name: "car.jpg", type: "image/jpeg", size: 7 * MB }) as { convert: boolean }).convert, true);
    assert.equal(classifyFile({ name: "clip.mov", type: "video/quicktime", size: MB }, "facebook").ok, true);
    assert.equal(classifyFile({ name: "clip.mov", type: "video/quicktime", size: MB }, "whatsapp").ok, false);
    assert.equal(classifyFile({ name: "files.zip", type: "application/zip", size: MB }, "facebook").ok, true);
  });

  test("the new types are checked against their first bytes too", () => {
    const wav = encodeWav(new Float32Array(10), 16_000);
    assert.equal(sniff(wav), "wav");
    assert.equal(verifiedType("audio/wav", wav), "audio/wav");
    assert.equal(sniff(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1])), "webm");
    assert.equal(verifiedType("video/quicktime", new Uint8Array([0, 0, 0, 8, 0x6d, 0x6f, 0x6f, 0x76])), "video/quicktime");
    assert.equal(verifiedType("audio/wav", new Uint8Array([1, 2, 3, 4])), "application/octet-stream");
  });
});

describe("a voice note for Instagram and Facebook", () => {
  test("a valid one-channel 16-bit WAV", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 2]);
    const wav = encodeWav(samples, 16_000);
    const dv = new DataView(wav.buffer);
    const text = (o: number) => String.fromCharCode(...wav.subarray(o, o + 4));
    assert.equal(text(0), "RIFF");
    assert.equal(text(8), "WAVE");
    assert.equal(text(12), "fmt ");
    assert.equal(text(36), "data");
    assert.equal(dv.getUint32(4, true), wav.length - 8);
    assert.equal(dv.getUint16(20, true), 1, "PCM");
    assert.equal(dv.getUint16(22, true), 1, "one channel");
    assert.equal(dv.getUint32(24, true), 16_000);
    assert.equal(dv.getUint16(34, true), 16);
    assert.equal(dv.getUint32(40, true), samples.length * 2);
    assert.equal(dv.getInt16(44 + 3 * 2, true), 0x7fff, "full scale");
    assert.equal(dv.getInt16(44 + 5 * 2, true), 0x7fff, "clipped, not wrapped");
    assert.equal(dv.getInt16(44 + 4 * 2, true), -0x8000);
  });

  test("stereo at 48 kHz becomes mono at 16 kHz", () => {
    const left = new Float32Array(48_000).fill(0.5);
    const right = new Float32Array(48_000).fill(-0.5);
    assert.deepEqual(Array.from(downmix([left, right]).subarray(0, 3)), [0, 0, 0]);
    assert.equal(resample(left, 48_000, 16_000).length, 16_000);
    const wav = voiceWav([left, right], 48_000);
    assert.equal((wav.length - 44) / 2, VOICE_SAMPLE_RATE, "one second of sound");
  });
});

describe("Facebook posts shown as the post", () => {
  test("posts, photos and permalinks → the embedded post", () => {
    const e = facebookEmbedUrl("https://www.facebook.com/voyahlebanon/posts/pfbid02abcDEF123?__cft__=x&__tn__=R");
    assert.equal(
      e,
      `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent("https://www.facebook.com/voyahlebanon/posts/pfbid02abcDEF123")}&show_text=true&width=350`
    );
    assert.match(facebookEmbedUrl("https://m.facebook.com/permalink.php?story_fbid=123456&id=987654&ref=x") ?? "", /post\.php\?href=.*story_fbid%3D123456%26id%3D987654&/);
    assert.match(facebookEmbedUrl("https://www.facebook.com/share/p/1AbCdEfGh/") ?? "", /plugins\/post\.php/);
  });

  test("videos and reels → the embedded video", () => {
    assert.match(facebookEmbedUrl("https://www.facebook.com/reel/1234567890123/") ?? "", /plugins\/video\.php/);
    assert.match(facebookEmbedUrl("https://www.facebook.com/watch/?v=1234567890") ?? "", /plugins\/video\.php\?href=.*v%3D1234567890/);
    assert.match(facebookEmbedUrl("https://fb.watch/aBcD123xy/") ?? "", /plugins\/video\.php/);
    assert.match(facebookEmbedUrl("https://www.facebook.com/voyahlebanon/videos/1234567890/") ?? "", /plugins\/video\.php/);
  });

  test("anything else stays a link", () => {
    assert.equal(facebookEmbedUrl("https://www.facebook.com/voyahlebanon"), null, "a Page is a link");
    assert.equal(facebookEmbedUrl("https://www.facebook.com/watch/"), null, "no video named");
    assert.equal(facebookEmbedUrl("http://www.facebook.com/reel/123456/"), null);
    assert.equal(facebookEmbedUrl("https://facebook.com.evil.io/reel/123456/"), null);
    assert.equal(facebookEmbedUrl("https://www.facebook.com/permalink.php?story_fbid=<x>"), null);
  });

  test("links pasted into the words — WhatsApp's link preview, for posts only", () => {
    const found = embeddableLinks(
      "Look at this instagram.com/reel/Db5pnRFsILn and https://www.facebook.com/reel/1234567890123/, also https://voyah.com.lb/free."
    );
    assert.deepEqual(found.map((l) => l.network), ["instagram", "facebook"]);
    assert.equal(found[0].link, "https://instagram.com/reel/Db5pnRFsILn");
    assert.deepEqual(embeddableLinks("no links here"), []);
    assert.deepEqual(embeddableLinks("https://www.instagram.com/voyahlebanon/"), [], "a profile is not a post");
    const many = Array.from({ length: 5 }, (_, i) => `https://www.instagram.com/p/AbCdE${i}xyz/`).join(" ");
    assert.equal(embeddableLinks(many).length, 3, "at most three per message");
    assert.equal(embeddableLinks("https://www.instagram.com/p/AbCdE1xyz/ https://instagram.com/p/AbCdE1xyz").length, 1, "each post once");
  });
});

describe("a file goes to Meta by link", () => {
  type Call = { url: string; body: Record<string, unknown> };
  const fake = (calls: Call[]) =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ message_id: "mid.1" }), { status: 200 });
    }) as typeof fetch;
  const LINK = "https://project.supabase.co/storage/v1/object/sign/whatsapp-media/out/ig-voyah/c/f.jpg?token=t";

  test("the message part is the file alone", () => {
    assert.deepEqual(outboundMessagePart({ accountId: "a", toExternalId: "p", text: "" , attachment: { type: "image", url: LINK } }), {
      attachment: { type: "image", payload: { url: LINK } },
    });
    assert.deepEqual(outboundMessagePart({ accountId: "a", toExternalId: "p", text: "hi" }), { text: "hi" });
  });

  test("Instagram, both routes: /me/messages, no messaging_type", async () => {
    const calls: Call[] = [];
    const r1 = await sendInstagramLogin({ accountId: "ig-voyah", toExternalId: "IGSID", text: "", attachment: { type: "file", url: LINK } }, "K", fake(calls));
    const r2 = await sendInstagram({ accountId: "ig-voyah", toExternalId: "IGSID", text: "", attachment: { type: "audio", url: LINK } }, "K", fake(calls));
    assert.equal(r1.ok && r2.ok, true);
    assert.equal(calls[0].url, "https://graph.instagram.com/v21.0/me/messages");
    assert.equal(calls[1].url, "https://graph.facebook.com/v21.0/me/messages");
    assert.deepEqual(calls[0].body, { recipient: { id: "IGSID" }, message: { attachment: { type: "file", payload: { url: LINK } } } });
    assert.equal(calls[1].body.messaging_type, undefined);
  });

  test("Messenger: the same, answering as a RESPONSE", async () => {
    const calls: Call[] = [];
    await sendMessenger({ accountId: "fb-voyah", toExternalId: "PSID", text: "", attachment: { type: "video", url: LINK } }, "K", fake(calls));
    assert.deepEqual(calls[0].body, {
      recipient: { id: "PSID" },
      message: { attachment: { type: "video", payload: { url: LINK } } },
      messaging_type: "RESPONSE",
    });
  });
});

describe("who the customer is", () => {
  test("Instagram: name, username, picture, followers, follows", () => {
    assert.deepEqual(
      mapCustomerProfile({
        name: "Samer K",
        username: "samer_k",
        profile_pic: "https://scontent.cdninstagram.com/v/pic.jpg",
        follower_count: 1240,
        is_user_follow_business: true,
        is_business_follow_user: false,
        is_verified_user: false,
        id: "IGSID",
      }),
      {
        name: "Samer K",
        username: "samer_k",
        pictureUrl: "https://scontent.cdninstagram.com/v/pic.jpg",
        followers: 1240,
        followsYou: true,
        youFollow: false,
        verified: false,
      }
    );
  });

  test("Facebook: first and last name make the name", () => {
    const p = mapCustomerProfile({ first_name: "Rami", last_name: "Khoury", profile_pic: "https://platform-lookaside.fbsbx.com/x" });
    assert.equal(p?.name, "Rami Khoury");
    assert.equal(p?.username, null);
  });

  test("only an https picture, and nothing from nothing", () => {
    assert.equal(mapCustomerProfile({ name: "X", profile_pic: "javascript:alert(1)" })?.pictureUrl, null);
    assert.equal(mapCustomerProfile({}), null);
    assert.equal(mapCustomerProfile(null), null);
  });

  test("the fields asked of Meta", () => {
    assert.match(PROFILE_FIELDS.instagram, /profile_pic/);
    assert.match(PROFILE_FIELDS.instagram, /is_user_follow_business/);
    assert.match(PROFILE_FIELDS.facebook, /first_name/);
  });
});
