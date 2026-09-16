/**
 * WHICH chats the sales autoreply pilot may answer — and no others.
 *
 * Samer, 2026-09-16: "begin automation only between the chat between those 2
 * numbers" — his test phone writing to the business WhatsApp — then "now lets
 * try on insta samer_k", his own Instagram writing to @voyahlebanon. This is
 * the ONE named exception to CLAUDE.md rule 24; every other chat sees nothing
 * new (lib/wasales/suggestion-server.ts `inPilot`).
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
