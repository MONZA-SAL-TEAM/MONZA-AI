/**
 * The live inbox reads Instagram and Facebook from Meta and keeps no copy
 * (Samer, 2026-09-10). What is tested here is the pure half:
 *
 *   - Meta's answers map to the right person and the right direction, so our
 *     own replies never look like the customer's and a reply is never
 *     addressed to ourselves;
 *   - a crafted thread id cannot steer a Graph request or borrow another
 *     brand's Page;
 *   - what the webhook keeps holds no words.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  NO_TEXT,
  decodeThreadId,
  encodeThreadId,
  graphProblem,
  graphTime,
  inboundIndexRow,
  lastCustomerAt,
  mapConversations,
  mapThread,
  pageIdFor,
  peerOf,
  readPageInfo,
  redactDelivery,
  sortNewestFirst,
  type LiveAccount,
} from "@/lib/channels/live-map";
import { searchConversations } from "@/lib/inbox/filters";

const VOYAH_PAGE = "408893845643871";
const VOYAH_IG_ID = "17841457996874250";

const FB_VOYAH: LiveAccount = {
  id: "fb-voyah",
  brand: "voyah",
  channel: "facebook",
  displayName: "Voyah Lebanon",
  externalId: VOYAH_PAGE,
};
const IG_VOYAH: LiveAccount = {
  id: "ig-voyah",
  brand: "voyah",
  channel: "instagram",
  displayName: "@voyahlebanon",
  externalId: VOYAH_IG_ID,
};
const FB_MHERO: LiveAccount = {
  id: "fb-mhero",
  brand: "mhero",
  channel: "facebook",
  displayName: "M HERO Lebanon",
  externalId: "419538711242175",
};
const IG_MHERO: LiveAccount = {
  id: "ig-mhero",
  brand: "mhero",
  channel: "instagram",
  displayName: "@mherolebanon",
  externalId: "17841469421956644",
};
const ALL = [FB_VOYAH, IG_VOYAH, FB_MHERO, IG_MHERO];

/** GET /{page-id}/conversations?platform=messenger, as Meta shapes it. */
const MESSENGER_LIST = {
  data: [
    {
      id: "t_111",
      updated_time: "2026-09-10T09:00:00+0000",
      participants: {
        data: [
          { name: "Rami Kanaan", email: "psid1@facebook.com", id: "PSID1" },
          { name: "Voyah Lebanon", email: "page@facebook.com", id: VOYAH_PAGE },
        ],
      },
      messages: {
        data: [
          {
            id: "m_1",
            created_time: "2026-09-10T09:00:00+0000",
            from: { name: "Rami Kanaan", id: "PSID1" },
            message: "Is the Free available in grey?",
          },
        ],
      },
    },
    {
      id: "t_222",
      updated_time: "2026-09-10T11:30:00+0000",
      participants: {
        // The Page listed FIRST — the customer must still be found.
        data: [
          { name: "Voyah Lebanon", id: VOYAH_PAGE },
          { name: "Maya S", id: "PSID2" },
        ],
      },
      messages: {
        data: [
          {
            id: "m_2",
            created_time: "2026-09-10T11:30:00+0000",
            from: { name: "Voyah Lebanon", id: VOYAH_PAGE },
            message: "Yes — come by the showroom.",
          },
        ],
      },
    },
    // An id that would change the Graph path. Must be dropped, not listed.
    { id: "t_333/../me", participants: { data: [] }, messages: { data: [] } },
  ],
};

/** GET /{conversation-id}?fields=participants,messages{…} on Instagram. */
const IG_THREAD = {
  participants: {
    data: [
      { username: "voyahlebanon", id: VOYAH_IG_ID },
      { username: "rami.k", id: "IGSID9" },
    ],
  },
  messages: {
    // Newest first, as Meta sends them.
    data: [
      {
        id: "ig3",
        created_time: "2026-09-10T10:02:00+0000",
        from: { username: "voyahlebanon", id: VOYAH_IG_ID },
        message: "Welcome!",
      },
      { id: "ig2", created_time: "2026-09-10T10:01:00+0000", from: { username: "rami.k", id: "IGSID9" } },
      {
        id: "ig1",
        created_time: "2026-09-10T10:00:00+0000",
        from: { username: "rami.k", id: "IGSID9" },
        message: "Hi",
      },
      { id: "", created_time: "not a date" },
    ],
  },
};

