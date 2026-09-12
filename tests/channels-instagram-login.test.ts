/**
 * The Instagram-login experiment ("Path 1", 2026-09-12): an opt-in, read-only
 * check of whether Meta lists an account's customer conversations through the
 * OTHER Instagram API at standard access. What must hold:
 *
 *   - it runs only with its own, separately named key, and says so when absent;
 *   - a key for the wrong Instagram account is caught before any read;
 *   - an empty list is never a pass (rule 21);
 *   - no key appears in any output.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { diagnoseInstagramLogin, type DiagnoseIO, type DiagnoseStep } from "@/lib/channels/live";
import {
  instagramLoginTokenEnv,
  readInstagramLoginSelf,
  summariseInstagramLoginAccount,
} from "@/lib/channels/live-map";
import { sendInstagramLogin } from "@/lib/channels/instagram";

describe("readInstagramLoginSelf — the key must be this brand's account (rule 4)", () => {
  const REG = "17841457996874250";

  test("the right account: registry, user_id and the app-scoped id all count as us", () => {
    const r = readInstagramLoginSelf({ id: "9001", user_id: REG, username: "voyahlebanon" }, REG);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.selfIds.sort(), [REG, "9001"].sort());
  });

  test("another brand's account is refused, naming both ids", () => {
    const r = readInstagramLoginSelf({ id: "1", user_id: "17841469421956644" }, REG);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.problem, /17841469421956644/);
    assert.match(r.problem, new RegExp(REG));
  });

  test("no user_id is refused, never guessed", () => {
    assert.equal(readInstagramLoginSelf({ id: "1" }, REG).ok, false);
  });
});

describe("sendInstagramLogin", () => {
  test("posts to graph.instagram.com with the Instagram-login key, never graph.facebook.com", async () => {
    const real = globalThis.fetch;
    const seen: { url?: string; auth?: string | null; body?: string } = {};
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      seen.url = String(input);
      seen.auth = new Headers(init?.headers).get("authorization");
      seen.body = String(init?.body);
      return new Response(JSON.stringify({ message_id: "m1" }), { status: 200 });
    }) as typeof fetch;
    try {
      const r = await sendInstagramLogin({ accountId: "ig-voyah", toExternalId: "123", text: "hi" }, "ig-login-key");
      assert.equal(r.ok, true);
      assert.match(seen.url ?? "", /^https:\/\/graph\.instagram\.com\/v21\.0\/me\/messages$/);
      assert.equal(seen.auth, "Bearer ig-login-key");
      assert.deepEqual(JSON.parse(seen.body ?? "{}"), { recipient: { id: "123" }, message: { text: "hi" } });
    } finally {
      globalThis.fetch = real;
    }
  });
});
import type { StoredAccount } from "@/lib/channels/store";

const VOYAH_IG = "17841457996874250";
const IG_TOKEN = "instagram-login-key-never-printed";

const account = (over: Partial<StoredAccount> = {}): StoredAccount => ({
  id: "ig-voyah",
  brand: "voyah",
  channel: "instagram",
  displayName: "@voyahlebanon",
  externalId: VOYAH_IG,
  portfolio: "VoyahLebanon",
  tokenEnv: "META_TOKEN_VOYAH",
  connectedAt: null,
  appId: "912301501380919",
  ...over,
});

function io(over: Partial<DiagnoseIO> = {}): DiagnoseIO {
  return {
    accounts: async () => [account(), account({ id: "fb-voyah", channel: "facebook", externalId: "408893845643871" })],
    deliveries: async () => ({ ok: true as const, rows: [], limit: 500 }),
    graph: async () => ({ ok: true as const, json: {} }),
    tokenFor: (name) => (name === "META_IG_LOGIN_TOKEN_VOYAH" ? IG_TOKEN : null),
    secretFor: () => null,
    now: () => 1_000,
    budgetMs: 45_000,
    ...over,
  };
}

const named = (steps: DiagnoseStep[], name: string) => steps.find((s) => s.step === name);

describe("instagramLoginTokenEnv", () => {
  test("names a brand's separate Instagram-login key", () => {
    assert.equal(instagramLoginTokenEnv("voyah"), "META_IG_LOGIN_TOKEN_VOYAH");
    assert.equal(instagramLoginTokenEnv("monza"), "META_IG_LOGIN_TOKEN_MONZA");
  });

  test("anything but a plain brand word names no variable", () => {
    assert.equal(instagramLoginTokenEnv("voyah; META_APP_SECRETS"), null);
    assert.equal(instagramLoginTokenEnv(""), null);
    assert.equal(instagramLoginTokenEnv("VOYAH"), null);
  });
});

describe("summariseInstagramLoginAccount", () => {
  test("a key for the account on record passes", () => {
    const s = summariseInstagramLoginAccount({ user_id: VOYAH_IG, username: "voyahlebanon" }, VOYAH_IG);
    assert.equal(s.status, "pass");
    assert.match(s.detail, /@voyahlebanon/);
  });

  test("user_id is compared as text whether Meta sends a string or a number", () => {
    assert.equal(summariseInstagramLoginAccount({ user_id: "17841457996874250" }, "17841457996874250").status, "pass");
    // Even, and below 2^54, so exactly representable as a double.
    assert.equal(summariseInstagramLoginAccount({ user_id: 17841457996874250 }, "17841457996874250").status, "pass");
  });

  test("a key for another account fails and names both", () => {
    const s = summariseInstagramLoginAccount({ user_id: "999", username: "someoneelse" }, VOYAH_IG);
    assert.equal(s.status, "fail");
    assert.match(s.detail, /999/);
    assert.match(s.detail, new RegExp(VOYAH_IG));
  });

  test("no user_id is unknown, not a failure", () => {
    assert.equal(summariseInstagramLoginAccount({}, VOYAH_IG).status, "unknown");
  });
});

describe("diagnoseInstagramLogin", () => {
  test("without its own key it asks nothing and says why", async () => {
    let called = false;
    const r = await diagnoseInstagramLogin(
      "ig-voyah",
      io({ tokenFor: () => null, igGraph: async () => ((called = true), { ok: true, json: {} }) })
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(called, false);
    assert.equal(r.steps.length, 1);
    assert.equal(r.steps[0].status, "skipped");
    assert.match(r.steps[0].detail, /META_IG_LOGIN_TOKEN_VOYAH/);
  });

  test("never uses the working system-user key", async () => {
    const asked: string[] = [];
    await diagnoseInstagramLogin(
      "ig-voyah",
      io({
        tokenFor: (name) => {
          asked.push(name);
          return name === "META_IG_LOGIN_TOKEN_VOYAH" ? IG_TOKEN : "system-user-key";
        },
        igGraph: async (_p, _q, token) => {
          assert.equal(token, IG_TOKEN);
          return { ok: true, json: { data: [{ id: "c1" }] } };
        },
      })
    );
    assert.deepEqual(asked, ["META_IG_LOGIN_TOKEN_VOYAH"]);
  });

  test("customer conversations listed: both checks pass", async () => {
    const r = await diagnoseInstagramLogin(
      "ig-voyah",
      io({
        igGraph: async (path) =>
          path === "me"
            ? { ok: true, json: { user_id: VOYAH_IG, username: "voyahlebanon" } }
            : { ok: true, json: { data: [{ id: "a" }, { id: "b" }], paging: { next: "x", cursors: { after: "abc" } } } },
      })
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(named(r.steps, "Which Instagram account this key is for")?.status, "pass");
    const conv = named(r.steps, "Instagram-login conversations: 5 rows, id only");
    assert.equal(conv?.status, "pass");
    assert.match(conv?.detail ?? "", /2 row\(s\), more available/);
  });

  test("an empty list is unknown, never a pass", async () => {
    const r = await diagnoseInstagramLogin(
      "ig-voyah",
      io({ igGraph: async (path) => (path === "me" ? { ok: true, json: { user_id: VOYAH_IG } } : { ok: true, json: { data: [] } }) })
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(named(r.steps, "Instagram-login conversations: 5 rows, id only")?.status, "unknown");
  });

  test("Meta's refusal is carried through, and no key appears anywhere", async () => {
    const r = await diagnoseInstagramLogin(
      "ig-voyah",
      io({
        igGraph: async (path) =>
          path === "me"
            ? { ok: true, json: { user_id: VOYAH_IG } }
            : { ok: false, problem: "Meta said: Timeout", retryLighter: true, meta: "code -2, subcode 2534084" },
      })
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const conv = named(r.steps, "Instagram-login conversations: 5 rows, id only");
    assert.equal(conv?.status, "unknown");
    assert.match(conv?.detail ?? "", /2534084/);
    assert.ok(!JSON.stringify(r).includes(IG_TOKEN));
  });

  test("a Facebook account is refused", async () => {
    const r = await diagnoseInstagramLogin("fb-voyah", io());
    assert.equal(r.ok, false);
  });
});
