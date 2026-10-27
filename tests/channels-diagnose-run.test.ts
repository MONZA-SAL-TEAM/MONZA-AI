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

const WA = base({ id: "wa-monza", brand: "monza", channel: "whatsapp", displayName: "+961 70 708 585", externalId: "984244264767607", tokenEnv: "META_TOKEN_WHATSAPP" });
const WABA = "1502691630809243";
const WA_STEPS = [
  "Our record of recent sends",
  "The last WhatsApp webhook received",
  "Meta's health status for the number",
  "The number as Meta sees it",
  "The app's subscription to the business account",
];
/** Meta answering every read of the number's diagnosis, as a healthy, subscribed, connected number. */
const waGraph = (over: Partial<Record<"health" | "number" | "apps", unknown>> = {}): DiagnoseIO["graph"] =>
  async (path, params) => {
    if (path === "984244264767607" && params.fields === "health_status") {
      return { ok: true, json: over.health ?? { health_status: { can_send_message: "AVAILABLE", entities: [{ entity_type: "WABA", id: WABA, can_send_message: "AVAILABLE" }] } } };
    }
    if (path === "984244264767607") return { ok: true, json: over.number ?? { id: "984244264767607", status: "CONNECTED", platform_type: "CLOUD_API", quality_rating: "GREEN" } };
    if (path === `${WABA}/subscribed_apps`) return { ok: true, json: over.apps ?? { data: [{ whatsapp_business_api_data: { id: APP, name: "Voyah" } }] } };
    return { ok: false, problem: `unexpected ${path}`, retryLighter: false };
  };

