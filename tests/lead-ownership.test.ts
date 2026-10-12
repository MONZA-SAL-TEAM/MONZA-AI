/**
 * "Take this lead" (Samer, 2026-10-12): sales take and release their own; managers and the owner also
 * assign and reassign. Rules in lib/leads/ownership.ts; the race-safe write in ownership-server.ts.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ownershipDecision, type Actor } from "@/lib/leads/ownership";
import { matchesView, EMPTY_VIEW } from "@/lib/inbox/sync";
import type { Conversation } from "@/lib/inbox/types";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const M = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const sales = (id: string, name: string): Actor => ({ id, name, appRole: "staff", capabilities: ["sales"] });
const manager: Actor = { id: M, name: "Manager", appRole: "staff", capabilities: ["manage_team"] };
const owner: Actor = { id: M, name: "Samer", appRole: "owner", capabilities: [] };
const cashier: Actor = { id: B, name: "Cashier", appRole: "staff", capabilities: ["cashier"] };

describe("who may take, release and assign", () => {
  test("a salesperson takes an unowned lead", () => {
    assert.deepEqual(ownershipDecision(sales(A, "Rami"), null, "take"), { ok: true, next: { id: A, name: "Rami" }, changed: true });
  });
  test("taking someone else's lead is refused with who owns it", () => {
    const r = ownershipDecision(sales(A, "Rami"), { id: B, name: "Lina" }, "take");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 409);
      assert.match(r.reason, /Lina/);
    }
  });
  test("release: your own yes, someone else's no — unless you manage", () => {
    assert.equal(ownershipDecision(sales(A, "Rami"), { id: A, name: "Rami" }, "release").ok, true);
    assert.equal(ownershipDecision(sales(A, "Rami"), { id: B, name: "Lina" }, "release").ok, false);
    assert.equal(ownershipDecision(manager, { id: B, name: "Lina" }, "release").ok, true);
  });
  test("assign: managers and the owner only, to a real staff id", () => {
    assert.equal(ownershipDecision(sales(A, "Rami"), null, "assign", { id: B, name: "Lina" }).ok, false);
    assert.deepEqual(ownershipDecision(manager, { id: A, name: "Rami" }, "assign", { id: B, name: "Lina" }), { ok: true, next: { id: B, name: "Lina" }, changed: true });
    assert.equal(ownershipDecision(owner, null, "assign", { id: B, name: "Lina" }).ok, true);
    assert.equal(ownershipDecision(manager, null, "assign", { id: "not-a-uuid", name: "x" }).ok, false);
  });
  test("someone who does not sell cannot own a lead", () => {
    assert.equal(ownershipDecision(cashier, null, "take").ok, false);
  });
  test("taking your own lead again changes nothing", () => {
    assert.deepEqual(ownershipDecision(sales(A, "Rami"), { id: A, name: "Rami" }, "take"), { ok: true, next: { id: A, name: "Rami" }, changed: false });
  });
});

describe("the write is race-safe and the names come from the CRM", () => {
  const src = readFileSync(join(process.cwd(), "lib/leads/ownership-server.ts"), "utf8");
  test("one conditional UPDATE: only if nobody changed it since it was read; the loser gets 409", () => {
    assert.match(src, /q = before\.owner \? q\.eq\("assigned_to", before\.owner\.id\) : q\.is\("assigned_to", null\);/);
    assert.match(src, /status: 409/);
    assert.match(src, /from\("conversation_owner_events"\)\.insert/);
  });
  test("an assignee must be on the CRM's assignable list — the browser cannot name anyone", () => {
    const route = readFileSync(join(process.cwd(), "app/api/conversations/owner/route.ts"), "utf8");
    assert.match(route, /const staff = await assignableStaff\(access\.user\);\s*target = staff\.find/);
    assert.match(route, /requireRealStaff\(request\)/);
  });
});

describe("the inbox's My leads and Unassigned filters", () => {
  const conv = (id: string): Conversation =>
    ({ id, customerId: "", customerName: "x", channel: "whatsapp", channelAddress: "", assignedTo: null, assignedToName: null, status: "open", unreadCount: 0, lastMessage: { text: "hi", at: "2026-10-12T10:00:00Z", direction: "in", author: "customer" }, hasAutomatedMessage: false }) as Conversation;
  const ctx = { accounts: [], seen: {}, baselineAt: "", dayOf: (iso: string) => iso.slice(0, 10), owners: { t1: { id: A } }, me: A };
  test("mine shows only my leads; unassigned shows only unowned ones", () => {
    assert.equal(matchesView(conv("t1"), { ...EMPTY_VIEW, show: "mine" }, ctx), true);
    assert.equal(matchesView(conv("t2"), { ...EMPTY_VIEW, show: "mine" }, ctx), false);
    assert.equal(matchesView(conv("t1"), { ...EMPTY_VIEW, show: "unassigned" }, ctx), false);
    assert.equal(matchesView(conv("t2"), { ...EMPTY_VIEW, show: "unassigned" }, ctx), true);
  });
});
