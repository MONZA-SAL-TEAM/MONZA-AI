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
import { isThrottled, isTransient, mapCustomerProfile, mapThread, messageShape, messageShapes, NO_TEXT, PROFILE_FIELDS } from "@/lib/channels/live-map";
import { isNoContent, UNSHOWN_TEXT, UNSUPPORTED_TEXT } from "@/lib/inbox/no-content";
import { askThread, attachmentsNote, threadFields, type ThreadAskRecord } from "@/lib/channels/live";
import { outboundMessagePart } from "@/lib/channels/types";
import { sendInstagramLogin, sendInstagram } from "@/lib/channels/instagram";
import { sendMessenger } from "@/lib/channels/messenger";

const MB = 1024 * 1024;

describe("the shape of a message, for the thread diagnosis (never a word)", () => {
  const SELF = ["17841457996874250"];
  const thread = "ig-voyah~1234";
  test("keys, attachment kinds and MIME types, Meta's flags — and what the inbox showed", () => {
    const photo = {
      id: "aWdfZF9tZXNzYWdlOjEyMzQ1Njc4OTA",
      created_time: "2026-10-23T08:00:00+0000",
      from: { id: "999" },
      to: { data: [{ id: SELF[0] }] },
      attachments: { data: [{ id: "a1", mime_type: "image/jpeg", image_data: { url: "https://scontent.cdninstagram.com/x.jpg", width: 1, height: 1 } }] },
    };
    const s = messageShape(photo, thread, SELF);
    assert.ok(s);
    assert.deepEqual(s, {
      id: "1Njc4OTA",
      ours: false,
      hasWords: false,
      keys: ["attachments"],
      attachments: [{ keys: ["id", "image_data", "mime_type"], mime: "image/jpeg" }],
      shares: 0,
      story: null,
      sticker: false,
      unsupported: null,
      deleted: null,
      shown: ["image"],
    });
    assert.ok(!JSON.stringify(s).includes("scontent"), "no link leaves the diagnosis");
  });

  test("a message Meta describes with nothing the inbox can draw is reported as a placeholder, with what Meta DID send", () => {
    const bare = { id: "x1", created_time: "2026-10-23T08:00:00+0000", from: { id: "999" }, is_unsupported: true };
    const s = messageShape(bare, thread, SELF);
    assert.deepEqual(s?.shown, ["placeholder"]);
    assert.equal(s?.unsupported, true);
    const noUrl = { id: "x2", created_time: "2026-10-23T08:00:00+0000", from: { id: "999" }, attachments: { data: [{ id: "a", mime_type: "audio/mp4" }] } };
    const s2 = messageShape(noUrl, thread, SELF);
    assert.deepEqual(s2?.shown, ["placeholder"]);
    assert.deepEqual(s2?.attachments, [{ keys: ["id", "mime_type"], mime: "audio/mp4" }]);
    assert.equal(messageShapes({ messages: { data: [bare, noUrl, { nope: 1 }] } }, thread, SELF).length, 2);
    assert.equal(NO_TEXT, "Photo, video or attachment — open the app to see it.");
  });

  test("a message with nothing to draw says WHY, as far as Meta said it", () => {
    const base = { created_time: "2026-10-23T08:00:00+0000", from: { id: "999" } };
    const read = (m: object) => mapThread({ messages: { data: [{ id: "m", ...base, ...m }] } }, thread, SELF)[0];
    assert.equal(read({ is_unsupported: true }).text, UNSUPPORTED_TEXT);
    assert.equal(read({ attachments: { data: [{ id: "a", mime_type: "video/mp4" }] } }).text, UNSHOWN_TEXT, "listed, no link");
    assert.equal(read({ shares: { data: [{ name: "x" }] } }).text, UNSHOWN_TEXT, "a share without a link");
    assert.equal(read({}).text, NO_TEXT, "nothing described: the read came without the attachment fields");
    assert.equal(read({ message: "hello" }).text, "hello");
    assert.equal(read({ message: "", attachments: { data: [{ id: "a", image_data: { url: "https://scontent.cdninstagram.com/p.jpg" } }] } }).text, "", "a photo with no words");
    for (const t of [NO_TEXT, UNSUPPORTED_TEXT, UNSHOWN_TEXT]) assert.equal(isNoContent(t), true);
    assert.equal(isNoContent("hello"), false);
  });

  test("the fields asked of Meta: shares with its sub-fields, no sticker, is_unsupported only when named", () => {
    const ig0 = threadFields("instagram", 0);
    assert.match(ig0, /shares\{link,name,description,id\}/);
    assert.match(ig0, /,is_unsupported,/);
    assert.match(ig0, /,story$/);
    assert.doesNotMatch(ig0, /sticker/);
    const fb0 = threadFields("facebook", 0);
    assert.doesNotMatch(fb0, /sticker|story/);
    assert.match(fb0, /shares\{link,name,description,id\}$/);
    assert.equal(threadFields("instagram", 1), "id,created_time,from,message,attachments,shares,story");
    assert.equal(threadFields("facebook", 1), "id,created_time,from,message,attachments,shares");
    assert.equal(threadFields("facebook", 2), "id,created_time,from,message");
  });

  test("Meta's rate limit and its own hiccups are told apart from a refusal", () => {
    assert.equal(isThrottled({ error: { code: 4, message: "Application request limit reached" } }, 400), true);
    assert.equal(isThrottled({ error: { code: 613 } }, 400), true);
    assert.equal(isThrottled({ error: { code: 80006 } }, 400), true, "the Messenger Business Use Case limit");
    assert.equal(isThrottled(null, 429), true);
    assert.equal(isThrottled({ error: { code: 100, message: "(#100) Unknown fields: sticker" } }, 400), false);
    assert.equal(isTransient({ error: { code: 2, message: "Service temporarily unavailable" } }, 500), true);
    assert.equal(isTransient({ error: { code: 1 } }, 400), true);
    assert.equal(isTransient("<html>bad gateway</html>", 502), true);
    assert.equal(isTransient(null, 400), true, "an error status with no Meta body says nothing about the fields");
    assert.equal(isTransient({ error: { code: 100, message: "(#100) Unknown fields: sticker" } }, 400), false);
  });
});

