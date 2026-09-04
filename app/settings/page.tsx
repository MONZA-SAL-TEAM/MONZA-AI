import type { Metadata } from "next";
import SettingsClient, { type SettingsView } from "./SettingsClient";
import { FALLBACK_MODEL, aiDb } from "@/lib/db";
import { environmentPresence } from "@/lib/env";
import { requireStaffForPage } from "@/lib/auth-server";

export const metadata: Metadata = {
  title: "Settings — Monza AI",
};

export const dynamic = "force-dynamic";

/**
 * /settings — read-only in v1.
 *
 * The values come from the AI's own ai_settings table when that project is
 * configured; otherwise honest demo defaults, clearly marked. Nothing here
 * exposes a secret — the environment checklist reports presence, never
 * values, and the assistant model is described in plain words rather than a
 * raw identifier.
 */

/** Raw model ids never reach the screen — plain words only. */
const MODEL_LABELS: Record<string, string> = {
  "claude-opus-5": "Claude — the most capable tier",
  "claude-sonnet-4-5": "Claude — fast and capable",
  "claude-haiku-4-5": "Claude — quickest tier",
};

const ENV_CHECKLIST: { name: string; purpose: string }[] = [
  {
    name: "NEXT_PUBLIC_CRM_SUPABASE_URL",
    purpose: "Where the Monza CRM lives — staff sign in against it.",
  },
  {
    name: "NEXT_PUBLIC_CRM_SUPABASE_ANON_KEY",
    purpose: "Lets the sign-in happen; every question then runs as that person.",
  },
  {
    name: "NEXT_PUBLIC_AI_SUPABASE_URL",
    purpose: "Where the assistant keeps its own conversations and activity log.",
  },
  {
    name: "AI_SUPABASE_SERVICE_ROLE_KEY",
    purpose: "The assistant's key to its OWN records — never used on the CRM.",
  },
  {
    name: "ANTHROPIC_API_KEY",
    purpose: "The assistant itself.",
  },
];

const ENV_TEMPLATE = `# Monza CRM — staff sign in here; every question runs with their own access
NEXT_PUBLIC_CRM_SUPABASE_URL=
NEXT_PUBLIC_CRM_SUPABASE_ANON_KEY=

# Monza AI's own database (a SEPARATE project — never the CRM one)
NEXT_PUBLIC_AI_SUPABASE_URL=
AI_SUPABASE_SERVICE_ROLE_KEY=

# The assistant
ANTHROPIC_API_KEY=
`;

async function readAiSettings(): Promise<Record<string, string> | null> {
  const supabase = aiDb();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("ai_settings")
      .select("key,value");
    if (error || !data) return null;
    const out: Record<string, string> = {};
    for (const row of data as { key: string; value: string | null }[]) {
      if (row.value !== null) out[row.key] = row.value;
    }
    return out;
  } catch {
    return null;
  }
}

/** This page lists WHICH secrets are configured. Presence is still
 *  information, so it is shown only to a verified staff member — middleware's
 *  cookie-presence check was never enough on its own. */
export default async function SettingsPage() {
  await requireStaffForPage("/settings");

  const settings = await readAiSettings();
  const demo = settings === null;

  const presence = new Map(environmentPresence().map((e) => [e.name, e.set]));
  const modelId = settings?.["monza_ai.model"] ?? FALLBACK_MODEL;
  const maxToolCalls = settings?.["monza_ai.max_tool_calls_per_turn"] ?? "8";
  const enabled = (settings?.["monza_ai.enabled"] ?? "true") === "true";

  const view: SettingsView = {
    demo,
    modelLabel: MODEL_LABELS[modelId] ?? "Set by your administrator",
    maxToolCalls,
    assistantOn: enabled,
    // Presence comes from lib/env, which trims — a dashboard row saved empty
    // reads as NOT set, which is the truth the administrator needs.
    env: ENV_CHECKLIST.map((e) => ({
      name: e.name,
      purpose: e.purpose,
      set: presence.get(e.name) ?? false,
    })),
    envTemplate: ENV_TEMPLATE,
  };

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "36px 24px 64px" }}>
      <div className="stack-lg">
        <header className="stack" style={{ gap: 6 }}>
          <div className="eyebrow">Settings</div>
          <h1 className="h1">How the assistant is set up</h1>
          <p className="lede">
            A plain-words look at the current setup. Nothing on this page can
            be changed from here — your administrator manages these values.
          </p>
        </header>
        <div className="aurora" aria-hidden="true" style={{ marginTop: -6 }} />
        <SettingsClient view={view} />
      </div>
    </main>
  );
}
