/**
 * Response times (lib/insights/team.ts): bursts, a person's first reply, bot replies apart, business
 * hours (Beirut, closed Sunday), unanswered chats, owners with no follow-up, overdue alerts.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildTeamReport, businessMinutes, PHONE_APP, type TurnRow } from "@/lib/insights/team";

const S1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const t = (conversation_id: string, at: string, author: TurnRow["author"], staff_id: string | null = null, staff_name: string | null = null): TurnRow => ({
  conversation_id, at, direction: author === "customer" ? "in" : "out", author, staff_id, staff_name,
});

describe("business minutes (Beirut: Mon–Fri 8–18, Sat 8–14, closed Sunday)", () => {
  test("inside one working day", () => {
    // Monday 2026-10-12, 10:00 → 10:30 Beirut (UTC+3).
    assert.equal(businessMinutes("2026-10-12T07:00:00Z", "2026-10-12T07:30:00Z"), 30);
  });
  test("a Saturday evening message answered Monday morning counts only Monday's opening minutes", () => {
    // Sat 2026-10-10 20:00 Beirut → Mon 2026-10-12 08:15 Beirut.
    assert.equal(businessMinutes("2026-10-10T17:00:00Z", "2026-10-12T05:15:00Z"), 15);
  });
  test("Sunday is closed", () => {
    assert.equal(businessMinutes("2026-10-11T07:00:00Z", "2026-10-11T12:00:00Z"), 0);
  });
});

describe("the report", () => {
  const report = buildTeamReport(
    {
      turns: [
        // c1: customer twice (one burst), the bot, then Rami 20 minutes after the first message.
        t("c1", "2026-10-12T07:00:00Z", "customer"),
        t("c1", "2026-10-12T07:02:00Z", "customer"),
        t("c1", "2026-10-12T07:03:00Z", "automation"),
        t("c1", "2026-10-12T07:20:00Z", "staff", S1, "rami"),
        // c2: answered from the phone app (no name), 2 hours later.
        t("c2", "2026-10-12T08:00:00Z", "customer"),
        t("c2", "2026-10-12T10:00:00Z", "staff"),
        // c3: the customer's word is the last: waiting on us.
        t("c3", "2026-10-12T09:00:00Z", "customer"),
      ],
      owned: [
        { conversation_id: "c3", owner_id: S1, owner_name: "Rami" },
        { conversation_id: "c1", owner_id: S1, owner_name: "Rami" },
      ],
      alerts: [
        { conversation_ref: "c3", status: "open", created_at: "2026-10-12T09:00:00Z", kind: "PRICE" },
        { conversation_ref: "c1", status: "open", created_at: "2026-10-12T12:30:00Z", kind: "LEAD" },
      ],
    },
    "2026-10-12T13:00:00Z"
  );

  test("one burst per run of customer messages; the bot is never a person's reply", () => {
    assert.equal(report.bursts, 3);
    assert.equal(report.answered, 2);
    assert.equal(report.botFirst, 1);
    const rami = report.people.find((p) => p.key === S1)!;
    assert.equal(rami.medianMinutes, 20);
    assert.equal(rami.within15, 0);
    assert.equal(rami.within60, 1);
  });
  test("a phone-app reply is shown as not attributed, never guessed", () => {
    assert.ok(report.people.some((p) => p.name === PHONE_APP && p.medianMinutes === 120));
  });
  test("waiting on us, overdue alerts, and owned leads", () => {
    assert.equal(report.unanswered, 1);
    assert.equal(report.overdueAlerts, 1, "only the alert open for over 2 hours");
    assert.deepEqual(report.owners, [{ ownerId: S1, name: "Rami", leads: 2, waitingOnUs: 1, noFollowUp: 1 }]);
  });
});

describe("never the words", () => {
  test("the team read selects no message body", () => {
    const src = readFileSync(join(process.cwd(), "lib/insights/team-server.ts"), "utf8");
    assert.doesNotMatch(src, /select\("[^"]*\bbody\b/);
  });
});
