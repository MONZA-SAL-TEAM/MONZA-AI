import type { Metadata } from "next";
import { requireStaffForPage } from "@/lib/auth-server";
import { getSource, isDemoSource, readContext } from "@/lib/domain";
import { DEMO_CONVERSATIONS, DEMO_MESSAGES, DEMO_STAFF, DEMO_VIEWER } from "@/lib/inbox/demo-conversations";
import { DEMO_TODAY } from "@/lib/domain/demo-source";
import {
  anyAccountConnected,
  listConversations,
  listMessages,
} from "@/lib/channels/store";
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
 * system through the adapter.
 *
 * REAL THREADS OR DEMO THREADS, NEVER BOTH. The moment one channel account is
 * connected, this screen shows only what is really in the library. Mixing the
 * two would be the worst possible outcome here: staff cannot be allowed to
 * reply to an invented customer, nor to mistake a real one for an example, and
 * a banner is not enough to keep those apart at a glance.
 */
export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const user = await requireStaffForPage("/inbox");
  const source = getSource();
  const ctx = readContext(user);

  // Context for the detail pane: who each customer is, and what is outstanding.
  const [customers, installments, vehicles, connected] = await Promise.all([
    source.listCustomers(ctx),
    source.listInstallments(ctx, { status: ["due", "overdue"] }),
    source.listVehicles(ctx),
    anyAccountConnected(),
  ]);

  const live = connected ? await listConversations() : [];
  const liveMessages = connected
    ? await listMessages(live.map((c) => c.id))
    : [];

  const conversations = connected ? live : DEMO_CONVERSATIONS;
  const messages = connected ? liveMessages : DEMO_MESSAGES;

  return (
    <InboxClient
      today={DEMO_TODAY}
      demo={isDemoSource(source)}
      channelsConnected={connected}
      sourceLabel={source.label}
      viewer={DEMO_VIEWER}
      staff={[...DEMO_STAFF]}
      conversations={conversations}
      messages={messages}
      customers={customers}
      openInstallments={installments}
      vehicles={vehicles}
    />
  );
}
