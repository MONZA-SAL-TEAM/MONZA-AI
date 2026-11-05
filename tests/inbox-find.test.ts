/**
 * The inbox's search box finds a person by their number or their name — theirs, the lead's or the CRM's
 * (Samer, 2026-11-05: "search the customers from his phone number or his name from the inbox, not just the
 * customer page"). Pure rules: lib/search.ts (how a Lebanese number is written), lib/inbox/filters.ts (the
 * list), lib/inbox/find.ts (the records).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { phoneMatches, significantDigits } from "@/lib/search";
import { searchConversations } from "@/lib/inbox/filters";
import { findPeople, MAX_FOUND } from "@/lib/inbox/find";
import type { Conversation } from "@/lib/inbox/types";
import type { Person } from "@/lib/leads/people";

const wa = (id: string, name: string, phone: string): Conversation => ({
  id: `wa-monza~${id}`,
  customerId: "",
  customerName: name,
  channel: "whatsapp",
  // What the inbox really carries for WhatsApp: the name and OUR account — never the number.
  channelAddress: `${name} → MONZA SAL (WhatsApp)`,
  peerPhone: phone,
  assignedTo: null,
  assignedToName: null,
  status: "open",
  unreadCount: 0,
  lastMessage: { text: "hi", at: "2026-11-05T10:00:00Z", direction: "in", author: "customer" },
  hasAutomatedMessage: false,
  accountId: "wa-monza",
  brand: "monza",
});

describe("a number written the Lebanese way", () => {
  test("the dialling prefix, the country code and the trunk zero are decoration", () => {
    for (const typed of ["70708585", "070 708 585", "+961 70 708 585", "0096170708585", "96170708585"]) assert.equal(significantDigits(typed), "70708585", typed);
    assert.equal(significantDigits("03 123 456"), "3123456");
  });
  test("each form finds the number stored as 961…", () => {
    for (const typed of ["70708585", "070708585", "0096170708585", "96170708585", "708585", "0707085"]) {
      assert.equal(phoneMatches("96170708585", typed.replace(/\D/g, "")), true, typed);
    }
  });
  test("a foreign number is found by its own digits, never rewritten", () => {
    assert.equal(phoneMatches("4915112345678", "15112345678"), true);
    assert.equal(phoneMatches("4915112345678", "0151"), false, "a trunk zero is only stripped from a number long enough to still mean somebody");
    assert.equal(phoneMatches("4915112345678", "0151123"), true);
  });
  test("three digits are the least that can mean somebody", () => {
    assert.equal(phoneMatches("96170708585", "00"), false);
    assert.equal(phoneMatches(null, "70708585"), false);
  });
});

describe("the list: a WhatsApp chat is found by the customer's number", () => {
  const list = [wa("a", "Rami", "96170708585"), wa("b", "Nour", "9613123456"), wa("c", "WhatsApp contact", "96171222333")];
  test("by the number, however it is written — the address never carried it", () => {
    for (const typed of ["70 708 585", "070708585", "+961 70 708 585"]) assert.deepEqual(searchConversations(list, typed).map((c) => c.customerName), ["Rami"], typed);
    assert.deepEqual(searchConversations(list, "03 123 456").map((c) => c.customerName), ["Nour"]);
  });
  test("by the name, and a nameless contact by number only", () => {
    assert.deepEqual(searchConversations(list, "nour").map((c) => c.id), ["wa-monza~b"]);
    assert.deepEqual(searchConversations(list, "71222333").map((c) => c.id), ["wa-monza~c"]);
  });
});

describe("the records: the lead's or the CRM's name, the number, the chats to open", () => {
  const person = (over: Partial<Person>): Person => ({
    id: "lead:1",
    name: "Rami",
    phone: "96170708585",
    threads: [{ threadId: "wa-monza~1", channel: "whatsapp", brand: "monza", lastMessageAt: "2026-11-01T00:00:00Z", lastInboundAt: null, unread: 0 }],
    source: "Not tracked",
    sourceDetail: null,
    sourceRef: null,
    interests: [],
    alerts: [],
    firstSeenAt: null,
    lastSeenAt: null,
    crm: null,
    ...over,
  });
  const crm: NonNullable<Person["crm"]> = { customerId: "c1", name: "Rami Kanaan", phone: "+961 70 708 585", email: null, leadSource: null, since: null, cars: [], activePlans: 0 };
  const people: Person[] = [
    person({ crm }),
    person({ id: "lead:2", name: "Instagram user", phone: null, threads: [{ threadId: "ig-voyah~9", channel: "instagram", brand: "voyah", lastMessageAt: "2026-11-04T00:00:00Z", lastInboundAt: null, unread: 1 }] }),
    person({ id: "crm:c3", name: "Nour Haddad", phone: "9613123456", threads: [], crm: { ...crm, customerId: "c3", name: "Nour Haddad" } }),
  ];
  test("the CRM's name finds the chat listed under the WhatsApp profile name", () => {
    const hit = findPeople(people, "kanaan");
    assert.equal(hit.length, 1);
    assert.equal(hit[0].name, "Rami");
    assert.equal(hit[0].crmName, "Rami Kanaan");
    assert.deepEqual(hit[0].threads.map((t) => t.threadId), ["wa-monza~1"]);
  });
  test("the number, written locally, finds them too", () => {
    assert.equal(findPeople(people, "070 708 585")[0]?.id, "lead:1");
  });
  test("a CRM customer with no chat is listed after people with one; an Instagram user is never found by a number", () => {
    const hit = findPeople(people, "a");
    assert.deepEqual(hit.map((h) => h.id), ["lead:2", "lead:1", "crm:c3"], "newest chat first, no chat last");
    assert.deepEqual(findPeople(people, "9999"), []);
  });
  test("nothing, or too little, finds nobody; the answer is capped", () => {
    assert.deepEqual(findPeople(people, "  "), []);
    assert.deepEqual(findPeople(people, "96"), []);
    const many = Array.from({ length: 50 }, (_, i) => person({ id: `lead:${i}`, name: `Person ${i}` }));
    assert.equal(findPeople(many, "person").length, MAX_FOUND);
  });
  test("what goes to the browser: a name, a number, chat ids — never a message's words", () => {
    const hit = findPeople(people, "rami")[0];
    assert.deepEqual(Object.keys(hit).sort(), ["crmName", "id", "name", "phone", "threads"]);
    assert.deepEqual(Object.keys(hit.threads[0]).sort(), ["brand", "channel", "lastMessageAt", "threadId"]);
  });
});
