/**
 * What Instagram and Facebook messages carry (2026-09-15: a shared post read
 * "open the app to see it"). Pinned here:
 *
 *   - photos, videos, voice notes, files, stickers, shared posts and stories
 *     are read from the shapes Meta sends when a thread is opened;
 *   - only https links survive — a customer's shared link can be anything;
 *   - a message with nothing described still says so, rather than showing an
 *     empty bubble;
 *   - only Meta's own hosts are drawn as pictures.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { NO_TEXT, mapThread, metaAttachmentsOf } from "@/lib/channels/live-map";
import { isMetaCdn } from "@/lib/inbox/media";

const NOW = Date.parse("2026-09-15T13:00:00.000Z");
const CDN = "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1&signature=x";

describe("what a message carries", () => {
  test("a shared Instagram post", () => {
    const [a, ...rest] = metaAttachmentsOf({ shares: { data: [{ link: CDN }] } }, NOW);
    assert.equal(rest.length, 0);
    assert.equal(a.kind, "share");
    assert.equal(a.state, "ready");
    assert.equal(a.url, CDN);
    assert.equal(a.urlExpiresAt, "2026-09-15T13:55:00.000Z", "fresh for the screen's refreshes");
  });

  test("photos, videos, voice notes, files and stickers", () => {
    const kinds = metaAttachmentsOf(
      {
        attachments: {
          data: [
            { id: "1", mime_type: "image/jpeg", image_data: { url: "https://scontent.xx.fbcdn.net/p.jpg", width: 10 } },
            { id: "2", mime_type: "video/mp4", video_data: { url: "https://video.xx.fbcdn.net/v.mp4" } },
            { id: "3", mime_type: "audio/mpeg", video_data: { url: "https://cdn.fbsbx.com/a.mp4" } },
            { id: "4", mime_type: "application/pdf", name: "Offer.pdf", file_url: "https://cdn.fbsbx.com/f.pdf" },
            { id: "5", image_data: { url: "https://scontent.xx.fbcdn.net/s.png", render_as_sticker: true } },
          ],
        },
        sticker: "https://scontent.xx.fbcdn.net/like.png",
      },
      NOW
    );
    assert.deepEqual(kinds.map((a) => a.kind), ["image", "video", "audio", "file", "sticker", "sticker"]);
    assert.equal(kinds[3].filename, "Offer.pdf");
    assert.equal(kinds[0].mime, "image/jpeg");
  });

  test("story mentions and replies", () => {
    const [mention] = metaAttachmentsOf({ story: { mention: { link: CDN, id: "9" } } }, NOW);
    assert.equal(mention.kind, "share");
    assert.equal(mention.label, "Mentioned you in their story");
    const [reply] = metaAttachmentsOf({ story: { reply_to: { link: CDN, id: "9" } } }, NOW);
    assert.equal(reply.label, "Replied to your story");
  });

  test("only https links survive", () => {
    assert.deepEqual(
      metaAttachmentsOf({
        shares: { data: [{ link: "javascript:alert(1)" }, { link: "http://example.com/x" }, { link: "not a url" }] },
        sticker: "data:image/png;base64,xx",
      }),
      []
    );
  });

  test("nothing described is nothing, not a crash", () => {
    assert.deepEqual(metaAttachmentsOf(null), []);
    assert.deepEqual(metaAttachmentsOf({ attachments: "x", shares: { data: [null, 4] } }), []);
  });
});

describe("in the thread", () => {
  const SELF = ["17841457996874250", "408893845643871"];
  const thread = (message: Record<string, unknown>) =>
    mapThread(
      { messages: { data: [{ id: "m1", created_time: "2026-09-15T12:50:00+0000", from: { id: "999" }, ...message }] } },
      "ig-voyah~t1",
      SELF
    )[0];

  test("a post with no words shows the post, not the 'open the app' line", () => {
    const m = thread({ shares: { data: [{ link: CDN }] } });
    assert.equal(m.text, "");
    assert.equal(m.attachments?.[0].kind, "share");
  });

  test("words and a photo keep both", () => {
    const m = thread({ message: "this one?", attachments: { data: [{ image_data: { url: CDN } }] } });
    assert.equal(m.text, "this one?");
    assert.equal(m.attachments?.[0].kind, "image");
  });

  test("with nothing described, it still says so", () => {
    const m = thread({});
    assert.equal(m.text, NO_TEXT);
    assert.equal(m.attachments, undefined);
  });
});

describe("what is drawn as a picture", () => {
  test("Meta's hosts only", () => {
    assert.equal(isMetaCdn(CDN), true);
    assert.equal(isMetaCdn("https://scontent-mrs2-1.cdninstagram.com/v/t51.jpg"), true);
    assert.equal(isMetaCdn("https://scontent.xx.fbcdn.net/p.jpg"), true);
    assert.equal(isMetaCdn("https://www.instagram.com/p/abc/"), false, "a post's page is a link, not a picture");
    assert.equal(isMetaCdn("https://tracker.example.com/pixel.gif"), false);
    assert.equal(isMetaCdn("https://fbcdn.net.evil.io/x.jpg"), false);
    assert.equal(isMetaCdn(undefined), false);
  });
});
