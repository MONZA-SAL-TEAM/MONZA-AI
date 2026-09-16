/**
 * The chats we REHEARSE the real customer experience in.
 *
 * Samer, 2026-09-16: "any time that number sends a message to 70708585 always
 * treat it as a client so that i can test all the questions" — his own phone,
 * +961 3 195 955, writing to the business WhatsApp.
 *
 * ── What "always treat it as a client" means, precisely ─────────────────────
 *
 * It means the number is NOT special-cased anywhere. It opens a lead, records
 * a touchpoint under the brand, records the car it named, and auto-links to a
 * CRM customer by phone exactly as a stranger's message would. That path is
 * the thing being tested, and a rehearsal that skipped it would rehearse
 * nothing. This list does not exempt it from any of that — deliberately.
 *
 * The ONE thing listing a chat here changes is the INTERNAL_TEST filter.
 * `detectExclusion` (lib/wasales/intent.ts) refuses to answer a message whose
 * whole text is "test", "testing", "hi test" — a rule that exists so a staff
 * member poking the system does not get a brochure, and the exact rule that
 * would silence the person poking it ON PURPOSE. In a rehearsal chat that one
 * filter is off, so "test" reads as an ordinary message with nothing in it.
 *
 * Every OTHER exclusion still applies, because a client gets them too: a fake
 * Meta-support message, a vendor pitch and Meta's own chat notice are still
 * excluded here. "Treat it as a client" is the whole rule, not a licence.
 *
 * ── What this costs, so nobody rediscovers it ───────────────────────────────
 *
 * The dashboard counts these messages as demand, because they are recorded as
 * a real lead. That is the price of the rehearsal being real, and it is a
 * decision, not an oversight (docs/TEST-NUMBERS.md says how to filter the
 * number out of a figure when it matters).
 *
 * ── Separate from the autoreply pilot, one way ──────────────────────────────
 *
 * `lib/wasales/autoreply-pilot.ts` says which chats a machine may ANSWER by
 * itself — CLAUDE.md rule 24, Samer's decision every time it widens. This file
 * says which chats are OURS to test in. Listing a chat here must never switch
 * automation on for it; tests/sales-rehearsal.test.ts asserts the direction.
 *
 * Pure: no I/O, tested in tests/sales-rehearsal.test.ts.
 */

import { samePhone } from "@/lib/leads/phone";

export type RehearsalChat = {
  /** Our account it is a rehearsal ON: "wa-monza", "ig-voyah". */
  accountId: string;
} & (
  | {
      channel: "whatsapp";
      /** In any written form — normalised before it is compared. */
      phone: string;
      note: string;
    }
  | {
      channel: "instagram" | "facebook";
      /** The account-scoped id Meta sends, compared exactly. */
      peer: string;
      note: string;
    }
);

export const REHEARSAL_CHATS: readonly RehearsalChat[] = Object.freeze([
  Object.freeze({
    accountId: "wa-monza",
    channel: "whatsapp" as const,
    phone: "03195955",
    note: "Samer's own phone, +961 3 195 955, writing to +961 70 708 585.",
  }),
]);

/**
 * Is this chat one of ours to test in?
 *
 * Scoped to the ACCOUNT as well as the person, because that is how Samer named
 * it — "that number … to 70708585". The same phone writing to another account
 * of ours is not a rehearsal there until somebody says so.
 *
 * Answers false for anything it cannot place. A WhatsApp number that does not
 * normalise matches nothing: comparing raw strings is how one truncated number
 * would match another.
 */
export function isRehearsalChat(
  chat: { channel: string; accountId: string; peerExternalId: string },
  chats: readonly RehearsalChat[] = REHEARSAL_CHATS
): boolean {
  const peer = chat.peerExternalId?.trim();
  if (!peer) return false;

  return chats.some((t) => {
    if (t.accountId !== chat.accountId || t.channel !== chat.channel) return false;
    if (t.channel === "whatsapp") return samePhone(t.phone, peer);
    // An Instagram or Messenger id is opaque and account-scoped: exact only.
    return t.peer === peer;
  });
}
