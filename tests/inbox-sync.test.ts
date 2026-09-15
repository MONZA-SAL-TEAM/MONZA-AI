/**
 * The inbox's saved copy: what is merged, when a reload stops asking Meta,
 * what counts as unread, what raises an alert, and what the filters show.
 *
 * Samer, 2026-09-14: the inbox loaded 2,000 conversations on every reload.
 * The stop rule below is what makes a reload one page per account instead.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_VIEW,
  accountIdOf,
  arrivals,
  brandLabel,
  brandOf,
  count,
  dayLabel,
  filterView,
  groupByDay,
  initialsOf,
  isFiltered,
  isUnread,
  mergeConversations,
  mergeOne,
  orderBrands,
  presetRange,
  reachedKnown,
  type InboxAccount,
  type ViewContext,
} from "@/lib/inbox/sync";
import type { Conversation } from "@/lib/inbox/types";

const ACCOUNTS: InboxAccount[] = [
  { id: "ig-voyah", brand: "voyah", channel: "instagram", label: "@voyahlebanon (Instagram)", handle: "@voyahlebanon" },
  { id: "fb-voyah", brand: "voyah", channel: "facebook", label: "Voyah Lebanon (Facebook)", handle: "Voyah Lebanon" },
  { id: "ig-mhero", brand: "mhero", channel: "instagram", label: "@mherolebanon (Instagram)", handle: "@mherolebanon" },
];

function conv(
  id: string,
  at: string,
  over: Partial<Conversation> & { text?: string; direction?: "in" | "out" } = {}
): Conversation {
  const { text = "hello", direction = "in", ...rest } = over;
  const accountId = accountIdOf(id) ?? "ig-voyah";
  return {
    id,
    customerId: "",
    customerName: "@someone",
    channel: accountId.startsWith("fb") ? "facebook" : "instagram",
    channelAddress: `@someone → ${accountId}`,
    assignedTo: null,
    assignedToName: null,
    status: direction === "out" ? "waiting_reply" : "open",
    unreadCount: 0,
    lastMessage: { text, at, direction, author: direction === "out" ? "staff" : "customer" },
    hasAutomatedMessage: false,
    accountId,
    brand: ACCOUNTS.find((a) => a.id === accountId)?.brand,
    ...rest,
  };
}

const map = (...list: Conversation[]) => new Map(list.map((c) => [c.id, c]));

/* The day is the UTC date here, so the tests do not depend on the machine's zone. */
const ctx = (over: Partial<ViewContext> = {}): ViewContext => ({
  accounts: ACCOUNTS,
  seen: {},
  baselineAt: "2026-09-01T00:00:00.000Z",
  dayOf: (iso) => iso.slice(0, 10),
  ...over,
});

describe("merging a page into the saved copy", () => {
  test("a newer row replaces the saved one", () => {
    const old = conv("ig-voyah~a", "2026-09-10T10:00:00.000Z", { text: "old" });
    const fresh = conv("ig-voyah~a", "2026-09-12T10:00:00.000Z", { text: "new" });
    assert.equal(mergeOne(old, fresh).lastMessage.text, "new");
  });

  test("an OLDER row never replaces a newer saved one", () => {
    const saved = conv("ig-voyah~a", "2026-09-12T10:00:00.000Z", { text: "new" });
    const late = conv("ig-voyah~a", "2026-09-10T10:00:00.000Z", { text: "old" });
    assert.equal(mergeOne(saved, late).lastMessage.text, "new");
  });

  test("a lighter list never erases a preview or a real name", () => {
    const saved = conv("ig-voyah~a", "2026-09-12T10:00:00.000Z", { text: "Is the Free available?", customerName: "@rami.k" });
    const lite = conv("ig-voyah~a", "2026-09-12T10:00:00.000Z", { text: "", customerName: "Instagram user" });
    const kept = mergeOne(saved, lite);
    assert.equal(kept.lastMessage.text, "Is the Free available?");
    assert.equal(kept.customerName, "@rami.k");
  });

  test("only rows that actually changed are written back", () => {
    const a = conv("ig-voyah~a", "2026-09-12T10:00:00.000Z");
    const b = conv("ig-voyah~b", "2026-09-11T10:00:00.000Z");
    const { merged, changed } = mergeConversations(map(a, b), [
      { ...a },
      conv("ig-voyah~c", "2026-09-13T10:00:00.000Z"),
    ]);
    assert.deepEqual(changed.map((c) => c.id), ["ig-voyah~c"]);
    assert.equal(merged.size, 3);
  });
});

