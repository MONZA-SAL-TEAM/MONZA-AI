import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { saveReplyTemplate } from "@/lib/channels/wa-templates-server";
import { staffName } from "@/lib/insights/activity-server";

/**
 * POST /api/admin/templates { name, language, label, body, enabled } — list a WhatsApp template (already approved
 * in WhatsApp Manager) so staff can send it after the 24-hour window, or switch one off. Admins only.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request);
  if (!access.ok) return NextResponse.json({ ok: false, message: "Only an admin can change the templates." }, { status: access.reason === "unauthenticated" ? 401 : 403 });
  if (!access.user.access?.admin) return NextResponse.json({ ok: false, message: "Only an admin can change the templates." }, { status: 403 });
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const r = await saveReplyTemplate(
    { id: access.user.userId, name: await staffName(access.user) },
    { name: str(b?.name).trim(), language: str(b?.language).trim() || "en", label: str(b?.label), body: str(b?.body), enabled: b?.enabled !== false }
  );
  if (!r.ok) return NextResponse.json({ ok: false, message: r.problem }, { status: 400 });
  return NextResponse.json({ ok: true, message: "Saved." }, { headers: { "Cache-Control": "no-store" } });
}
