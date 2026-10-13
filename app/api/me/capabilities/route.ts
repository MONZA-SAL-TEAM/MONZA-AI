import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { channelDb } from "@/lib/channels/store";
import { canSeeInsights } from "@/lib/insights/access";

/**
 * What the signed-in staff member may open — so the side rail can hide what they cannot. Hiding is a
 * courtesy; every page and route checks again for itself.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const user = await requireStaff(request);
  if (!user) return NextResponse.json({ ok: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(
    {
      ok: true,
      insights: canSeeInsights(user, channelDb() !== null),
      admin: user.access?.admin === true,
      // The pages set for them in Team & access; null = not set (every page, as before).
      pages: user.access?.restricted ? user.access.pages : null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
