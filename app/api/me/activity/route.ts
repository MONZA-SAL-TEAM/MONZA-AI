import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { recordActivity, staffName } from "@/lib/insights/activity-server";
import { SECTIONS } from "@/lib/insights/activity";
import { touchPresence } from "@/lib/access/access-server";

/**
 * POST /api/me/activity { section?, active?, nav?, signIn?, device? } — the signed-in person is here
 * (components/ActivityPing.tsx; the sign-in screen sends { signIn: true }). For THEMSELVES only: the id is the
 * session's, never the browser's.
 *
 *   - presence: the section open now, when last seen and last active, the kind of device (Team & access);
 *   - a "page" line when the section changes, a "sign_in" line on signing in;
 *   - a minute of active time when `active` and it is the minute tick (not a navigation).
 *
 * Only a section's name is kept — never a page address, never a customer. The database credits at most the
 * time since the previous minute, so two open tabs never count double.
 */
export const dynamic = "force-dynamic";

const DEVICES = ["phone", "tablet", "computer"] as const;

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request);
  if (!access.ok) return NextResponse.json({ ok: false }, { status: access.reason === "unauthenticated" ? 401 : 403 });
  const body = (await request.json().catch(() => null)) as { section?: unknown; active?: unknown; nav?: unknown; signIn?: unknown; device?: unknown } | null;
  const section = typeof body?.section === "string" ? ((SECTIONS as readonly string[]).find((s) => s === body.section) ?? "other") : null;
  const active = body?.active === true;
  const nav = body?.nav === true;
  const signIn = body?.signIn === true;
  const device = DEVICES.find((d) => d === body?.device) ?? null;
  const name = await staffName(access.user);
  await touchPresence({ staffId: access.user.userId, name, section, active: active || nav || signIn, device, signIn });
  const ok = active && !nav && section ? await recordActivity(access.user, section, 60) : true;
  return NextResponse.json({ ok }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
