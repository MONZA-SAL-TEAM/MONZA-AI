/**
 * "Load more" / "Load all" (Samer, 2026-09-10: "let me be able to load more
 * chats, as many as I want"). Meta pages its conversation lists; the cursor
 * for the next page comes back from the browser, so it is checked here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { isSafeCursor, nextCursor } from "@/lib/channels/live-map";

test("the next page's cursor is read from Meta's paging", () => {
  assert.equal(
    nextCursor({
      data: [],
      paging: {
        cursors: { before: "QVFIUmJ2", after: "QVFIUnR5dGx4" },
        next: "https://graph.facebook.com/v21.0/408893845643871/conversations?after=QVFIUnR5dGx4",
      },
    }),
    "QVFIUnR5dGx4"
  );
});

test("no `next` link means the last page, whatever the cursors say", () => {
  assert.equal(nextCursor({ data: [], paging: { cursors: { after: "QVFIUnR5dGx4" } } }), null);
  assert.equal(nextCursor({ data: [] }), null);
  assert.equal(nextCursor(null), null);
});

test("a cursor that could smuggle extra parameters is refused", () => {
  assert.equal(isSafeCursor("QVFIUnR5dGx4-_=+/."), true);
  for (const bad of ["abc&fields=access_token", "abc def", "abc#x", "abc?x", "", "x".repeat(1025)]) {
    assert.equal(isSafeCursor(bad), false, bad);
  }
  assert.equal(isSafeCursor(42), false);
  assert.equal(
    nextCursor({ paging: { next: "https://x", cursors: { after: "abc&limit=500" } } }),
    null
  );
});
