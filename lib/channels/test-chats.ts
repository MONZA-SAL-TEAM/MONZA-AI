/**
 * The chats that are OURS, not a customer's.
 *
 * Samer, 2026-09-16: "treat the following number as a test number 03195955" —
 * his own phone, the one the autoreply pilot answers. Every message it sends
 * still arrives, is stored, is shown in the inbox and may be answered by the
 * pilot; what it must NOT do is count as a customer.
 *
 * ── Why this is worth a file ────────────────────────────────────────────────
 *
 * Without it, each test message runs the whole lead path: a row in `leads`
 * carrying Samer's phone, a touchpoint under a brand, a car interest, and —
 * because a Lebanese MOBILE is the one thing allowed to auto-link without a
 * human (lib/leads/phone.ts) — an automatic join to whatever CRM customer
 * holds that number. The dashboard then reports our own testing as demand,
 * and "where do customers come from" answers with a number we dialled
 * ourselves. Attribution is the figure somebody spends money against.
 *
 * ── What it deliberately does NOT do ────────────────────────────────────────
 *
 * It does not hide the chat, silence it, or stop it being stored: Samer has to
 * be able to see his own test in the Inbox and read what came back. And it is
 * SEPARATE from `lib/wasales/autoreply-pilot.ts` on purpose — that list says
 * which chats a machine may ANSWER (CLAUDE.md rule 24, Samer's decision every
 * time it widens). Listing a number here must never switch automation on for
 * it. The dependency runs one way only, and a test asserts it: every pilot
 * chat is a test chat, never the reverse.
 *
 * ── Identity, per channel ───────────────────────────────────────────────────
 *
 * WhatsApp is a PHONE, so it is the same human on any WhatsApp account of ours
 * and it is compared through `samePhone` — "03195955", "+961 3 195 955" and
 * "9613195955" are one number. A number that cannot be normalised matches
 * nothing at all; raw-string comparison is how a truncated number would match
 * another truncated one.
 *
 * Instagram and Messenger ids are SCOPED TO THE ACCOUNT they wrote to (rule:
 * the same person on another account arrives as an unrelated id), so an entry
 * there must name the account, and the id is compared exactly.
 *
 * Pure: no I/O, tested in tests/channels-test-chats.test.ts.
 */

import { normalizeLebanesePhone, samePhone } from "@/lib/leads/phone";

export type TestChat =
  | {
      channel: "whatsapp";
      /** In any written form — normalised before it is compared. */
      phone: string;
      note: string;
    }
  | {
      channel: "instagram" | "facebook";
      /** Our account the id belongs to: "ig-voyah", "fb-monza". */
      accountId: string;
      /** The account-scoped id Meta sends, compared exactly. */
      peer: string;
      note: string;
    };

export const TEST_CHATS: readonly TestChat[] = Object.freeze([
  Object.freeze({
    channel: "whatsapp" as const,
    phone: "03195955",
    note: "Samer's own phone, +961 3 195 955 — the autoreply pilot's test number.",
  }),
]);

/**
 * Is this message ours rather than a customer's?
 *
 * Answers false for anything it cannot place, which is the safe direction: a
 * real customer wrongly treated as a test disappears from the figures and from
 * the lead queue, and nobody would notice.
 */
export function isTestChat(
  chat: { channel: string; accountId: string; peerExternalId: string },
  chats: readonly TestChat[] = TEST_CHATS
): boolean {
  const peer = chat.peerExternalId?.trim();
  if (!peer) return false;

  return chats.some((t) => {
    if (t.channel !== chat.channel) return false;
    // A phone is a phone on any of our WhatsApp accounts.
    if (t.channel === "whatsapp") return samePhone(t.phone, peer);
    // An Instagram or Messenger id means nothing without the account it is
    // scoped to.
    return t.accountId === chat.accountId && t.peer === peer;
  });
}

/**
 * The test numbers as WhatsApp itself writes them — digits, country code, no
 * plus. For the one-off clean-up of rows recorded before a number was listed
 * (docs/TEST-NUMBERS.md), and for a human to check the list at a glance.
 */
export function testPhonesE164(chats: readonly TestChat[] = TEST_CHATS): string[] {
  const out: string[] = [];
  for (const t of chats) {
    if (t.channel !== "whatsapp") continue;
    const n = normalizeLebanesePhone(t.phone);
    if (n) out.push(n);
  }
  return out;
}
