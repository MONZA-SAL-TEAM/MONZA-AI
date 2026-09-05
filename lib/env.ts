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

/* ── Meta channels (Instagram, Messenger, WhatsApp) ─────────────────────── */

/**
 * The app secret Meta signs every webhook delivery with.
 *
 * Absent means the webhook REFUSES everything — see lib/channels/meta-signature
 * for why that is the only safe default. Unconfigured must not mean unguarded.
 */
export function metaAppSecret(): string | null {
  return read("META_APP_SECRET");
}

/**
 * Whether a staff reply actually leaves the building.
 *
 *   "log_only"  (default) the reply is stored and shown in the thread, and
 *               NOTHING is sent. The customer never sees it.
 *   "live"      the reply goes to Meta.
 *
 * DEFAULTS TO log_only, and an unrecognised value also means log_only. Going
 * live is a deliberate act by somebody who typed the word, after the receive
 * path has been proven end to end — not something a deployment falls into by
 * having a variable unset, misspelt, or created empty in a dashboard.
 */
export function channelsSendLive(): boolean {
  return read("CHANNELS_SEND_MODE") === "live";
}

/** The token echoed back during Meta's one-time subscription handshake. Ours
 *  to choose; it just has to match what is typed into the Meta dashboard. */
export function metaVerifyToken(): string | null {
  return read("META_VERIFY_TOKEN");
}

/** Read one connected account's access token by the env NAME its
 *  ChannelAccount records. Tokens are never held in code. */
export function channelToken(envName: string): string | null {
  // Guarded: the name comes from committed configuration, but reading an
  // arbitrary env var by request would be an oracle for every other secret.
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(envName)) return null;
  return read(envName);
}

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
