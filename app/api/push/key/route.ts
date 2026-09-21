import { NextResponse } from "next/server";
import { pushSetup } from "@/lib/push/server";
import { vapidFromEnv } from "@/lib/push/webpush";

/** The PUBLIC half of the push keys — a browser needs it to subscribe. Public by design; the private half never leaves the server. */
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const setup = pushSetup();
  return NextResponse.json(
    { ok: setup === "ready", setup, publicKey: setup === "ready" ? (vapidFromEnv()?.publicKey ?? null) : null },
    { headers: { "Cache-Control": "no-store" } }
  );
}
