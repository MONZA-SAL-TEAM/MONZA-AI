import type { Metadata } from "next";
import { requireStaffForPage } from "@/lib/auth-server";
import { getSource, isDemoSource, readContext } from "@/lib/domain";
import { DEMO_CONVERSATIONS, DEMO_MESSAGES, DEMO_STAFF, DEMO_VIEWER } from "@/lib/inbox/demo-conversations";
import { DEMO_TODAY } from "@/lib/domain/demo-source";
import { listAccounts } from "@/lib/channels/store";
import { readInbox } from "@/lib/channels/live";
import InboxClient from "./InboxClient";

export const metadata: Metadata = {
  title: "Inbox — Monza AI",
};

/**
 * /inbox — the centre of the product.
 *
 * Server-rendered so identity is verified before a single conversation is read
 * (middleware only checks that a sign-in cookie exists).
 *
 * LIVE FROM META. With any Instagram or Facebook account connected, the list
 * is read from Meta on every visit (and refreshed by the screen), and each
 * thread is fetched from Meta when it is opened. MONZA AI keeps no copy of the
 * messages — Samer's rule, see lib/channels/live-map.ts.
 *
 * REAL THREADS OR DEMO THREADS, NEVER BOTH. The moment one account is
 * registered, this screen shows only what Meta returns. Staff cannot be allowed
 * to reply to an invented customer, nor to mistake a real one for an example.
 */
export const dynamic = "force-dynamic";
// Every account is read from Meta while the page renders, and Instagram's
// listing can take a while (see LIST_TIMEOUT_MS in lib/channels/live.ts).
export const maxDuration = 60;

export default async function InboxPage() {
  const user = await requireStaffForPage("/inbox");
  const source = getSource();
  const ctx = readContext(user);

  // Context for the detail pane: who each customer is, and what is outstanding.
  const [customers, installments, vehicles, accounts] = await Promise.all([
    source.listCustomers(ctx),
    source.listInstallments(ctx, { status: ["due", "overdue"] }),
    source.listVehicles(ctx),
    listAccounts(),
  ]);

  const live = accounts.length > 0;
  const inbox = live ? await readInbox() : null;

  return (
    <InboxClient
      // Live threads carry real timestamps, so "today" must be the real one.
      today={live ? new Date().toISOString().slice(0, 10) : DEMO_TODAY}
      demo={isDemoSource(source)}
      channelsConnected={live}
      live={live}
      accountStatuses={inbox?.statuses ?? []}
      sourceLabel={source.label}
      viewer={DEMO_VIEWER}
      staff={[...DEMO_STAFF]}
      conversations={inbox ? inbox.conversations : DEMO_CONVERSATIONS}
      // Live messages are fetched per thread, straight from Meta.
      messages={live ? [] : DEMO_MESSAGES}
      customers={customers}
      openInstallments={installments}
      vehicles={vehicles}
    />
  );
}