describe("the asks for one thread, in order (askThread with a scripted Meta)", () => {
  type Answer = { ok: true; json: unknown } | { ok: false; problem: string; retryLighter: boolean; meta?: string | null; throttled?: boolean; transient?: boolean };
  const okJson = { participants: { data: [] }, messages: { data: [] } };
  const OK: Answer = { ok: true, json: okJson };
  const REFUSED: Answer = { ok: false, problem: "Meta said: (#100) Unknown fields: sticker", retryLighter: false, meta: "code 100 \"(#100) Unknown fields: sticker\"" };
  const SLOW: Answer = { ok: false, problem: "Meta took too long to answer (over 20 s).", retryLighter: true, meta: null };
  const HICCUP: Answer = { ok: false, problem: "Meta said: Service temporarily unavailable", retryLighter: false, meta: "code 2", transient: true };
  const LIMIT: Answer = { ok: false, problem: "Meta is limiting requests for a moment.", retryLighter: false, meta: "code 4", throttled: true };
  let n = 0;
  const key = () => `test:${++n}:${Math.random()}`;
  function scripted(answers: Answer[]) {
    const asked: string[] = [];
    const route = {
      token: "t",
      get: async (_path: string, params: Record<string, string>) => {
        asked.push(params.fields);
        return answers.shift() ?? REFUSED;
      },
    };
    return { route, asked };
  }
  const levelsOf = (records: ThreadAskRecord[]) => records.map((a) => `${a.level}@${a.limit}:${a.status}`);

  test("the named fields first; a refusal moves to the bare edges and remembers them", async () => {
    const k = key();
    const { route, asked } = scripted([REFUSED, OK]);
    const records: ThreadAskRecord[] = [];
    const a = await askThread(route, "c1", "facebook", k, (x) => records.push(x));
    assert.equal(a.r.ok, true);
    assert.equal(a.level, 1);
    assert.equal(a.limit, 20);
    assert.deepEqual(levelsOf(records), ["0@20:refused", "1@20:ok"]);
    assert.match(asked[0], /shares\{link,name,description,id\}/);
    assert.equal(asked[1], "participants,messages.limit(20){id,created_time,from,message,attachments,shares}");
    // Remembered: the next read starts at the bare edges.
    const again = scripted([OK]);
    const b = await askThread(again.route, "c1", "facebook", k);
    assert.equal(b.level, 1);
    assert.equal(again.asked.length, 1);
    assert.match(again.asked[0], /attachments,shares\}$/);
  });

  test("slow means the smaller page next, remembering nothing", async () => {
    const k = key();
    const { route } = scripted([SLOW, OK]);
    const records: ThreadAskRecord[] = [];
    const a = await askThread(route, "c1", "instagram", k, (x) => records.push(x));
    assert.deepEqual(levelsOf(records), ["0@20:slow", "0@8:ok"]);
    assert.equal(a.limit, 8, "a partial page: the screen merges");
    const again = scripted([OK]);
    await askThread(again.route, "c1", "instagram", k);
    assert.match(again.asked[0], /limit\(20\)/, "the full page is asked again next time");
  });

  test("a hiccup is not a refusal: nothing is fixed below the best level", async () => {
    const k = key();
    const { route } = scripted([HICCUP, HICCUP, OK]);
    const records: ThreadAskRecord[] = [];
    const a = await askThread(route, "c1", "instagram", k, (x) => records.push(x));
    assert.deepEqual(levelsOf(records), ["0@20:transient", "0@8:transient", "1@20:ok"]);
    assert.equal(a.level, 1);
    const again = scripted([OK]);
    await askThread(again.route, "c1", "instagram", k);
    assert.match(again.asked[0], /is_unsupported/, "the named fields are asked again: the bare edges were never remembered");
  });

  test("two outright refusals: words only, remembered with the reason", async () => {
    const k = key();
    const { route } = scripted([REFUSED, REFUSED, OK]);
    const records: ThreadAskRecord[] = [];
    const a = await askThread(route, "c1", "facebook", k, (x) => records.push(x));
    assert.deepEqual(levelsOf(records), ["0@20:refused", "1@20:refused", "2@20:ok"]);
    assert.equal(a.level, 2);
    assert.ok(a.rememberedUntil && a.rememberedUntil > Date.now());
    assert.match(a.richProblem ?? "", /Unknown fields/);
    const note = attachmentsNote("facebook", a.richProblem, a.rememberedUntil);
    assert.match(note, /^Facebook refused the attachment fields \(code 100 .*\) — words only until \d\d:\d\d; what was shown before is kept\.$/);
    // The next read goes straight to words only and still knows why.
    const again = scripted([OK]);
    const b = await askThread(again.route, "c1", "facebook", k);
    assert.equal(again.asked.length, 1);
    assert.equal(again.asked[0], "participants,messages.limit(20){id,created_time,from,message}");
    assert.equal(b.level, 2);
    assert.match(b.richProblem ?? "", /Unknown fields/);
    assert.ok(b.rememberedUntil);
  });

  test("a rate limit stops the read at once and remembers nothing", async () => {
    const k = key();
    const { route, asked } = scripted([LIMIT, OK, OK]);
    const a = await askThread(route, "c1", "instagram", k);
    assert.equal(a.r.ok, false);
    assert.equal(asked.length, 1);
    const again = scripted([OK]);
    const b = await askThread(again.route, "c1", "instagram", k);
    assert.equal(b.level, 0, "the named fields are asked again");
    assert.equal(attachmentsNote("instagram", null, null), "Photos and files could not be read from Instagram this time — what was shown before is kept, and the next refresh tries again.");
  });
});

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
    assert.equal(classifyFile({ name: "clip.mov", type: "video/quicktime", size: MB }, "whatsapp").ok, true, "fitted in the browser");
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
