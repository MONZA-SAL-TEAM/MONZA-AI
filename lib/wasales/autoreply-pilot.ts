/**
 * WHICH chats the sales autoreply pilot may answer — and no others.
 *
 * Samer, 2026-09-16: "begin automation only between the chat between those 2
 * numbers" — his test phone writing to the business WhatsApp — then "now lets
 * try on insta samer_k", his own Instagram writing to @voyahlebanon. This is
 * the ONE named exception to CLAUDE.md rule 24; every other chat sees nothing
 * new (lib/wasales/suggestion-server.ts `inPilot`).
 *
 * WIDENED to four Lebanese numbers by Samer, 2026-09-18: "I want only the
 * following numbers to be able to talk to the chat bot", for testing its
 * responses. Still testing, NOT a launch — every number below is a phone
 * Samer named himself, and nothing else on wa-monza is answered.
 *
 * ⚠ TWO OF THEM ALREADY HAVE REAL HISTORY on the business line (see the
 * comments below). The autoreply sets `startedAt` just before the message that
 * wakes it, so it ignores everything said before it ran — which means a prior
 * human reply does NOT hand the chat over, and the bot WILL answer these
 * numbers on their next message. That is the intended test; it is written down
 * because it is not obvious. Once a person types in the chat AFTER the bot
 * starts, handover is permanent for that chat.
 *
 * A chat is an ACCOUNT of ours plus ONE customer's id on it. Instagram ids are
 * scoped to the account they wrote to, so the same person on another account
 * is a different id and is not in the pilot.
 *
 * The list lives in code on purpose: widening it is a reviewed change with
 * Samer's decision behind it. Stopping it needs no code:
 * `SALES_AUTOREPLY_MODE=off` in Vercel, then a redeploy.
 *
 * Pure: tested in tests/sales-autoreply.test.ts.
 */

export interface PilotChat {
  /** Our account: "wa-monza", "ig-voyah". */
  accountId: string;
  /** The customer's id on that account: WhatsApp digits, or the Instagram-scoped id. */
  peer: string;
}

export interface AutoreplyPilot {
  chats: readonly PilotChat[];
}

export const AUTOREPLY_PILOT: AutoreplyPilot = Object.freeze({
  chats: Object.freeze([
    /** Samer's test phone, +961 3 195 955, writing to +961 70 708 585. */
    Object.freeze({ accountId: "wa-monza", peer: "9613195955" }),
    /** +961 81 659 640 — named by Samer 2026-09-18. No prior thread on wa-monza. */
    Object.freeze({ accountId: "wa-monza", peer: "96181659640" }),
    /**
     * +961 78 986 096 — named by Samer 2026-09-18.
     * ⚠ Has a REAL thread on wa-monza carrying an internal business discussion,
     * not a sales enquiry. The bot will answer its next message with sales
     * material. Deliberate, per Samer; say so before it surprises anybody.
     */
    Object.freeze({ accountId: "wa-monza", peer: "96178986096" }),
    /**
     * +961 76 877 278 — named by Samer 2026-09-18.
     * ⚠ Has a REAL thread on wa-monza (attachments only, never answered).
     */
    Object.freeze({ accountId: "wa-monza", peer: "96176877278" }),
  ]),
});

/** SALES_AUTOREPLY_MODE: "off" stops the pilot; anything else leaves it to the list. */
export function autoreplyMode(raw: string | undefined | null): "pilot" | "off" {
  return typeof raw === "string" && raw.trim().toLowerCase() === "off" ? "off" : "pilot";
}

/** Is this one of our accounts with a pilot chat at all? (Cheap: no Meta call.) */
export function isPilotAccount(accountId: string, pilot: AutoreplyPilot = AUTOREPLY_PILOT): boolean {
  return pilot.chats.some((c) => c.accountId === accountId);
}

/** May the pilot answer this chat? Exactly a listed account AND its listed customer. */
export function isPilotChat(
  chat: { accountId: string; channel: string; peerExternalId: string },
  pilot: AutoreplyPilot = AUTOREPLY_PILOT
): boolean {
  const peer =
    chat.channel === "whatsapp" ? chat.peerExternalId.replace(/\D/g, "") : chat.peerExternalId.trim();
  if (peer.length < 8) return false;
  return pilot.chats.some((c) => c.accountId === chat.accountId && c.peer === peer);
}