describe("THE STOP RULE: a reload stops at the first conversation already saved", () => {
  const saved = map(
    conv("ig-voyah~a", "2026-09-12T10:00:00.000Z"),
    conv("ig-voyah~b", "2026-09-11T10:00:00.000Z")
  );

  test("a page of only new activity keeps going", () => {
    assert.equal(
      reachedKnown(saved, [
        conv("ig-voyah~x", "2026-09-14T09:00:00.000Z"),
        conv("ig-voyah~a", "2026-09-14T08:00:00.000Z"), // a has a NEW message
      ]),
      false
    );
  });

  test("an unchanged saved conversation on the page means everything after it is saved", () => {
    assert.equal(
      reachedKnown(saved, [
        conv("ig-voyah~x", "2026-09-14T09:00:00.000Z"),
        conv("ig-voyah~a", "2026-09-12T10:00:00.000Z"),
      ]),
      true
    );
  });

  test("an empty saved copy never stops early", () => {
    assert.equal(reachedKnown(new Map(), [conv("ig-voyah~x", "2026-09-14T09:00:00.000Z")]), false);
  });
});

describe("unread", () => {
  const base = "2026-09-10T00:00:00.000Z";

  test("history from before the first visit is NOT unread", () => {
    assert.equal(isUnread(conv("ig-voyah~a", "2026-09-09T10:00:00.000Z"), undefined, base), false);
  });

  test("a customer message after the baseline is unread until opened", () => {
    const c = conv("ig-voyah~a", "2026-09-12T10:00:00.000Z");
    assert.equal(isUnread(c, undefined, base), true);
    assert.equal(isUnread(c, "2026-09-12T10:00:00.000Z", base), false, "opened");
    assert.equal(isUnread(c, "2026-09-11T10:00:00.000Z", base), true, "opened before it arrived");
  });

  test("our own reply is never unread, nor a row with no preview", () => {
    assert.equal(isUnread(conv("ig-voyah~a", "2026-09-12T10:00:00.000Z", { direction: "out" }), undefined, base), false);
    assert.equal(isUnread(conv("ig-voyah~a", "2026-09-12T10:00:00.000Z", { text: "" }), undefined, base), false);
  });
});

describe("alerts", () => {
  const saved = map(conv("ig-voyah~a", "2026-09-12T10:00:00.000Z"));
  const after = "2026-09-11T00:00:00.000Z";

  test("a new customer message rings, once", () => {
    const fresh = [conv("ig-voyah~a", "2026-09-14T10:00:00.000Z"), conv("ig-voyah~b", "2026-09-14T09:00:00.000Z")];
    assert.deepEqual(arrivals(saved, fresh, after).map((c) => c.id), ["ig-voyah~a", "ig-voyah~b"]);
    const nowSaved = mergeConversations(saved, fresh).merged;
    assert.deepEqual(arrivals(nowSaved, fresh, after), [], "the same page again rings nothing");
  });

  test("our own reply and old history never ring", () => {
    assert.deepEqual(arrivals(saved, [conv("ig-voyah~c", "2026-09-14T10:00:00.000Z", { direction: "out" })], after), []);
    assert.deepEqual(arrivals(new Map(), [conv("ig-voyah~d", "2026-09-01T10:00:00.000Z")], after), []);
  });
});

describe("brands are separate", () => {
  test("a conversation's brand is its account's brand", () => {
    assert.equal(brandOf(conv("ig-mhero~a", "2026-09-12T10:00:00.000Z"), ACCOUNTS), "mhero");
    // Saved before the field existed: the account half of the id still decides.
    const legacy = { ...conv("ig-mhero~a", "2026-09-12T10:00:00.000Z"), brand: undefined, accountId: undefined };
    assert.equal(brandOf(legacy, ACCOUNTS), "mhero");
  });

  test("the brand is NEVER read from what the customer wrote (rule 1)", () => {
    const c = conv("ig-voyah~a", "2026-09-12T10:00:00.000Z", { text: "I want the MHERO" });
    assert.equal(brandOf(c, ACCOUNTS), "voyah");
  });

  test("the MHERO tab shows only MHERO conversations", () => {
    const list = [
      conv("ig-voyah~a", "2026-09-12T10:00:00.000Z"),
      conv("ig-mhero~b", "2026-09-12T11:00:00.000Z"),
      conv("fb-voyah~c", "2026-09-12T12:00:00.000Z"),
    ];
    assert.deepEqual(filterView(list, { ...EMPTY_VIEW, brand: "mhero" }, ctx()).map((c) => c.id), ["ig-mhero~b"]);
    assert.deepEqual(filterView(list, { ...EMPTY_VIEW, brand: "voyah" }, ctx()).map((c) => c.id), ["fb-voyah~c", "ig-voyah~a"]);
  });

  test("brand tabs come in a fixed order", () => {
    assert.deepEqual(orderBrands(["monza", "mhero", "voyah", "mhero"]), ["voyah", "mhero", "monza"]);
    assert.equal(brandLabel("monza"), "MONZA SAL");
  });
});

