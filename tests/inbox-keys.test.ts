/** Enter sends (lib/inbox/keys.ts): Enter sends, Shift+Enter is a new line, phones keep Enter as a new line. */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { enterSends } from "@/lib/inbox/keys";

const k = (over: Partial<Parameters<typeof enterSends>[0]> = {}) => ({ key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, ...over });

describe("Enter sends", () => {
  test("on a computer: Enter sends, Shift+Enter does not, Ctrl/Cmd+Enter still sends", () => {
    assert.equal(enterSends(k(), false), true);
    assert.equal(enterSends(k({ shiftKey: true }), false), false);
    assert.equal(enterSends(k({ ctrlKey: true }), false), true);
    assert.equal(enterSends(k({ metaKey: true }), false), true);
    assert.equal(enterSends(k({ key: "a" }), false), false);
  });
  test("on a phone: Enter is a new line; Ctrl+Enter (a keyboard case) still sends", () => {
    assert.equal(enterSends(k(), true), false);
    assert.equal(enterSends(k({ ctrlKey: true }), true), true);
  });
  test("while a keyboard is still composing, Enter never sends", () => {
    assert.equal(enterSends(k({ isComposing: true }), false), false);
  });
});
