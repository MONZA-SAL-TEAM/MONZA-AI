/**
 * The staff-only diagnosis must say WHICH refusal Meta gave and whether the
 * access key actually carries each messaging permission for the right account
 * (2026-09-11: every Instagram listing was refused or timed out while Facebook
 * worked, and the plain sentence could not tell those causes apart).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  metaErrorDetail,
  summariseAppSubscriptions,
  summariseDebugToken,
  summariseDeliveries,
  summariseSubscribedApps,
  type DeliveryRecord,
  type ScopeWant,
} from "@/lib/channels/live-map";

describe("metaErrorDetail keeps Meta's plain-language explanation", () => {
  test("the Instagram listing timeout says why", () => {
    const d = metaErrorDetail({
      error: {
        code: -2,
        error_subcode: 2534084,
        message: "Timeout",
        error_user_msg: "Your query has timed out since you have too many conversations with users who do not have a role on app.",
      },
    });
    assert.match(d ?? "", /code -2, subcode 2534084/);
    assert.match(d ?? "", /do not have a role on app/);
  });

  test("does not repeat a user message identical to the message", () => {
    const d = metaErrorDetail({ error: { code: 1, message: "Same", error_user_msg: "Same" } }) ?? "";
    assert.equal(d.match(/Same/g)?.length, 1);
  });
});

describe("summariseAppSubscriptions", () => {
  const OURS = "https://monza-ai.vercel.app/api/channels/meta";

  test("reports each object: active, callback, fields", () => {
    const s = summariseAppSubscriptions(
      {
        data: [
          { object: "page", callback_url: OURS, active: true, fields: [{ name: "messages", version: "v26.0" }] },
          {
            object: "instagram",
            callback_url: OURS,
            active: true,
            fields: [{ name: "messages" }, { name: "messaging_postbacks" }],
          },
        ],
      },
      ["page", "instagram"]
    );
    assert.equal(
      s,
      `page: active, ${OURS}, fields messages · instagram: active, ${OURS}, fields messages, messaging_postbacks`
    );
  });

  test("an object Meta has no record of says NOT subscribed", () => {
    const s = summariseAppSubscriptions({ data: [{ object: "page", active: true, fields: [] }] }, ["page", "instagram"]);
    assert.match(s, /instagram: NOT subscribed/);
    assert.match(s, /page: active, no callback, fields none/);
  });

  test("no list at all is said plainly", () => {
    assert.equal(summariseAppSubscriptions({ error: { code: 190 } }, ["page"]), "Meta returned no subscription list.");
  });
});

describe("summariseSubscribedApps", () => {
  test("names every app the Page sends events to, and whether ours is one", () => {
    const s = summariseSubscribedApps(
      { data: [{ id: "912301501380919", name: "Monza SAL CHAT BOT", subscribed_fields: ["messages", "messaging_postbacks"] }] },
      "912301501380919"
    );
    assert.equal(s, "our app is subscribed · Monza SAL CHAT BOT (912301501380919): messages, messaging_postbacks");
  });

  test("another app only means ours is NOT subscribed", () => {
    const s = summariseSubscribedApps({ data: [{ id: "1", name: "Other", subscribed_fields: [] }] }, "912301501380919");
    assert.match(s, /^our app is NOT subscribed · Other \(1\): no fields$/);
  });

  test("an empty list says no app is subscribed", () => {
    assert.equal(summariseSubscribedApps({ data: [] }, "912301501380919"), "No app is subscribed to this Page.");
  });
});

const IG = "17841469421956644";
const PAGE = "419538711242175";

const WANTS: ScopeWant[] = [
  { scope: "instagram_manage_messages", id: IG },
  { scope: "pages_messaging", id: PAGE },
];

describe("metaErrorDetail", () => {
  test("keeps Meta's code, subcode, type and message", () => {
    const detail = metaErrorDetail({
      error: {
        message: "(#3) Application does not have the capability to make this API call.",
        type: "OAuthException",
        code: 3,
        error_subcode: 2069030,
        fbtrace_id: "Abc",
      },
    });
    assert.equal(
      detail,
      'code 3, subcode 2069030, OAuthException, "(#3) Application does not have the capability to make this API call."'
    );
  });

  test("tells code 10 apart from code 3", () => {
    const ten = metaErrorDetail({ error: { code: 10, message: "(#10) Permission denied" } });
    const three = metaErrorDetail({ error: { code: 3, message: "(#3) No capability" } });
    assert.notEqual(ten, three);
    assert.match(ten ?? "", /^code 10/);
  });

  test("is null when there is no error", () => {
    assert.equal(metaErrorDetail({ data: [] }), null);
    assert.equal(metaErrorDetail(null), null);
  });

  test("caps a long message", () => {
    const detail = metaErrorDetail({ error: { code: 1, message: "x".repeat(500) } }) ?? "";
    assert.ok(detail.length < 230);
  });
});

describe("summariseDebugToken", () => {
  const base = { app_id: "1793221688521200", type: "SYSTEM_USER", is_valid: true, expires_at: 0 };

  test("granted and reaching the right accounts", () => {
    const s = summariseDebugToken(
      {
        data: {
          ...base,
          scopes: ["instagram_manage_messages", "pages_messaging"],
          granular_scopes: [
            { scope: "instagram_manage_messages", target_ids: [IG] },
            { scope: "pages_messaging", target_ids: [PAGE] },
          ],
        },
      },
      WANTS
    );
    assert.match(s, /^valid, SYSTEM_USER, app 1793221688521200, never expires/);
    assert.match(s, new RegExp(`instagram_manage_messages: granted for ${IG}`));
    assert.match(s, new RegExp(`pages_messaging: granted for ${PAGE}`));
  });

  test("a permission missing from the key says NOT granted", () => {
    const s = summariseDebugToken({ data: { ...base, scopes: ["pages_messaging"] } }, WANTS);
    assert.match(s, /instagram_manage_messages: NOT granted/);
    assert.match(s, /pages_messaging: granted \(every account\)/);
  });

  test("a permission that covers a different account says so", () => {
    const s = summariseDebugToken(
      {
        data: {
          ...base,
          scopes: ["instagram_manage_messages"],
          granular_scopes: [{ scope: "instagram_manage_messages", target_ids: ["999"] }],
        },
      },
      WANTS
    );
    assert.match(s, new RegExp(`instagram_manage_messages: granted, but NOT for ${IG} \\(covers 999\\)`));
  });

  test("an invalid or expiring key is stated", () => {
    const s = summariseDebugToken(
      { data: { ...base, is_valid: false, expires_at: 1_800_000_000, scopes: [] } },
      WANTS
    );
    assert.match(s, /^NOT valid, SYSTEM_USER, app 1793221688521200, expires 2027-01-15/);
    assert.match(s, /all permissions: none/);
  });

  test("no data is said plainly", () => {
    assert.equal(summariseDebugToken({ error: { code: 190 } }, WANTS), "Meta returned no details for this key.");
  });
});

/**
 * The delivery record is the one check that needs no token: it separates "Meta
 * never sent it" from "it arrived and we lost it". Messenger delivering while
 * Instagram stays silent is the exact shape of a `page` subscription that works
 * and an `instagram` subscription that was never made, and the diagnosis has to
 * say so rather than report both as "nothing in the inbox".
 */
