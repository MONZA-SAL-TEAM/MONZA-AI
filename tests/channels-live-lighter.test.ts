/**
 * When Meta says "reduce the amount of data", the inbox asks again, lighter,
 * instead of reporting @voyahlebanon as unreadable (2026-09-10). This pins the
 * recognition of that answer, and that nothing else is mistaken for it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { isTooMuchData, mapConversations, type LiveAccount } from "@/lib/channels/live-map";

test("Meta's 'reduce the amount of data' is recognised", () => {
  assert.equal(
    isTooMuchData({
      error: {
        message: "Please reduce the amount of data you're asking for, then retry your request",
        code: 1,
      },
    }),
    true
  );
});

test("other errors, and success, are not mistaken for it", () => {
  assert.equal(isTooMuchData({ error: { code: 190, message: "Invalid OAuth access token." } }), false);
  assert.equal(isTooMuchData({ error: { code: 10 } }), false);
  assert.equal(isTooMuchData({ data: [] }), false);
  assert.equal(isTooMuchData(null), false);
});

test("a lighter list without message previews still lists who wrote", () => {
  const ig: LiveAccount = {
    id: "ig-voyah",
    brand: "voyah",
    channel: "instagram",
    displayName: "@voyahlebanon",
    externalId: "17841457996874250",
  };
  const rows = mapConversations(
    {
      data: [
        {
          id: "aWdfZAG06",
          updated_time: "2026-09-09T18:00:00+0000",
          participants: {
            data: [
              { username: "voyahlebanon", id: "17841457996874250" },
              { username: "rami.k", id: "IGSID9" },
            ],
          },
        },
      ],
    },
    ig,
    ["17841457996874250", "408893845643871"]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].customerName, "@rami.k");
  assert.equal(rows[0].lastMessage.text, "");
  assert.equal(rows[0].lastMessage.at, "2026-09-09T18:00:00.000Z");
});
