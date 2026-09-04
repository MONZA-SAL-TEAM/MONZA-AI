/**
 * SERVER configuration — every environment variable the server reads, read one
 * way, in one place. Public values live in lib/env-public.ts and are
 * re-exported here so server code has a single import.
 *
 * Why this file exists: a Vercel dashboard row created without a value arrives
 * as an EMPTY STRING, not `undefined`. `process.env.X ?? fallback` does not
 * catch that, and production spent two days believing its own database was
 * unconfigured because of it. Everything here trims, and treats "" as absent.
 *
 * SECRETS HAVE NO FALLBACK. `AI_SUPABASE_SERVICE_ROLE_KEY` and
 * `ANTHROPIC_API_KEY` are absent until the environment supplies them; nothing
 * in this repository can stand in for them, and no accessor here ever returns
 * a secret's length, prefix or shape — only whether it is present.
 *
 * Do not import this module from a client component: use lib/env-public.ts.
 */

export {
  AI_ANON_KEY,
  AI_URL,
  CRM_ANON_KEY,
  CRM_URL,
  aiPublicSource,
  crmConfigured,
} from "@/lib/env-public";

import { AI_ANON_KEY, AI_URL, CRM_ANON_KEY, CRM_URL } from "@/lib/env-public";

/** Trimmed value, or null when unset OR set to an empty/whitespace string. */
function read(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/* ── The Monza CRM project ──────────────────────────────────────────────── */

export function crmUrl(): string | null {
  return CRM_URL;
}

export function crmAnonKey(): string | null {
  return CRM_ANON_KEY;
}

/* ── MONZA AI's own project ─────────────────────────────────────────────── */

export function aiUrl(): string {
  return AI_URL;
}

export function aiAnonKey(): string {
  return AI_ANON_KEY;
}

/** The service-role key. Server-only, no fallback, never returned to a client. */
export function aiServiceRoleKey(): string | null {
  return read("AI_SUPABASE_SERVICE_ROLE_KEY");
}

/**
 * True when the AI's own database can be written. The URL always resolves (see
 * lib/env-public.ts), so this turns entirely on the service key being present —
 * which is what "configured" has always meant in practice, and what the old
 * check got wrong by also requiring an env-supplied URL.
 */
export function aiDbConfigured(): boolean {
  return aiServiceRoleKey() !== null;
}

/* ── The brain ──────────────────────────────────────────────────────────── */

export function anthropicApiKey(): string | null {
  return read("ANTHROPIC_API_KEY");
}

export function brainConfigured(): boolean {
  return anthropicApiKey() !== null;
}

/** Model id override. The ai_settings row still wins over this. */
export function modelOverride(): string | null {
  return read("MONZA_AI_MODEL");
}

/**
 * Presence-only report for the settings screen. Values NEVER appear — not the
 * key, not its length, not its first characters. A boolean is the entire
 * answer an administrator needs to see from inside the product.
 */
export function environmentPresence(): { name: string; set: boolean }[] {
  return [
    { name: "NEXT_PUBLIC_CRM_SUPABASE_URL", set: CRM_URL !== null },
    { name: "NEXT_PUBLIC_CRM_SUPABASE_ANON_KEY", set: CRM_ANON_KEY !== null },
    {
      name: "NEXT_PUBLIC_AI_SUPABASE_URL",
      set: read("NEXT_PUBLIC_AI_SUPABASE_URL") !== null,
    },
    {
      name: "NEXT_PUBLIC_AI_SUPABASE_ANON_KEY",
      set: read("NEXT_PUBLIC_AI_SUPABASE_ANON_KEY") !== null,
    },
    { name: "AI_SUPABASE_SERVICE_ROLE_KEY", set: aiServiceRoleKey() !== null },
    { name: "ANTHROPIC_API_KEY", set: anthropicApiKey() !== null },
  ];
}
