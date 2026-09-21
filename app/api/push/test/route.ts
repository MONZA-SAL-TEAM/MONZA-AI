import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { notifyAll, pushSetup } from "@/lib/push/server";

/** "Send me a test": one notification to every device that has them on — proof the whole path works. Staff only. */
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request);
  if (!access.ok) return NextResponse.json({ ok: false, message: "Please sign in." }, { status: access.reason === "unauthenticated" ? 401 : 403, headers: NO_STORE });
  if (pushSetup() !== "ready") return NextResponse.json({ ok: false, message: "Notifications are not set up on the server yet." }, { status: 503, headers: NO_STORE });
  const sent = await notifyAll({ title: "Monza AI notifications are on", body: "This is a test. New messages will arrive like this, even when the app is closed.", url: "/inbox", tag: "test" }, 8_000);
  return NextResponse.json({ ok: sent > 0, sent, message: sent > 0 ? `Sent to ${sent} device${sent === 1 ? "" : "s"}.` : "No device accepted it — switch notifications off and on again on this device." }, { headers: NO_STORE });
}
