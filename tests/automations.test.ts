/**
 * The automation engine.
 *
 * The failure everyone actually fears here is sending a customer the same
 * reminder twice — or three times, because a job re-ran. Most of this file is
 * about that: stable event ids, idempotency keys, and a history that only
 * counts a real send as done.
 *
 * The second theme is that nothing fires by accident: an automation that is
 * switched off does nothing, a trigger only matches its own events, and a
 * message with no valid template is never sent.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_ATTEMPTS,
  completedKeys,
  evaluate,
  idempotencyKeyFor,
  nextAttemptNumber,
  recordAttempt,
  shouldRetry,
  summarise,
  triggerMatches,
} from "@/lib/automations/engine";
import {
  EXTENDED_OVERDUE_DAYS,
  PAID_CONFIRMATION_WINDOW_DAYS,
  REMINDER_DAYS_BEFORE,
  collectEvents,
  daysBetween,
  eventsForInstallment,
  eventsForVehicle,
} from "@/lib/automations/events";
import { DEFAULT_AUTOMATIONS } from "@/lib/automations/catalog";
import {
  allTemplates,
  findTemplate,
  renderTemplate,
  templateIds,
} from "@/lib/automations/templates";
import type {
  Automation,
  DomainEvent,
  ExecutionRecord,
} from "@/lib/automations/types";
import type { Installment, Vehicle } from "@/lib/domain/types";

const TODAY = "2026-08-20";

/** ISO date, N days before `iso`. Local to the tests; no clock is read. */
function shiftBack(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function installment(over: Partial<Installment> = {}): Installment {
  return {
    id: "plan-rami-6",
    planId: "plan-rami",
    customerId: "rami-kanaan",
    vehicleId: "veh-rami-kanaan",
    number: 6,
    totalCount: 20,
    amountUsd: 1550,
    dueDate: "2026-08-27",
    status: "upcoming",
    paidDate: null,
    receiptRef: null,
    ...over,
  };
}

function vehicle(over: Partial<Vehicle> = {}): Vehicle {
  return {
    id: "veh-rami-kanaan",
    customerId: "rami-kanaan",
    label: "Voyah Free 2025",
    vin: "LDNVYAFR8SD210457",
    plate: "B 123456",
    status: "ready_for_pickup",
    jobReference: "GJ-2026-0142",
    awaitingPart: null,
    ...over,
  };
}

function automation(over: Partial<Automation> = {}): Automation {
  return {
    id: "test-automation",
    name: "Test",
    description: "",
    enabled: true,
    trigger: { kind: "vehicle.ready_for_pickup" },
    actions: [
      { kind: "send_message", templateId: "vehicle.ready_for_pickup" },
    ],
    ...over,
  };
}

describe("daysBetween", () => {
  test("counts whole days in both directions", () => {
    assert.equal(daysBetween("2026-08-20", "2026-08-27"), 7);
    assert.equal(daysBetween("2026-08-27", "2026-08-20"), -7);
    assert.equal(daysBetween("2026-08-20", "2026-08-20"), 0);
  });

  test("crosses months and years", () => {
    assert.equal(daysBetween("2026-08-30", "2026-09-02"), 3);
    assert.equal(daysBetween("2026-12-31", "2027-01-01"), 1);
  });

  test("is unaffected by daylight saving, being date-only UTC", () => {
    assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2);
    assert.equal(daysBetween("2026-10-24", "2026-10-26"), 2);
  });
});