describe("filters", () => {
  const list = [
    conv("ig-voyah~a", "2026-09-14T10:00:00.000Z"),
    conv("fb-voyah~b", "2026-09-13T10:00:00.000Z", { direction: "out" }),
    conv("ig-mhero~c", "2026-09-05T10:00:00.000Z", { customerName: "@nour.h" }),
    conv("ig-voyah~d", "2026-08-20T10:00:00.000Z"),
  ];

  test("from–to dates keep conversations whose latest message falls inside", () => {
    const v = { ...EMPTY_VIEW, from: "2026-09-05", to: "2026-09-13" };
    assert.deepEqual(filterView(list, v, ctx()).map((c) => c.id), ["fb-voyah~b", "ig-mhero~c"]);
  });

  test("open-ended ranges, and a range typed backwards", () => {
    assert.deepEqual(filterView(list, { ...EMPTY_VIEW, from: "2026-09-13" }, ctx()).map((c) => c.id), ["ig-voyah~a", "fb-voyah~b"]);
    assert.deepEqual(filterView(list, { ...EMPTY_VIEW, to: "2026-08-31" }, ctx()).map((c) => c.id), ["ig-voyah~d"]);
    assert.deepEqual(
      filterView(list, { ...EMPTY_VIEW, from: "2026-09-13", to: "2026-09-05" }, ctx()).map((c) => c.id),
      ["fb-voyah~b", "ig-mhero~c"]
    );
  });

  test("needs a reply, waiting on customer, unread, channel", () => {
    assert.deepEqual(filterView(list, { ...EMPTY_VIEW, show: "waiting" }, ctx()).map((c) => c.id), ["fb-voyah~b"]);
    assert.equal(filterView(list, { ...EMPTY_VIEW, show: "needs_reply" }, ctx()).length, 3);
    assert.deepEqual(
      filterView(list, { ...EMPTY_VIEW, show: "unread" }, ctx({ seen: { "ig-voyah~a": "2026-09-14T10:00:00.000Z" } })).map((c) => c.id),
      ["ig-mhero~c"]
    );
    assert.deepEqual(filterView(list, { ...EMPTY_VIEW, channel: "facebook" }, ctx()).map((c) => c.id), ["fb-voyah~b"]);
  });

  test("search finds a @username", () => {
    assert.deepEqual(filterView(list, { ...EMPTY_VIEW, search: "nour" }, ctx()).map((c) => c.id), ["ig-mhero~c"]);
  });

  test("isFiltered knows when anything is set", () => {
    assert.equal(isFiltered(EMPTY_VIEW), false);
    assert.equal(isFiltered({ ...EMPTY_VIEW, to: "2026-09-01" }), true);
    assert.equal(isFiltered({ ...EMPTY_VIEW, search: "  " }), false);
  });
});

describe("days and display", () => {
  test("date presets count back from today, inclusive", () => {
    assert.deepEqual(presetRange("7d", "2026-09-14"), { from: "2026-09-08", to: "2026-09-14" });
    assert.deepEqual(presetRange("today", "2026-09-14"), { from: "2026-09-14", to: "2026-09-14" });
  });

  test("day labels", () => {
    assert.equal(dayLabel("2026-09-14", "2026-09-14"), "Today");
    assert.equal(dayLabel("2026-09-13", "2026-09-14"), "Yesterday");
    assert.equal(dayLabel("2026-09-01", "2026-09-14"), "1 September 2026");
  });

  test("the list groups under one heading per day", () => {
    const list = [
      conv("ig-voyah~a", "2026-09-14T10:00:00.000Z"),
      conv("ig-voyah~b", "2026-09-14T08:00:00.000Z"),
      conv("ig-voyah~c", "2026-09-12T10:00:00.000Z"),
    ];
    const groups = groupByDay(list, (c) => c.lastMessage.at, (iso) => iso.slice(0, 10), "2026-09-14");
    assert.deepEqual(groups.map((g) => [g.label, g.items.length]), [["Today", 2], ["12 September 2026", 1]]);
  });

  test("initials and counts", () => {
    assert.equal(initialsOf("Rami Kanaan"), "RK");
    assert.equal(initialsOf("@rami.k"), "RK");
    assert.equal(initialsOf("@nour"), "NO");
    assert.equal(initialsOf(""), "?");
    assert.equal(count(2134), "2,134");
  });
});