describe("thread ids", () => {
  test("round-trip our account id and Meta's conversation id", () => {
    const id = encodeThreadId("ig-voyah", "aWdfZAG06MTpJR01lc3NhZA==");
    assert.deepEqual(decodeThreadId(id), {
      accountId: "ig-voyah",
      metaConversationId: "aWdfZAG06MTpJR01lc3NhZA==",
    });
  });

  test("refuse anything that could steer the Graph request", () => {
    for (const bad of [
      "fb-voyah~t_1/../me",
      "fb-voyah~t_1?fields=access_token",
      "fb-voyah~t_1&x=1",
      "fb-voyah~t_1#frag",
      "fb-voyah~",
      "~t_1",
      "FB_VOYAH~t_1",
      "fb-voyah",
      "",
    ]) {
      assert.equal(decodeThreadId(bad), null, bad);
    }
    assert.equal(decodeThreadId(42), null);
    assert.equal(decodeThreadId(null), null);
  });
});

describe("which Page reads an account", () => {
  test("a Facebook account is its own Page", () => {
    assert.equal(pageIdFor(FB_VOYAH, ALL), VOYAH_PAGE);
  });

  test("an Instagram account borrows its OWN brand's Page, never another's", () => {
    assert.equal(pageIdFor(IG_VOYAH, ALL), VOYAH_PAGE);
    assert.equal(pageIdFor(IG_MHERO, ALL), FB_MHERO.externalId);
    // With MHERO's Page missing, MHERO's Instagram is unreadable — it must not
    // fall back to VOYAH's Page.
    assert.equal(pageIdFor(IG_MHERO, [FB_VOYAH, IG_VOYAH, IG_MHERO]), null);
  });

  test("two Pages for one brand is ambiguous and refuses", () => {
    const second = { ...FB_VOYAH, id: "fb-voyah-2", externalId: "999" };
    assert.equal(pageIdFor(IG_VOYAH, [...ALL, second]), null);
  });

  test("the Page answer yields its token and linked Instagram id", () => {
    assert.deepEqual(
      readPageInfo({ access_token: "PAGE_TOKEN", instagram_business_account: { id: VOYAH_IG_ID }, id: VOYAH_PAGE }),
      { token: "PAGE_TOKEN", igId: VOYAH_IG_ID }
    );
    assert.deepEqual(readPageInfo({ id: VOYAH_PAGE }), { token: null, igId: null });
    assert.deepEqual(readPageInfo(null), { token: null, igId: null });
  });
});

describe("the conversation list", () => {
  const selfIds = [VOYAH_PAGE];
  const rows = mapConversations(MESSENGER_LIST, FB_VOYAH, selfIds);

  test("maps real conversations and drops an unsafe id", () => {
    assert.deepEqual(rows.map((r) => r.id), ["fb-voyah~t_111", "fb-voyah~t_222"]);
  });

  test("the customer is the participant who is not us", () => {
    assert.equal(rows[0].customerName, "Rami Kanaan");
    assert.equal(rows[1].customerName, "Maya S");
  });

  test("who spoke last decides the state", () => {
    assert.equal(rows[0].status, "open");
    assert.equal(rows[0].lastMessage.direction, "in");
    assert.equal(rows[1].status, "waiting_reply");
    assert.equal(rows[1].lastMessage.direction, "out");
    assert.equal(rows[1].lastMessage.author, "staff");
  });

  test("every row says which brand's account it came to", () => {
    assert.equal(rows[0].channel, "facebook");
    assert.match(rows[0].channelAddress, /Voyah Lebanon$/);
    assert.equal(searchConversations(rows, "voyah").length, 2);
    assert.equal(searchConversations(rows, "rami").length, 1);
  });

  test("newest first across accounts", () => {
    assert.deepEqual(sortNewestFirst(rows).map((r) => r.id), ["fb-voyah~t_222", "fb-voyah~t_111"]);
  });

  test("an unnamed person is still listed, never hidden", () => {
    const anon = mapConversations(
      { data: [{ id: "aWdf1", participants: { data: [{ id: VOYAH_IG_ID }, { id: "IGSID7" }] }, messages: { data: [] } }] },
      IG_VOYAH,
      [VOYAH_IG_ID, VOYAH_PAGE]
    );
    assert.equal(anon.length, 1);
    assert.equal(anon[0].customerName, "Instagram user");
  });
});

