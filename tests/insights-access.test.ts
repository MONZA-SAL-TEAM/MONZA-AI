/**
 * Who may open Insights (Samer, 2026-10-12): the owner and managers only. And the pilot test phones are
 * never counted as clients.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DEMO_IDENTITY } from "@/lib/auth";
import { canSeeInsights, INSIGHTS_CAPS } from "@/lib/insights/access";
import type { StaffIdentity } from "@/lib/connectors/types";

const staff = (appRole: string, capabilities: string[]): StaffIdentity => ({ userId: "u1", email: "a@monza.example", crmAccessToken: "t", appRole, capabilities });

describe("who may open Insights", () => {
  test("the owner, manage_team and view_reports may; a salesperson and nobody may not", () => {
    assert.equal(canSeeInsights(staff("owner", []), true), true);
    assert.equal(canSeeInsights(staff("staff", ["manage_team"]), true), true);
    assert.equal(canSeeInsights(staff("staff", ["view_reports"]), true), true);
    assert.equal(canSeeInsights(staff("staff", ["sales"]), true), false);
    assert.equal(canSeeInsights(staff("staff", []), true), false);
    assert.equal(canSeeInsights(null, true), false);
    assert.deepEqual([...INSIGHTS_CAPS], ["manage_team", "view_reports"]);
  });

  test("the demo identity never sees real data: refused whenever the database is reachable", () => {
    assert.equal(canSeeInsights(DEMO_IDENTITY, true), false);
    assert.equal(canSeeInsights(DEMO_IDENTITY, false), true);
  });

  test("every page under /insights checks the role, and every insights route requires it", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    const pages = walk(join(process.cwd(), "app/insights")).filter((p) => p.endsWith("page.tsx"));
    assert.ok(pages.length >= 1);
    for (const p of pages) assert.match(readFileSync(p, "utf8"), /requireInsightsAccess\(/, p);
    const routes = walk(join(process.cwd(), "app/api/insights")).filter((p) => p.endsWith("route.ts"));
    assert.ok(routes.length >= 1);
    for (const p of routes) {
      const src = readFileSync(p, "utf8");
      assert.ok(/requireRealStaff\(request, INSIGHTS_CAPS\)/.test(src) || /isCronAuthorized\(/.test(src), `${p} is not gated`);
    }
  });

  test("the side rail hides Insights unless allowed", () => {
    assert.match(readFileSync(join(process.cwd(), "lib/nav.ts"), "utf8"), /href: "\/insights",[\s\S]{0,120}requires: "insights"/);
    assert.match(readFileSync(join(process.cwd(), "components/SideNav.tsx"), "utf8"), /!item\.requires \|\| allowed\[item\.requires\]/);
  });

  test("the pilot test phones are left out of the signals", () => {
    const src = readFileSync(join(process.cwd(), "lib/wasales/signal-server.ts"), "utf8");
    assert.match(src, /if \(isTestChat\(meta\)\) return false;/);
    assert.match(src, /testConversations\.has\(r\.conversation_id\)/);
    assert.match(readFileSync(join(process.cwd(), "lib/channels/store.ts"), "utf8"), /peerExternalId: event\.fromExternalId,/);
  });
});
