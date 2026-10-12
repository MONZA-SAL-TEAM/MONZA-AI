/**
 * Where a welcome card on the chat screen sends you.
 *
 * This replaces lib/chat/departments.ts, which gave every connector its own
 * "department page" — a page per business system, which is how a communication
 * layer quietly turns into a second ERP. The connectors still exist (the
 * assistant reads all five), but the product's screens are now organised
 * around what you DO, not around Monza's org chart.
 *
 * Finance deliberately has no screen. Money questions are answered by the
 * assistant, which reads the finance connector under the asker's own
 * permissions — Monza AI does not keep a second set of books, so there is
 * nothing for a Money & Reports page to be authoritative about.
 */

import type { RecommendedChat } from "@/lib/chat/contract";

export interface ChatDestination {
  /** The screen this card's header links to, or null to stay in the chat. */
  href: string | null;
  /** What the link says. */
  label: string;
}

const DESTINATIONS: Record<RecommendedChat["key"], ChatDestination> = {
  crm: { href: "/customers", label: "Customers" },
  installments: { href: "/installments", label: "Installments" },
  // The Vehicle updates screen was removed (Samer, 2026-10-12): garage and stock questions stay in the chat.
  garage: { href: null, label: "Ask the assistant" },
  inventory: { href: null, label: "Ask the assistant" },
  // No screen, by design — see the note above.
  finance: { href: null, label: "Ask the assistant" },
};

export function destinationFor(key: RecommendedChat["key"]): ChatDestination {
  return DESTINATIONS[key] ?? { href: null, label: "Ask the assistant" };
}
