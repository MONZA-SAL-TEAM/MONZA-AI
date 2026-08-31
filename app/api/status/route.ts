/**
 * GET /api/status — what is wired up, in booleans only. No URLs, no keys,
 * no secrets: presence, never values.
 */

import { NextResponse } from "next/server";
import { crmConfigured } from "@/lib/auth";
import { aiDbConfigured, loadSettings } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await loadSettings();
  return NextResponse.json({
    crmConfigured: crmConfigured(),
    aiDbConfigured: aiDbConfigured(),
    brainConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    enabled: settings.enabled,
  });
}
