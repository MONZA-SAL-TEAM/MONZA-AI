/**
 * Employees (lib/insights/activity.ts, migration 028): time actively using the app, by section, never a page
 * address or a customer; tasks from the records, matched by staff id or name; two tabs never count double.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { employeesReport, isActive, minutesByDay, sectionOf, type ActivityDay } from "@/lib/insights/activity";

describe("what a minute is", () => {
  test("only the section is kept; public pages are never counted", () => {
    assert.equal(sectionOf("/inbox"), "inbox");
    assert.equal(sectionOf("/insights/clients/lead:123"), "insights");
    assert.equal(sectionOf("/test-drives"), "test_drives");
    assert.equal(sectionOf("/something-new"), "other");
    assert.equal(sectionOf("/care"), null);
    assert.equal(sectionOf("/login"), null);
    assert.equal(sectionOf("/install"), null);
  });
  test("visible AND used in the last two minutes", () => {
    const now = 1_000_000;
    assert.equal(isActive(true, now - 60_000, now), true);
    assert.equal(isActive(true, now - 180_000, now), false, "left open, not used");
    assert.equal(isActive(false, now, now), false, "another tab or app in front");
  });
  test("the database credits at most the wall-clock time since the last minute, and 90 s at most", () => {
    const sql = readFileSync(join(process.cwd(), "database/migrations/028_decisions_activity.sql"), "utf8");
    assert.match(sql, /least\(v_credit, greatest\(0, floor\(extract\(epoch from \(now\(\) - v_prev\)\)\)\)::integer\)/);
    assert.match(sql, /least\(greatest\(coalesce\(p_seconds, 0\), 0\), 90\)/);
    assert.match(sql, /revoke all on function public\.staff_activity_ping/);
    const table = sql.slice(sql.indexOf("create table if not exists public.staff_activity_days"), sql.indexOf("create index if not exists staff_activity_days_day"));
    assert.doesNotMatch(table, /path|url|customer|conversation|phone/i);
  });
});

describe("the report", () => {
  const day = (staff: string, d: string, secs: number, first = `${d}T05:30:00Z`, last = `${d}T14:00:00Z`, sections: Record<string, number> = { inbox: secs }): ActivityDay => ({
    staff_id: staff, day: d, staff_name: staff === "s1" ? "Lara" : "Kareem", active_seconds: secs, sections, first_at: first, last_at: last,
  });
  const days = [day("s1", "2026-10-12", 3600), day("s1", "2026-10-13", 7200, undefined, undefined, { inbox: 3600, insights: 3600 }), day("s2", "2026-10-13", 600)];
  const tasks = [
    { kind: "replies_whatsapp" as const, staffId: "s1", staffName: "Lara", at: "2026-10-13T08:00:00Z" },
    { kind: "alerts_closed" as const, staffId: null, staffName: "lara ", at: "2026-10-13T09:00:00Z" },
    { kind: "leads_taken" as const, staffId: "s3", staffName: "Samaya", at: "2026-10-13T09:00:00Z" },
  ];
  const r = employeesReport(days, tasks);
  test("time, days, usual hours in Beirut, sections", () => {
    const lara = r.find((e) => e.key === "s1")!;
    assert.equal(lara.activeMinutes, 180);
    assert.equal(lara.daysActive, 2);
    assert.equal(lara.typicalStart, "08:30");
    assert.equal(lara.typicalEnd, "17:00");
    assert.deepEqual(lara.sections.map((s) => [s.key, s.minutes]), [["inbox", 120], ["insights", 60]]);
  });
  test("a task recorded under a name joins the person with that name; nobody is invented", () => {
    const lara = r.find((e) => e.key === "s1")!;
    assert.deepEqual(lara.tasks, { replies_whatsapp: 1, alerts_closed: 1 });
    assert.equal(lara.tasksPerHour, 0.7);
    const samaya = r.find((e) => e.name === "Samaya")!;
    assert.equal(samaya.activeMinutes, 0, "tasks without measured time");
    assert.equal(r.find((e) => e.key === "s2")!.tasksPerHour, null, "under 30 minutes: too little to say");
  });
  test("minutes by day", () => {
    assert.deepEqual(minutesByDay(days, ["2026-10-12", "2026-10-13"]).map((x) => [x.staffId, x.minutes]), [["s1", [60, 120]], ["s2", [0, 10]]]);
  });
});