describe("diagnoseAccount on the WhatsApp number: our record first, then Meta's health status", () => {
  const LOCK = "Business account has been locked.";
  test("a locked account: the record says since when, Meta says which entity and why", async () => {
    const d = await diagnoseAccount(
      "wa-monza",
      io({
        accounts: async () => [WA],
        now: () => Date.parse("2026-10-23T08:00:00Z"),
        recentOutbound: async () => [
          { at: "2026-10-23T07:11:02Z", status: "failed", error: LOCK, direction: "out" },
          { at: "2026-10-23T05:25:27Z", status: "failed", error: LOCK, direction: "out" },
          { at: "2026-10-22T16:57:15Z", status: "read", error: null, direction: "out" },
        ],
        graph: waGraph({
          health: {
            health_status: {
              can_send_message: "BLOCKED",
              entities: [{ entity_type: "WABA", id: "1", can_send_message: "BLOCKED", errors: [{ error_code: 131031, error_description: LOCK, possible_solution: "Appeal in Business Support Home." }] }],
            },
          },
        }),
        lastDelivery: async () => ({ ok: true, last: "2026-10-23T07:12:48Z", lastDay: 36 }),
      })
    );
    assert.equal(d.ok, true);
    if (!d.ok) return;
    assert.deepEqual(names(d.steps), WA_STEPS);
    assert.equal(named(d.steps, "The last WhatsApp webhook received")?.status, "pass");
    assert.equal(named(d.steps, "The number as Meta sees it")?.status, "pass");
    assert.equal(named(d.steps, "The app's subscription to the business account")?.status, "pass");
    assert.match(named(d.steps, "The app's subscription to the business account")?.detail ?? "", /ours \(912301501380919\) is among them/);
    assert.equal(named(d.steps, "Our record of recent sends")?.status, "fail");
    assert.match(named(d.steps, "Our record of recent sends")?.detail ?? "", /^The newest send \(2026-10-23T07:11:02Z\) failed with "Business account has been locked\.", as did 2 since 2026-10-23T05:25:27Z; nothing of ours went out after it\.$/);
    assert.equal(named(d.steps, "Meta's health status for the number")?.status, "fail");
    assert.match(named(d.steps, "Meta's health status for the number")?.detail ?? "", /^BLOCKED\. WABA BLOCKED · 131031: Business account has been locked\. — Appeal in Business Support Home\.$/);
    assert.ok(!JSON.stringify(d).includes(TOKEN), "the key never appears");
  });

  test("a healthy account; a missing key is skipped, never failed; a refused read is unknown", async () => {
    const healthy = await diagnoseAccount(
      "wa-monza",
      io({
        accounts: async () => [WA],
        now: () => Date.parse("2026-10-23T10:00:00Z"),
        recentOutbound: async () => [{ at: "2026-10-23T09:00:00Z", status: "delivered", error: null, direction: "out" }],
        lastDelivery: async () => ({ ok: true, last: "2026-10-23T09:30:00Z", lastDay: 400 }),
        graph: waGraph(),
      })
    );
    assert.ok(healthy.ok && healthy.steps.every((s) => s.status === "pass"), JSON.stringify(healthy));
    // A lock lifted after an appeal: a later send got through, and the record says so.
    const lifted = await diagnoseAccount(
      "wa-monza",
      io({
        accounts: async () => [WA],
        now: () => Date.parse("2026-10-27T08:00:00Z"),
        recentOutbound: async () => [
          { at: "2026-10-26T10:00:00Z", status: "delivered", error: null, direction: "out" },
          { at: "2026-10-23T05:25:27Z", status: "failed", error: LOCK, direction: "out" },
        ],
      })
    );
    assert.ok(lifted.ok);
    if (!lifted.ok) return;
    assert.equal(named(lifted.steps, "Our record of recent sends")?.status, "pass");
    assert.match(named(lifted.steps, "Our record of recent sends")?.detail ?? "", /the lock is lifted/);
    // An old lock with nothing sent since proves nothing about now: unknown, never fail.
    const stale = await diagnoseAccount(
      "wa-monza",
      io({
        accounts: async () => [WA],
        now: () => Date.parse("2026-11-10T08:00:00Z"),
        recentOutbound: async () => [{ at: "2026-10-23T05:25:27Z", status: "failed", error: LOCK, direction: "out" }],
      })
    );
    assert.ok(stale.ok);
    if (!stale.ok) return;
    assert.equal(named(stale.steps, "Our record of recent sends")?.status, "unknown");
    const noKey = await diagnoseAccount("wa-monza", io({ accounts: async () => [WA], tokenFor: () => null }));
    assert.ok(noKey.ok);
    if (!noKey.ok) return;
    assert.equal(named(noKey.steps, "Our record of recent sends")?.status, "skipped");
    assert.equal(named(noKey.steps, "Meta's health status for the number")?.status, "skipped");
    assert.equal(named(noKey.steps, "The app's subscription to the business account")?.status, "skipped");
    // Four silent days after a lock, the number connected, but NO app subscribed: the silence explained.
    const silent = await diagnoseAccount(
      "wa-monza",
      io({
        accounts: async () => [WA],
        now: () => Date.parse("2026-10-27T09:00:00Z"),
        recentOutbound: async () => [{ at: "2026-10-23T13:41:01Z", status: "failed", error: LOCK, direction: "out" }],
        lastDelivery: async () => ({ ok: true, last: "2026-10-23T13:41:03Z", lastDay: 0 }),
        graph: waGraph({ apps: { data: [] } }),
      })
    );
    assert.ok(silent.ok);
    if (!silent.ok) return;
    assert.equal(named(silent.steps, "Our record of recent sends")?.status, "fail", "3.8 days: the lock failure is still the newest fact");
    assert.equal(named(silent.steps, "The last WhatsApp webhook received")?.status, "unknown");
    assert.match(named(silent.steps, "The last WhatsApp webhook received")?.detail ?? "", /91 hours ago/);
    assert.equal(named(silent.steps, "The app's subscription to the business account")?.status, "fail");
    assert.match(named(silent.steps, "The app's subscription to the business account")?.detail ?? "", /No app is subscribed .* never the Coexistence connect flow/);
    // The subscription read refused (the sending key holds only messaging): unknown, with Meta's words.
    const refusedApps = await diagnoseAccount(
      "wa-monza",
      io({
        accounts: async () => [WA],
        graph: async (path) => (path.endsWith("/subscribed_apps") ? { ok: false, problem: "Meta said: (#200) permission", retryLighter: false, meta: "code 200" } : waGraph()(path, {}, "", 0)),
      })
    );
    assert.ok(refusedApps.ok);
    if (!refusedApps.ok) return;
    assert.equal(named(refusedApps.steps, "The app's subscription to the business account")?.status, "unknown");
    assert.match(named(refusedApps.steps, "The app's subscription to the business account")?.detail ?? "", /whatsapp_business_messaging.*code 200/);
    // CONNECTED but no longer on the Business app: the one answer that calls for the connect flow.
    const offApp = await diagnoseAccount("wa-monza", io({ accounts: async () => [WA], graph: waGraph({ number: { status: "CONNECTED", is_on_biz_app: false } }) }));
    assert.ok(offApp.ok);
    if (!offApp.ok) return;
    assert.equal(named(offApp.steps, "The number as Meta sees it")?.status, "fail");
    assert.match(named(offApp.steps, "The number as Meta sees it")?.detail ?? "", /NO LONGER linked to the WhatsApp Business app/);
    const refused = await diagnoseAccount(
      "wa-monza",
      io({ accounts: async () => [WA], graph: async () => ({ ok: false, problem: "Meta said: (#10) permission", retryLighter: false, meta: "code 10" }) })
    );
    assert.ok(refused.ok);
    if (!refused.ok) return;
    assert.equal(named(refused.steps, "Meta's health status for the number")?.status, "unknown");
    assert.match(named(refused.steps, "Meta's health status for the number")?.detail ?? "", /code 10/);
  });
});

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
