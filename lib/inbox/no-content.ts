/**
 * The sentences shown for an Instagram / Facebook message whose content Meta
 * did not hand over — never the customer's words. One place, so the screen,
 * the sales engine and the insights reader agree on what "nothing to read"
 * looks like (each treats it as a message with no words). WhatsApp has its own
 * sentence for a file still being copied (lib/channels/whatsapp.ts).
 */

/** Meta described nothing: the read came without the attachment fields. */
export const NO_TEXT = "Photo, video or attachment — open the app to see it.";
/** Meta marked the message unsupported (`is_unsupported`): it passes nothing on for it. */
export const UNSUPPORTED_TEXT = "A message Meta does not pass on (an unsupported type) — open the app to see it.";
/** Meta listed a photo, video, share or story but gave no link the inbox can draw. */
export const UNSHOWN_TEXT = "A photo, video or file Meta sent without a link — open the app to see it.";

/** WhatsApp: a file still being copied from Meta (lib/channels/whatsapp.ts shows it; defined here so the composer's quote can tell it from words). */
export const WA_ATTACHMENT_ONLY = "Photo, video, voice note or file — open WhatsApp to see it.";

const NO_CONTENT: ReadonlySet<string> = new Set([NO_TEXT, UNSUPPORTED_TEXT, UNSHOWN_TEXT]);

/** A stand-in on ANY channel: ours for Instagram / Facebook, or WhatsApp's own. Never the customer's words. */
export function isStandIn(text: string): boolean {
  return NO_CONTENT.has(text.trim()) || text.trim() === WA_ATTACHMENT_ONLY;
}

/** Whether a message's text is one of ours standing in for content, not the customer's words. */
export function isNoContent(text: string): boolean {
  return NO_CONTENT.has(text.trim());
}
