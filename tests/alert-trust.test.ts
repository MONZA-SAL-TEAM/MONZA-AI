/**
 * Alerts a person can trust (Samer, 2026-11-25): every open alert is ONE of six things, with
 * evidence; who is genuinely waiting; nine conversation classes; a test-drive request's lifecycle;
 * who gets a new lead. All pure — the audited production cases are the fixtures.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { apiRuleOf } from "@/lib/access/access";
import { reconcileAlerts, countVerdicts, AUTO_CLOSE, isCloseReason, type AlertFact, type ChatFact } from "@/lib/alerts/reconcile";
import { classOf, isActionable, isHighIntent } from "@/lib/alerts/intent";
import { waitingRows, summariseWaiting, loadByOwner } from "@/lib/alerts/waiting";
import { changeProblem, needsAction, statusFromAlert, isOpenStatus } from "@/lib/testdrives/lifecycle";
import { chooseAssignee, type AssignmentRule } from "@/lib/alerts/assign";
import { messagingKinds, parseMetaEchoes } from "@/lib/channels/echoes";

const NOW = Date.parse("2026-11-25T10:00:00Z");
const alert = (id: string, conv: string, kind: string, createdAt: string, tags: string[] = []): AlertFact =>
  ({ id, conversationId: conv, kind: kind as never, tags: tags as never, createdAt });
const chat = (id: string, over: Partial<ChatFact> = {}): ChatFact =>
  ({ conversationId: id, stored: true, lastCustomerAt: "2026-11-24T09:00:00Z", lastPersonAt: null, waitingSince: "2026-11-24T09:00:00Z", everAnswered: false, ...over });
const verdictOf = (alerts: AlertFact[], chats: ChatFact[]) =>
  Object.fromEntries(reconcileAlerts(alerts, new Map(chats.map((c) => [c.conversationId, c])), NOW).map((v) => [v.alertId, v]));

describe("what an open alert really is", () => {
  test("the customer wrote last in a chat we can see → waiting", () => {
    const v = verdictOf([alert("a", "c1", "PRICE", "2026-11-24T09:00:00Z")], [chat("c1")]);
    assert.equal(v.a.verdict, "waiting");
    assert.equal(v.a.evidence, "customer_wrote_last");
  });

  test("a person replied after the alert and we spoke last → answered; the bot's reply is not a person's", () => {
    const answered = verdictOf([alert("a", "c1", "PRICE", "2026-11-24T09:00:00Z")], [chat("c1", { lastPersonAt: "2026-11-24T09:30:00Z", waitingSince: null, everAnswered: true })]);
    assert.equal(answered.a.verdict, "answered");
    // lastPersonAt is null when only the bot wrote: still waiting.
    assert.equal(verdictOf([alert("a", "c1", "PRICE", "2026-11-24T09:00:00Z")], [chat("c1")]).a.verdict, "waiting");
  });

  test("a reply BEFORE the alert was raised is not an answer to it", () => {
    const v = verdictOf([alert("a", "c1", "PRICE", "2026-11-24T09:00:00Z")], [chat("c1", { lastPersonAt: "2026-11-23T09:00:00Z", everAnswered: true })]);
    assert.equal(v.a.verdict, "waiting");
  });

  test("answered, then the customer wrote again → waiting again (the alert is not closed under them)", () => {
    const v = verdictOf(
      [alert("a", "c1", "PRICE", "2026-11-23T09:00:00Z")],
      [chat("c1", { lastPersonAt: "2026-11-23T10:00:00Z", lastCustomerAt: "2026-11-25T08:00:00Z", waitingSince: "2026-11-25T08:00:00Z", everAnswered: true })]
    );
    assert.equal(v.a.verdict, "waiting");
  });

  test("a test drive, a call, a sale, a trade-in: answered is not done → follow-up (86 of 89 test-drive alerts, 2026-11-25)", () => {
    for (const kind of ["TEST_DRIVE", "CALLBACK", "BUYING", "TRADE_IN"]) {
      const v = verdictOf([alert("a", "c1", kind, "2026-11-24T09:00:00Z")], [chat("c1", { lastPersonAt: "2026-11-24T09:30:00Z", waitingSince: null, everAnswered: true })]);
      assert.equal(v.a.verdict, "follow_up", kind);
      assert.equal(v.a.evidence, "person_replied_outcome_open");
    }
  });

  test("a second alert in the same chat is a duplicate of the newest, and its reasons are not lost", () => {
    const v = verdictOf(
      [alert("old", "c1", "TEST_DRIVE", "2026-11-20T09:00:00Z"), alert("new", "c1", "PRICE", "2026-11-24T09:00:00Z")],
      [chat("c1", { lastPersonAt: "2026-11-24T10:00:00Z", waitingSince: null, everAnswered: true })]
    );
    assert.equal(v.old.verdict, "duplicate");
    assert.equal(v.old.survivorId, "new");
    // PRICE alone would close; the chat's open TEST_DRIVE keeps it a follow-up.
    assert.equal(v.new.verdict, "follow_up");
  });

  test("Instagram / Facebook with no visible reply is UNVERIFIED — never answered, never waiting", () => {
    const v = verdictOf([alert("a", "ig1", "NEEDS_PERSON", "2026-11-10T09:00:00Z")], [chat("ig1", { stored: false, lastCustomerAt: "2026-11-10T09:00:00Z" })]);
    assert.equal(v.a.verdict, "unverified");
    assert.equal(v.a.evidence, "our_side_not_visible");
    // …but when Meta's own history shows our reply after it, that IS evidence.
    const seen = verdictOf([alert("a", "ig1", "NEEDS_PERSON", "2026-11-10T09:00:00Z")], [chat("ig1", { stored: false, lastCustomerAt: "2026-11-10T09:00:00Z", lastPersonAt: "2026-11-10T11:00:00Z", waitingSince: null, everAnswered: true })]);
    assert.equal(seen.a.verdict, "answered");
  });

  test("silent for over 30 days and never answered → historical, not chased and not closed", () => {
    const v = verdictOf([alert("a", "c1", "NEEDS_PERSON", "2026-10-01T09:00:00Z")], [chat("c1", { lastCustomerAt: "2026-10-01T09:00:00Z", waitingSince: "2026-10-01T09:00:00Z" })]);
    assert.equal(v.a.verdict, "historical");
    assert.equal(AUTO_CLOSE.historical, undefined);
    assert.equal(AUTO_CLOSE.unverified, undefined);
    assert.equal(AUTO_CLOSE.waiting, undefined);
    assert.equal(AUTO_CLOSE.follow_up, undefined);
  });

  test("only answered and duplicate close by themselves; an alert with no known chat is left alone", () => {
    assert.deepEqual(Object.keys(AUTO_CLOSE).sort(), ["answered", "duplicate"]);
    assert.deepEqual(reconcileAlerts([alert("a", "ghost", "PRICE", "2026-11-24T09:00:00Z")], new Map(), NOW), []);
    assert.equal(isCloseReason("answered_elsewhere"), true);
    assert.equal(isCloseReason("because"), false);
  });

  test("counts add up", () => {
    const verdicts = reconcileAlerts(
      [alert("a", "c1", "PRICE", "2026-11-24T09:00:00Z"), alert("b", "c1", "PRICE", "2026-11-23T09:00:00Z"), alert("c", "c2", "PRICE", "2026-11-24T09:00:00Z")],
      new Map([["c1", chat("c1")], ["c2", chat("c2", { stored: false })]]),
      NOW
    );
    const c = countVerdicts(verdicts);
    assert.deepEqual([c.total, c.chats, c.waiting, c.duplicate, c.unverified], [3, 2, 1, 1, 1]);
  });
});

describe("nine conversation classes", () => {
  test("what the customer is trying to do beats who they are; a person's correction beats everything", () => {
    assert.equal(classOf({ alertKinds: ["BUYING"], intents: ["OWNER_ISSUE"] }).class, "ready_to_buy");
    assert.equal(classOf({ alertKinds: ["TEST_DRIVE", "PRICE"], intents: [] }).class, "test_drive");
    assert.equal(classOf({ alertKinds: ["NEEDS_PERSON"], intents: ["SERVICE"] }).class, "after_sales");
    assert.equal(classOf({ alertKinds: ["PRICE"], intents: [] }).class, "interested");
    assert.equal(classOf({ alertKinds: ["NEEDS_PERSON"], intents: [], ownerSupport: true }).class, "existing_customer");
    assert.equal(classOf({ alertKinds: ["NEEDS_PERSON"], intents: ["GENERAL_INFO"] }).class, "general");
    const fixed = classOf({ override: "spam", alertKinds: ["BUYING"], intents: [] });
    assert.deepEqual(fixed, { class: "spam", source: "person" });
  });

  test("spam, suppliers and no-action are nobody's work; buying and test drives are high intent", () => {
    assert.equal(isActionable("spam"), false);
    assert.equal(isActionable("supplier"), false);
    assert.equal(isActionable("no_action"), false);
    assert.equal(isActionable("after_sales"), true);
    assert.equal(isHighIntent("ready_to_buy") && isHighIntent("test_drive"), true);
    assert.equal(isHighIntent("interested"), false);
  });
});

describe("who is waiting, and for how long", () => {
  const w = (id: string, since: string, last: string, over: Record<string, unknown> = {}) =>
    ({ conversationId: id, waitingSince: since, lastCustomerAt: last, neverAnswered: true, class: "interested" as const, ownerId: null, ownerName: null, ...over });

  test("inside the free-reply window first, high intent first, the one about to lose the window first", () => {
    const rows = waitingRows(
      [
        w("old", "2026-11-20T10:00:00Z", "2026-11-20T10:00:00Z"),
        w("fresh", "2026-11-25T09:00:00Z", "2026-11-25T09:00:00Z"),
        w("closing", "2026-11-24T11:00:00Z", "2026-11-24T11:00:00Z"),
        w("buyer", "2026-11-25T08:00:00Z", "2026-11-25T08:00:00Z", { class: "ready_to_buy" }),
      ],
      NOW
    );
    assert.deepEqual(rows.map((r) => r.conversationId), ["buyer", "closing", "fresh", "old"]);
    assert.equal(rows[1].windowHoursLeft, 1);
    assert.equal(rows[3].inWindow, false);
    assert.equal(rows[3].waitingHours, 120);
  });

  test("the window counts from the customer's LATEST message; the wait from the FIRST unanswered one", () => {
    const [r] = waitingRows([w("c", "2026-11-22T10:00:00Z", "2026-11-25T09:30:00Z")], NOW);
    assert.equal(r.inWindow, true);
    assert.equal(r.waitingHours, 72);
  });

  test("the summary is counts only; unowned work is its own row", () => {
    const rows = waitingRows(
      [
        w("a", "2026-11-25T09:00:00Z", "2026-11-25T09:00:00Z", { class: "ready_to_buy" }),
        w("b", "2026-11-20T09:00:00Z", "2026-11-20T09:00:00Z", { neverAnswered: false, ownerId: "u1", ownerName: "Rami" }),
        w("c", "2026-11-23T09:00:00Z", "2026-11-23T09:00:00Z", { class: "test_drive", ownerId: "u1", ownerName: "Rami" }),
      ],
      NOW
    );
    const s = summariseWaiting(rows);
    assert.deepEqual([s.total, s.inWindow, s.outsideWindow, s.highIntent, s.highIntentInWindow, s.newCustomers, s.existingConversations, s.unowned], [3, 1, 2, 2, 1, 2, 1, 1]);
    assert.equal(JSON.stringify(s).includes("Rami"), false);
    const load = loadByOwner(rows);
    assert.deepEqual(load.map((l) => [l.ownerName, l.waiting, l.highIntentWaiting, l.overdue]), [["Rami", 2, 1, 2], ["Nobody", 1, 1, 0]]);
  });
});

describe("a test-drive request", () => {
  test("from the backlog: answered → contacted, not answered → requested, never booked", () => {
    assert.equal(statusFromAlert(true), "contacted");
    assert.equal(statusFromAlert(false), "requested");
  });

  test("a booking needs a time, a car and a salesperson; only a booked drive is completed or missed", () => {
    assert.match(changeProblem("contacted", { to: "booked" }, NOW)!, /date and time/);
    assert.match(changeProblem("contacted", { to: "booked", slotAt: "2026-11-26T09:00:00Z" }, NOW)!, /car/);
    assert.match(changeProblem("contacted", { to: "booked", slotAt: "2026-11-26T09:00:00Z", vehicle: "FREE" }, NOW)!, /salesperson/);
    assert.equal(changeProblem("contacted", { to: "booked", slotAt: "2026-11-26T09:00:00Z", vehicle: "FREE", salespersonId: "u1" }, NOW), null);
    assert.match(changeProblem("contacted", { to: "completed", nextAction: "none" }, NOW)!, /booked/);
    assert.match(changeProblem("booked", { to: "completed" }, NOW)!, /next/);
    assert.equal(changeProblem("booked", { to: "completed", nextAction: "send_proposal" }, NOW), null);
    assert.equal(changeProblem("booked", { to: "no_show" }, NOW), null);
  });

  test("an outcome is final until a person reopens it", () => {
    assert.match(changeProblem("declined", { to: "contacted" }, NOW)!, /Reopen/);
    assert.equal(changeProblem("declined", { to: "requested" }, NOW), null);
    assert.equal(isOpenStatus("booked"), true);
    assert.equal(isOpenStatus("no_show"), false);
  });

  test("the brief counts only what is ours to do: not contacted, or a past booking with no outcome", () => {
    assert.equal(needsAction({ status: "requested", slotAt: null }, NOW), "not_contacted");
    assert.equal(needsAction({ status: "contacted", slotAt: null }, NOW), null);
    assert.equal(needsAction({ status: "awaiting_confirmation", slotAt: null }, NOW), null);
    assert.equal(needsAction({ status: "booked", slotAt: "2026-11-26T09:00:00Z" }, NOW), null);
    assert.equal(needsAction({ status: "booked", slotAt: "2026-11-24T09:00:00Z" }, NOW), "outcome_missing");
    assert.equal(needsAction({ status: "completed", slotAt: "2026-11-24T09:00:00Z" }, NOW), null);
  });
});

describe("who gets a new lead", () => {
  const rule = (staffId: string, over: Partial<AssignmentRule> = {}): AssignmentRule => ({ staffId, staffName: staffId.toUpperCase(), brand: null, channel: null, weight: 1, active: true, ...over });

  test("no rules → nobody: the product never picks a person on its own", () => {
    assert.equal(chooseAssignee([], { brand: "voyah", channel: "whatsapp" }, {}), null);
    assert.equal(chooseAssignee([rule("a", { active: false })], { brand: "voyah", channel: "whatsapp" }, {}), null);
  });

  test("the least loaded for their weight; a brand rule beats a general one", () => {
    const rules = [rule("a"), rule("b", { weight: 2 })];
    assert.equal(chooseAssignee(rules, { brand: "voyah", channel: "whatsapp" }, { a: 2, b: 2 })?.staffId, "b");
    assert.equal(chooseAssignee(rules, { brand: "voyah", channel: "whatsapp" }, { a: 1, b: 4 })?.staffId, "a");
    const withBrand = [...rules, rule("m", { brand: "mhero" })];
    assert.equal(chooseAssignee(withBrand, { brand: "mhero", channel: "instagram" }, { m: 50 })?.staffId, "m");
    assert.notEqual(chooseAssignee(withBrand, { brand: "voyah", channel: "instagram" }, {})?.staffId, "m");
  });
});

describe("the wiring keeps its promises", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  test("one open alert per chat no longer looks back only 24 hours (81 duplicates, 2026-11-25)", () => {
    const src = read("lib/wasales/sales-ops.ts");
    assert.equal(src.includes("sinceAny"), false);
    assert.match(src, /action: "raised"/);
  });

  test("the reconciliation never reads or returns a customer's words", () => {
    for (const p of ["lib/alerts/reconcile-server.ts", "app/api/insights/alerts/route.ts", "database/migrations/033_alert_trust.sql"]) {
      const src = read(p);
      assert.equal(/\bbody\b(?!\.)/.test(src.replace(/const body = [^\n]+/g, "").replace(/!body\b/g, "")), false, p);
      assert.equal(src.includes("message_body"), false, p);
    }
    // Only a person's message counts as an answer — never the bot's.
    assert.match(read("database/migrations/033_alert_trust.sql"), /m\.direction = 'out' and m\.author = 'staff'/);
  });

  test("every write is conditional on the alert still being open, and only two verdicts close by themselves", () => {
    const src = read("lib/alerts/reconcile-server.ts");
    const closes = src.match(/status: "done"/g) ?? [];
    const guarded = src.match(/\.eq\("status", "open"\)/g) ?? [];
    assert.ok(guarded.length >= closes.length);
    assert.equal(/verdict === "(unverified|historical|waiting)"[^\n]*status: "done"/.test(src), false);
  });

  test("the nightly job changes nothing unless ALERT_RECONCILE_MODE is exactly \"apply\"", () => {
    assert.match(read("app/api/insights/refresh/route.ts"), /if \(alertReconcileApplies\(\)\) alerts = await applyReconcile\(null\)/);
    assert.match(read("lib/env.ts"), /read\("ALERT_RECONCILE_MODE"\) === "apply"/);
  });

  test("the brief's feed gives live counts and no identity; the new routes are gated like their neighbours", () => {
    const feed = read("app/api/brief/decisions/route.ts");
    assert.match(feed, /waiting: snap\.waitingSummary/);
    assert.equal(/customerName|customer_name|threadId|conversationId/.test(feed), false);
    assert.deepEqual(apiRuleOf("/api/insights/alerts", "GET"), { page: "insights" });
    assert.equal(apiRuleOf("/api/insights/alerts", "POST")?.action, "edit_insights");
    assert.equal(apiRuleOf("/api/sales/test-drives/requests", "POST")?.action, "manage_test_drives");
    assert.match(read("app/insights/alerts/page.tsx"), /requireInsightsAccess\("\/insights\/alerts"\)/);
  });

  test("034 is not applied with 033: it cannot be built while duplicates exist", () => {
    assert.match(read("database/migrations/034_one_open_alert_per_chat.sql"), /APPLY ONLY AFTER THE FIRST RECONCILIATION/);
    assert.equal(read("database/migrations/033_alert_trust.sql").includes("sales_alerts_one_open_per_chat"), false);
  });
});

describe("our own Instagram and Facebook replies, as turns", () => {
  const accounts = [
    { id: "ig-voyah", channel: "instagram", externalId: "17841457996874250", brand: "voyah" },
    { id: "fb-voyah", channel: "facebook", externalId: "408893845643871", brand: "voyah" },
  ] as never;
  const echo = (object: string, account: string, to: string, extra: Record<string, unknown> = {}) => ({
    object,
    entry: [{ id: account, messaging: [{ sender: { id: account }, recipient: { id: to }, timestamp: 1795600000000, message: { mid: "m_1", is_echo: true, text: "SECRET WORDS", ...extra } }] }],
  });

  test("an echo becomes a turn: which account, to whom, when — never the words", () => {
    const turns = parseMetaEchoes(echo("instagram", "17841457996874250", "998877665544"), accounts);
    assert.deepEqual(turns, [{ accountId: "ig-voyah", channel: "instagram", peerExternalId: "998877665544", externalMessageId: "m_1", at: new Date(1795600000000).toISOString() }]);
    assert.equal(JSON.stringify(turns).includes("SECRET"), false);
    assert.equal(parseMetaEchoes(echo("page", "408893845643871", "5544332211"), accounts)[0].accountId, "fb-voyah");
  });

  test("a customer's message, an unknown account and another brand's envelope are not our turns", () => {
    const inbound = { object: "instagram", entry: [{ id: "17841457996874250", messaging: [{ sender: { id: "998877665544" }, recipient: { id: "17841457996874250" }, timestamp: 1, message: { mid: "m_2", text: "hi" } }] }] };
    assert.deepEqual(parseMetaEchoes(inbound, accounts), []);
    assert.deepEqual(parseMetaEchoes(echo("instagram", "11111111", "998877665544"), accounts), []);
    // The envelope decides the channel: an Instagram account id inside a "page" delivery is nobody's.
    assert.deepEqual(parseMetaEchoes(echo("page", "17841457996874250", "998877665544"), accounts), []);
    assert.deepEqual(parseMetaEchoes({ object: "whatsapp_business_account", entry: [] }, accounts), []);
  });

  test("the delivery record names what each event was, by Meta's structure only", () => {
    const entry = { messaging: [{ message: { mid: "a", is_echo: true } }, { message: { mid: "b", text: "x" } }, { read: { mid: "c" } }, { reaction: {} }, { postback: {} }, {}] };
    assert.deepEqual(messagingKinds(entry), ["echo", "message", "read", "reaction", "postback", "other"]);
  });

  test("an echo is recorded as a turn and still never stored as a message (rule 19)", () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    assert.match(read("lib/channels/instagram.ts"), /if \(message\.is_echo === true\) continue;/);
    assert.match(read("lib/channels/messenger.ts"), /if \(message\.is_echo === true\) continue;/);
    const store = read("lib/channels/store.ts");
    const fn = store.slice(store.indexOf("export async function recordEchoTurns"), store.indexOf("export async function recordEchoTurns") + 1400);
    assert.match(fn, /from\("channel_turns"\)/);
    assert.equal(fn.includes("channel_messages"), false);
  });
});
