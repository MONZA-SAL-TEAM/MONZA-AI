/**
 * Authentication and authorization — the boundary that was breached.
 *
 * The confirmed vulnerability: requireStaff() returns the fixed DEMO_IDENTITY
 * to ANY caller when no CRM is configured, which is the live production state.
 * That is correct for surfaces made of invented data and catastrophic for a
 * route that mutates real infrastructure, because "anonymous" and "demo staff"
 * become the same caller.
 *
 * Environment-dependent behaviour is exercised in a CHILD PROCESS with a
 * controlled environment, because lib/env-public.ts reads process.env at module
 * load — the same reason Next can inline those values into a bundle. Testing it
 * any other way would test a mock instead of the real module.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";

import {
  DEMO_IDENTITY,
  hasAnyCapability,
  isDemoIdentity,
} from "@/lib/auth";
import { MEDIA_CAPABILITIES, mediaWriteRefusal } from "@/lib/permissions/media";
import type { StaffIdentity } from "@/lib/connectors/types";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * Run an ES-module snippet in a child node process with a controlled env, and
 * return whatever it prints as JSON. The alias hook is loaded so the snippet
 * can import "@/lib/...". CRM env vars are cleared unless the case sets them.
 */
function runWithEnv(env: Record<string, string>, source: string): unknown {
  const out = execFileSync(
    process.execPath,
    [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "--import",
      "./tests/_alias.mjs",
      "--input-type=module",
      "-e",
      source,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        NEXT_PUBLIC_CRM_SUPABASE_URL: "",
        NEXT_PUBLIC_CRM_SUPABASE_ANON_KEY: "",
        ...env,
      },
    }
  );
  return JSON.parse(out.trim().split("\n").pop() as string);
}

function staff(over: Partial<StaffIdentity> = {}): StaffIdentity {
  return {
    userId: "11111111-1111-1111-1111-111111111111",
    email: "lara@monzasal.com",
    crmAccessToken: "a-real-token",
    appRole: "employee",
    capabilities: ["sales"],
    ...over,
  };
}

describe("the demo identity is recognisable and inert", () => {
  test("isDemoIdentity is true only for the exact demo identity", () => {
    assert.equal(isDemoIdentity(DEMO_IDENTITY), true);
    assert.equal(isDemoIdentity(staff()), false);
  });

  test("a forged identity that borrows the demo id is still not the demo", () => {
    // Both halves must match, so a real user id paired with the demo token (or
    // the reverse) cannot slip through either branch of a check.
    assert.equal(isDemoIdentity(staff({ userId: "demo" })), false);
    assert.equal(isDemoIdentity(staff({ crmAccessToken: "demo" })), false);
  });

  test("the demo identity carries no CRM capabilities", () => {
    // It is an owner for the assistant's layer-1 checks so the demo can show
    // every screen — and holds no capability, so any capability-gated real
    // resource refuses it even if the demo check were somehow bypassed.
    assert.deepEqual(DEMO_IDENTITY.capabilities, []);
  });
});

describe("hasAnyCapability", () => {
  test("owners pass everything", () => {
    assert.equal(
      hasAnyCapability(staff({ appRole: "owner", capabilities: [] }), [
        "sales",
      ]),
      true
    );
  });

  test("a matching capability passes", () => {
    assert.equal(hasAnyCapability(staff(), ["sales", "manage_team"]), true);
  });

  test("a non-matching capability is refused", () => {
    assert.equal(
      hasAnyCapability(staff({ capabilities: ["marketing"] }), [
        "sales",
        "manage_team",
      ]),
      false
    );
  });

  test("no requirement means any proven staff member", () => {
    assert.equal(hasAnyCapability(staff({ capabilities: [] })), true);
    assert.equal(hasAnyCapability(staff({ capabilities: [] }), []), true);
  });

  test("a capability the user does not hold cannot be spoofed by role text", () => {
    assert.equal(
      hasAnyCapability(
        staff({ appRole: "Owner", capabilities: [] }),
        ["sales"]
      ),
      false,
      "role comparison is exact — 'Owner' is not 'owner'"
    );
  });
});

describe("media write policy", () => {
  test("demo mode is refused with an explanation, not a sign-in prompt", () => {
    const r = mediaWriteRefusal({ ok: false, reason: "demo_mode" });
    assert.equal(r.code, "demoMode");
    assert.equal(r.status, 403);
    assert.match(r.message, /demo mode/);
  });

  test("an anonymous caller is asked to sign in", () => {
    const r = mediaWriteRefusal({ ok: false, reason: "unauthenticated" });
    assert.equal(r.code, "signInRequired");
    assert.equal(r.status, 401);
  });

  test("a signed-in staff member without the capability is forbidden", () => {
    const r = mediaWriteRefusal({ ok: false, reason: "forbidden" });
    assert.equal(r.code, "forbidden");
    assert.equal(r.status, 403);
  });

  test("no refusal message leaks anything about server configuration", () => {
    for (const reason of ["demo_mode", "unauthenticated", "forbidden"] as const) {
      const { message } = mediaWriteRefusal({ ok: false, reason });
      for (const leak of [
        "SUPABASE",
        "service_role",
        "ANTHROPIC",
        "key length",
        "undefined",
      ]) {
        assert.doesNotMatch(
          message,
          new RegExp(leak, "i"),
          `refusal for ${reason} must not mention ${leak}`
        );
      }
    }
  });

  test("media writes require a sales-side capability", () => {
    assert.deepEqual([...MEDIA_CAPABILITIES], ["sales", "manage_team"]);
  });
});

