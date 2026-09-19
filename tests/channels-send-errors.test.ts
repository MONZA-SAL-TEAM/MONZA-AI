/**
 * Why Meta refused a reply (lib/channels/send-errors.ts), and the inbox's "clients need a
 * salesperson" bar (Samer, 2026-09-19).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { explainSendRefusal } from "@/lib/channels/send-errors";
import { sendInstagram, sendInstagramLogin } from "@/lib/channels/instagram";
import { sendMessenger } from "@/lib/channels/messenger";
import { alertsHeadline } from "@/lib/wasales/alerts";

const meta = (code: number, sub?: number, message = "") => ({ error: { code, ...(sub ? { error_subcode: sub } : {}), message, type: "OAuthException" } });

describe("a refused reply says WHY, and keeps Meta's code", () => {
  test("the five causes need opposite fixes, so each is named", () => {
    const cases: [unknown, number, string, RegExp][] = [
      [meta(10, 2018278, "(#10) This message is sent outside of allowed window."), 400, "window", /within 24 hours/],
      [meta(10, undefined, "(#10) Application does not have permission for this action"), 403, "permission", /App Review/],
      [meta(200, undefined, "(#200) Requires pages_messaging permission"), 403, "permission", /pages_messaging|instagram_manage_messages/],
      [meta(3, undefined, "(#3) Application does not have the capability to make this API call."), 400, "permission", /Advanced Access/],
      [meta(190, 463, "Error validating access token: Session has expired"), 401, "token", /new key in Vercel/],
      [meta(551, 1545041, "This person isn't available right now."), 400, "unreachable", /blocked the account/],
      [meta(100, 2018001, "No matching user found"), 400, "unreachable", /cannot be messaged/],
      [meta(613, undefined, "Calls to this api have exceeded the rate limit."), 429, "rate_limit", /Wait a minute/],
      [meta(2, undefined, "Service temporarily unavailable"), 503, "meta_down", /press Send again/],
      [meta(100, undefined, "Invalid parameter"), 400, "bad_request", /as written/],
      [null, 418, "unknown", /Nothing was sent/],
    ];
    for (const [payload, status, kind, words] of cases) {
      for (const channel of ["instagram", "facebook"] as const) {
        const r = explainSendRefusal(payload, status, channel);
        assert.equal(r.kind, kind, JSON.stringify(payload));
        assert.match(r.message, words, r.message);
        assert.match(r.message, new RegExp(`HTTP ${status}`), "Meta's own code is always kept");
        assert.doesNotMatch(r.message, /undefined|null|\[object/);
      }
    }
    // The window is code 10 too — the SUBCODE decides, and it must win over "permission".
    assert.equal(explainSendRefusal(meta(10, 2018278), 400, "facebook").kind, "window");
    assert.equal(explainSendRefusal(meta(10), 400, "facebook").kind, "permission");
    // Only what is worth pressing Send again for is retryable.
    assert.equal(explainSendRefusal(meta(613), 429, "instagram").retryable, true);
    assert.equal(explainSendRefusal(meta(10, 2018278), 400, "instagram").retryable, false);
    // Each channel names its own app and its own permission.
    assert.match(explainSendRefusal(meta(200), 403, "instagram").message, /Instagram.*instagram_manage_messages/s);
    assert.match(explainSendRefusal(meta(200), 403, "facebook").message, /Messenger.*pages_messaging/s);
  });

  test("the three senders pass it on — kind, codes and the words — and never the key", async () => {
    const refuse = (body: unknown, status: number) =>
      (async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    const msg = { accountId: "ig-voyah", toExternalId: "123", text: "hello" };
    for (const send of [sendInstagram, sendInstagramLogin, sendMessenger]) {
      const r = await send(msg, "SECRET-KEY-VALUE", refuse(meta(10, 2018278, "outside of allowed window"), 400));
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.equal(r.kind, "window");
        assert.match(r.codes ?? "", /code 10, subcode 2018278, HTTP 400/);
        assert.match(r.error, /24 hours/);
        assert.doesNotMatch(r.error, /SECRET-KEY-VALUE|hello/);
        assert.equal(r.retryable, false);
      }
    }
    const ok = await sendMessenger(msg, "k", (async () => new Response(JSON.stringify({ message_id: "m_1" }), { status: 200 })) as unknown as typeof fetch);
    assert.deepEqual(ok, { ok: true, externalMessageId: "m_1" });
  });
});

describe("the 'clients need a salesperson' bar opens and shuts", () => {
  const tsx = readFileSync(join(process.cwd(), "app/inbox/SalesAlerts.tsx"), "utf8");
  const css = readFileSync(join(process.cwd(), "app/inbox/suggestion.css"), "utf8");

  test("closed by default, remembered per device, and says what is urgent while closed", () => {
    assert.match(tsx, /useState\(false\)/, "twenty alerts never bury the conversations");
    assert.match(tsx, /localStorage\.setItem\(OPEN_KEY/);
    assert.deepEqual(alertsHeadline([{ urgency: "hot" }, { urgency: "overdue" }, { urgency: "overdue" }, { urgency: "normal" }, {}]), { hot: 1, overdue: 2 });
  });

  test("one real button with aria-expanded; shut, the list is inert and hidden from screen readers", () => {
    assert.match(tsx, /aria-expanded=\{open\}/);
    assert.match(tsx, /aria-controls="sa-panel"/);
    assert.match(tsx, /aria-hidden=\{!open\}/);
    assert.match(tsx, /\.inert = !open/);
  });

  test("it glides, scrolls by itself, and respects reduced motion", () => {
    assert.match(css, /grid-template-rows: 0fr/);
    assert.match(css, /\.sa-strip\[data-open="true"\] \.sa-panel \{ grid-template-rows: 1fr; \}/);
    assert.match(css, /max-height: min\(46vh, 420px\); overflow-y: auto/);
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /\.sa-toggle \{[^}]*min-height: 44px/s, "a thumb-sized target");
  });
});
