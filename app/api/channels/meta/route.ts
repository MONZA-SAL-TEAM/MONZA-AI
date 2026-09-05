/**
 * THE META WEBHOOK — where Instagram, Messenger and WhatsApp messages arrive.
 *
 * GET  — the subscription handshake. Meta calls once with a token you chose and
 *        a challenge to echo back.
 * POST — deliveries. Signature-verified, normalised, then handed on.
 *
 * ── This endpoint is PUBLIC and its callers are anonymous ───────────────────
 * Meta cannot sign in, so the usual requireRealStaff gate is impossible here.
 * The signature IS the authentication, and it is checked before the body is
 * parsed, before anything is looked up, and before a single byte is stored.
 * Everything downstream — the inbox staff read, the threads the local model
 * drafts from — trusts that check and nothing else.
 *
 * ── Answer 200 to Meta almost always ────────────────────────────────────────
 * Meta retries a failed delivery for up to 7 days with increasing backoff, and
 * disables a subscription that keeps failing. So a payload we cannot understand
 * is logged and answered 200: it is not going to become understandable on the
 * fourth attempt, and a poison message must not take the channel down for every
 * other customer.
 *
 * The ONE exception is a bad signature, which gets 403. That is not a delivery
 * failing, it is somebody who is not Meta, and it must never look accepted.
 */

import { NextResponse } from "next/server";
import { instagramAdapter } from "@/lib/channels/instagram";
import { CHANNEL_ACCOUNTS, type InboundEvent } from "@/lib/channels/types";
import {
  verifyMetaSignature,
  verifySubscription,
} from "@/lib/channels/meta-signature";
import { metaAppSecret, metaVerifyToken } from "@/lib/env";

export const dynamic = "force-dynamic";

/** The adapters, in the order their payloads are tried. Each ignores an
 *  envelope that is not its own, so order is irrelevant to correctness. */
const ADAPTERS = [instagramAdapter];

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const challenge = verifySubscription(params, metaVerifyToken());

  if (challenge === null) {
    // No detail: this endpoint answers to anyone, and "wrong token" versus
    // "not configured" is a fact worth keeping to ourselves.
    console.warn("[channels/meta] subscription check refused");
    return new Response("Forbidden", { status: 403 });
  }

  // Meta requires the challenge echoed as PLAIN TEXT. JSON fails the check.
  return new Response(challenge, {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

export async function POST(request: Request): Promise<Response> {
  // RAW text, read exactly once. Re-serialising parsed JSON produces different
  // bytes from the ones Meta signed, and the check would never pass.
  const raw = await request.text();

  const check = verifyMetaSignature(
    raw,
    request.headers.get("x-hub-signature-256"),
    metaAppSecret()
  );
  if (!check.ok) {
    console.warn(`[channels/meta] signature refused: ${check.reason}`);
    return new Response("Forbidden", { status: 403 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    console.error("[channels/meta] signed body was not JSON");
    return NextResponse.json({ ok: true });
  }

  let events: InboundEvent[] = [];
  try {
    for (const adapter of ADAPTERS) {
      events = events.concat(adapter.parse(body, CHANNEL_ACCOUNTS));
    }
  } catch (e) {
    // A shape we did not anticipate. Log it and accept the delivery: retrying
    // will produce the same crash, and a failing endpoint gets disabled.
    console.error("[channels/meta] parse failed:", e);
    return NextResponse.json({ ok: true });
  }

  if (events.length === 0) return NextResponse.json({ ok: true, stored: 0 });

  /*
   * STORAGE IS NOT WIRED YET, and this says so rather than pretending.
   *
   * No account is connected (CHANNEL_ACCOUNTS is empty) and no conversation
   * table exists, so there is nothing to write to and nowhere for these to go.
   * Logging the COUNT and the accounts — never the message text, which is
   * customer content and does not belong in a server log — makes the endpoint
   * verifiable end to end the moment a channel is connected: point Meta at it,
   * send yourself a DM, and the log says whether it arrived and whether it
   * matched a known account.
   */
  const unmatched = events.filter((e) => e.accountId === null).length;
  console.info(
    `[channels/meta] ${events.length} event(s), ${unmatched} for no connected account`
  );

  return NextResponse.json({ ok: true, stored: 0, received: events.length });
}
