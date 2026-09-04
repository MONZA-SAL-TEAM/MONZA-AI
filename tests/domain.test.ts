/**
 * The data boundary.
 *
 * Two things are under test here:
 *
 *  1. The adapter is READ-ONLY and honest. No method mutates, every getter can
 *     answer "I don't know", and the demo source labels itself as demo so no
 *     screen can present invented figures as live.
 *
 *  2. The demo dataset stays reconciled with the canon it is derived from
 *     (lib/customers/directory-data.ts). The demo universe is shared by the
 *     chat answers, the tracker and the boards; a fourth copy that drifts is
 *     exactly what deriving it was meant to prevent.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { DEMO_CUSTOMER_DIRECTORY } from "@/lib/customers/directory-data";
import {
  DEMO_DATASET,
  DEMO_TODAY,
  addMonths,
  customerIdFor,
  demoSource,
} from "@/lib/domain/demo-source";
import {
  customerMatches,
  installmentMatches,
  vehicleMatches,
} from "@/lib/domain/source";
import { getSource, isDemoSource, readContext } from "@/lib/domain";
import { CHANNELS, type Customer } from "@/lib/domain/types";
import { DEMO_IDENTITY } from "@/lib/auth";

const ctx = readContext(DEMO_IDENTITY);

describe("the adapter contract", () => {
  test("the selected source is the demo source, and says so", () => {
    const source = getSource();
    assert.equal(source.kind, "demo");
    assert.equal(isDemoSource(source), true);
    assert.match(source.label, /Example data/);
  });

  test("NOTHING on the adapter can write", () => {
    // Read-only is enforced by the interface having no mutation, which types
    // check at build time. This asserts the runtime shape too, so a stray
    // method added later trips a test rather than shipping.
    const allowed = new Set([
      "kind",
      "label",
      "getCustomer",
      "listCustomers",
      "getVehicle",
      "listVehicles",
      "getVehicleStatus",
      "getInstallment",
      "listInstallments",
      "listPayments",
      "getSalesCatalog",
    ]);
    for (const key of Object.keys(demoSource)) {
      assert.ok(allowed.has(key), `unexpected member on the source: ${key}`);
    }
    for (const key of Object.keys(demoSource)) {
      assert.doesNotMatch(
        key,
        /^(set|save|create|update|delete|record|mark|send)/,
        key
      );
    }
  });

  test("an unknown id is null, never a throw and never a guess", async () => {
    assert.equal(await demoSource.getCustomer("nobody", ctx), null);
    assert.equal(await demoSource.getVehicle("nothing", ctx), null);
    assert.equal(await demoSource.getInstallment("nope", ctx), null);
    assert.equal(await demoSource.getVehicleStatus("nothing", ctx), null);
  });
});

describe("the demo dataset stays reconciled with the canon", () => {
  const canon = DEMO_CUSTOMER_DIRECTORY.customers;

  test("one customer and one vehicle per person in the directory", () => {
    assert.equal(DEMO_DATASET.customers.length, canon.length);
    assert.equal(DEMO_DATASET.vehicles.length, canon.length);
  });

  test("names, phones, VINs and plates come straight from the canon", () => {
    for (const c of canon) {
      const id = customerIdFor(c.name);
      const customer = DEMO_DATASET.customers.find((x) => x.id === id);
      const vehicle = DEMO_DATASET.vehicles.find((v) => v.customerId === id);
      assert.ok(customer, c.name);
      assert.ok(vehicle, c.name);
      assert.equal(customer.phone, c.phone);
      assert.equal(vehicle.vin, c.vin);
      assert.equal(vehicle.plate, c.plate);
      assert.equal(vehicle.label, c.carLabel);
    }
  });

  test("paid counts match the canon exactly", () => {
    for (const c of canon) {
      if (!c.plan) continue;
      const id = customerIdFor(c.name);
      const paid = DEMO_DATASET.installments.filter(
        (i) => i.customerId === id && i.status === "paid"
      ).length;
      assert.equal(paid, c.plan.paidCount, c.name);
    }
  });

  test("overdue counts match 'behind' in the canon exactly", () => {
    // The schedule is anchored so this comes out right whether or not the
    // plan's due day has already passed this month.
    for (const c of canon) {
      if (!c.plan) continue;
      const id = customerIdFor(c.name);
      const overdue = DEMO_DATASET.installments.filter(
        (i) => i.customerId === id && i.status === "overdue"
      ).length;
      const expected = c.plan.behind ? c.plan.behindCount ?? 1 : 0;
      assert.equal(overdue, expected, c.name);
    }
  });

  test("a customer with no plan has no installments", () => {
    for (const c of canon) {
      if (c.plan) continue;
      const id = customerIdFor(c.name);
      assert.equal(
        DEMO_DATASET.installments.filter((i) => i.customerId === id).length,
        0,
        c.name
      );
    }
  });

  test("every plan has exactly its total number of installments", () => {
    for (const c of canon) {
      if (!c.plan) continue;
      const id = customerIdFor(c.name);
      const mine = DEMO_DATASET.installments.filter((i) => i.customerId === id);
      assert.equal(mine.length, c.plan.totalCount, c.name);
      assert.deepEqual(
        mine.map((i) => i.number),
        Array.from({ length: c.plan.totalCount }, (_, k) => k + 1)
      );
    }
  });

  test("no unpaid installment carries a payment record", () => {
    for (const i of DEMO_DATASET.installments) {
      if (i.status !== "paid") {
        assert.equal(i.paidDate, null, i.id);
        assert.equal(i.receiptRef, null, i.id);
      }
    }
    for (const p of DEMO_DATASET.payments) {
      const inst = DEMO_DATASET.installments.find((i) => i.id === p.installmentId);
      assert.equal(inst?.status, "paid", p.id);
    }
  });

  test("statuses agree with the dates they were derived from", () => {
    for (const i of DEMO_DATASET.installments) {
      if (i.status === "overdue") assert.ok(i.dueDate < DEMO_TODAY, i.id);
      if (i.status === "upcoming") assert.ok(i.dueDate > DEMO_TODAY, i.id);
    }
  });

  test("every vehicle waiting on a part names the part", () => {
    for (const v of DEMO_DATASET.vehicles) {
      if (v.status === "waiting_parts") {
        assert.ok(v.awaitingPart, v.id);
        assert.ok(v.jobReference, v.id);
      }
    }
  });

  test("everyone is reachable on at least one channel", () => {
    for (const c of DEMO_DATASET.customers) {
      assert.ok(c.handles.length > 0, c.name);
      for (const h of c.handles) {
        assert.ok(CHANNELS.includes(h.channel), h.channel);
        assert.ok(h.address.length > 0);
      }
      assert.ok(
        c.handles.some((h) => h.channel === c.preferredChannel),
        `${c.name} prefers a channel they have no handle on`
      );
    }
  });

  test("all three channels appear, so the inbox is not single-channel", () => {
    const used = new Set(
      DEMO_DATASET.customers.flatMap((c) => c.handles.map((h) => h.channel))
    );
    assert.deepEqual([...used].sort(), ["facebook", "instagram", "whatsapp"]);
  });

  test("the dataset is fixed — repeated reads are identical", async () => {
    const a = await demoSource.listCustomers(ctx);
    const b = await demoSource.listCustomers(ctx);
    assert.deepEqual(a, b);
  });
});

describe("addMonths", () => {
  test("moves forward and backward across year boundaries", () => {
    assert.equal(addMonths("2026-08-10", 1), "2026-09-10");
    assert.equal(addMonths("2026-08-10", -1), "2026-07-10");
    assert.equal(addMonths("2026-12-10", 1), "2027-01-10");
    assert.equal(addMonths("2026-01-10", -1), "2025-12-10");
    assert.equal(addMonths("2026-08-10", 0), "2026-08-10");
  });

  test("clamps a day the target month does not have", () => {
    assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
    assert.equal(addMonths("2024-01-31", 1), "2024-02-29", "leap year");
  });

  test("moves whole years", () => {
    assert.equal(addMonths("2026-08-10", 24), "2028-08-10");
    assert.equal(addMonths("2026-08-10", -24), "2024-08-10");
  });
});

describe("query helpers", () => {
  test("installments filter by customer, plan, status and date window", () => {
    const i = DEMO_DATASET.installments[0];
    assert.equal(installmentMatches(i, undefined), true);
    assert.equal(installmentMatches(i, { customerId: i.customerId }), true);
    assert.equal(installmentMatches(i, { customerId: "someone-else" }), false);
    assert.equal(installmentMatches(i, { status: i.status }), true);
    assert.equal(installmentMatches(i, { status: [i.status] }), true);
    assert.equal(installmentMatches(i, { dueOnOrBefore: i.dueDate }), true);
    assert.equal(installmentMatches(i, { dueOnOrAfter: i.dueDate }), true);
    assert.equal(installmentMatches(i, { dueOnOrBefore: "1999-01-01" }), false);
  });

  test("a status list matches any member", () => {
    const overdue = DEMO_DATASET.installments.filter((x) => x.status === "overdue");
    assert.ok(overdue.length > 0);
    assert.equal(
      installmentMatches(overdue[0], { status: ["due", "overdue"] }),
      true
    );
    assert.equal(
      installmentMatches(overdue[0], { status: ["paid", "upcoming"] }),
      false
    );
  });

  test("vehicles filter by customer and status", () => {
    const v = DEMO_DATASET.vehicles[0];
    assert.equal(vehicleMatches(v, undefined), true);
    assert.equal(vehicleMatches(v, { status: v.status }), true);
    assert.equal(vehicleMatches(v, { customerId: "nobody" }), false);
  });

  test("customer search matches name, phone digits and handles", () => {
    const rami = DEMO_DATASET.customers.find((c) => c.id === "rami-kanaan");
    assert.ok(rami);
    assert.equal(customerMatches(rami, "rami"), true);
    assert.equal(customerMatches(rami, "RAMI"), true);
    assert.equal(customerMatches(rami, "961 3 100 001"), true, "spaced phone");
    assert.equal(customerMatches(rami, "@rami_kanaan"), true, "instagram handle");
    assert.equal(customerMatches(rami, ""), true, "empty search matches all");
    assert.equal(customerMatches(rami, "layal"), false);
  });

  test("a very short digit string does not match every phone number", () => {
    const someone = DEMO_DATASET.customers[0];
    // Two digits would match nearly any number; the helper requires three.
    const bogus: Customer = { ...someone, name: "Zzz", phone: "9613100001" };
    assert.equal(customerMatches(bogus, "96"), false);
  });
});

describe("the source honours its queries", () => {
  test("listInstallments filters by status", async () => {
    const overdue = await demoSource.listInstallments(ctx, { status: "overdue" });
    assert.ok(overdue.length > 0);
    assert.ok(overdue.every((i) => i.status === "overdue"));
  });

  test("listVehicles filters by status", async () => {
    const inService = await demoSource.listVehicles(ctx, { status: "in_service" });
    assert.ok(inService.every((v) => v.status === "in_service"));
  });

  test("listPayments can be scoped to one customer", async () => {
    const all = await demoSource.listPayments(ctx);
    const mine = await demoSource.listPayments(ctx, "rami-kanaan");
    assert.ok(mine.length > 0);
    assert.ok(mine.length < all.length);
    assert.ok(mine.every((p) => p.customerId === "rami-kanaan"));
  });

  test("the sales catalogue reports only what can be SENT", async () => {
    const catalog = await demoSource.getSalesCatalog(ctx);
    assert.ok(catalog.length > 0);
    for (const item of catalog) {
      assert.equal(typeof item.hasBrochure, "boolean");
      assert.equal(typeof item.videoCount, "number");
      // No price, no stock count — those stay in the source system.
      assert.ok(!("priceUsd" in item));
      assert.ok(!("stock" in item));
    }
  });
});