describe("summariseDeliveries", () => {
  const messengerDelivery: DeliveryRecord = {
    object: "page",
    ids: ["408893845643871"],
    receivedAt: "2026-09-11T13:01:12.168Z",
    eventCount: 1,
    storedCount: 1,
  };

  test("no delivery at all blames the endpoint, not the account", () => {
    const s = summariseDeliveries([], "17841457996874250", "instagram");
    assert.match(s, /never posted a webhook to this endpoint/);
  });

  test("Messenger delivering while Instagram is silent points at the instagram subscription", () => {
    const s = summariseDeliveries([messengerDelivery], "17841457996874250", "instagram");
    assert.match(s, /NOTHING for 17841457996874250/);
    assert.match(s, /never sent a "instagram" delivery at all/);
    assert.match(s, /1 delivery\(ies\) recorded in total/);
  });

  test("an account that has received deliveries reports the most recent", () => {
    const s = summariseDeliveries([messengerDelivery], "408893845643871", "page");
    assert.match(s, /1 delivery\(ies\) named 408893845643871/);
    assert.match(s, /2026-09-11T13:01:12\.168Z/);
    assert.match(s, /1 event\(s\), 1 stored/);
    assert.doesNotMatch(s, /DROPPED/);
  });

  test("delivered but nothing kept is called out as dropped, not as silence", () => {
    const s = summariseDeliveries(
      [{ ...messengerDelivery, eventCount: 3, storedCount: 0 }],
      "408893845643871",
      "page"
    );
    assert.match(s, /DROPPED/);
  });

  test("the right account under the wrong webhook object is a warning", () => {
    const s = summariseDeliveries(
      [{ ...messengerDelivery, ids: ["17841457996874250"] }],
      "17841457996874250",
      "instagram"
    );
    assert.match(s, /WARNING: arrived under object page, expected instagram/);
  });

  test("deliveries for another account under the same object do not count as this one's", () => {
    const s = summariseDeliveries(
      [{ ...messengerDelivery, object: "instagram", ids: ["17841469421956644"] }],
      "17841457996874250",
      "instagram"
    );
    assert.match(s, /NOTHING for 17841457996874250/);
    assert.match(s, /do arrive, but none has named this account/);
  });
});
