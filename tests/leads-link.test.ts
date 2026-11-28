/**
 * Linking chat leads to CRM customers by mobile number (lib/leads/link.ts).
 * Invented rows — no real customer appears in a test.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { planPhoneLinks, linkReport } from "@/lib/leads/link";

const lead = (id: string, phone: string | null, crmCustomerId: string | null = null) => ({ id, phone, crmCustomerId });
const cust = (customerId: string, phone: string | null) => ({ customerId, phone });

describe("planPhoneLinks", () => {
  test("the same mobile written two ways is one person", () => {
    const plan = planPhoneLinks([lead("L1", "96170000001")], [cust("C1", "+961 70 000 001")]);
    assert.deepEqual(plan.links, [{ leadId: "L1", crmCustomerId: "C1" }]);
    assert.equal(plan.counts.toLink, 1);
  });

  test("a local form with the trunk zero matches the international one", () => {
    const plan = planPhoneLinks([lead("L1", "9613000001")], [cust("C1", "03 000 001")]);
    assert.equal(plan.links.length, 1);
  });

  test("a landline never links, whichever side holds it", () => {
    const plan = planPhoneLinks([lead("L1", "9611488333"), lead("L2", "96170000002")], [cust("C1", "01 488 333"), cust("C2", "01 488 666")]);
    assert.equal(plan.links.length, 0);
    assert.equal(plan.counts.noMobile, 1);
    assert.equal(plan.counts.notInCrm, 1);
  });

  test("a number two CRM customers share links nobody", () => {
    const plan = planPhoneLinks([lead("L1", "96170000003")], [cust("C1", "70000003"), cust("C2", "+96170000003")]);
    assert.equal(plan.links.length, 0);
    assert.equal(plan.counts.sharedNumber, 1);
  });

  test("the same customer listed twice is still one customer", () => {
    const plan = planPhoneLinks([lead("L1", "96170000004")], [cust("C1", "70000004"), cust("C1", "+96170000004")]);
    assert.deepEqual(plan.links, [{ leadId: "L1", crmCustomerId: "C1" }]);
  });

  test("a lead already linked is never planned again, even to a different customer", () => {
    const plan = planPhoneLinks([lead("L1", "96170000005", "C9")], [cust("C1", "70000005")]);
    assert.equal(plan.links.length, 0);
    assert.equal(plan.counts.alreadyLinked, 1);
  });

  test("no number, a foreign number and an Instagram-style id link nothing", () => {
    const plan = planPhoneLinks(
      [lead("L1", null), lead("L2", "447700900123"), lead("L3", "17841457996874250")],
      [cust("C1", "447700900123"), cust("C2", "17841457996874250")]
    );
    assert.equal(plan.links.length, 0);
    assert.equal(plan.counts.noMobile, 3);
  });

  test("a mobile nobody in the CRM has is counted, not linked", () => {
    const plan = planPhoneLinks([lead("L1", "96170000006")], [cust("C1", "70000007")]);
    assert.equal(plan.links.length, 0);
    assert.equal(plan.counts.notInCrm, 1);
  });

  test("the counts add up to the leads given", () => {
    const plan = planPhoneLinks(
      [lead("a", "96170000001"), lead("b", null), lead("c", "96170000008"), lead("d", "96170000003"), lead("e", "96170000009", "C7")],
      [cust("C1", "70000001"), cust("C2", "70000003"), cust("C3", "70000003")]
    );
    const c = plan.counts;
    assert.equal(c.toLink + c.noMobile + c.notInCrm + c.sharedNumber + c.alreadyLinked, c.leads);
  });
});

describe("linkReport", () => {
  const counts = { leads: 10, alreadyLinked: 1, noMobile: 2, notInCrm: 3, sharedNumber: 1, toLink: 3 };

  test("switched off says so, and never says anything was linked", () => {
    const s = linkReport({ applied: false, linked: 0, counts }) ?? "";
    assert.match(s, /switched off; nothing was changed/);
    assert.match(s, /3 could be linked to exactly one CRM customer/);
    assert.doesNotMatch(s, /were linked|was linked/);
  });

  test("every group is named, and the figures are the ones given", () => {
    const s = linkReport({ applied: false, linked: 0, counts }) ?? "";
    for (const part of ["Of 10 people who wrote", "1 already linked", "1 share a number", "3 have a mobile number no CRM customer has", "2 have no usable mobile number"]) {
      assert.ok(s.includes(part), part);
    }
  });

  test("applied reports what was written, and admits when the budget ran out", () => {
    assert.match(linkReport({ applied: true, linked: 1, counts }) ?? "", /1 chat was linked/);
    assert.match(linkReport({ applied: true, linked: 2, partial: true, counts }) ?? "", /2 chats were linked.*more will follow/);
  });

  test("no leads is nothing to say, never a row of zeros", () => {
    assert.equal(linkReport({ applied: false, linked: 0, counts: { leads: 0, alreadyLinked: 0, noMobile: 0, notInCrm: 0, sharedNumber: 0, toLink: 0 } }), null);
  });
});