describe("events are derived from stable facts, never from the clock", () => {
  test("a 7-day reminder fires exactly 7 days before", () => {
    const events = eventsForInstallment(
      installment({ dueDate: "2026-08-27" }),
      TODAY
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "installment.due_soon");
    assert.equal(events[0].data.daysBefore, 7);
  });

  test("no reminder on a day that is not a reminder window", () => {
    assert.deepEqual(
      eventsForInstallment(installment({ dueDate: "2026-08-25" }), TODAY),
      []
    );
  });

  test("both reminder windows exist and produce DIFFERENT ids", () => {
    const seven = eventsForInstallment(
      installment({ dueDate: "2026-08-27" }),
      TODAY
    )[0];
    const three = eventsForInstallment(
      installment({ dueDate: "2026-08-23" }),
      TODAY
    )[0];
    assert.equal(three.data.daysBefore, 3);
    assert.notEqual(seven.id, three.id, "both reminders must be able to fire");
    assert.deepEqual([...REMINDER_DAYS_BEFORE], [7, 3]);
  });

  test("due today is its own event", () => {
    const events = eventsForInstallment(
      installment({ dueDate: TODAY, status: "due" }),
      TODAY
    );
    assert.equal(events[0].kind, "installment.due_today");
  });

  test("THE ANTI-NAG RULE: an overdue id does not change as days pass", () => {
    // If the day count were in the id, the customer would be chased every
    // single morning — a new "occurrence" each time.
    const day1 = eventsForInstallment(
      installment({ dueDate: "2026-08-19", status: "overdue" }),
      "2026-08-20"
    ).find((e) => e.kind === "installment.overdue");
    const day9 = eventsForInstallment(
      installment({ dueDate: "2026-08-19", status: "overdue" }),
      "2026-08-28"
    ).find((e) => e.kind === "installment.overdue");
    assert.equal(day1?.id, day9?.id);
  });

  test("long overdue adds a SECOND event for the team", () => {
    const events = eventsForInstallment(
      installment({ dueDate: "2026-08-01", status: "overdue" }),
      TODAY
    );
    const kinds = events.map((e) => e.kind).sort();
    assert.deepEqual(kinds, [
      "installment.overdue",
      "installment.overdue_extended",
    ]);
    assert.ok(daysBetween("2026-08-01", TODAY) >= EXTENDED_OVERDUE_DAYS);
  });

  test("not-yet-long-overdue produces only the customer follow-up", () => {
    const events = eventsForInstallment(
      installment({ dueDate: "2026-08-18", status: "overdue" }),
      TODAY
    );
    assert.deepEqual(events.map((e) => e.kind), ["installment.overdue"]);
  });

  test("a recent payment confirms once, tied to the payment not to today", () => {
    const events = eventsForInstallment(
      installment({ status: "paid", paidDate: "2026-08-18", receiptRef: "RC-1" }),
      TODAY
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "installment.paid");
    assert.equal(events[0].occurredOn, "2026-08-18");
    assert.equal(
      events[0].id,
      eventsForInstallment(
        installment({ status: "paid", paidDate: "2026-08-18" }),
        "2026-08-19"
      )[0].id,
      "the same payment keeps the same id whichever day it is noticed"
    );
  });

  test("NO RETRO-SPAM: an old payment produces no confirmation", () => {
    // Switching the confirmation automation on must not thank every customer
    // for a payment they made months ago. Idempotency stops the second
    // message; only this window stops the first.
    const old = eventsForInstallment(
      installment({ status: "paid", paidDate: "2026-01-15" }),
      TODAY
    );
    assert.deepEqual(old, []);

    const justInside = eventsForInstallment(
      installment({
        status: "paid",
        paidDate: shiftBack(TODAY, PAID_CONFIRMATION_WINDOW_DAYS),
      }),
      TODAY
    );
    assert.equal(justInside.length, 1);

    const justOutside = eventsForInstallment(
      installment({
        status: "paid",
        paidDate: shiftBack(TODAY, PAID_CONFIRMATION_WINDOW_DAYS + 1),
      }),
      TODAY
    );
    assert.deepEqual(justOutside, []);
  });

  test("a payment with no date, or dated in the future, is not confirmed", () => {
    assert.deepEqual(
      eventsForInstallment(installment({ status: "paid", paidDate: null }), TODAY),
      []
    );
    assert.deepEqual(
      eventsForInstallment(
        installment({ status: "paid", paidDate: "2026-09-01" }),
        TODAY
      ),
      []
    );
  });

  test("a ready vehicle announces once per JOB", () => {
    const events = eventsForVehicle(vehicle(), TODAY);
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "vehicle.ready_for_pickup");
    assert.match(events[0].id, /GJ-2026-0142/);
  });

  test("a LATER visit is a different job and rightly a second message", () => {
    const first = eventsForVehicle(vehicle(), TODAY)[0];
    const second = eventsForVehicle(
      vehicle({ jobReference: "GJ-2026-0199" }),
      TODAY
    )[0];
    assert.notEqual(first.id, second.id);
  });

  test("statuses other than ready produce nothing", () => {
    for (const status of [
      "with_customer",
      "in_service",
      "waiting_parts",
      "delivered",
    ] as const) {
      assert.deepEqual(eventsForVehicle(vehicle({ status }), TODAY), []);
    }
  });

  test("a ready vehicle with NO job reference stays silent", () => {
    // Without a stable id there is no way to promise a single message, and
    // sending nothing is the safe failure.
    assert.deepEqual(eventsForVehicle(vehicle({ jobReference: null }), TODAY), []);
    assert.deepEqual(eventsForVehicle(vehicle({ customerId: null }), TODAY), []);
  });

  test("collectEvents gathers both sources", () => {
    const events = collectEvents(
      {
        installments: [installment({ dueDate: "2026-08-27" })],
        vehicles: [vehicle()],
      },
      TODAY
    );
    assert.equal(events.length, 2);
  });
});

