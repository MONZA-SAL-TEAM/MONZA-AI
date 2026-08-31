/**
 * POST /api/chat — one question in, one assistant turn out.
 *
 * Body: { conversationId?: string, message: string }
 * Returns: { conversationId: string | null, text: string, trace: [...] }
 *
 * Persistence (conversation + both messages) happens only when the AI's own
 * database is configured AND the caller is a real CRM identity. In demo mode
 * nothing is persisted, but the loop still runs — the connectors answer from
 * their labelled demo data. With no ANTHROPIC_API_KEY the route returns an
 * honest sentence saying the brain is not connected; it never fakes output.
 */

import { NextResponse } from "next/server";
import { requireStaff, isDemoIdentity } from "@/lib/auth";
import { aiDb, loadSettings, loadUserRules } from "@/lib/db";
import { buildMonzaRegistry } from "@/lib/tools/registry";
import { runAssistantTurn } from "@/lib/ai/loop";
import type { ClaudeMessage } from "@/lib/ai/client";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const HISTORY_LIMIT = 30;
const MESSAGE_CHAR_LIMIT = 4000;

async function loadHistory(
  db: SupabaseClient,
  conversationId: string,
  userId: string
): Promise<ClaudeMessage[] | null> {
  // Ownership check: the conversation must belong to the caller.
  const { data: convo, error: convoError } = await db
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("crm_user_id", userId)
    .maybeSingle();
  if (convoError || !convo) return null;

  const { data, error } = await db
    .from("messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error || !data) return [];

  return data
    .reverse()
    .filter(
      (m: { role: string; content: string | null }) =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.length > 0
    )
    .map(
      (m: { role: string; content: string | null }): ClaudeMessage => ({
        role: m.role as "user" | "assistant",
        content: m.content as string,
      })
    );
}

export async function POST(request: Request) {
  const user = await requireStaff(request);
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }

  let body: { conversationId?: unknown; message?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "That request was not readable." },
      { status: 400 }
    );
  }

  const message =
    typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json(
      { error: "Please type a question first." },
      { status: 400 }
    );
  }
  if (message.length > MESSAGE_CHAR_LIMIT) {
    return NextResponse.json(
      { error: "That message is too long. Please shorten it." },
      { status: 400 }
    );
  }

  const requestedConversationId =
    typeof body.conversationId === "string" && body.conversationId
      ? body.conversationId
      : null;

  const settings = await loadSettings();
  if (!settings.enabled) {
    return NextResponse.json({
      conversationId: requestedConversationId,
      text: "The assistant is currently switched off by an administrator.",
      trace: [],
    });
  }

  const db = aiDb();
  const demo = isDemoIdentity(user);
  const persist = Boolean(db) && !demo;

  // Resolve or create the conversation, and load prior turns.
  let conversationId: string | null = requestedConversationId;
  let history: ClaudeMessage[] = [];

  if (persist && db) {
    if (conversationId) {
      const loaded = await loadHistory(db, conversationId, user.userId);
      if (loaded === null) {
        return NextResponse.json(
          { error: "That conversation was not found." },
          { status: 404 }
        );
      }
      history = loaded;
    } else {
      const { data, error } = await db
        .from("conversations")
        .insert({ crm_user_id: user.userId, title: message.slice(0, 60) })
        .select("id")
        .single();
      if (error || !data) {
        return NextResponse.json(
          { error: "Could not start a new conversation right now." },
          { status: 500 }
        );
      }
      conversationId = data.id as string;
    }

    // Persist the user's message before anything can fail downstream.
    await db.from("messages").insert({
      conversation_id: conversationId,
      role: "user",
      content: message,
    });
  }

  // No brain connected: say so honestly. Never fake model output.
  if (!process.env.ANTHROPIC_API_KEY) {
    const text =
      "The assistant's brain is not connected yet — no Anthropic API key is set on the server. " +
      "Once an administrator adds it, I can answer questions like this by consulting the connected Monza systems.";
    if (persist && db && conversationId) {
      await db.from("messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: text,
        tool_trace: [],
      });
    }
    return NextResponse.json({ conversationId, text, trace: [] });
  }

  // Fail closed: a REAL identity with no AI database means live CRM queries
  // would run with every audit write silently dropped. That half-configured
  // state is refused, not tolerated — the audit trail is part of the product.
  if (!demo && !db) {
    return NextResponse.json({
      conversationId,
      text:
        "Monza AI's own database is not configured on this server, so I can't " +
        "record an audit trail — and I won't run live lookups without one. " +
        "An administrator needs to set the AI database keys, then this will work.",
      trace: [],
    });
  }

  const userRules = demo ? [] : await loadUserRules(user.userId);

  const result = await runAssistantTurn({
    identity: user,
    conversationId,
    userMessage: message,
    history,
    deps: {
      registry: buildMonzaRegistry(),
      userRules,
      // In demo mode there is nowhere to audit to; pass null explicitly so a
      // half-configured environment never writes rows for the demo identity.
      aiDb: demo ? null : db,
      settings: {
        model: settings.model,
        maxToolCalls: settings.maxToolCalls,
      },
    },
  });

  if (persist && db && conversationId) {
    await db.from("messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: result.text,
      tool_trace: result.trace,
      model: result.model,
    });
    await db
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);
  }

  return NextResponse.json({
    conversationId,
    text: result.text,
    trace: result.trace,
  });
}
