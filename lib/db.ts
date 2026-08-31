/**
 * MONZA AI's OWN database — conversations, messages, permissions, audit,
 * settings. A SEPARATE Supabase project from the CRM; the service key here is
 * fine and expected (rule 1 forbids service keys only against CONNECTED
 * systems). When the env is not set every reader returns safe defaults so the
 * app runs fully in demo mode.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ToolRule } from "@/lib/permissions/kernel";

export interface AiSettings {
  /** From ai_settings or MONZA_AI_MODEL — resolved by loadSettings(). */
  model: string;
  maxToolCalls: number;
  enabled: boolean;
}

/**
 * The ONE last-resort model id in the whole codebase, used only when both the
 * MONZA_AI_MODEL env var and the ai_settings row are absent. Every other file
 * reads the model through loadSettings() or imports this constant — a second
 * model literal anywhere else is a defect.
 */
export const FALLBACK_MODEL = "claude-opus-5";

const DEFAULT_SETTINGS: AiSettings = {
  model: FALLBACK_MODEL,
  maxToolCalls: 8,
  enabled: true,
};

export function aiDbConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_AI_SUPABASE_URL &&
      process.env.AI_SUPABASE_SERVICE_ROLE_KEY
  );
}

/** Service client for the AI's own project, or null when unconfigured. */
export function aiDb(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_AI_SUPABASE_URL;
  const key = process.env.AI_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Read ai_settings with defaults. The model id may also come from the
 * environment (MONZA_AI_MODEL); the database value wins when present.
 */
export async function loadSettings(): Promise<AiSettings> {
  const envModel = process.env.MONZA_AI_MODEL;
  const base: AiSettings = {
    ...DEFAULT_SETTINGS,
    model: envModel || DEFAULT_SETTINGS.model,
  };

  const db = aiDb();
  if (!db) return base;

  try {
    const { data, error } = await db
      .from("ai_settings")
      .select("key, value")
      .in("key", [
        "monza_ai.model",
        "monza_ai.max_tool_calls_per_turn",
        "monza_ai.enabled",
      ]);
    if (error || !data) return base;

    const map = new Map<string, string | null>(
      data.map((r: { key: string; value: string | null }) => [r.key, r.value])
    );

    const model = map.get("monza_ai.model");
    const maxRaw = map.get("monza_ai.max_tool_calls_per_turn");
    const enabledRaw = map.get("monza_ai.enabled");

    const parsedMax = maxRaw ? Number.parseInt(maxRaw, 10) : NaN;

    return {
      model: model || base.model,
      maxToolCalls:
        Number.isFinite(parsedMax) && parsedMax > 0
          ? parsedMax
          : base.maxToolCalls,
      enabled: enabledRaw == null ? base.enabled : enabledRaw !== "false",
    };
  } catch {
    return base;
  }
}

/** Layer-1 per-user rules from tool_permissions. Empty in demo mode. */
export async function loadUserRules(userId: string): Promise<ToolRule[]> {
  const db = aiDb();
  if (!db) return [];

  try {
    const { data, error } = await db
      .from("tool_permissions")
      .select("connector_key, tool_name, effect")
      .eq("crm_user_id", userId);
    if (error || !data) return [];

    return data
      .filter(
        (r: { effect: string }) => r.effect === "allow" || r.effect === "deny"
      )
      .map(
        (r: {
          connector_key: string;
          tool_name: string;
          effect: string;
        }): ToolRule => ({
          connector_key: r.connector_key,
          tool_name: r.tool_name,
          effect: r.effect as "allow" | "deny",
        })
      );
  } catch {
    return [];
  }
}