describe("triggerMatches", () => {
  test("an automation only reacts to its own trigger kind", () => {
    const a = automation({ trigger: { kind: "installment.paid" } });
    const e = eventsForVehicle(vehicle(), TODAY)[0];
    assert.equal(triggerMatches(a, e), false);
  });

  test("a 7-day reminder does NOT fire on the 3-day event", () => {
    const seven = automation({
      trigger: { kind: "installment.due_soon", daysBefore: 7 },
    });
    const threeDayEvent = eventsForInstallment(
      installment({ dueDate: "2026-08-23" }),
      TODAY
    )[0];
    assert.equal(triggerMatches(seven, threeDayEvent), false);
  });

  test("an escalation fires at or beyond its threshold, never before", () => {
    const a = automation({
      trigger: { kind: "installment.overdue_extended", daysAfter: 14 },
    });
    const at14: DomainEvent = {
      id: "x",
      kind: "installment.overdue_extended",
      occurredOn: TODAY,
      customerId: "c",
      subjectId: "s",
      data: { daysOverdue: 14 },
    };
    assert.equal(triggerMatches(a, at14), true);
    assert.equal(
      triggerMatches(a, { ...at14, data: { daysOverdue: 13 } }),
      false
    );
    assert.equal(
      triggerMatches(a, { ...at14, data: { daysOverdue: 40 } }),
      true
    );
  });
});

