import type { Metadata } from "next";
import { requireStaffForPage } from "@/lib/auth-server";
import { getSource, isDemoSource, readContext } from "@/lib/domain";
import { DEMO_CONVERSATIONS } from "@/lib/inbox/demo-conversations";
import { listPeople } from "@/lib/leads/people-server";
import { listCrmCustomers } from "@/lib/leads/people-crm";
import { mergeCrm } from "@/lib/leads/people";
import CustomersClient from "./CustomersClient";
import PeopleClient from "./PeopleClient";

export const metadata: Metadata = {
  title: "Customers — Monza AI",
};

/**
 * /customers — communication context, NOT a CRM.
 *
 * What belongs here: who this person is, how to reach them, what you have
 * already said to them, and the handful of facts you need in your head while
 * you talk — their car, its status, whether anything is outstanding.
 *
 * What deliberately does not: pipeline stages, deal values, ownership history,
 * activity logging, a notes field competing with the source system's. The
 * customer master record lives in the source system and this screen never
 * pretends otherwise — it cannot create, edit or delete a customer.
 */
export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const user = await requireStaffForPage("/customers");

  // THE REAL PEOPLE (Samer, 2026-09-18: "all my customers need to be tracked"): everyone Monza
  // has a chat with, from Monza AI's own records. Null only where those records cannot be read
  // (a local preview with no keys) — then, and only then, the labelled example screen below.
  // …joined, for this page view only, with the CRM's customers as THIS staff member may see them
  // (their own CRM sign-in; a Lebanese mobile number is the only link; nothing is stored).
  const [people, crm] = await Promise.all([listPeople(), listCrmCustomers(user)]);
  if (people) {
    return (
      <PeopleClient
        people={crm.state === "ok" ? mergeCrm(people, crm.customers) : people}
        crm={crm.state}
        crmMissing={crm.state === "ok" ? crm.missing : []}
      />
    );
  }

  const source = getSource();
  const ctx = readContext(user);

  const [customers, installments, vehicles] = await Promise.all([
    source.listCustomers(ctx),
    source.listInstallments(ctx),
    source.listVehicles(ctx),
  ]);

  return (
    <CustomersClient
      demo={isDemoSource(source)}
      sourceLabel={source.label}
      customers={customers}
      installments={installments}
      vehicles={vehicles}
      conversations={DEMO_CONVERSATIONS}
    />
  );
}
