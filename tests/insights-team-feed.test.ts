import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTeamReport, feedTeam, firstReplyByConversation, PHONE_APP, speedVsSale, type TurnRow } from "@/lib/insights/team";

// Tuesday 2026-11-10, Beirut is UTC+2: 08:00 UTC = 10:00 in the showroom.
const t = (conv: string, at: string, author: TurnRow["author"], staff: string | null = null): TurnRow => ({
  conversation_id: conv, at, direction: author === "customer" ? "in" : "out", author, staff_id: staff, staff_name: staff,
});

const turns = [
  t("fast", "2026-11-10T08:00:00Z", "customer"), t("fast", "2026-11-10T08:10:00Z", "staff", "Michelle"),
  t("slow", "2026-11-10T08:00:00Z", "customer"), t("slow", "2026-11-10T08:05:00Z", "automation"), t("slow", "2026-11-11T08:00:00Z", "staff"),
  t("none", "2026-11-10T09:00:00Z", "customer"),
];

test("each chat's first reply is a PERSON's, in business minutes; the bot never counts", () => {
  const f = firstReplyByConversation(turns);
  assert.equal(f.get("fast")!.minutes, 10);
  assert.equal(f.get("slow")!.minutes, 600); // 10:00 → next day 10:00 = one 10-hour working day
  assert.equal(f.get("none")!.minutes, null);
});

test("speed bands count chats and later buyers; an unreadable CRM is unknown, never 0", () => {
  const f = firstReplyByConversation(turns);
  const bands = speedVsSale(f, (conv) => conv === "fast");
  const by = Object.fromEntries(bands.map((b) => [b.key, b]));
  assert.deepEqual([by["15m"].chats, by["15m"].bought], [1, 1]);
  assert.deepEqual([by["1d"].chats, by["1d"].bought], [1, 0]);
  assert.deepEqual([by.never.chats, by.never.bought], [1, 0]);
  assert.ok(speedVsSale(f, null).every((b) => b.bought === null));
});

test("the feed says how much of the replying carries a name, and chats with an owner", () => {
  const report = buildTeamReport({ turns, owned: [{ conversation_id: "fast", owner_id: "u1", owner_name: "Michelle" }], alerts: [] }, "2026-11-12T08:00:00Z");
  const team = feedTeam(report, []);
  assert.equal(team.chats, 3);
  assert.equal(team.ownedChats, 1);
  assert.equal(team.answered, 2);
  assert.equal(team.attributedShare, 0.5); // Michelle named; the other reply came from the phone app
  assert.equal(team.people.find((p) => p.name === PHONE_APP)?.named, false);
});

test("the speed table splits by when the customer first wrote: showroom hours or after", async () => {
  const { showroomOpenAt } = await import("@/lib/insights/team");
  assert.equal(showroomOpenAt("2026-11-10T08:00:00Z"), true); // Tue 10:00 Beirut
  assert.equal(showroomOpenAt("2026-11-10T19:00:00Z"), false); // Tue 21:00
  assert.equal(showroomOpenAt("2026-11-14T13:00:00Z"), false); // Sat 15:00, closed at 14:00
  assert.equal(showroomOpenAt("2026-11-15T08:00:00Z"), false); // Sunday
  const late = [t("late", "2026-11-10T19:00:00Z", "customer"), t("late", "2026-11-11T08:30:00Z", "staff")];
  const f = firstReplyByConversation([...turns, ...late]);
  const inH = speedVsSale(f, () => false, showroomOpenAt);
  const after = speedVsSale(f, () => false, (at) => !showroomOpenAt(at));
  assert.equal(inH.reduce((a, b) => a + b.chats, 0), 3);
  assert.equal(after.reduce((a, b) => a + b.chats, 0), 1);
});
