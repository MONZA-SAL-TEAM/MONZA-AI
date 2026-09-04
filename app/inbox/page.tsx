import type { Metadata } from "next";
import { requireStaffForPage } from "@/lib/auth-server";
import { getSource, isDemoSource, readContext } from "@/lib/domain";
import { DEMO_CONVERSATIONS, DEMO_MESSAGES, DEMO_STAFF, DEMO_VIEWER } from "@/lib/inbox/demo-conversations";
import { DEMO_TODAY } from "@/lib/domain/demo-source";
import InboxClient from "./InboxClient";

export const metadata: Metadata = {
  title: "Inbox — Monza AI",
};

/**
 * /inbox — the centre of the product.
 *
 * Server-rendered so identity is verified before a single conversation is read
 * (middleware only checks that a sign-in cookie exists), and so the demo label
 * is decided on the server rather than fetched.
 *
 * The conversations themselves are MONZA AI's own data — unlike the customer,
 * vehicle and installment context beside them, which is read from the source
 * system through the adapter. Today both are the demo implementations, and the
 * banner says so.
 */
export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const user = await requireStaffForPage("/inbox");
  const source = getSource();
  const ctx = readContext(user);

  // Context for the detail pane: who each customer is, and what is outstanding.
  const [customers, installments, vehicles] = await Promise.all([
    source.listCustomers(ctx),
    source.listInstallments(ctx, { status: ["due", "overdue"] }),
    source.listVehicles(ctx),
  ]);

  return (
    <InboxClient
      today={DEMO_TODAY}
      demo={isDemoSource(source)}
      sourceLabel={source.label}
      viewer={DEMO_VIEWER}
      staff={[...DEMO_STAFF]}
      conversations={DEMO_CONVERSATIONS}
      messages={DEMO_MESSAGES}
      customers={customers}
      openInstallments={installments}
      vehicles={vehicles}
    />
  );
}
