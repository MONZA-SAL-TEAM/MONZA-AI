/**
 * The clients, counted, for the Monza app's Morning Briefing (Samer, 2026-11-25: "the overview
 * telling me insights about all the clients", not the messaging system's details). Counts only;
 * a figure that did not come is null, never 0; the waiting number is the recent ones.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseClientsSummary } from "@/lib/brief/clients-summary";
import { summariseWaiting, waitingRows, RECENT_WAIT_DAYS } from "@/lib/alerts/waiting";

// What brief_client_summary() answered on the live database, 2026-11-25.
const LIVE = {
  at: "2026-11-25T13:15:33.364+00:00",
  people: { now: 348, before: 817 },
  newPeople: 283,
  returning: 65,
  fromAd: { now: 28, before: 277 },
  byChannel: { facebook: 1, whatsapp: 233, instagram: 114 },
  byBrand: { mhero: 64, monza: 237, voyah: 47 },
  cars: [{ code: "COURAGE", people: 15 }, { code: "FREE_318", people: 10 }, { code: "NOT_A_CAR", people: 9 }],
  questions: [{ topic: "PRICE", people: 88 }, { topic: "FINANCING", people: 18 }, { topic: "GENERAL_INFO", people: 400 }],
  people90d: 1602,
  buyingQuestion90d: 610,
  reply: { asked: 832, answered: 727, medianMinutes: 27, withinHour: 407, neverAnswered: 105 },
};

describe("the clients summary", () => {
  test("reads the live answer: people, ads, channels, cars by their workbook names, buying questions", () => {
    const s = parseClientsSummary(LIVE)!;
    assert.deepEqual(s.people, { now: 348, before: 817 });
    assert.deepEqual(s.fromAd, { now: 28, before: 277 });
    assert.deepEqual(s.byChannel, { whatsapp: 233, instagram: 114, facebook: 1 });
    assert.equal(s.cars.length, 2); // a code that is not a car of the workbook is not shown
    assert.match(s.cars[0].label, /Courage/i);
    assert.deepEqual(s.questions.map((q) => q.label), ["Price", "Financing"]); // only buying questions
    assert.deepEqual(s.reply, { asked: 832, answered: 727, medianMinutes: 27, withinHour: 407, neverAnswered: 105 });
  });

  test("not a summary → null, so the caller says \"not available\" and never shows zeros", () => {
    assert.equal(parseClientsSummary(null), null);
    assert.equal(parseClientsSummary({ at: "2026-11-25T00:00:00Z" }), null);
    assert.equal(parseClientsSummary({ ...LIVE, people: { now: "many", before: 1 } }), null);
  });

  test("nothing needed an answer → reply is null, not a perfect score", () => {
    assert.equal(parseClientsSummary({ ...LIVE, reply: { asked: 0, answered: 0 } })!.reply, null);
    assert.equal(parseClientsSummary({ ...LIVE, reply: { asked: 3, answered: 0, neverAnswered: 3 } })!.reply!.medianMinutes, null);
  });

  test("counts only: the summary has no place for a name, a number, a chat or a word", () => {
    const withExtras = { ...LIVE, customer_name: "Rami", phone: "96170000000", body: "hello", conversation_id: "c1" };
    const out = JSON.stringify(parseClientsSummary(withExtras));
    assert.equal(/Rami|96170000000|hello|c1/.test(out), false);
    const sql = readFileSync(join(process.cwd(), "database/migrations/035_brief_client_summary.sql"), "utf8");
    const fn = sql.slice(sql.indexOf("create or replace function"));
    assert.equal(/customer_name|peer_display|\.body|customer_phone/.test(fn), false);
    // Only a person's reply counts as an answer, and the test phones are left out.
    assert.match(fn, /x\.a = 'staff'/);
    assert.match(fn, /not \(c\.peer_external_id = any \(p_exclude\)\)/);
    assert.match(sql, /revoke all on function public\.brief_client_summary\(text\[\]\) from public, anon, authenticated/);
  });

  test("the feed passes the pilot's test phones and answers null when the count failed", () => {
    const route = readFileSync(join(process.cwd(), "app/api/brief/decisions/route.ts"), "utf8");
    assert.match(route, /p_exclude: AUTOREPLY_PILOT\.chats\.map\(\(c\) => c\.peer\)/);
    assert.match(route, /const clients = summaryError \? null : parseClientsSummary\(summary\)/);
  });
});

describe("the waiting number means something", () => {
  const NOW = Date.parse("2026-11-25T10:00:00Z");
  const w = (id: string, since: string) =>
    ({ conversationId: id, waitingSince: since, lastCustomerAt: since, neverAnswered: true, class: "interested" as const, ownerId: null, ownerName: null });

  test("recent = waiting a week or less; older ones are a backlog to review", () => {
    assert.equal(RECENT_WAIT_DAYS, 7);
    const s = summariseWaiting(
      waitingRows([w("a", "2026-11-25T08:00:00Z"), w("b", "2026-11-19T10:00:00Z"), w("c", "2026-11-18T09:00:00Z"), w("d", "2026-10-01T09:00:00Z")], NOW)
    );
    assert.deepEqual([s.total, s.recent, s.older], [4, 2, 2]);
  });
});
