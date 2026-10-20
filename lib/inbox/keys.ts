/**
 * Enter sends (Samer, 2026-10-20) — PURE. As in WhatsApp Web: Enter sends, Shift+Enter makes a new line;
 * Ctrl/Cmd+Enter still sends too. On a phone's keyboard Enter stays a new line (as in the WhatsApp app) and
 * the Send button sends — long replies are typed there without a Shift key. An Enter pressed while an
 * input method is still composing (Arabic / Chinese predictive keyboards) is never a send.
 */
export function enterSends(e: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; isComposing?: boolean }, touchKeyboard: boolean): boolean {
  if (e.key !== "Enter" || e.isComposing) return false;
  if (e.ctrlKey || e.metaKey) return true;
  if (e.shiftKey) return false;
  return !touchKeyboard;
}

/** Is this a phone or tablet keyboard? Decided in the browser; the server answers "no". */
export function hasTouchKeyboard(): boolean {
  return typeof window !== "undefined" && (window.matchMedia?.("(pointer: coarse)").matches ?? false);
}
