/**
 * The staff-only diagnosis must say WHICH refusal Meta gave and whether the
 * access key actually carries each messaging permission for the right account
 * (2026-09-11: every Instagram listing was refused or timed out while Facebook
 * worked, and the plain sentence could not tell those causes apart).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  instagramApiFlavour,
  metaErrorDetail,
  safeCallbackUrl,
  summariseAppSubscriptions,
  summariseDebugToken,
  summariseDeliveries,
  summariseInstagramIdentity,
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
 * The delivery record is the one check that needs no token. It separates "no
 * matching row" from "it arrived and nothing was kept" — but it must never be
 * read as proof that Meta sent nothing, and its counters are payload-level, not
 * per-account. Both overclaims shipped in the first version of this summariser
 * and both are asserted against here.
 */
describe("summariseDeliveries", () => {
  const CAP = 500;
  const messengerDelivery: DeliveryRecord = {
    object: "page",
    ids: ["408893845643871"],
    receivedAt: "2026-09-11T13:01:12.168Z",
    eventCount: 1,
    storedCount: 1,
  };

  test("an empty table is reported as no rows, never as proof Meta sent nothing", () => {
    const s = summariseDeliveries([], "17841457996874250", "instagram", CAP);
    assert.match(s, /No delivery rows are recorded at all/);
    assert.match(s, /not evidence that Meta sent nothing/);
    assert.doesNotMatch(s, /never posted/);
  });

  test("a signature or logging failure is named as a reason a row can be missing", () => {
    const s = summariseDeliveries([messengerDelivery], "17841457996874250", "instagram", CAP);
    assert.match(s, /failed signature verification, failed to parse, or failed to log/);
  });

  test("no match is scoped to the inspected sample and states its bounds", () => {
    const s = summariseDeliveries([messengerDelivery], "17841457996874250", "instagram", CAP);
    assert.match(s, /No matching delivery recorded in the inspected sample for 17841457996874250/);
    assert.match(s, /no "instagram" delivery appears in the sample at all/);
    assert.match(s, /Inspected sample: 1 row\(s\) across ALL accounts/);
    assert.match(s, /cap 500/);
    assert.doesNotMatch(s, /NOTHING for/);
  });

  test("a sample at the cap warns that older rows fall outside it", () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      ...messengerDelivery,
      receivedAt: `2026-09-1${i + 1}T00:00:00.000Z`,
    }));
    const s = summariseDeliveries(rows, "17841457996874250", "instagram", 3);
    assert.match(s, /AT THE CAP, so older rows for this account may fall outside it/);
  });

  test("a sample under the cap does not warn about truncation", () => {
    const s = summariseDeliveries([messengerDelivery], "17841457996874250", "instagram", CAP);
    assert.doesNotMatch(s, /AT THE CAP/);
  });

  test("a matching delivery reports the most recent and labels the counts payload-level", () => {
    const s = summariseDeliveries([messengerDelivery], "408893845643871", "page", CAP);
    assert.match(s, /1 delivery\(ies\) in the sample name 408893845643871/);
    assert.match(s, /2026-09-11T13:01:12\.168Z/);
    assert.match(s, /payload-level counts: 1 event\(s\), 1 stored/);
  });

  test("nothing stored lists all four causes and never calls it dropped", () => {
    const s = summariseDeliveries(
      [{ ...messengerDelivery, eventCount: 3, storedCount: 0 }],
      "408893845643871",
      "page",
      CAP
    );
    assert.match(s, /nothing was stored from these payloads/);
    assert.match(s, /duplicate redelivery \(correct\)/);
    assert.match(s, /a failed write \(a fault\)/);
    assert.doesNotMatch(s, /DROPPED/);
  });

  test("a payload naming several accounts says the counts are not this account's alone", () => {
    const s = summariseDeliveries(
      [{ ...messengerDelivery, ids: ["408893845643871", "419538711242175"] }],
      "408893845643871",
      "page",
      CAP
    );
    assert.match(s, /named more than one account, so the counts are not this account's alone/);
  });

  test("a single-account payload carries no multi-account caveat", () => {
    const s = summariseDeliveries([messengerDelivery], "408893845643871", "page", CAP);
    assert.doesNotMatch(s, /more than one account/);
  });

  test("the right account under an unexpected webhook object is noted, not alarmed", () => {
    const s = summariseDeliveries(
      [{ ...messengerDelivery, ids: ["17841457996874250"] }],
      "17841457996874250",
      "instagram",
      CAP
    );
    assert.match(s, /NOTE: arrived under object page, expected instagram/);
  });
});

/**
 * Meta ships two Instagram messaging APIs. The Inbox renders from
 * {page-id}/conversations with a Page token, which only the Facebook-Login one
 * supports — so an Instagram-Login key receives webhooks and shows an empty
 * screen, with no error anywhere. The diagnosis has to name that out loud.
 */
