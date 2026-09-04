/**
 * POST /api/suggest — draft a reply for one conversation.
 *
 * The whole point of this route is that it CANNOT send. It reads a thread,
 * asks the local model for words, and returns them. Putting a message into a
 * conversation is a separate act a person performs; there is no code path from
 * here to an outbound message, and there must never be one.
 *
 * The model runs on this machine (Ollama, loopback). No customer message
 * leaves the building, which is exactly why a local model is the right choice
 * for reading a customer's words.
 *
 * Body:  { conversationId: string }
 * Reply: { ok: true, text, model, ms, fingerprint }
 *        { ok: false, reason, message }   — always with words for the screen
 */

import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { getSource, readContext } from "@/lib/domain";
import { draftReply } from "@/lib/ai/sales-coach";
import { FAILURE_MESSAGE } from "@/lib/ai/ollama";
import {
  DEMO_CONVERSATIONS,
  demoMessagesFor,
} from "@/lib/inbox/demo-conversations";

export const dynamic = "force-dynamic";
/** A local 20B model reasons before it answers; give it room. */
export const maxDuration = 120;

export async function POST(request: Request): Promise<NextResponse> {
  const user = await requireStaff(request);
  if (!user) {
    return NextResponse.json(
      { ok: false, reason: "signInRequired", message: "Please sign in first." },
      { status: 401 }
    );
  }

  let body: { conversationId?: unknown; steer?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, reason: "badRequest", message: "That request was not readable." },
      { status: 400 }
    );
  }

  const conversationId =
    typeof body.conversationId === "string" ? body.conversationId : "";
  if (!conversationId) {
    return NextResponse.json(
      { ok: false, reason: "badRequest", message: "Which conversation?" },
      { status: 400 }
    );
  }

  // Conversations are Monza AI's own data. Today that is the demo set; when the
  // channels are connected this reads the inbox tables instead, and nothing
  // else in this route changes.
  const conversation = DEMO_CONVERSATIONS.find((c) => c.id === conversationId);
  if (!conversation) {
    return NextResponse.json(
      { ok: false, reason: "notFound", message: "That conversation was not found." },
      { status: 404 }
    );
  }

  // Context comes from the SOURCE systems through the adapter, so the coach
  // sees exactly what the screen shows and cannot know more than we do.
  const source = getSource();
  const ctx = readContext(user);
  const [customer, vehicles, installments] = await Promise.all([
    source.getCustomer(conversation.customerId, ctx),
    source.listVehicles(ctx, { customerId: conversation.customerId }),
    source.listInstallments(ctx, {
      customerId: conversation.customerId,
      status: ["due", "overdue"],
    }),
  ]);

  const steer = typeof body.steer === "string" ? body.steer.slice(0, 200) : undefined;

  const result = await draftReply(
    {
      conversation,
      messages: demoMessagesFor(conversation.id),
      customer,
      vehicles,
      installments,
    },
    steer ? { steer } : {}
  );

  if (result.ok) {
    return NextResponse.json({
      ok: true,
      // The four parts stay separate so the card can render them separately —
      // the reply big and copyable, the slots as chips, the note quiet.
      reply: result.draft.reply,
      language: result.draft.language,
      rightToLeft: result.rightToLeft,
      needs: result.draft.needs,
      slots: result.slots,
      note: result.draft.note,
      // "check" means something in the reply is not backed by the facts; the
      // spans say which words, and the card marks them. Never auto-corrected.
      level: result.level,
      flags: result.flags,
      model: result.model,
      ms: result.ms,
      promptVersion: result.promptVersion,
      anchorMessageId: result.anchorMessageId,
    });
  }

  if (result.reason === "ollama_failed") {
    // 503: the drafting service is unavailable, not the request's fault. The
    // message names WHICH thing is wrong so the screen can be specific.
    return NextResponse.json(
      {
        ok: false,
        reason: result.failure,
        message: FAILURE_MESSAGE[result.failure],
      },
      { status: 503 }
    );
  }

  return NextResponse.json(
    { ok: false, reason: result.reason, message: result.message },
    { status: 422 }
  );
}