describe("evaluate — nothing fires by accident", () => {
  const knownTemplates = templateIds();
  const readyEvent = eventsForVehicle(vehicle(), TODAY);

  test("an enabled, matching automation plans its action", () => {
    const r = evaluate(readyEvent, [automation()], { knownTemplates });
    assert.equal(r.planned.length, 1);
    assert.equal(r.planned[0].automationId, "test-automation");
    assert.equal(r.skipped.length, 0);
  });

  test("A DISABLED AUTOMATION DOES NOTHING, and says why", () => {
    const r = evaluate(readyEvent, [automation({ enabled: false })], {
      knownTemplates,
    });
    assert.equal(r.planned.length, 0);
    assert.deepEqual(r.skipped, [
      {
        automationId: "test-automation",
        eventId: readyEvent[0].id,
        reason: "automation_disabled",
      },
    ]);
  });

  test("a disabled automation is not reported against unrelated events", () => {
    const paid = eventsForInstallment(
      installment({ status: "paid", paidDate: "2026-08-05" }),
      TODAY
    );
    const r = evaluate(paid, [automation({ enabled: false })], { knownTemplates });
    assert.deepEqual(r.skipped, [], "no noise about irrelevant automations");
  });

  test("a message action with no template is skipped, not sent blank", () => {
    const a = automation({ actions: [{ kind: "send_message" }] });
    const r = evaluate(readyEvent, [a], { knownTemplates });
    assert.equal(r.planned.length, 0);
    assert.equal(r.skipped[0].reason, "no_template");
  });

  test("a message action naming a template that does not exist is skipped", () => {
    const a = automation({
      actions: [{ kind: "send_message", templateId: "does.not.exist" }],
    });
    const r = evaluate(readyEvent, [a], { knownTemplates });
    assert.equal(r.planned.length, 0);
    assert.equal(r.skipped[0].reason, "unknown_template");
  });

  test("a staff action needs no template", () => {
    const a = automation({
      actions: [{ kind: "create_followup", note: "Call them." }],
    });
    const r = evaluate(readyEvent, [a], { knownTemplates });
    assert.equal(r.planned.length, 1);
  });

  test("an automation with two actions plans both, tracked separately", () => {
    const a = automation({
      actions: [
        { kind: "send_message", templateId: "vehicle.ready_for_pickup" },
        { kind: "create_followup", note: "Confirm pickup time." },
      ],
    });
    const r = evaluate(readyEvent, [a], { knownTemplates });
    assert.equal(r.planned.length, 2);
    assert.notEqual(
      r.planned[0].idempotencyKey,
      r.planned[1].idempotencyKey,
      "a failed staff note must not block re-sending, or vice versa"
    );
  });
});

describe("idempotency — the customer is messaged once", () => {
  const knownTemplates = templateIds();
  const readyEvent = eventsForVehicle(vehicle(), TODAY);

  test("the key is derived from the automation, event and action index", () => {
    assert.equal(idempotencyKeyFor("auto", "evt", 0), "auto|evt|0");
    assert.notEqual(
      idempotencyKeyFor("auto", "evt", 0),
      idempotencyKeyFor("auto", "evt", 1)
    );
  });

  test("RE-RUNNING over the same event plans nothing the second time", () => {
    const first = evaluate(readyEvent, [automation()], { knownTemplates });
    const history = first.planned.map((p) =>
      recordAttempt(p, "sent", "delivered", "2026-08-20T09:00:00Z")
    );

    const second = evaluate(readyEvent, [automation()], {
      knownTemplates,
      alreadyDone: completedKeys(history),
    });
    assert.equal(second.planned.length, 0);
    assert.equal(second.skipped[0].reason, "already_done");
  });

  test("THE SAME EVENT TWICE IN ONE BATCH is still planned once", () => {
    // A duplicated feed, or two sources reporting the same fact, must not
    // produce two messages within a single run.
    const r = evaluate([...readyEvent, ...readyEvent], [automation()], {
      knownTemplates,
    });
    assert.equal(r.planned.length, 1);
    assert.equal(r.skipped.filter((s) => s.reason === "already_done").length, 1);
  });

  test("a DIFFERENT customer's identical situation is NOT deduplicated", () => {
    const mine = eventsForVehicle(vehicle(), TODAY);
    const theirs = eventsForVehicle(
      vehicle({ id: "veh-layal", customerId: "layal", jobReference: "GJ-2026-0155" }),
      TODAY
    );
    const r = evaluate([...mine, ...theirs], [automation()], { knownTemplates });
    assert.equal(r.planned.length, 2);
  });

  test("only a SUCCESSFUL send counts as done", () => {
    const planned = evaluate(readyEvent, [automation()], { knownTemplates })
      .planned[0];
    const failed = [
      recordAttempt(planned, "failed", "network error", "2026-08-20T09:00:00Z"),
    ];
    assert.equal(completedKeys(failed).size, 0, "a failure must stay retryable");

    const skippedHistory = [
      recordAttempt(planned, "skipped", "channel off", "2026-08-20T09:00:00Z"),
    ];
    assert.equal(completedKeys(skippedHistory).size, 0);
  });
});

