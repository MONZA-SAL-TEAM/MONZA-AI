/**
 * The Decision Center, counted, for the Monza S.A.L. app's 08:00 morning brief (owner, 24 Nov 2026).
 * Counts and labels only; only items still waiting on a person; its own secret.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { summariseDecisions } from "@/lib/brief/decisions-summary";
import { apiRuleOf } from "@/lib/access/access";

const row = (rule: string, state: string, severity = "normal", first = "2026-11-20T08:00:00Z", last = "2026-11-24T05:00:00Z") =>
  ({ rule, state, severity, first_seen: first, last_seen: last });

describe("morning brief: Decision Center summary", () => {
  test("counts open and escalated items per rule; acknowledged and closed ones do not count", () => {
    const s = summariseDecisions([
      row("buyer_waiting", "open", "critical", "2026-11-22T08:00:00Z"),
      row("buyer_waiting", "escalated", "high", "2026-11-21T08:00:00Z", "2026-11-24T06:00:00Z"),
      row("buyer_waiting", "acknowledged", "critical"),
      row("colour_unavailable", "open"),
      row("test_drive_unbooked", "resolved"),
      row("test_drive_unbooked", "dismissed"),
      row("not_a_rule", "open"),
    ]);
    assert.deepEqual(s.items.map((i) => [i.rule, i.count, i.severity]), [["buyer_waiting", 2, "critical"], ["colour_unavailable", 1, "normal"]]);
    assert.equal(s.items[0].oldestFirstSeen, "2026-11-21T08:00:00Z");
    assert.equal(s.asOf, "2026-11-24T06:00:00Z");
    assert.match(s.items[0].label, /buyer/i);
  });

  test("nothing waiting → no items and no date (never invented)", () => {
    assert.deepEqual(summariseDecisions([row("buyer_waiting", "resolved")]), { asOf: null, items: [] });
  });

  test("the summary carries no subject, person or name — by construction", () => {
    const s = summariseDecisions([{ ...row("buyer_waiting", "open"), subject: "chat:1", person_key: "lead:2", assigned_name: "Rami" } as never]);
    assert.doesNotMatch(JSON.stringify(s), /chat:1|lead:2|Rami/);
  });

  test("the route checks its OWN secret (BRIEF_FEED_SECRET, never CRON_SECRET) and is not a staff route", () => {
    const src = readFileSync(join(process.cwd(), "app/api/brief/decisions/route.ts"), "utf8");
    assert.match(src, /isCronAuthorized\(request\.headers\.get\("authorization"\), briefFeedSecret\(\)\)/);
    assert.doesNotMatch(src, /cronSecret\(\)/);
    const select = /\.select\("([^"]+)"\)/.exec(src)?.[1] ?? "";
    assert.equal(select, "rule, severity, state, first_seen, last_seen");
    assert.equal(apiRuleOf("/api/brief/decisions", "GET"), null);
  });
});
