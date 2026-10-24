/**
 * Refresh timers (lib/poll.ts): fast while someone is using the screen, slow when it is left open, none (or
 * rare) behind another tab — the Vercel bill was mostly tabs nobody was looking at.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IDLE_AFTER_MS, POLL, pollDelay, staleOnReturn } from "@/lib/poll";

const now = 10_000_000;

describe("how long until the next ask", () => {
  test("in front and in use: the active speed", () => {
    assert.equal(pollDelay(POLL.thread, true, now - 1_000, now), 15_000);
    assert.equal(pollDelay(POLL.inboxList, true, now - 1_000, now), 60_000);
  });
  test("in front but untouched for five minutes: the idle speed", () => {
    assert.equal(pollDelay(POLL.thread, true, now - IDLE_AFTER_MS, now), 2 * 60_000);
    assert.equal(pollDelay(POLL.salesAlerts, true, now - IDLE_AFTER_MS - 1, now), 2 * 60_000);
  });
  test("behind another tab: the open thread, owners, cars and calendar are not asked at all", () => {
    for (const rule of [POLL.thread, POLL.owners, POLL.cars, POLL.testDrives]) {
      assert.equal(pollDelay(rule, false, now, now), null);
    }
  });
  test("behind another tab: new chats and sales alerts are still checked, slowly, so a desktop notification comes", () => {
    assert.equal(pollDelay(POLL.inboxList, false, now, now), 5 * 60_000);
    assert.equal(pollDelay(POLL.salesAlerts, false, now, now), 5 * 60_000);
  });
  test("no rule is faster idle or hidden than active", () => {
    for (const [name, r] of Object.entries(POLL)) {
      assert.ok(r.idle >= r.active, name);
      if (r.hidden !== null) assert.ok(r.hidden >= r.idle, name);
    }
  });
});

describe("coming back", () => {
  test("asks at once only when the last answer is older than the active wait", () => {
    assert.equal(staleOnReturn(POLL.thread, now - 20_000, now), true);
    assert.equal(staleOnReturn(POLL.thread, now - 5_000, now), false, "a glance at another tab costs nothing");
  });
});

describe("the screens use it", () => {
  test("no fixed setInterval refresh is left on the inbox, alerts or test-drive screens", () => {
    for (const f of ["app/inbox/InboxClient.tsx", "app/inbox/SalesAlerts.tsx", "app/test-drives/TestDrivesClient.tsx"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      assert.doesNotMatch(src, /setInterval\(/, f);
      assert.match(src, /usePoll\(/, f);
    }
  });
});
