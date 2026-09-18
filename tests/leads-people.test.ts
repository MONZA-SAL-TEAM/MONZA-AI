/**
 * The real people behind /customers (lib/leads/people.ts): everyone Monza has a
 * chat with, built from MONZA AI's own rows. Invented rows below — no real
 * customer appears in a test.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildPeople, peopleCsv, personMatches, summarisePeople, type PeopleRows } from "@/lib/leads/people";

const ROWS: PeopleRows = {
  accounts: [
    { id: "wa-monza", channel: "whatsapp" },
    { id: "ig-voyah", channel: "instagram" },
  ],
  conversations: [
    { id: "c1", account_id: "wa-monza", brand: "monza", peer_external_id: "9613000001", peer_display: "Test One", last_message_at: "2026-09-17T10:00:00Z", last_inbound_at: "2026-09-17T10:00:00Z", unread_count: 2, created_at: "2026-09-16T08:00:00Z" },
    { id: "c2", account_id: "ig-voyah", brand: "voyah", peer_external_id: "17840000000000001", peer_display: "test.one", last_message_at: "2026-09-18T09:00:00Z", last_inbound_at: null, unread_count: 0, created_at: "2026-09-18T09:00:00Z" },
    { id: "c3", account_id: "wa-monza", brand: "monza", peer_external_id: "9613000002", peer_display: "", last_message_at: "2026-09-15T12:00:00Z", last_inbound_at: null, unread_count: 0, created_at: "2026-09-15T12:00:00Z" },
    { id: "c4", account_id: "wa-monza", brand: "monza", peer_external_id: "9613000003", peer_display: "=cmd|calc", last_message_at: "2026-09-14T12:00:00Z", last_inbound_at: "2026-09-14T12:00:00Z", unread_count: 0, created_at: "2026-09-14T12:00:00Z" },
  ],
  leads: [
    { id: "L1", display_name: "Test One", phone: "9613000001", first_seen_at: "2026-09-16T08:00:00Z", last_seen_at: "2026-09-17T10:00:00Z" },
    { id: "L4", display_name: "=cmd|calc", phone: "9613000003", first_seen_at: "2026-09-14T12:00:00Z", last_seen_at: "2026-09-14T12:00:00Z" },
  ],
  leadConversations: [
    { lead_id: "L1", conversation_id: "c1" },
    { lead_id: "L1", conversation_id: "c2" },
    { lead_id: "L4", conversation_id: "c4" },
  ],
  touchpoints: [
    { lead_id: "L1", source_kind: "direct", source_ref: null, headline: null, occurred_at: "2026-09-18T09:00:00Z" },
    { lead_id: "L1", source_kind: "ad_click", source_ref: "120200000000000001", headline: "Voyah COURAGE", occurred_at: "2026-09-16T08:00:00Z" },
    { lead_id: "L4", source_kind: "direct", source_ref: null, headline: null, occurred_at: "2026-09-14T12:00:00Z" },
  ],
  interests: [
    { lead_id: "L1", car_key: "voyah-taishan", mention_count: 1 },
    { lead_id: "L1", car_key: "voyah-courage", mention_count: 3 },
  ],
  alerts: [{ thread_id: "wa-monza~c1", kind: "PRICE", reason: "Bot not switched on for this chat: the customer asked about the price (COURAGE).", created_at: "2026-09-17T10:00:01Z" }],
};

describe("the people behind /customers", () => {
  const people = buildPeople(ROWS);
  const one = people.find((p) => p.name === "Test One");

  test("one person per lead, however many chats; a chat with no lead is still a person", () => {
    assert.equal(people.length, 3);
    assert.deepEqual(one?.threads.map((t) => t.threadId), ["ig-voyah~c2", "wa-monza~c1"], "newest chat first");
    assert.ok(people.some((p) => p.id === "chat:c3" && p.name === "+9613000002"), "staff wrote first: no lead, named by the number");
  });

  test("whoever waits for a person comes first", () => {
    assert.equal(people[0].name, "Test One");
    assert.deepEqual(people[0].alerts.map((a) => a.kind), ["PRICE"]);
  });

  test("where they came from is the FIRST touch, with the ad's headline and Meta's id", () => {
    assert.equal(one?.source, "Ad click");
    assert.equal(one?.sourceDetail, "Voyah COURAGE");
    assert.equal(one?.sourceRef, "120200000000000001");
  });

  test("'direct' is 'Not tracked' — never organic, never dropped from the totals", () => {
    const s = summarisePeople(people);
    assert.deepEqual({ people: s.people, waiting: s.waiting, fromAds: s.fromAds, notTracked: s.notTracked }, { people: 3, waiting: 1, fromAds: 1, notTracked: 2 });
    assert.deepEqual(s.sources, [{ label: "Ad click: Voyah COURAGE", people: 1 }]);
    assert.ok(!JSON.stringify(s).toLowerCase().includes("organic"));
  });

  test("cars they asked about use Monza's names, most-mentioned first", () => {
    assert.deepEqual(one?.interests, ["VOYAH Courage", "VOYAH Taishan"]);
    assert.deepEqual(summarisePeople(people).cars.map((c) => c.car).sort(), ["VOYAH Courage", "VOYAH Taishan"]);
  });

  test("an Instagram id is never a phone number; WhatsApp's is", () => {
    assert.equal(one?.phone, "9613000001");
    const igOnly = buildPeople({ ...ROWS, leads: [], leadConversations: [], conversations: [ROWS.conversations[1]] });
    assert.equal(igOnly[0].phone, null);
    assert.equal(igOnly[0].name, "test.one");
  });

  test("search: a name, a number typed the local way, an ad, a car", () => {
    assert.ok(one);
    if (!one) return;
    for (const q of ["test one", "03 000 001", "+961 3 000 001", "courage", "voyah courage", "ad click"]) assert.ok(personMatches(one, q), q);
    assert.ok(!personMatches(one, "mhero"));
    assert.ok(personMatches(one, "  "));
  });

  test("the export is the list as shown, and a name can never start a spreadsheet formula", () => {
    const csv = peopleCsv(people);
    const lines = csv.split("\r\n");
    assert.equal(lines[0], '"Name","Phone","Channels","Came from","Ad or post","Asked about","Waiting for a person","First seen","Last seen"');
    assert.equal(lines[1], '"Test One","\'+9613000001","instagram / whatsapp","Ad click","Voyah COURAGE","VOYAH Courage / VOYAH Taishan","yes","2026-09-16","2026-09-18"');
    assert.ok(csv.includes(`"'=cmd|calc"`), "a leading = is defused");
    assert.ok(!/(^|,)"=/.test(csv));
  });

  test("no message text is part of a person", () => {
    assert.ok(one);
    assert.deepEqual(Object.keys(one ?? {}).sort(), ["alerts", "firstSeenAt", "id", "interests", "lastSeenAt", "name", "phone", "source", "sourceDetail", "sourceRef", "threads"]);
  });
});
