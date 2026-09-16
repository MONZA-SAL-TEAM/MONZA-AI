/**
 * THE SALES AUTOREPLY PILOT — run from the Meta webhook, for customer messages
 * that were NEW (lib/channels/store.ts `fresh`: a Meta redelivery is never
 * new, so it can never answer twice) and only in the chats
 * lib/wasales/autoreply-pilot.ts names. SERVER ONLY.
 *
 * Nothing here decides what to say or what may be sent: that is the same
 * engine, templates and checks a person's "Send this" uses
 * (suggestion-server.ts autoreplyThread).
 */

import type { FreshInbound } from "@/lib/channels/store";
import { encodeThreadId } from "@/lib/channels/live-map";
import { metaThreadFor } from "@/lib/channels/live";
import { autoreplyMode, isPilotChat } from "@/lib/wasales/autoreply-pilot";
import { autoreplyThread } from "@/lib/wasales/suggestion-server";

export async function runAutoreply(
  fresh: readonly FreshInbound[],
  budgetMs: number
): Promise<{ chats: number; sent: number }> {
  if (autoreplyMode(process.env.SALES_AUTOREPLY_MODE) === "off") return { chats: 0, sent: 0 };

  // One run per chat, woken by the EARLIEST new message of this delivery, so
  // every message in it is part of the conversation the engine answers.
  const chats = new Map<string, FreshInbound>();
  for (const f of fresh) {
    if (!isPilotChat(f)) continue;
    const seen = chats.get(f.conversationId);
    if (!seen || Date.parse(f.at) < Date.parse(seen.at)) chats.set(f.conversationId, f);
  }

  const deadline = Date.now() + budgetMs;
  let sent = 0;
  for (const f of chats.values()) {
    // WhatsApp threads are ours; an Instagram or Facebook thread is Meta's, found
    // from the customer's id (a webhook does not name the conversation).
    const threadId =
      f.channel === "whatsapp"
        ? encodeThreadId(f.accountId, f.conversationId)
        : await metaThreadFor(f.accountId, f.peerExternalId);
    if (!threadId) {
      console.info(`[sales/autoreply] ${f.accountId}: could not find the conversation on Meta`);
      continue;
    }
    const r = await autoreplyThread(threadId, f.at, deadline);
    sent += r.sent;
    // Counts and reasons only — no customer words, no phone number.
    console.info(`[sales/autoreply] ${f.accountId}: rounds ${r.rounds}, sent ${r.sent}, stopped: ${r.stopped}`);
  }
  return { chats: chats.size, sent };
}