describe("instagramApiFlavour", () => {
  const withScopes = (scopes: string[]) => ({ data: { is_valid: true, scopes } });

  test("the Facebook-Login vocabulary is the supported one", () => {
    const s = instagramApiFlavour(withScopes(["instagram_basic", "instagram_manage_messages", "pages_messaging"]));
    assert.match(s, /^Facebook Login/);
  });

  test("the Instagram-Login vocabulary warns that the Inbox will stay empty", () => {
    const s = instagramApiFlavour(
      withScopes(["instagram_business_basic", "instagram_business_manage_messages"])
    );
    assert.match(s, /^Instagram Login/);
    assert.match(s, /NOT the configuration this product is written for/);
    assert.match(s, /will not appear/);
  });

  test("both vocabularies is ambiguous and says so rather than picking one", () => {
    const s = instagramApiFlavour(withScopes(["instagram_basic", "instagram_business_basic"]));
    assert.match(s, /BOTH vocabularies present/);
  });

  test("no Instagram messaging permission at all is distinguished from the wrong one", () => {
    const s = instagramApiFlavour(withScopes(["pages_messaging", "pages_show_list"]));
    assert.match(s, /no Instagram messaging permission at all/);
  });

  test("a malformed answer does not read as Facebook Login", () => {
    assert.doesNotMatch(instagramApiFlavour({ error: { code: 190 } }), /^Facebook Login/);
    assert.doesNotMatch(instagramApiFlavour(null), /^Facebook Login/);
  });
});

/**
 * Meta gives one Instagram account two numeric identities: the Graph node id
 * (17841…) and the older ig_id, which is what the app dashboard's rate-limit
 * card displays. Confirmed live 2026-09-12: the VOYAH dashboard showed
 * 117114624612614 while our registry holds 17841457996874250, and a person
 * comparing the two reasonably concluded the registry was wrong.
 *
 * Both halves matter. Reading the dashboard id as a fault sends you fixing a
 * row that is correct; a REAL mismatch on the Graph id silently drops every
 * Instagram event, because an unrecognised account has no brand to file under.
 */
describe("summariseInstagramIdentity", () => {
  test("the Graph id matching is a match, whatever the dashboard shows", () => {
    const s = summariseInstagramIdentity(
      "17841457996874250",
      "17841457996874250",
      "117114624612614",
      "voyahlebanon"
    );
    assert.match(s, /MATCHES/);
    assert.match(s, /117114624612614/);
    assert.match(s, /is expected and is not a fault/);
    assert.match(s, /@voyahlebanon/);
  });

  test("a match still warns that entry\[\].id is the thing that decides storage", () => {
    const s = summariseInstagramIdentity("17841457996874250", "17841457996874250", "117114624612614", null);
    assert.match(s, /entry\[\]\.id/);
    assert.match(s, /channel_deliveries/);
  });

  test("a real mismatch says every event will be dropped and names the right id", () => {
    const s = summariseInstagramIdentity("117114624612614", "17841457996874250", "117114624612614", "voyahlebanon");
    assert.match(s, /MISMATCH on the Graph id/);
    assert.match(s, /dropped/);
    assert.match(s, /until the registry row holds 17841457996874250/);
    assert.doesNotMatch(s, /MATCHES/);
  });

  test("no linked account is unknown, not a mismatch", () => {
    const s = summariseInstagramIdentity("17841457996874250", null, null, null);
    assert.match(s, /did not report an Instagram account/);
    assert.doesNotMatch(s, /MISMATCH/);
  });

  test("a missing ig_id is stated rather than left blank", () => {
    const s = summariseInstagramIdentity("17841457996874250", "17841457996874250", null, null);
    assert.match(s, /ig_id not returned/);
  });
});

/**
 * A webhook callback is a place people put secrets — a token in a query string
 * is a known pattern — and this output is rendered to staff and pasted into
 * chat. So query and fragment go unconditionally, and the removal is STATED:
 * a silent strip would have someone compare this against the dashboard, see a
 * shorter string, and hunt a configuration difference that does not exist.
 */
describe("safeCallbackUrl", () => {
  test("a plain URL is shown whole and unannotated", () => {
    const s = safeCallbackUrl("https://monza-ai.vercel.app/api/channels/meta");
    assert.equal(s, "https://monza-ai.vercel.app/api/channels/meta");
  });

  test("a query string is removed and the removal is announced", () => {
    const s = safeCallbackUrl("https://monza-ai.vercel.app/api/channels/meta?token=SECRETVALUE&x=1");
    assert.doesNotMatch(s, /SECRETVALUE/);
    assert.doesNotMatch(s, /token=/);
    assert.match(s, /\[query\/fragment hidden\]/);
    assert.match(s, /^https:\/\/monza-ai\.vercel\.app\/api\/channels\/meta /);
  });

  test("a fragment is removed too", () => {
    const s = safeCallbackUrl("https://x.test/hook#access_token=SECRETVALUE");
    assert.doesNotMatch(s, /SECRETVALUE/);
    assert.match(s, /hidden/);
  });

  test("a missing or non-string callback says so rather than printing undefined", () => {
    assert.equal(safeCallbackUrl(undefined), "no callback");
    assert.equal(safeCallbackUrl(null), "no callback");
    assert.equal(safeCallbackUrl(42), "no callback");
    assert.equal(safeCallbackUrl(""), "no callback");
  });

  test("the subscription summary carries no query string through", () => {
    const s = summariseAppSubscriptions(
      { data: [{ object: "instagram", active: true, callback_url: "https://x.test/hook?verify=SECRETVALUE", fields: [{ name: "messages" }] }] },
      ["instagram"]
    );
    assert.doesNotMatch(s, /SECRETVALUE/);
    assert.match(s, /hidden/);
  });
});
