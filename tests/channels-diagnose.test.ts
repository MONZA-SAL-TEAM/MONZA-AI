/**
 * The staff-only diagnosis must say WHICH refusal Meta gave and whether the
 * access key actually carries each messaging permission for the right account
 * (2026-09-11: every Instagram listing was refused or timed out while Facebook
 * worked, and the plain sentence could not tell those causes apart).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { metaErrorDetail, summariseDebugToken, type ScopeWant } from "@/lib/channels/live-map";

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
