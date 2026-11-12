import { test } from "node:test";
import assert from "node:assert/strict";
import { feedFunnel } from "@/lib/insights/leads";

const st = (key: string, n: number | null) => ({ def: { key, label: key, definition: "", source: "messages" }, n });

test("the feed funnel leaves out Handed to Sales and measures each stage against the one it follows", () => {
  const f = feedFunnel([
    st("wrote", 1654), st("asked", 1268), st("interest", 717), st("qualified", 255), st("handoff", 1153),
    st("test_drive_asked", 84), st("test_drive_booked", 0), st("quoted", 20), st("reserved", 20), st("won", 19),
  ]);
  assert.equal(f.find((s) => s.key === "handoff"), undefined);
  const by = Object.fromEntries(f.map((s) => [s.key, s]));
  assert.equal(by.test_drive_asked.of, "qualified");
  assert.equal(by.test_drive_asked.fromPrevious, 84 / 255);
  // A quotation is a branch off a qualified lead, not a step after a booked test drive.
  assert.equal(by.quoted.of, "qualified");
  assert.equal(by.quoted.fromPrevious, 20 / 255);
  assert.equal(by.won.fromPrevious, 19 / 20);
  assert.equal(by.wrote.fromPrevious, null);
});

test("an unreadable CRM stage stays unknown, and so does every share measured against it", () => {
  const f = feedFunnel([st("qualified", 255), st("quoted", null), st("reserved", null), st("won", null)]);
  const by = Object.fromEntries(f.map((s) => [s.key, s]));
  assert.equal(by.quoted.n, null);
  assert.equal(by.quoted.fromPrevious, null);
  assert.equal(by.reserved.fromPrevious, null);
});
