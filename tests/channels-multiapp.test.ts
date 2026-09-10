/**
 * One secret per Meta app — and each secret speaks only for its own brand.
 *
 * Monza's three brands sit in three Meta business portfolios with three apps,
 * and each app signs webhook deliveries with its own secret. One configured
 * secret verifies exactly one brand; the other two get refused.
 *
 * The obvious fix, a list of secrets, would let anyone holding ANY brand's
 * secret forge messages for EVERY brand. So the property under test here is not
 * only "each app's signature verifies" but "a signature from app X can never
 * file a message under an account of app Y" — rule 4, applied to signatures.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  accountsForApp,
  parseMetaAppSecrets,
  verifyMetaSignatureForApps,
} from "@/lib/channels/meta-signature";
import { parseInstagram } from "@/lib/channels/instagram";
import type { ChannelAccount } from "@/lib/channels/types";

const VOYAH_APP = "912301501380919";
const MHERO_APP = "1793221688521200";
const VOYAH_SECRET = "voyah-app-secret";
const MHERO_SECRET = "mhero-app-secret";

const MAP = JSON.stringify({ [VOYAH_APP]: VOYAH_SECRET, [MHERO_APP]: MHERO_SECRET });

function sign(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

describe("reading the configuration", () => {
  test("a map of app id to secret", () => {
    assert.deepEqual(parseMetaAppSecrets(MAP, null), [
      { appId: VOYAH_APP, secret: VOYAH_SECRET },
      { appId: MHERO_APP, secret: MHERO_SECRET },
    ]);
  });

  test("the legacy single secret still works, unbound", () => {
    assert.deepEqual(parseMetaAppSecrets(null, "only-one"), [
      { appId: null, secret: "only-one" },
    ]);
  });

  test("the map wins, and the single secret is ignored beside it", () => {
    const s = parseMetaAppSecrets(MAP, "legacy");
    assert.equal(s.length, 2);
    assert.ok(
      s.every((x) => x.appId !== null),
      "an unbound secret beside bound ones would quietly undo the binding"
    );
  });

  test("a malformed map refuses everything instead of falling back", () => {
    // Falling back to the single secret would turn a dashboard typo into
    // "accept what the old setting accepts" with nobody noticing.
    assert.deepEqual(parseMetaAppSecrets("{not json", "legacy"), []);
    assert.deepEqual(parseMetaAppSecrets('["a","b"]', "legacy"), []);
    assert.deepEqual(parseMetaAppSecrets('"a string"', "legacy"), []);
    assert.deepEqual(parseMetaAppSecrets("null", "legacy"), []);
  });

  test("paste errors inside the map are skipped, never trusted", () => {
    const s = parseMetaAppSecrets(
      JSON.stringify({ "not-an-id": "x", [VOYAH_APP]: "   ", [MHERO_APP]: 42, "123": "ok" }),
      null
    );
    assert.deepEqual(s, [{ appId: "123", secret: "ok" }]);
  });

  test("nothing configured is nothing", () => {
    assert.deepEqual(parseMetaAppSecrets(null, null), []);
    assert.deepEqual(parseMetaAppSecrets("", ""), []);
  });
});

describe("verifying against several apps", () => {
  const body = '{"object":"instagram","entry":[]}';
  const secrets = parseMetaAppSecrets(MAP, null);

  test("each app's own signature passes, and names its app", () => {
    assert.deepEqual(verifyMetaSignatureForApps(body, sign(body, VOYAH_SECRET), secrets), {
      ok: true,
      appId: VOYAH_APP,
    });
    assert.deepEqual(verifyMetaSignatureForApps(body, sign(body, MHERO_SECRET), secrets), {
      ok: true,
      appId: MHERO_APP,
    });
  });

  test("a secret belonging to no configured app is refused", () => {
    assert.deepEqual(verifyMetaSignatureForApps(body, sign(body, "someone-else"), secrets), {
      ok: false,
      reason: "mismatch",
    });
  });

  test("no secrets configured refuses — unconfigured is not open", () => {
    assert.deepEqual(verifyMetaSignatureForApps(body, sign(body, VOYAH_SECRET), []), {
      ok: false,
      reason: "no_secret",
    });
  });

  test("a missing or malformed header is refused", () => {
    assert.deepEqual(verifyMetaSignatureForApps(body, null, secrets), {
      ok: false,
      reason: "no_header",
    });
    assert.deepEqual(verifyMetaSignatureForApps(body, "sha256=zz", secrets), {
      ok: false,
      reason: "malformed",
    });
  });

  test("a tampered body fails for every app", () => {
    assert.equal(
      verifyMetaSignatureForApps(body + " ", sign(body, VOYAH_SECRET), secrets).ok,
      false
    );
  });

  test("the legacy single secret verifies, unbound", () => {
    assert.deepEqual(
      verifyMetaSignatureForApps(body, sign(body, "legacy"), parseMetaAppSecrets(null, "legacy")),
      { ok: true, appId: null }
    );
  });
});

describe("a secret speaks only for its own brand", () => {
  type Account = ChannelAccount & { appId: string | null };

  const VOYAH_IG = "17841457996874250";
  const ACCOUNTS: Account[] = [
    {
      id: "ig-voyah",
      channel: "instagram",
      displayName: "@voyahlebanon",
      externalId: VOYAH_IG,
      portfolio: "VoyahLebanon",
      tokenEnv: "META_TOKEN_VOYAH",
      appId: VOYAH_APP,
    },
    {
      id: "ig-mhero",
      channel: "instagram",
      displayName: "@mherolebanon",
      externalId: "17841400000000001",
      portfolio: "M Hero Lebanon",
      tokenEnv: "META_TOKEN_MHERO",
      appId: MHERO_APP,
    },
    {
      id: "ig-orphan",
      channel: "instagram",
      displayName: "@unassigned",
      externalId: "17841400000000002",
      portfolio: "unknown",
      tokenEnv: "META_TOKEN_NONE",
      appId: null,
    },
  ];

  /** A real-shaped Instagram delivery addressed to VOYAH's account. */
  const toVoyah = JSON.stringify({
    object: "instagram",
    entry: [
      {
        id: VOYAH_IG,
        time: 1_757_000_000_000,
        messaging: [
          {
            sender: { id: "someone" },
            recipient: { id: VOYAH_IG },
            timestamp: 1_757_000_000_000,
            message: { mid: "m.1", text: "is the Free available?" },
          },
        ],
      },
    ],
  });

  test("a bound secret sees only its own app's accounts", () => {
    assert.deepEqual(accountsForApp(ACCOUNTS, VOYAH_APP).map((a) => a.id), ["ig-voyah"]);
    assert.deepEqual(accountsForApp(ACCOUNTS, MHERO_APP).map((a) => a.id), ["ig-mhero"]);
  });

  test("an account with no app recorded is excluded, not guessed", () => {
    for (const app of [VOYAH_APP, MHERO_APP]) {
      assert.ok(!accountsForApp(ACCOUNTS, app).some((a) => a.id === "ig-orphan"));
    }
  });

  test("the legacy unbound secret sees every account, as before", () => {
    assert.equal(accountsForApp(ACCOUNTS, null).length, ACCOUNTS.length);
  });

  test("MHERO's secret cannot file a message under VOYAH", () => {
    // The attack: someone holding MHERO's app secret signs a delivery that
    // names VOYAH's Instagram account. The signature itself is genuine.
    const check = verifyMetaSignatureForApps(
      toVoyah,
      sign(toVoyah, MHERO_SECRET),
      parseMetaAppSecrets(MAP, null)
    );
    assert.equal(check.ok, true, "the signature is real — it is MHERO's");
    if (!check.ok) return;

    const events = parseInstagram(JSON.parse(toVoyah), accountsForApp(ACCOUNTS, check.appId));
    assert.equal(events.length, 1, "the message is still read, so it can be logged");
    assert.equal(events[0].accountId, null, "but it must arrive unmatched, never as VOYAH");
  });

  test("the same delivery signed by VOYAH's own app is filed under VOYAH", () => {
    const check = verifyMetaSignatureForApps(
      toVoyah,
      sign(toVoyah, VOYAH_SECRET),
      parseMetaAppSecrets(MAP, null)
    );
    if (!check.ok) return assert.fail("VOYAH's own signature must pass");

    const events = parseInstagram(JSON.parse(toVoyah), accountsForApp(ACCOUNTS, check.appId));
    assert.equal(events[0].accountId, "ig-voyah");
  });
});
