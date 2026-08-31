/**
 * GET /api/conversations/[id]/messages — one conversation's messages, oldest
 * first, only if the conversation belongs to the signed-in user. In demo mode
 * nothing is persisted, so there is nothing to open.
 */

import { NextResponse } from "next/server";
import { requireStaff, isDemoIdentity } from "@/lib/auth";
import { aiDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const user = await requireStaff(request);
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }

  const db = aiDb();
  if (!db || isDemoIdentity(user)) {
    return NextResponse.json({ messages: [] });
  }

  // Ownership first: a conversation id that is not yours behaves exactly like
  // one that does not exist.
  const { data: conv } = await db
    .from("conversations")
    .select("id")
    .eq("id", params.id)
    .eq("crm_user_id", user.userId)
    .maybeSingle();
  if (!conv) {
    return NextResponse.json(
      { error: "That conversation was not found." },
      { status: 404 }
    );
  }

  const { data, error } = await db
    .from("messages")
    .select("id, role, content, tool_trace, tables, followups, created_at")
    .eq("conversation_id", params.id)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) {
    return NextResponse.json(
      { error: "Could not load that conversation right now." },
      { status: 500 }
    );
  }

  return NextResponse.json({ messages: data ?? [] });
}