describe("requireStaff / requireRealStaff against a real environment", () => {
  test("DEMO MODE: requireStaff hands an anonymous caller the demo identity", () => {
    const result = runWithEnv(
      {},
      `
      const { requireStaff, isDemoIdentity } = await import("@/lib/auth");
      const user = await requireStaff(new Request("https://x.test/"));
      console.log(JSON.stringify({
        gotUser: user !== null,
        isDemo: user ? isDemoIdentity(user) : false,
      }));
      `
    );
    assert.deepEqual(result, { gotUser: true, isDemo: true });
  });

  test("DEMO MODE: requireRealStaff refuses that same caller", () => {
    // This is the fix. The route used the check above; it now uses this one.
    const result = runWithEnv(
      {},
      `
      const { requireRealStaff } = await import("@/lib/auth");
      const a = await requireRealStaff(new Request("https://x.test/"));
      console.log(JSON.stringify(a));
      `
    );
    assert.deepEqual(result, { ok: false, reason: "demo_mode" });
  });

  test("DEMO MODE: a bearer token does not conjure a real identity", () => {
    const result = runWithEnv(
      {},
      `
      const { requireRealStaff } = await import("@/lib/auth");
      const a = await requireRealStaff(new Request("https://x.test/", {
        headers: { authorization: "Bearer pretend-to-be-staff" },
      }));
      console.log(JSON.stringify(a));
      `
    );
    assert.deepEqual(result, { ok: false, reason: "demo_mode" });
  });

  test("LIVE MODE: no token means no identity at all", () => {
    const result = runWithEnv(
      {
        NEXT_PUBLIC_CRM_SUPABASE_URL: "https://crm.example.supabase.co",
        NEXT_PUBLIC_CRM_SUPABASE_ANON_KEY: "anon-key",
      },
      `
      const { requireStaff, requireRealStaff } = await import("@/lib/auth");
      const user = await requireStaff(new Request("https://x.test/"));
      const access = await requireRealStaff(new Request("https://x.test/"));
      console.log(JSON.stringify({ user, access }));
      `
    );
    assert.deepEqual(result, {
      user: null,
      access: { ok: false, reason: "unauthenticated" },
    });
  });

  test("EMPTY DASHBOARD ROWS read as absent, not as a configured CRM", () => {
    // The production bug in one assertion: rows created without a value arrive
    // as "" and used to satisfy a truthiness check on the CRM pair.
    const result = runWithEnv(
      {
        NEXT_PUBLIC_CRM_SUPABASE_URL: "   ",
        NEXT_PUBLIC_CRM_SUPABASE_ANON_KEY: "",
      },
      `
      const { crmConfigured } = await import("@/lib/env-public");
      console.log(JSON.stringify({ crmConfigured: crmConfigured() }));
      `
    );
    assert.deepEqual(result, { crmConfigured: false });
  });

  test("a whitespace-padded secret still counts as present", () => {
    const result = runWithEnv(
      { AI_SUPABASE_SERVICE_ROLE_KEY: "  a-real-looking-key  " },
      `
      const { aiDbConfigured, aiServiceRoleKey } = await import("@/lib/env");
      console.log(JSON.stringify({
        configured: aiDbConfigured(),
        trimmed: aiServiceRoleKey() === "a-real-looking-key",
      }));
      `
    );
    assert.deepEqual(result, { configured: true, trimmed: true });
  });

  test("an empty secret row counts as absent", () => {
    const result = runWithEnv(
      { AI_SUPABASE_SERVICE_ROLE_KEY: "" },
      `
      const { aiDbConfigured } = await import("@/lib/env");
      console.log(JSON.stringify({ configured: aiDbConfigured() }));
      `
    );
    assert.deepEqual(result, { configured: false });
  });

  test("THE GO-LIVE BUG: the AI database is configured by its key alone", () => {
    // The old check also required NEXT_PUBLIC_AI_SUPABASE_URL to be set in the
    // environment. Production had a working service key and no URL row, so it
    // reported its own database as unconfigured — which would have made every
    // live chat answer the "no audit trail" refusal.
    const result = runWithEnv(
      {
        AI_SUPABASE_SERVICE_ROLE_KEY: "a-real-looking-key",
        NEXT_PUBLIC_AI_SUPABASE_URL: "",
      },
      `
      const { aiDbConfigured, aiUrl } = await import("@/lib/env");
      const { aiPublicSource } = await import("@/lib/env-public");
      console.log(JSON.stringify({
        configured: aiDbConfigured(),
        hasUrl: aiUrl().startsWith("https://"),
        source: aiPublicSource(),
      }));
      `
    );
    assert.deepEqual(result, {
      configured: true,
      hasUrl: true,
      source: "committed_default",
    });
  });
});
