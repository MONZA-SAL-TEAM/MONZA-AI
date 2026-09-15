import type { Metadata } from "next";
import { requireStaffForPage } from "@/lib/auth-server";
import { getSource, isDemoSource, readContext } from "@/lib/domain";
import { DEMO_CONVERSATIONS, DEMO_MESSAGES } from "@/lib/inbox/demo-conversations";
import { listAccounts } from "@/lib/channels/store";
import { accountLabel } from "@/lib/channels/live-map";
import type { InboxAccount } from "@/lib/inbox/sync";
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
 * THE PAGE NO LONGER WAITS FOR META (2026-09-14). It used to read every
 * account from Meta before sending a byte, up to ten seconds each, on every
 * visit. Now it sends the list of connected accounts and returns at once; the
 * browser shows the conversations it saved last time and asks Meta only for
 * what is newer (lib/inbox/sync.ts, lib/inbox/cache.ts).
 *
 * REAL THREADS OR DEMO THREADS, NEVER BOTH. The moment one account is
 * registered, this screen shows only what Meta returns. Staff cannot be allowed
 * to reply to an invented customer, nor to mistake a real one for an example.
 */
export const dynamic = "force-dynamic";

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
  const inboxAccounts: InboxAccount[] = accounts
    .filter((a) => a.channel === "instagram" || a.channel === "facebook")
    .map((a) => ({
      id: a.id,
      brand: a.brand,
      channel: a.channel,
      label: accountLabel(a),
      handle: a.displayName,
    }));

  return (
    <InboxClient
      demo={isDemoSource(source)}
      live={live}
      accounts={inboxAccounts}
      // Each person's saved inbox and read state live under their own id.
      viewerKey={user.userId}
      sourceLabel={source.label}
      conversations={live ? [] : DEMO_CONVERSATIONS}
      // Live messages are fetched per thread, straight from Meta.
      messages={live ? [] : DEMO_MESSAGES}
      customers={customers}
      openInstallments={installments}
      vehicles={vehicles}
    />
  );
}
