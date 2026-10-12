import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { INSIGHTS_CAPS } from "@/lib/insights/access";
import { channelDb } from "@/lib/channels/store";
import { actorOf, canManage } from "@/lib/leads/ownership-server";

/**
 * POST /api/insights/spend { month: "YYYY-MM", brand, channel, amount } — what Monza spent on ads that month
 * (USD), typed by a manager from the ad accounts' own figures, so cost per lead is computed from real money.
 * One figure per month, brand and channel: saving again replaces it (who and when are kept). DELETE ?id=.
 */
export const dynamic = "force-dynamic";

async function manager(request: Request) {
  const access = await requireRealStaff(request, INSIGHTS_CAPS);
  if (!access.ok) return { error: NextResponse.json({ ok: false, message: "Not available for your role." }, { status: access.reason === "unauthenticated" ? 401 : 403 }) };
  const actor = await actorOf(access.user);
  if (!canManage(actor)) return { error: NextResponse.json({ ok: false, message: "Only a manager or the owner can enter ad spend." }, { status: 403 }) };
  return { actor };
}

export async function POST(request: Request): Promise<NextResponse> {
  const m = await manager(request);
  if ("error" in m) return m.error!;
  const b = (await request.json().catch(() => null)) as { month?: unknown; brand?: unknown; channel?: unknown; amount?: unknown } | null;
  const month = typeof b?.month === "string" && /^20\d{2}-(0[1-9]|1[0-2])$/.test(b.month) ? `${b.month}-01` : null;
  const brand = typeof b?.brand === "string" && ["voyah", "mhero", "monza"].includes(b.brand) ? b.brand : null;
  const channel = typeof b?.channel === "string" && ["whatsapp", "instagram", "facebook", "all"].includes(b.channel) ? b.channel : null;
  const amount = typeof b?.amount === "number" ? b.amount : typeof b?.amount === "string" ? Number(b.amount) : NaN;
  if (!month || !brand || !channel || !Number.isFinite(amount) || amount < 0 || amount >= 10_000_000) return NextResponse.json({ ok: false, message: "Enter a month, a brand, a channel and an amount in dollars." }, { status: 400 });
  const sb = channelDb();
  if (!sb) return NextResponse.json({ ok: false, message: "The database is not reachable here." }, { status: 503 });
  const { error } = await sb.from("insight_ad_spend").upsert({ month, brand, channel, amount, currency: "USD", by_staff: m.actor.id, by_name: m.actor.name, at: new Date().toISOString() }, { onConflict: "month,brand,channel" });
  if (error) return NextResponse.json({ ok: false, message: "The figure could not be saved." }, { status: 503 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const m = await manager(request);
  if ("error" in m) return m.error!;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, message: "Unknown figure." }, { status: 400 });
  const sb = channelDb();
  if (!sb) return NextResponse.json({ ok: false, message: "The database is not reachable here." }, { status: 503 });
  const { error } = await sb.from("insight_ad_spend").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, message: "Not deleted." }, { status: 503 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
