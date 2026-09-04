import type { Metadata } from "next";
import { requireStaffForPage } from "@/lib/auth-server";
import { getSource, isDemoSource, readContext } from "@/lib/domain";
import { DEMO_CONVERSATIONS } from "@/lib/inbox/demo-conversations";
import CustomersClient from "./CustomersClient";

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
