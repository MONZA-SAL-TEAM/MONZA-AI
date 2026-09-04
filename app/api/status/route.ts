/**
 * GET /api/status
 *
 * Two audiences, deliberately separated:
 *
 *   ANYONE       → { status: "ok" }. A liveness probe and nothing else. This
 *                  route used to tell any anonymous caller whether the CRM, the
 *                  AI database and the Anthropic key were configured — a map of
 *                  which doors exist and which are unlocked. Health checks do
 *                  not need that, and attackers should not have it.
 *
 *   REAL STAFF   → the same plus the deployment's actual configuration, so an
 *                  administrator can diagnose a half-configured environment
 *                  from inside the product.
 *
 * Even the staff view reports PRESENCE, never values: no key, no key length,
 * no key prefix, no URL of a system the caller could not already reach.
 */

import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import {
  aiDbConfigured,
  aiPublicSource,
  brainConfigured,
  crmConfigured,
} from "@/lib/env";
import { loadSettings } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await requireRealStaff(request);
  if (!access.ok) {
    // Liveness only. The refusal reason is not disclosed either — "you are not
    // staff here" and "there are no staff here" look identical from outside.
    return NextResponse.json({ status: "ok" });
  }

  const settings = await loadSettings();
  return NextResponse.json({
    status: "ok",
    crmConfigured: crmConfigured(),
    aiDbConfigured: aiDbConfigured(),
    brainConfigured: brainConfigured(),
    assistantEnabled: settings.enabled,
    model: settings.model,
    maxToolCallsPerTurn: settings.maxToolCalls,
    /**
     * Where the AI project's PUBLIC client pair came from. "committed_default"
     * means no dashboard values are set and the repository's public defaults
     * are in use — which works, but hides a missing configuration. Surfacing it
     * here is how that stops being invisible.
     */
    aiPublicClientSource: aiPublicSource(),
  });
}
