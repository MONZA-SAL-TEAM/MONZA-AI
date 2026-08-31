/**
 * GET /api/conversations — the signed-in user's conversation list, newest
 * first. Empty in demo mode (nothing is persisted there).
 */

import { NextResponse } from "next/server";
import { requireStaff, isDemoIdentity } from "@/lib/auth";
import { aiDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await requireStaff(request);
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }

  const db = aiDb();
  if (!db || isDemoIdentity(user)) {
    return NextResponse.json({ conversations: [] });
  }

  const { data, error } = await db
    .from("conversations")
    .select("id, title, created_at, updated_at")
    .eq("crm_user_id", user.userId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json(
      { error: "Could not load your conversations right now." },
      { status: 500 }
    );
  }

  return NextResponse.json({ conversations: data ?? [] });
}
