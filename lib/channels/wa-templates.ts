/**
 * WhatsApp templates for replying after the 24-hour window — PURE (Samer, 2026-10-20: "reply to messages even
 * after 24 hours"). A template is approved at Meta (WhatsApp Manager); an admin lists it in MONZA AI with its
 * words, `{{1}}`, `{{2}}`… marking the blanks (migration 031). A person picks one, fills the blanks, sees exactly
 * what will go, and presses Send. WhatsApp charges for each.
 */

export interface ReplyTemplate {
  name: string;
  language: string;
  label: string;
  body: string;
  params: number;
  enabled: boolean;
}

export const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;
export const TEMPLATE_LANGUAGE = /^[a-z]{2,3}(_[A-Z]{2})?$/;

/** How many blanks the words have: the highest {{n}}, which must run 1, 2, 3… with none skipped. */
export function blanksOf(body: string): { count: number; ok: boolean } {
  const nums = [...body.matchAll(/\{\{\s*(\d{1,2})\s*\}\}/g)].map((m) => Number(m[1]));
  if (nums.length === 0) return { count: 0, ok: true };
  const max = Math.max(...nums);
  const all = new Set(nums);
  for (let i = 1; i <= max; i++) if (!all.has(i)) return { count: max, ok: false };
  return { count: max, ok: max <= 10 };
}

/** One blank's text as WhatsApp accepts it: one line, no tabs, no long runs of spaces. */
export function cleanParam(text: string): string {
  return text.replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim().slice(0, 900);
}

/** The words that go out, blanks filled — what is shown before sending and kept in the thread. */
export function renderTemplate(body: string, params: readonly string[]): string {
  return body.replace(/\{\{\s*(\d{1,2})\s*\}\}/g, (_, n: string) => cleanParam(params[Number(n) - 1] ?? "") || `{{${n}}}`);
}

/** A template as an admin typed it: problems in words, or the row to keep. */
export function templateProblem(t: { name: string; language: string; label: string; body: string }): string | null {
  if (!TEMPLATE_NAME.test(t.name)) return "The name must be exactly as in WhatsApp Manager: small letters, digits and _ only.";
  if (!TEMPLATE_LANGUAGE.test(t.language)) return "The language must be WhatsApp's code, e.g. en, en_US or ar.";
  if (!t.label.trim() || t.label.length > 80) return "Give it a short name staff will recognise (80 characters at most).";
  if (!t.body.trim() || t.body.length > 1024) return "Paste the template's words (1,024 characters at most).";
  if (!blanksOf(t.body).ok) return "The blanks must be {{1}}, {{2}}, {{3}}… in order, at most 10.";
  return null;
}

/** Every blank filled? */
export function paramsProblem(t: Pick<ReplyTemplate, "params">, params: readonly string[]): string | null {
  for (let i = 0; i < t.params; i++) if (!cleanParam(params[i] ?? "")) return `Fill in blank {{${i + 1}}}.`;
  return null;
}
