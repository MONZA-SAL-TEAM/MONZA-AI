/**
 * Team & access (lib/access/access.ts, migration 029): MONZA AI's own pages-and-actions layer. No setting =
 * as before; admin = everything; blocked = nothing; every API route has a rule; every real page checks.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { allowsPage, allowsRule, apiRuleOf, effectiveAccess, ownershipCapabilities, pageKeyOf, presenceOf, PRESETS, UNRESTRICTED } from "@/lib/access/access";
import { canSeeInsights } from "@/lib/insights/access";
import type { StaffIdentity } from "@/lib/connectors/types";

const row = (p: Partial<Parameters<typeof effectiveAccess>[0] & object> = {}) => ({ userId: "u", isAdmin: false, blocked: false, preset: "custom", pages: [], actions: [], ...p });
const sales = effectiveAccess(row({ preset: "sales", pages: PRESETS.sales.pages, actions: PRESETS.sales.actions }));

describe("who may open what", () => {
  test("no setting is MONZA AI as before; admin is everything, including this section", () => {
    assert.equal(allowsPage(UNRESTRICTED, "settings"), true);
    assert.equal(allowsPage(UNRESTRICTED, "admin"), false, "the admin section is never open by default");
    const admin = effectiveAccess(row({ isAdmin: true }));
    assert.equal(allowsPage(admin, "admin"), true);
    assert.equal(allowsRule(admin, { page: "inbox", action: "send_messages" }), true);
  });
  test("a salesperson: their pages and actions, nothing else", () => {
    assert.equal(allowsPage(sales, "inbox"), true);
    assert.equal(allowsPage(sales, "insights"), false);
    assert.equal(allowsPage(sales, "settings"), false);
    assert.equal(allowsRule(sales, apiRuleOf("/api/channels/send", "POST")!), true);
    assert.equal(allowsRule(sales, apiRuleOf("/api/conversations/owner", "POST")!), true);
    assert.equal(allowsRule(sales, apiRuleOf("/api/insights/review", "POST")!), false);
    assert.deepEqual(ownershipCapabilities(sales), ["sales"], "takes leads, does not assign others'");
  });
  test("view only reads the inbox but cannot send, take or close", () => {
    const viewer = effectiveAccess(row({ pages: PRESETS.viewer.pages, actions: [] }));
    assert.equal(allowsRule(viewer, apiRuleOf("/api/channels/thread", "GET")!), true);
    for (const [path, method] of [["/api/channels/send", "POST"], ["/api/sales/suggestion/send", "POST"], ["/api/sales/alerts", "POST"], ["/api/conversations/owner", "POST"]]) {
      assert.equal(allowsRule(viewer, apiRuleOf(path, method)!), false, path);
    }
  });
  test("blocked: nothing at all, not even their own settings", () => {
    const b = effectiveAccess(row({ blocked: true, pages: ["inbox"], actions: ["send_messages"] }));
    assert.equal(allowsPage(b, "inbox"), false);
    assert.equal(allowsRule(b, apiRuleOf("/api/me/activity", "POST")!), false);
  });
  test("Insights follows the setting when there is one, the CRM role when there is none", () => {
    const base: StaffIdentity = { userId: "u", email: null, crmAccessToken: "t", appRole: "assistant", capabilities: [] };
    assert.equal(canSeeInsights(base, true), false);
    assert.equal(canSeeInsights({ ...base, access: effectiveAccess(row({ pages: ["insights"] })) }, true), true);
    assert.equal(canSeeInsights({ ...base, appRole: "owner", access: sales }, true), false, "an owner in the CRM can still be limited here");
  });
  test("addresses map to pages", () => {
    assert.equal(pageKeyOf("/test-drives"), "test_drives");
    assert.equal(pageKeyOf("/insights/clients/lead:1"), "insights");
    assert.equal(pageKeyOf("/admin/123"), "admin");
    assert.equal(pageKeyOf("/no-access"), null);
  });
  test("online: seen in 2½ minutes; active when also used", () => {
    const now = Date.parse("2026-10-13T12:00:00Z");
    assert.equal(presenceOf("2026-10-13T11:59:00Z", "2026-10-13T11:59:00Z", now), "active");
    assert.equal(presenceOf("2026-10-13T11:59:00Z", "2026-10-13T11:40:00Z", now), "open");
    assert.equal(presenceOf("2026-10-13T11:50:00Z", null, now), "offline");
  });
});

describe("nothing slips by", () => {
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f === "route.ts") routes.push(p);
    }
  };
  walk(join(process.cwd(), "app", "api"));
  test("every API route has a rule: a page, an action for what changes something, or none for webhooks and cron", () => {
    const OPEN = ["/api/me", "/api/push", "/api/status"];
    for (const file of routes) {
      const path = `/${file.slice(file.indexOf("app") + 4).replace(/\\/g, "/").replace(/\/route\.ts$/, "")}`.replace(/\[[^\]]+\]/g, "x");
      const src = readFileSync(file, "utf8");
      const rule = apiRuleOf(path, "POST");
      if (rule === null) {
        assert.match(src, /isCronAuthorized|verifySignature|X-Hub-Signature|x-hub-signature|META_APP_SECRET|appSecret/i, `${path} has no staff rule and must check its own secret`);
        continue;
      }
      if (rule.page === "any") assert.ok(OPEN.some((o) => path.startsWith(o)), `${path} has no page in lib/access apiRuleOf`);
      if (/export async function (POST|PUT|PATCH|DELETE)/.test(src) && !OPEN.some((o) => path.startsWith(o)) && !path.startsWith("/api/admin") && !path.startsWith("/api/chat") && rule.page !== "integrations") {
        assert.ok(rule.action || /requireStaff|requireRealStaff/.test(src), `${path} changes something`);
      }
    }
  });
  test("every page with real data checks access on the server", () => {
    for (const page of ["inbox", "customers", "automations", "installments", "test-drives", "sales", "chat", "dashboard", "integrations", "settings"]) {
      assert.match(readFileSync(join(process.cwd(), "app", page, "page.tsx"), "utf8"), /requireStaffForPage/, page);
    }
    for (const p of ["app/admin/page.tsx", "app/admin/[id]/page.tsx"]) assert.match(readFileSync(join(process.cwd(), p), "utf8"), /requireAdminForPage/, p);
    assert.match(readFileSync(join(process.cwd(), "app/api/admin/access/route.ts"), "utf8"), /access\.user\.access\?\.admin/);
  });
  test("stored: no customer, no page address; closed vocabularies; service role only", () => {
    const sql = readFileSync(join(process.cwd(), "database/migrations/029_staff_access.sql"), "utf8");
    const events = sql.slice(sql.indexOf("create table if not exists public.staff_events"), sql.indexOf("create index if not exists staff_events_staff"));
    assert.doesNotMatch(events, /conversation|customer|phone|url|path/i);
    assert.match(events, /detail \~ '\^\[a-z0-9_\]\{1,40\}\$'/);
    assert.equal((sql.match(/enable row level security/g) ?? []).length, 4);
    assert.doesNotMatch(sql, /create policy/i);
  });
});
