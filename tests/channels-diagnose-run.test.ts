/**
 * diagnoseAccount end to end, with Meta and the database faked.
 *
 * The case this file exists for: a REFUSED PAGE TOKEN must not suppress the
 * checks that do not depend on it. That regression shipped once — the diagnosis
 * returned early on the Page/Instagram-link step, so the delivery record, the
 * key's granular permissions and Meta's record of which webhook objects the app
 * subscribes to were never read, and the reader was left with one unexplained
 * refusal and none of the evidence that would explain it.
 *
 * Also asserted here: four distinct statuses rather than a boolean, a shared
 * time budget that RETURNS completed work instead of letting one slow Instagram
 * listing burn the route's timeout, and no credential in any output.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { diagnoseAccount, type DiagnoseIO, type DiagnoseStep } from "@/lib/channels/live";
import type { StoredAccount } from "@/lib/channels/store";

const VOYAH_PAGE = "408893845643871";
const VOYAH_IG = "17841457996874250";
const APP = "912301501380919";
const SECRET = "app-secret-never-printed";
const TOKEN = "system-user-token-never-printed";

const base = (over: Partial<StoredAccount> = {}): StoredAccount => ({
  id: "ig-voyah",
  brand: "voyah",
  channel: "instagram",
  displayName: "@voyahlebanon",
  externalId: VOYAH_IG,
  portfolio: "VoyahLebanon",
  tokenEnv: "META_TOKEN_VOYAH",
  connectedAt: null,
  appId: APP,
  ...over,
});

const FB = base({ id: "fb-voyah", channel: "facebook", displayName: "Voyah Lebanon", externalId: VOYAH_PAGE });

/** A clock the test advances by hand, so no assertion depends on wall time. */
function clock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

function io(over: Partial<DiagnoseIO> = {}): DiagnoseIO {
  return {
    accounts: async () => [base(), FB],
    deliveries: async () => ({ ok: true as const, rows: [], limit: 500 }),
    graph: async () => ({ ok: true as const, json: { data: [] } }),
    tokenFor: () => TOKEN,
    secretFor: () => SECRET,
    now: () => 1_000,
    budgetMs: 45_000,
    ...over,
  };
}

const named = (steps: DiagnoseStep[], name: string) => steps.find((s) => s.step === name);
const names = (steps: DiagnoseStep[]) => steps.map((s) => s.step);

describe("diagnoseAccount: a refused Page token does not hide the checks that explain it", () => {
  /** Meta answers everything the app's own id and secret may ask, and refuses
   *  the Page read — the exact shape of a permission problem on the Page. */
  const pageRefused: DiagnoseIO["graph"] = async (path) => {
    if (path === "debug_token") {
      return {
        ok: true,
        json: { data: { is_valid: true, scopes: ["instagram_basic", "instagram_manage_messages"], app_id: APP } },
      };
    }
    if (path.endsWith("/subscriptions")) {
      return {
        ok: true,
        json: { data: [{ object: "instagram", active: true, callback_url: "https://x.test/hook", fields: [{ name: "messages" }] }] },
      };
    }
    return { ok: false, problem: "Not yet given permission.", retryLighter: false, meta: "code 200" };
  };

  test("the independent checks still run and still answer", async () => {
    const r = await diagnoseAccount("ig-voyah", io({ graph: pageRefused }));
    assert.equal(r.ok, true);
    if (!r.ok) return;

    assert.ok(names(r.steps).includes("Webhooks Meta has actually delivered"));
    assert.equal(named(r.steps, "Access key permissions")?.status, "pass");
    assert.equal(named(r.steps, "Meta's record of this app's webhooks")?.status, "pass");
    assert.match(named(r.steps, "Meta's record of this app's webhooks")?.detail ?? "", /instagram: active/);
  });

  test("the Page step fails and the reads that need it are reported as skipped", async () => {
    const r = await diagnoseAccount("ig-voyah", io({ graph: pageRefused }));
    assert.equal(r.ok, true);
    if (!r.ok) return;

    assert.equal(named(r.steps, "Page key and linked Instagram account")?.status, "fail");
    const skipped = named(r.steps, "Page and conversation reads");
    assert.equal(skipped?.status, "skipped");
    assert.match(skipped?.detail ?? "", /Not attempted/);
  });

  test("the independent checks come BEFORE the Page check, so ordering cannot suppress them", async () => {
    const r = await diagnoseAccount("ig-voyah", io({ graph: pageRefused }));
    assert.equal(r.ok, true);
    if (!r.ok) return;

    const order = names(r.steps);
    const page = order.indexOf("Page key and linked Instagram account");
    assert.ok(order.indexOf("Webhooks Meta has actually delivered") < page);
    assert.ok(order.indexOf("Access key permissions") < page);
    assert.ok(order.indexOf("Meta's record of this app's webhooks") < page);
  });

  test("a missing access key is skipped, not failed — we did not ask", async () => {
    const r = await diagnoseAccount("ig-voyah", io({ graph: pageRefused, tokenFor: () => null }));
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const step = named(r.steps, "Access key permissions");
    assert.equal(step?.status, "skipped");
    assert.match(step?.detail ?? "", /META_TOKEN_VOYAH/);
  });
});