describe("one thread", () => {
  const selfIds = [VOYAH_IG_ID, VOYAH_PAGE];
  const msgs = mapThread(IG_THREAD, "ig-voyah~aWdf", selfIds);

  test("oldest first, malformed entries dropped", () => {
    assert.deepEqual(msgs.map((m) => m.id), ["ig1", "ig2", "ig3"]);
  });

  test("our own messages are ours; the customer's are theirs", () => {
    assert.deepEqual(msgs.map((m) => m.direction), ["in", "in", "out"]);
    assert.equal(msgs[2].author, "staff");
    assert.equal(msgs[2].status, "sent");
  });

  test("a photo with no text is shown as an attachment, not dropped", () => {
    assert.equal(msgs[1].text, NO_TEXT);
  });

  test("the reply goes to the customer, never to ourselves", () => {
    assert.deepEqual(peerOf(IG_THREAD, selfIds), { id: "IGSID9", label: "@rami.k" });
    const onlyUs = { participants: { data: [{ id: VOYAH_IG_ID }, { id: VOYAH_PAGE }] } };
    assert.equal(peerOf(onlyUs, selfIds), null);
  });

  test("the reply window runs from the customer's last message", () => {
    assert.equal(lastCustomerAt(msgs), "2026-09-10T10:01:00.000Z");
    assert.equal(lastCustomerAt(msgs.filter((m) => m.direction === "out")), null);
  });
});

describe("Graph details", () => {
  test("Graph's +0000 timestamps parse", () => {
    assert.equal(graphTime("2026-09-10T09:00:00+0000"), "2026-09-10T09:00:00.000Z");
    assert.equal(graphTime("2026-09-10T12:00:00+0300"), "2026-09-10T09:00:00.000Z");
    assert.equal(graphTime("yesterday"), null);
    assert.equal(graphTime(undefined), null);
  });

  test("errors become words staff can act on", () => {
    assert.match(graphProblem({ error: { code: 190, message: "x" } }, 400), /invalid or has expired/);
    assert.match(graphProblem({ error: { code: 10 } }, 403), /approval/);
    assert.match(graphProblem({ error: { code: 230 } }, 403), /approval/);
    assert.match(graphProblem({ error: { code: 4 } }, 400), /limiting/);
    assert.match(graphProblem({ error: { code: 100, message: "Unknown field" } }, 400), /Meta said: Unknown field/);
    assert.match(graphProblem(null, 500), /HTTP 500/);
  });
});

describe("what the webhook keeps holds no words", () => {
  const SECRET_WORDS = "my number is 70 123 456, is the Free available?";
  const delivery = {
    object: "instagram",
    entry: [
      {
        id: VOYAH_IG_ID,
        time: 1,
        messaging: [
          {
            sender: { id: "IGSID9" },
            recipient: { id: VOYAH_IG_ID },
            timestamp: 1,
            message: { mid: "m.1", text: SECRET_WORDS, attachments: [{ type: "image", payload: { url: "https://x/photo.jpg" } }] },
          },
        ],
      },
    ],
  };

  test("the delivery is kept as its shape only", () => {
    const kept = redactDelivery(delivery);
    assert.deepEqual(kept, { object: "instagram", entries: [{ id: VOYAH_IG_ID, events: 1 }] });
    const text = JSON.stringify(kept);
    assert.ok(!text.includes("Free") && !text.includes("70 123") && !text.includes("photo.jpg"));
  });

  test("the arrival row has an empty body and no attachments", () => {
    const row = inboundIndexRow({
      conversationId: "c1",
      brand: "voyah",
      accountId: "ig-voyah",
      externalMessageId: "m.1",
      at: "2026-09-10T10:00:00.000Z",
    });
    assert.equal(row.body, "");
    assert.deepEqual(row.attachments, []);
    assert.equal(row.external_message_id, "m.1");
    assert.equal(row.direction, "in");
  });
});
