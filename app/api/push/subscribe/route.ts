import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { pushSetup, removeSubscription, saveSubscription } from "@/lib/push/server";

/**
 * A staff member switches notifications on (POST) or off (DELETE) for THIS device. Staff only. The
 * address is checked against the push services' own hosts before it is kept (lib/push/webpush.ts).
 */
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

async function endpointOf(request: Request): Promise<unknown> {
  const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
  return body?.endpoint;
}

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request);
  if (!access.ok) return NextResponse.json({ ok: false, message: "Please sign in." }, { status: access.reason === "unauthenticated" ? 401 : 403, headers: NO_STORE });
  if (pushSetup() !== "ready") return NextResponse.json({ ok: false, message: "Notifications are not set up on the server yet." }, { status: 503, headers: NO_STORE });
  const saved = await saveSubscription(access.user.userId, await endpointOf(request), request.headers.get("user-agent"));
  if (saved === "bad_endpoint") return NextResponse.json({ ok: false, message: "This browser's notification address is not one Monza AI can use." }, { status: 400, headers: NO_STORE });
  if (saved === "unavailable") return NextResponse.json({ ok: false, message: "Notifications could not be saved just now." }, { status: 503, headers: NO_STORE });
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request);
  if (!access.ok) return NextResponse.json({ ok: false }, { status: access.reason === "unauthenticated" ? 401 : 403, headers: NO_STORE });
  await removeSubscription(access.user.userId, await endpointOf(request));
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
