import type { Metadata } from "next";
import { requireStaffForPage } from "@/lib/auth-server";
import { getSource, isDemoSource, readContext } from "@/lib/domain";
import { DEMO_TODAY } from "@/lib/domain/demo-source";
import { DEMO_MESSAGES } from "@/lib/inbox/demo-conversations";
import InstallmentsClient from "./InstallmentsClient";

export const metadata: Metadata = {
  title: "Installments — Monza AI",
};

/**
 * /installments — a FOLLOW-UP board, not an accounting screen.
 *
 * What this page does: shows whose installments need a word from Monza, and
 * helps send that word.
 *
 * What this page deliberately does NOT do: record payments, compute balances,
 * or decide that anything is overdue. Every figure and every status is read
 * from the source system through the adapter and shown as reported. The screen
 * this replaced had a "Record a payment" dialog that recomputed plan coverage
 * from cumulative dollars — careful arithmetic that MONZA AI should not be
 * doing at all, because the moment two systems both compute a balance, one of
 * them is wrong and nobody knows which.
 */
export const dynamic = "force-dynamic";

export default async function InstallmentsPage() {
  const user = await requireStaffForPage("/installments");
  const source = getSource();
  const ctx = readContext(user);

  const [installments, customers] = await Promise.all([
    source.listInstallments(ctx),
    source.listCustomers(ctx),
  ]);

  // Reminder history: what has already gone out, so nobody chases twice by
  // hand. Owned by Monza AI (these are our messages), unlike the plans above.
  const sentReminders = DEMO_MESSAGES.filter(
    (m) => m.author === "automation" && m.automationId?.startsWith("installment")
  ).map((m) => ({
    conversationId: m.conversationId,
    automationId: m.automationId as string,
    at: m.at,
    text: m.text,
  }));

  return (
    <InstallmentsClient
      today={DEMO_TODAY}
      demo={isDemoSource(source)}
      sourceLabel={source.label}
      installments={installments}
      customers={customers}
      sentReminders={sentReminders}
    />
  );
}