describe("diagnoseAccount: four statuses, never a boolean", () => {
  test("an unreadable delivery record is unknown, not fail", async () => {
    const r = await diagnoseAccount(
      "ig-voyah",
      io({ deliveries: async () => ({ ok: false as const, error: "no database key" }) })
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const step = named(r.steps, "Webhooks Meta has actually delivered");
    assert.equal(step?.status, "unknown");
    assert.match(step?.detail ?? "", /unknown rather than empty/);
  });

  test("no matching delivery row is unknown, because absence is not evidence", async () => {
    const r = await diagnoseAccount("ig-voyah", io());
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(named(r.steps, "Webhooks Meta has actually delivered")?.status, "unknown");
  });

  test("a matching delivery row passes", async () => {
    const r = await diagnoseAccount(
      "ig-voyah",
      io({
        deliveries: async () => ({
          ok: true as const,
          limit: 500,
          rows: [
            { object: "instagram", ids: [VOYAH_IG], receivedAt: "2026-09-12T10:00:00.000Z", eventCount: 1, storedCount: 1 },
          ],
        }),
      })
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(named(r.steps, "Webhooks Meta has actually delivered")?.status, "pass");
  });

  test("an Instagram-Login key FAILS the API-flavour check rather than passing quietly", async () => {
    const r = await diagnoseAccount(
      "ig-voyah",
      io({
        graph: async (path) =>
          path === "debug_token"
            ? { ok: true, json: { data: { is_valid: true, scopes: ["instagram_business_basic"] } } }
            : { ok: false, problem: "refused", retryLighter: false },
      })
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const step = named(r.steps, "Which Instagram API this key is for");
    assert.equal(step?.status, "fail");
    assert.match(step?.detail ?? "", /NOT the configuration this product is written for/);
  });
});

describe("diagnoseAccount: the time budget returns work instead of discarding it", () => {
  test("a slow first call does not cost the checks already completed", async () => {
    const c = clock();
    // The first Meta call burns 44 s of the 45 s budget, leaving less than the
    // floor a network step needs — so nothing after it may start.
    const slow: DiagnoseIO["graph"] = async (path) => {
      c.advance(44_000);
      if (path === "debug_token") {
        return { ok: true, json: { data: { is_valid: true, scopes: ["instagram_basic"] } } };
      }
      return { ok: true, json: { data: [] } };
    };
    const r = await diagnoseAccount("ig-voyah", io({ graph: slow, now: c.now }));
    assert.equal(r.ok, true);
    if (!r.ok) return;

    assert.equal(r.truncated, true);
    assert.equal(named(r.steps, "Access key permissions")?.status, "pass");
    const later = named(r.steps, "Meta's record of this app's webhooks");
    assert.equal(later?.status, "skipped");
    assert.match(later?.detail ?? "", /time budget/);
    // The Page-token checks are reported as not attempted, not omitted.
    assert.ok(names(r.steps).includes("Page and conversation reads"));
  });

  test("a run inside its budget is not marked truncated", async () => {
    const r = await diagnoseAccount("ig-voyah", io());
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.truncated, false);
  });
});

describe("diagnoseAccount: nothing secret reaches the answer", () => {
  test("no token, app secret or composite app token appears in any step", async () => {
    const r = await diagnoseAccount(
      "ig-voyah",
      io({
        graph: async (_path, _params, token) =>
          // Meta echoing the credential back is the shape this guards against.
          ({ ok: true, json: { data: [{ echoed: token }] } }),
      })
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const blob = JSON.stringify(r.steps);
    assert.doesNotMatch(blob, new RegExp(TOKEN));
    assert.doesNotMatch(blob, new RegExp(SECRET));
    assert.doesNotMatch(blob, /app-secret|system-user-token/);
  });

  test("an unknown account is refused without revealing the registry", async () => {
    const r = await diagnoseAccount("ig-nope", io());
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.status, 404);
  });

  test("a non-string account id is a 400", async () => {
    const r = await diagnoseAccount(undefined, io());
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.status, 400);
  });
});

/**
 * The Page read is on the INBOX's hot path, not just the diagnosis. Asking for
 * instagram_business_account{id,ig_id,username} gained the diagnosis the second
 * id it needs — but a Meta version or permission that rejects the sub-field
 * syntax must never cost us the linked-account id, because accountContext
 * refuses to read an Instagram account without it and the inbox would go dark.
 */
describe("the Page read falls back rather than taking the Instagram inbox down", () => {
  test("when the expanded field list is refused, the plain one is asked and the link survives", async () => {
    const asked: string[] = [];
    const r = await diagnoseAccount(
      "ig-voyah",
      io({
        graph: async (path, params) => {
          if (path === VOYAH_PAGE) {
            const fields = params.fields ?? "";
            asked.push(fields);
            if (fields.includes("{")) {
              return { ok: false, problem: "Unsupported get request.", retryLighter: false, meta: "code 100" };
            }
            return {
              ok: true,
              json: { access_token: "PAGE_TOKEN", instagram_business_account: { id: VOYAH_IG } },
            };
          }
          return { ok: true, json: { data: [] } };
        },
      })
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;

    // Both shapes were tried, expanded first.
    assert.equal(asked.length >= 2, true);
    assert.match(asked[0], /\{id,ig_id,username\}/);
    assert.doesNotMatch(asked[1], /\{/);

    // And the account is still readable: the Page step passed.
    assert.equal(named(r.steps, "Page key and linked Instagram account")?.status, "pass");
    // ig_id is simply absent, and the summary says so rather than inventing it.
    assert.match(named(r.steps, "Instagram id on record vs Meta's two ids")?.detail ?? "", /ig_id not returned/);
  });
});
