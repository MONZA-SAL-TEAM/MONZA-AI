/**
 * PUBLIC configuration — the values that are allowed to reach a browser.
 *
 * Split out from lib/env.ts for two reasons, one of them load-bearing:
 *
 *  1. SAFETY. Nothing in this file is a secret, so a client component may
 *     import it without dragging server-only accessors into the bundle.
 *  2. CORRECTNESS. Next.js inlines `process.env.NEXT_PUBLIC_X` into client
 *     bundles only when it is written as a LITERAL property access. A dynamic
 *     lookup (`process.env[name]`) is not substituted and reads as undefined in
 *     the browser — so every public variable is read literally here, once.
 *
 * Empty-string handling is the whole point of centralising this: a Vercel
 * dashboard row created without a value arrives as "" rather than undefined, so
 * `??` never fires. Everything is trimmed and "" counts as absent.
 */

/** Trim, and treat empty/whitespace as absent. */
function clean(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/* ── The Monza CRM project — staff identity ─────────────────────────────── */

export const CRM_URL = clean(process.env.NEXT_PUBLIC_CRM_SUPABASE_URL);
export const CRM_ANON_KEY = clean(process.env.NEXT_PUBLIC_CRM_SUPABASE_ANON_KEY);

/** Both halves present. Staff sign-in is only possible when this is true. */
export function crmConfigured(): boolean {
  return CRM_URL !== null && CRM_ANON_KEY !== null;
}

/* ── The MONZA AI project — public client pair ──────────────────────────── */

/**
 * The committed public client pair for the MONZA AI Supabase project.
 *
 * Not a secret. An anon key is designed to be published — it ships in every
 * visitor's browser bundle and grants only what the project's RLS and storage
 * policies allow, which here is read access to one public bucket. Every write
 * goes through a server route holding the service-role key.
 *
 * It is kept as a default so the shared media library stays readable on a
 * deployment whose dashboard rows were never filled in. That convenience used
 * to HIDE the misconfiguration; `aiPublicSource()` below is how it stops doing
 * that — admin diagnostics report which of the two it is actually using.
 */
const AI_URL_DEFAULT = "https://fpsgsgldepgcowyivoow.supabase.co";
const AI_ANON_DEFAULT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZwc2dzZ2xkZXBnY293eWl2b293Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzNDA1MjYsImV4cCI6MjEwMzkxNjUyNn0.dg3OftDJZMdi4mQdSdeqY76kV-_mTULr10iUPSqtfEA";

const AI_URL_ENV = clean(process.env.NEXT_PUBLIC_AI_SUPABASE_URL);
const AI_ANON_ENV = clean(process.env.NEXT_PUBLIC_AI_SUPABASE_ANON_KEY);

export const AI_URL = AI_URL_ENV ?? AI_URL_DEFAULT;
export const AI_ANON_KEY = AI_ANON_ENV ?? AI_ANON_DEFAULT;

/** Where the public pair actually came from — for admin diagnostics only. */
export function aiPublicSource(): "environment" | "committed_default" {
  return AI_URL_ENV !== null && AI_ANON_ENV !== null
    ? "environment"
    : "committed_default";
}
