/**
 * The unified inbox.
 *
 * Two properties are worth protecting here:
 *
 *  1. A filter's COUNT and the list it opens always agree. They come from one
 *     predicate for exactly this reason — a badge that says 3 over a list of 5
 *     is the oldest inbox bug there is.
 *
 *  2. Channels are a field, not a special case. Every filter, sort and search
 *     works identically on WhatsApp, Instagram and Facebook, which is what
 *     stops the three from drifting back into three products.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  applyFilter,
  conversationsForCustomer,
  countsByFilter,
  matchesFilter,
  searchConversations,
  sortConversations,
  unreadIn,
  type Viewer,
} from "@/lib/inbox/filters";
import {
  DEMO_CONVERSATIONS,
  DEMO_MESSAGES,
  DEMO_STAFF,
  DEMO_VIEWER,
  demoMessagesFor,
} from "@/lib/inbox/demo-conversations";
import {
  CHANNEL_FILTERS,
  FILTER_LABEL,
  INBOX_FILTERS,
  STATUS_LABEL,
  type Conversation,
  type InboxFilter,
} from "@/lib/inbox/types";
import { DEMO_DATASET } from "@/lib/domain/demo-source";
import { CHANNELS } from "@/lib/domain/types";

const viewer: Viewer = DEMO_VIEWER;

function conv(over: Partial<Conversation> = {}): Conversation {
  return {
    id: "c1",
    customerId: "rami-kanaan",
    customerName: "Rami Kanaan",
    channel: "whatsapp",
    channelAddress: "9613100001",
    assignedTo: null,
    assignedToName: null,
    status: "open",
    unreadCount: 0,
    lastMessage: {
      text: "hello",
      at: "2026-08-20T07:42:00Z",
      direction: "in",
      author: "customer",
    },
    hasAutomatedMessage: false,
    ...over,
  };
}

describe("filters", () => {
  test("'all' includes everything, closed conversations included", () => {
    assert.equal(
      applyFilter(DEMO_CONVERSATIONS, "all", viewer).length,
      DEMO_CONVERSATIONS.length
    );
    assert.ok(
      DEMO_CONVERSATIONS.some((c) => c.status === "closed"),
      "the demo needs a closed thread for this to mean anything"
    );
  });

  test("every other filter hides closed conversations", () => {
    const closed = conv({ status: "closed", channel: "whatsapp" });
    for (const filter of INBOX_FILTERS) {
      if (filter === "all") continue;
      assert.equal(
        matchesFilter(closed, filter, viewer),
        false,
        `${filter} should not surface a closed thread`
      );
    }
  });

  test("channel filters select exactly their channel", () => {
    for (const [filter, channel] of Object.entries(CHANNEL_FILTERS)) {
      const shown = applyFilter(
        DEMO_CONVERSATIONS,
        filter as InboxFilter,
        viewer
      );
      assert.ok(shown.every((c) => c.channel === channel), filter);
    }
  });

  test("the channel filters cover every channel the product supports", () => {
    assert.deepEqual(
      Object.values(CHANNEL_FILTERS).sort(),
      [...CHANNELS].sort(),
      "a new channel needs a filter, or it becomes invisible"
    );
  });

  test("'unassigned' is exactly the threads nobody has picked up", () => {
    const shown = applyFilter(DEMO_CONVERSATIONS, "unassigned", viewer);
    assert.ok(shown.length > 0);
    assert.ok(shown.every((c) => c.assignedTo === null));
  });

  test("'mine' depends on who is looking", () => {
    const lara = applyFilter(DEMO_CONVERSATIONS, "mine", {
      staffId: "staff-lara",
    });
    const kareem = applyFilter(DEMO_CONVERSATIONS, "mine", {
      staffId: "staff-kareem",
    });
    assert.ok(lara.every((c) => c.assignedTo === "staff-lara"));
    assert.ok(kareem.every((c) => c.assignedTo === "staff-kareem"));
    assert.notDeepEqual(
      lara.map((c) => c.id),
      kareem.map((c) => c.id)
    );
  });

  test("'mine' shows nothing to a staff member with no threads", () => {
    assert.deepEqual(
      applyFilter(DEMO_CONVERSATIONS, "mine", { staffId: "staff-nobody" }),
      []
    );
  });

  test("'waiting for reply' and 'follow-up' select their status", () => {
    assert.ok(
      applyFilter(DEMO_CONVERSATIONS, "waiting_reply", viewer).every(
        (c) => c.status === "waiting_reply"
      )
    );
    assert.ok(
      applyFilter(DEMO_CONVERSATIONS, "follow_up", viewer).every(
        (c) => c.status === "follow_up"
      )
    );
  });

  test("'automated' selects threads an automation has written in", () => {
    const shown = applyFilter(DEMO_CONVERSATIONS, "automated", viewer);
    assert.ok(shown.length > 0);
    for (const c of shown) {
      assert.ok(
        demoMessagesFor(c.id).some((m) => m.author === "automation"),
        c.id
      );
    }
  });
});

describe("counts always agree with the lists they label", () => {
  test("every filter's count equals its list length", () => {
    const counts = countsByFilter(DEMO_CONVERSATIONS, viewer);
    for (const filter of INBOX_FILTERS) {
      assert.equal(
        counts[filter],
        applyFilter(DEMO_CONVERSATIONS, filter, viewer).length,
        filter
      );
    }
  });

  test("counts are viewer-specific where the filter is", () => {
    const lara = countsByFilter(DEMO_CONVERSATIONS, { staffId: "staff-lara" });
    const kareem = countsByFilter(DEMO_CONVERSATIONS, {
      staffId: "staff-kareem",
    });
    assert.equal(lara.all, kareem.all, "'all' cannot depend on the viewer");
    assert.notEqual(lara.mine, kareem.mine);
  });

  test("an empty inbox counts zero everywhere without throwing", () => {
    const counts = countsByFilter([], viewer);
    for (const filter of INBOX_FILTERS) assert.equal(counts[filter], 0, filter);
  });

  test("unread totals are scoped to the filter", () => {
    assert.equal(
      unreadIn(DEMO_CONVERSATIONS, "all", viewer),
      DEMO_CONVERSATIONS.reduce((n, c) => n + c.unreadCount, 0)
    );
    assert.ok(unreadIn(DEMO_CONVERSATIONS, "instagram", viewer) >= 0);
  });
});

describe("sorting", () => {
  test("newest activity first", () => {
    const sorted = sortConversations(DEMO_CONVERSATIONS);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(
        sorted[i - 1].lastMessage.at >= sorted[i].lastMessage.at,
        `${sorted[i - 1].id} before ${sorted[i].id}`
      );
    }
  });

  test("the order is total and stable when timestamps tie", () => {
    const at = "2026-08-20T07:42:00Z";
    const tied = [
      conv({ id: "c-b", lastMessage: { ...conv().lastMessage, at } }),
      conv({ id: "c-a", lastMessage: { ...conv().lastMessage, at } }),
      conv({ id: "c-c", lastMessage: { ...conv().lastMessage, at } }),
    ];
    assert.deepEqual(
      sortConversations(tied).map((c) => c.id),
      ["c-a", "c-b", "c-c"]
    );
    // Sorting the already-sorted list must not reshuffle it.
    assert.deepEqual(
      sortConversations(sortConversations(tied)).map((c) => c.id),
      ["c-a", "c-b", "c-c"]
    );
  });

  test("sorting does not mutate the input", () => {
    const before = DEMO_CONVERSATIONS.map((c) => c.id);
    sortConversations(DEMO_CONVERSATIONS);
    assert.deepEqual(
      DEMO_CONVERSATIONS.map((c) => c.id),
      before
    );
  });
});

describe("search", () => {
  test("finds by customer name, case-insensitively", () => {
    assert.ok(searchConversations(DEMO_CONVERSATIONS, "rami").length > 0);
    assert.ok(searchConversations(DEMO_CONVERSATIONS, "RAMI").length > 0);
  });

  test("finds by phone number however it is punctuated", () => {
    const spaced = searchConversations(DEMO_CONVERSATIONS, "+961 3 100 001");
    assert.ok(spaced.length > 0);
    assert.ok(spaced.every((c) => c.channelAddress.includes("9613100001")));
  });

  test("finds by words in the last message", () => {
    // Rami's newest message; the thread's own last line, not an earlier one.
    assert.ok(searchConversations(DEMO_CONVERSATIONS, "payments").length > 0);
  });

  test("an empty search returns everything", () => {
    assert.equal(
      searchConversations(DEMO_CONVERSATIONS, "   ").length,
      DEMO_CONVERSATIONS.length
    );
  });

  test("a two-digit query is not treated as a phone search", () => {
    assert.equal(searchConversations(DEMO_CONVERSATIONS, "96").length, 0);
  });

  test("nonsense finds nothing rather than everything", () => {
    assert.equal(searchConversations(DEMO_CONVERSATIONS, "zzzzzz").length, 0);
  });
});

describe("one person, several threads", () => {
  test("a customer's WhatsApp and Instagram threads are separate", () => {
    const rami = conversationsForCustomer(DEMO_CONVERSATIONS, "rami-kanaan");
    assert.equal(rami.length, 2, "separate places, or replies get lost");
    assert.deepEqual(
      rami.map((c) => c.channel).sort(),
      ["instagram", "whatsapp"]
    );
  });

  test("but they are all reachable from the one customer id", () => {
    const rami = conversationsForCustomer(DEMO_CONVERSATIONS, "rami-kanaan");
    assert.ok(rami.every((c) => c.customerId === "rami-kanaan"));
  });

  test("an unknown customer has no threads", () => {
    assert.deepEqual(conversationsForCustomer(DEMO_CONVERSATIONS, "nobody"), []);
  });
});

describe("the demo inbox is consistent with the canon", () => {
  test("every conversation belongs to a real demo customer", () => {
    for (const c of DEMO_CONVERSATIONS) {
      const known = DEMO_DATASET.customers.find((x) => x.id === c.customerId);
      assert.ok(known, c.customerId);
      assert.equal(c.customerName, known.name);
    }
  });

  test("every channel address is one the customer actually has", () => {
    for (const c of DEMO_CONVERSATIONS) {
      const known = DEMO_DATASET.customers.find((x) => x.id === c.customerId);
      assert.ok(
        known?.handles.some(
          (h) => h.channel === c.channel && h.address === c.channelAddress
        ),
        `${c.id}: ${c.channel} ${c.channelAddress}`
      );
    }
  });

  test("every assignment names a real staff member", () => {
    for (const c of DEMO_CONVERSATIONS) {
      if (c.assignedTo === null) {
        assert.equal(c.assignedToName, null, c.id);
        continue;
      }
      const staff = DEMO_STAFF.find((s) => s.id === c.assignedTo);
      assert.ok(staff, c.assignedTo);
      assert.equal(c.assignedToName, staff.name);
    }
  });

  test("the last message really is the last one in the thread", () => {
    for (const c of DEMO_CONVERSATIONS) {
      const mine = demoMessagesFor(c.id);
      assert.ok(mine.length > 0, c.id);
      const last = mine[mine.length - 1];
      assert.equal(c.lastMessage.at, last.at, c.id);
      assert.equal(c.lastMessage.text, last.text, c.id);
      assert.equal(c.lastMessage.author, last.author, c.id);
    }
  });

  test("messages within a thread are in chronological order", () => {
    for (const c of DEMO_CONVERSATIONS) {
      const mine = demoMessagesFor(c.id);
      for (let i = 1; i < mine.length; i++) {
        assert.ok(mine[i - 1].at <= mine[i].at, `${c.id} message ${i}`);
      }
    }
  });

  test("hasAutomatedMessage matches the thread's actual messages", () => {
    for (const c of DEMO_CONVERSATIONS) {
      assert.equal(
        c.hasAutomatedMessage,
        demoMessagesFor(c.id).some((m) => m.author === "automation"),
        c.id
      );
    }
  });

  test("every automated message names the automation that sent it", () => {
    for (const m of DEMO_MESSAGES) {
      if (m.author === "automation") {
        assert.ok(m.automationId, m.id);
        assert.equal(m.direction, "out", "automations never receive");
      }
    }
  });

  test("incoming messages are never attributed to staff or automation", () => {
    for (const m of DEMO_MESSAGES) {
      if (m.direction === "in") {
        assert.equal(m.author, "customer", m.id);
        assert.equal(m.status, "received", m.id);
      }
    }
  });

  test("all three channels are represented, and every filter has a use", () => {
    const counts = countsByFilter(DEMO_CONVERSATIONS, viewer);
    for (const filter of INBOX_FILTERS) {
      assert.ok(counts[filter] > 0, `${filter} has no demo example`);
    }
  });
});

describe("labels", () => {
  test("every filter and status has plain words for the screen", () => {
    for (const filter of INBOX_FILTERS) {
      assert.ok(FILTER_LABEL[filter], filter);
      assert.doesNotMatch(FILTER_LABEL[filter], /_/, filter);
    }
    for (const label of Object.values(STATUS_LABEL)) {
      assert.doesNotMatch(label, /_/);
    }
  });
});
