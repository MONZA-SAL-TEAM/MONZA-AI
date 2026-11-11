/**
 * The message a reply answers, as the thread shows it above the reply — PURE, client-safe.
 *
 * Shared by the WhatsApp thread (lib/channels/whatsapp.ts quoteReplies: a reply read from the webhook
 * or sent from here, matched to the message it answers) and the inbox's composer (Samer, 2026-11-11:
 * "reply to a specific message" — the quote shown while a person writes the reply, and on the stand-in
 * row until the real one is read back). Words are cut to a line, never invented; a photo keeps its link
 * as a thumbnail; a stand-in sentence (a file still being copied, a message Meta passed nothing on for)
 * counts as no words.
 */

import type { InboxMessage, QuotedMessage } from "@/lib/inbox/types";

const QUOTE_WORDS = 140;

export function quoteOf(target: InboxMessage, isStandIn: (text: string) => boolean): QuotedMessage {
  if (target.deleted) return { author: target.author, text: "This message was deleted" };
  const first = target.attachments?.[0];
  const words = isStandIn(target.text) ? "" : target.text.replace(/\s+/g, " ").trim();
  return {
    author: target.author,
    text: words.length > QUOTE_WORDS ? `${words.slice(0, QUOTE_WORDS - 1)}…` : words,
    ...(first ? { kind: first.kind } : {}),
    ...(first && (first.kind === "image" || first.kind === "sticker") && first.state === "ready" && first.url ? { thumbUrl: first.url } : {}),
  };
}

/**
 * The platform's id a reply must name to quote this message: WhatsApp's wamid (kept on the stored row),
 * Instagram's message id (the id Meta lists the thread with). Null when the message cannot be quoted —
 * a row not yet sent, a Facebook Messenger message (Meta's Send API has no reply there), a deleted one.
 */
export function replyableId(m: InboxMessage, channel: string): string | null {
  if (m.deleted || "pendingState" in m) return null;
  if (channel === "whatsapp") return m.externalId ?? null;
  if (channel === "instagram") return m.id && !m.id.startsWith("pending-") ? m.id : null;
  return null;
}
