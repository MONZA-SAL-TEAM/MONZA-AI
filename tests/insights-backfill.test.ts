/**
 * The Instagram / Facebook history read (lib/insights/meta-backfill*.ts): labels only, never words; stops
 * on Meta's rate limits; an empty first page is unknown, never "no chats" (CLAUDE.md rule 21).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { metaErrorCode, metaUsagePercent, NO_TEXT } from "@/lib/channels/live-map";
import { emptyFirstPage, MAX_CALLS_PER_RUN, shouldStop, turnsOf, unchanged } from "@/lib/insights/meta-backfill-rules";
import type { InboxMessage } from "@/lib/inbox/types";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("Meta's usage headers and error codes", () => {
  test("the highest usage figure across the headers", () => {
    const headers: Record<string, string> = {
      "x-app-usage": JSON.stringify({ call_count: 12, total_cputime: 4, total_time: 9 }),
      "x-business-use-case-usage": JSON.stringify({ "1234": [{ type: "instagram", call_count: 81, total_cputime: 3, total_time: 5 }] }),
    };
    assert.equal(metaUsagePercent((n) => headers[n] ?? null), 81);
    assert.equal(metaUsagePercent(() => null), null);
    assert.equal(metaUsagePercent((n) => (n === "x-app-usage" ? "not json" : null)), null);
  });
  test("codes from Meta's error detail", () => {
    assert.equal(metaErrorCode('code 4, OAuthException, "Application request limit reached"'), "meta_4");
    assert.equal(metaErrorCode("code -2, subcode 2534084, OAuthException"), "meta_-2_2534084");
    assert.equal(metaErrorCode(null), null);
  });
});

describe("when to stop", () => {
  const base = { calls: 1, usage: 10, errorCode: null, elapsedMs: 1000, budgetMs: 40000 };
  test("rate limits and the -2/2534084 timeout block the run with the code", () => {
    for (const code of ["meta_4", "meta_17", "meta_32", "meta_613", "meta_-2_2534084"]) assert.deepEqual(shouldStop({ ...base, errorCode: code }), { stop: true, state: "blocked", code });
  });
  test("over 75% usage, or the call budget, pauses it", () => {
    assert.deepEqual(shouldStop({ ...base, usage: 76 }), { stop: true, state: "blocked", code: "usage_over_75" });
    assert.deepEqual(shouldStop({ ...base, usage: 75 }), { stop: false });
    assert.deepEqual(shouldStop({ ...base, calls: MAX_CALLS_PER_RUN }), { stop: true, state: "blocked", code: "call_budget" });
  });
  test("an empty FIRST page is unknown; an empty later page is just the end", () => {
    assert.equal(emptyFirstPage(true, 0, null), true);
    assert.equal(emptyFirstPage(false, 0, null), false);
    assert.equal(emptyFirstPage(true, 0, "cursor"), false);
  });
  test("a thread Meta says is unchanged is skipped", () => {
    assert.equal(unchanged({ meta_updated_at: "2026-10-01T10:00:00+00:00" }, "2026-10-01T10:00:00.000Z"), true);
    assert.equal(unchanged({ meta_updated_at: "2026-10-01T10:00:00Z" }, "2026-10-02T10:00:00.000Z"), false);
    assert.equal(unchanged(null, "2026-10-02T10:00:00.000Z"), false);
  });
});

describe("Meta's messages as reader turns", () => {
  const msg = (id: string, direction: "in" | "out", text: string): InboxMessage => ({ id, conversationId: "t", direction, author: direction === "in" ? "customer" : "staff", text, at: `2026-10-01T10:0${id}:00.000Z`, status: direction === "in" ? "received" : "sent" });
  test("the customer's are read, ours are context, an attachment placeholder is a file with no words", () => {
    const turns = turnsOf([msg("1", "in", "courage price?"), msg("2", "out", "Here is the Courage brochure"), msg("3", "in", NO_TEXT)]);
    assert.deepEqual(turns.map((t) => [t.author, t.text, t.hasMedia]), [["customer", "courage price?", false], ["staff", "Here is the Courage brochure", false], ["customer", "", true]]);
  });
});

describe("never the words, never a stored message", () => {
  test("the history read writes no channel_messages row and logs no text", () => {
    const job = src("lib/insights/meta-backfill.ts");
    assert.doesNotMatch(job, /from\("channel_messages"\)/);
    for (const line of job.split("\n").filter((l) => l.includes("console."))) assert.doesNotMatch(line, /text|message\b|words|body/i, line);
  });
  test("the Meta read is a GET through the account's own route, and asks for words only (no attachments)", () => {
    const live = src("lib/channels/live.ts");
    const fn = live.slice(live.indexOf("export async function readThreadsForInsights"));
    assert.match(fn, /route\.get\(/);
    assert.doesNotMatch(fn, /method: "POST"|graphPost|attachments/);
  });
  test("the nightly route is the cron's alone, and the manual one is owner and managers only", () => {
    assert.match(src("app/api/insights/refresh/route.ts"), /isCronAuthorized\(request\.headers\.get\("authorization"\), cronSecret\(\)\)/);
    assert.match(src("app/api/insights/backfill/route.ts"), /requireRealStaff\(request, INSIGHTS_CAPS\)/);
    assert.match(src("vercel.json"), /"\/api\/insights\/refresh", "schedule": "0 2 \* \* \*"/);
  });
});
