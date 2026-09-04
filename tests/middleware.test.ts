/**
 * The sign-in gate.
 *
 * The gate is deliberately shallow — it checks that a cookie EXISTS, not that
 * it is valid, because verifying on every navigation would mean a round-trip to
 * the CRM each time. What it must get right is WHICH paths it covers, and that
 * is exactly what used to go wrong: /departments was added to the product and
 * left out of the matcher, so those screens were reachable without signing in.
 *
 * The protected list is now derived from lib/nav.ts, and this file checks that
 * every screen in the product is actually behind the gate.
 *
 * The rule under test is lib/gate's pure decideGate; middleware.ts is a thin
 * adapter over it, because next/server only resolves inside the bundler and a
 * security rule that cannot be tested is one nobody checks.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { decideGate, isProtectedPath } from "@/lib/gate";
import { NAV_ITEMS, PROTECTED_PATHS } from "@/lib/nav";

/** Ask the gate about one request. Returns where it sends you, or null. */
function gate(
  path: string,
  opts: { token?: string; crmConfigured?: boolean } = {}
): string | null {
  const [pathname, search] = path.split("?");
  const decision = decideGate({
    pathname,
    search: search ? `?${search}` : "",
    token: opts.token,
    crmConfigured: opts.crmConfigured ?? true,
  });
  return decision.action === "redirect" ? decision.to : null;
}

describe("demo mode: no CRM configured", () => {
  test("every screen is reachable without signing in", () => {
    for (const item of NAV_ITEMS) {
      assert.equal(gate(item.href, { crmConfigured: false }), null, item.href);
    }
  });

  test("a cookie is neither required nor consulted", () => {
    assert.equal(gate("/inbox", { crmConfigured: false }), null);
    assert.equal(
      gate("/inbox", { crmConfigured: false, token: "whatever" }),
      null
    );
  });
});

describe("live mode: a CRM is configured", () => {
  test("EVERY screen in the product is behind the gate", () => {
    // The regression this prevents: a page added to the product but missing
    // from the matcher, reachable by anyone.
    for (const item of NAV_ITEMS) {
      assert.equal(
        gate(item.href),
        `/login?next=${encodeURIComponent(item.href)}`,
        item.href
      );
    }
  });

  test("sub-paths of a screen are protected too", () => {
    assert.equal(
      gate("/customers/rami-kanaan"),
      `/login?next=${encodeURIComponent("/customers/rami-kanaan")}`
    );
  });

  test("a path that merely STARTS with a protected name is not caught", () => {
    // "/inboxes" is not "/inbox" — prefix matching must respect the boundary.
    assert.equal(gate("/inboxes"), null);
    assert.equal(isProtectedPath("/inboxes"), false);
    assert.equal(isProtectedPath("/inbox"), true);
    assert.equal(isProtectedPath("/inbox/anything"), true);
  });

  test("a deep link survives sign-in", () => {
    assert.equal(
      gate("/customers?open=rami-kanaan"),
      `/login?next=${encodeURIComponent("/customers?open=rami-kanaan")}`
    );
  });

  test("the carried destination is encoded, so it cannot inject a parameter", () => {
    const to = gate("/customers?open=x&role=owner");
    assert.ok(to);
    // Exactly one "?" and one "next=" — the payload rides as a single value.
    assert.equal(to.split("?").length, 2);
    assert.equal(to.split("next=").length, 2);
    assert.ok(!to.includes("&role="), to);
  });

  test("any cookie gets past the front door — by design", () => {
    // The gate does not verify; lib/auth (routes) and lib/auth-server (pages)
    // do. This asserts the documented division of labour, so nobody later
    // assumes the middleware is the real check.
    assert.equal(gate("/inbox", { token: "anything" }), null);
  });

  test("unknown paths are not gated, so 404s stay 404s", () => {
    assert.equal(gate("/nope"), null);
    assert.equal(gate("/"), null);
  });
});

describe("the protected list stays in step with the product", () => {
  test("it is derived from the navigation, not hand-maintained", () => {
    assert.deepEqual(
      [...PROTECTED_PATHS].sort(),
      NAV_ITEMS.map((i) => i.href).sort()
    );
  });

  test("every protected path is absolute and has no trailing slash", () => {
    for (const p of PROTECTED_PATHS) {
      assert.ok(p.startsWith("/"), p);
      assert.ok(p === "/" || !p.endsWith("/"), p);
    }
  });

  test("the navigation has no duplicate destinations", () => {
    const hrefs = NAV_ITEMS.map((i) => i.href);
    assert.equal(new Set(hrefs).size, hrefs.length);
  });

  test("every screen has a plain-words label and blurb", () => {
    for (const item of NAV_ITEMS) {
      assert.ok(item.label.length > 1, item.href);
      assert.ok(item.blurb.length > 15, item.href);
      assert.doesNotMatch(item.label, /_/, item.href);
    }
  });

  test("the inbox is the first screen in the product", () => {
    // Conversations are the centre of MONZA AI; the navigation says so.
    assert.equal(NAV_ITEMS[0].href, "/inbox");
  });
});