describe("failure handling", () => {
  const planned = evaluate(
    eventsForVehicle(vehicle(), TODAY),
    [automation()],
    { knownTemplates: templateIds() }
  ).planned[0];
  const key = planned.idempotencyKey;

  function failures(n: number): ExecutionRecord[] {
    return Array.from({ length: n }, (_, k) =>
      recordAttempt(planned, "failed", "network error", "2026-08-20T09:00:00Z", k + 1)
    );
  }

  test("a first failure is retried", () => {
    assert.equal(shouldRetry(key, failures(1)), true);
  });

  test("retries stop at the attempt limit and a person is flagged", () => {
    assert.equal(shouldRetry(key, failures(MAX_ATTEMPTS - 1)), true);
    assert.equal(shouldRetry(key, failures(MAX_ATTEMPTS)), false);
    assert.deepEqual(summarise(failures(MAX_ATTEMPTS)).needsAttention, [key]);
  });

  test("something that eventually SUCCEEDED is never retried", () => {
    const history = [
      ...failures(1),
      recordAttempt(planned, "sent", "delivered", "2026-08-20T09:05:00Z", 2),
    ];
    assert.equal(shouldRetry(key, history), false);
    assert.deepEqual(summarise(history).needsAttention, []);
  });

  test("something never attempted is not a retry", () => {
    assert.equal(shouldRetry(key, []), false);
  });

  test("attempt numbers increase", () => {
    assert.equal(nextAttemptNumber(key, []), 1);
    assert.equal(nextAttemptNumber(key, failures(2)), 3);
  });

  test("a summary counts every outcome", () => {
    const history = [
      ...failures(2),
      recordAttempt(planned, "sent", "ok", "2026-08-20T10:00:00Z", 3),
      recordAttempt(planned, "skipped", "off", "2026-08-20T10:00:00Z", 4),
    ];
    const s = summarise(history);
    assert.equal(s.failed, 2);
    assert.equal(s.sent, 1);
    assert.equal(s.skipped, 1);
  });
});

