import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { isTrustedDevice, latestNote } from "@/lib/push/server";
import { GENERIC_NOTE, safeNoteUrl, type PushNote } from "@/lib/push/webpush";

/**
 * "What happened?" — asked by the service worker the moment a push wakes it. The push itself carries
 * nothing, so this is where the one line comes from: who and where, never what a customer wrote.
 *
 * Who may ask: a signed-in staff member, OR a device whose own push address a signed-in staff member
 * confirmed in the last 30 days (the sign-in lasts an hour; a phone in a pocket is woken long after).
 * Anybody else — and any failure — gets the generic line, which says nothing.
 */
export const dynamic = "force-dynamic";

async function answer(request: Request, endpoint: unknown): Promise<NextResponse> {
  let note: PushNote = GENERIC_NOTE;
  try {
    const access = await requireRealStaff(request);
    if (access.ok || (await isTrustedDevice(endpoint))) note = (await latestNote()) ?? GENERIC_NOTE;
  } catch {
    /* the generic line */
  }
  return NextResponse.json({ ...note, url: safeNoteUrl(note.url) }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request): Promise<NextResponse> {
  return answer(request, null);
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
  return answer(request, body?.endpoint);
}