describe("templates are a closed set", () => {
  test("every template an automation names actually exists", () => {
    const ids = templateIds();
    for (const a of DEFAULT_AUTOMATIONS) {
      for (const action of a.actions) {
        if (action.templateId) {
          assert.ok(ids.has(action.templateId), `${a.id} -> ${action.templateId}`);
        }
      }
    }
  });

  test("every send_message action names a CUSTOMER template", () => {
    for (const a of DEFAULT_AUTOMATIONS) {
      for (const action of a.actions) {
        if (action.kind !== "send_message") continue;
        const t = findTemplate(action.templateId as string);
        assert.equal(t?.audience, "customer", `${a.id}`);
      }
    }
  });

  test("an unknown template renders to null, never to a fallback sentence", () => {
    assert.equal(
      renderTemplate("no.such.template", {
        customerName: "Rami Kanaan",
        event: eventsForVehicle(vehicle(), TODAY)[0],
      }),
      null
    );
  });

  test("templates render from event data and use the first name", () => {
    const text = renderTemplate("vehicle.ready_for_pickup", {
      customerName: "Rami Kanaan",
      event: eventsForVehicle(vehicle(), TODAY)[0],
    });
    assert.ok(text);
    assert.match(text, /Rami/);
    assert.doesNotMatch(text, /Kanaan/, "first name only, like a person would");
    assert.match(text, /Voyah Free 2025/);
    assert.match(text, /B 123456/);
  });

  test("a template never emits an empty placeholder or 'undefined'", () => {
    const events = [
      ...eventsForInstallment(installment({ dueDate: "2026-08-27" }), TODAY),
      ...eventsForInstallment(
        installment({ dueDate: TODAY, status: "due" }),
        TODAY
      ),
      ...eventsForInstallment(
        installment({ dueDate: "2026-08-01", status: "overdue" }),
        TODAY
      ),
      ...eventsForInstallment(
        installment({ status: "paid", paidDate: "2026-08-18", receiptRef: "RC-1" }),
        TODAY
      ),
      ...eventsForVehicle(vehicle(), TODAY),
    ];
    for (const t of allTemplates()) {
      for (const event of events) {
        const text = t.render({ customerName: "Rami Kanaan", event });
        assert.doesNotMatch(text, /undefined|null|NaN|\{\{/, `${t.id}`);
        assert.ok(text.length > 20, `${t.id}`);
      }
    }
  });

  test("no customer template threatens or shames", () => {
    const event = eventsForInstallment(
      installment({ dueDate: "2026-08-01", status: "overdue" }),
      TODAY
    )[0];
    for (const t of allTemplates()) {
      if (t.audience !== "customer") continue;
      const text = t.render({ customerName: "Rami Kanaan", event }).toLowerCase();
      for (const word of ["immediately", "failure", "legal", "must pay", "penalty"]) {
        assert.ok(!text.includes(word), `${t.id} contains "${word}"`);
      }
    }
  });
});

describe("the default automation catalog", () => {
  test("EVERY automation ships switched OFF", () => {
    // A deployment must never start messaging real customers on its own.
    for (const a of DEFAULT_AUTOMATIONS) {
      assert.equal(a.enabled, false, a.id);
    }
  });

  test("ids are unique", () => {
    const ids = DEFAULT_AUTOMATIONS.map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("the installment ladder ends with a HUMAN, not another message", () => {
    const escalation = DEFAULT_AUTOMATIONS.find(
      (a) => a.trigger.kind === "installment.overdue_extended"
    );
    assert.ok(escalation);
    assert.ok(
      escalation.actions.every((x) => x.kind !== "send_message"),
      "a long-overdue customer is handed to a person, not chased again"
    );
  });

  test("the customer is messaged at most four times about one installment", () => {
    const customerFacing = DEFAULT_AUTOMATIONS.filter(
      (a) =>
        a.trigger.kind.startsWith("installment.") &&
        a.trigger.kind !== "installment.paid" &&
        a.actions.some((x) => x.kind === "send_message")
    );
    assert.equal(customerFacing.length, 4, "7-day, 3-day, due day, one follow-up");
  });

  test("every automation has a plain-words name and at least one action", () => {
    for (const a of DEFAULT_AUTOMATIONS) {
      assert.ok(a.name.length > 5, a.id);
      assert.ok(a.description.length > 10, a.id);
      assert.ok(a.actions.length > 0, a.id);
      assert.doesNotMatch(a.name, /_|\./, "no raw identifiers on screen");
    }
  });
});

describe("end to end: a month of a real demo customer", () => {
  test("a 3-installments-behind customer is chased once, then escalated", () => {
    const overdue = [
      installment({ id: "i-6", number: 6, dueDate: "2026-05-10", status: "overdue" }),
      installment({ id: "i-7", number: 7, dueDate: "2026-06-10", status: "overdue" }),
      installment({ id: "i-8", number: 8, dueDate: "2026-07-10", status: "overdue" }),
    ];
    const events = collectEvents({ installments: overdue }, TODAY);
    const r = evaluate(events, DEFAULT_AUTOMATIONS.map((a) => ({ ...a, enabled: true })), {
      knownTemplates: templateIds(),
    });

    const messages = r.planned.filter((p) => p.action.kind === "send_message");
    assert.equal(messages.length, 3, "one follow-up per overdue installment");

    const escalations = r.planned.filter((p) => p.action.kind === "notify_staff");
    assert.equal(escalations.length, 3, "all three are long overdue");

    // Running it again the next day sends nothing new.
    const history = r.planned.map((p) =>
      recordAttempt(p, "sent", "delivered", "2026-08-20T09:00:00Z")
    );
    const tomorrow = evaluate(
      collectEvents({ installments: overdue }, "2026-08-21"),
      DEFAULT_AUTOMATIONS.map((a) => ({ ...a, enabled: true })),
      { knownTemplates: templateIds(), alreadyDone: completedKeys(history) }
    );
    assert.equal(tomorrow.planned.length, 0, "no second chase the next morning");
  });
});
