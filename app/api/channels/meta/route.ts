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
import { messengerAdapter } from "@/lib/channels/messenger";
import { parseWhatsAppStatuses, whatsappAdapter, type WhatsAppStatusUpdate } from "@/lib/channels/whatsapp";
import type { ChannelAccount, InboundEvent } from "@/lib/channels/types";
import { applyWhatsAppStatuses, listAccounts, recordDelivery, storeInbound } from "@/lib/channels/store";
import { captureMedia } from "@/lib/channels/wa-media-store";
import { runAutoreply } from "@/lib/wasales/autoreply";
import {
  accountsForApp,
  parseMetaAppSecrets,
  withInstagramLoginSecrets,
  verifyMetaSignatureForApps,
  verifySubscription,
} from "@/lib/channels/meta-signature";
import { metaAppSecret, metaAppSecretsMap, metaInstagramAppSecretVoyah, metaVerifyToken } from "@/lib/env";

export const dynamic = "force-dynamic";
/** Room to copy a customer's photo or voice note out of Meta before answering. */
export const maxDuration = 30;

/** The adapters, in the order their payloads are tried. Each ignores an
 *  envelope that is not its own, so order is irrelevant to correctness. */
const ADAPTERS = [instagramAdapter, messengerAdapter, whatsappAdapter];

/**
 * How long a delivery spends copying WhatsApp files out of Meta. A photo or a
 * voice note takes well under a second; what does not fit stays "pending" for
 * the thread and the daily job (lib/channels/wa-media-store.ts).
 */
const MEDIA_BUDGET_MS = 8_000;

/** How long the sales autoreply pilot may spend answering, inside maxDuration. */
const AUTOREPLY_BUDGET_MS = 12_000;

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

  // One secret per Meta app (lib/env.ts). The check also says WHICH app signed,
  // and that decides below which accounts this delivery may speak for.
  const check = verifyMetaSignatureForApps(
    raw,
    request.headers.get("x-hub-signature-256"),
    withInstagramLoginSecrets(parseMetaAppSecrets(metaAppSecretsMap(), metaAppSecret()), {
      "2636993883137857": metaInstagramAppSecretVoyah(),
    })
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

  // The connected accounts come from the DATABASE, not from code, so
  // connecting one is a row rather than a deploy. An empty list is the honest
  // state today and makes every event "unmatched" rather than mis-filed.
  let accounts: ChannelAccount[] = [];
  try {
    // Only the accounts of the app that signed. A delivery signed by MHERO's
    // app can never be filed under a VOYAH account, even if it names one.
    accounts = accountsForApp(await listAccounts(), check.appId).map((a) => ({
      id: a.id,
      channel: a.channel as ChannelAccount["channel"],
      displayName: a.displayName,
      externalId: a.externalId,
      portfolio: a.portfolio,
      tokenEnv: a.tokenEnv,
    }));
  } catch (e) {
    console.error("[channels/meta] could not read accounts:", e);
  }

  let events: InboundEvent[] = [];
  try {
    for (const adapter of ADAPTERS) {
      events = events.concat(adapter.parse(body, accounts));
    }
  } catch (e) {
    // A shape we did not anticipate. Log it and accept the delivery: retrying
    // will produce the same crash, and a failing endpoint gets disabled.
    console.error("[channels/meta] parse failed:", e);
    return NextResponse.json({ ok: true });
  }

  // WhatsApp receipts move the ticks of messages we sent. They never create a
  // message (rule 19), and a failure here never fails the delivery.
  let statuses: WhatsAppStatusUpdate[] = [];
  try {
    statuses = parseWhatsAppStatuses(body, accounts);
    if (statuses.length > 0) {
      const moved = await applyWhatsAppStatuses(statuses);
      console.info(`[channels/meta] receipts ${statuses.length}, ticks moved ${moved}`);
    }
  } catch (e) {
    console.error("[channels/meta] receipts failed:", e);
  }

  if (events.length === 0) {
    await recordDelivery(null, body, 0, 0);
    return NextResponse.json({ ok: true, received: 0, stored: 0, receipts: statuses.length });
  }

  const result = await storeInbound(events);

  if (!result.ok) {
    // The delivery was genuine and we could not keep it. Say so loudly in the
    // log — but still answer 200: Meta will redeliver, and the write is
    // idempotent, so a retry is the recovery rather than a duplicate.
    console.error(`[channels/meta] store failed: ${result.error}`);
    await recordDelivery(null, body, events.length, 0);
    return NextResponse.json({ ok: true, received: events.length, stored: 0 });
  }

  // Counts only. The message TEXT is customer content and does not belong in a
  // server log, where it would outlive the conversation and be readable by
  // anyone with log access.
  console.info(
    `[channels/meta] received ${events.length}, stored ${result.stored}, ` +
      `duplicate ${result.duplicates}, unmatched ${result.unmatched}`
  );
  await recordDelivery(null, body, events.length, result.stored);

  // THE SALES AUTOREPLY PILOT (Samer, 2026-09-16) — the one named exception to
  // CLAUDE.md rule 24. Only for messages that are NEW here, and only in the
  // chats lib/wasales/autoreply-pilot.ts lists; every other chat is untouched.
  if (result.fresh.length > 0) {
    try {
      const a = await runAutoreply(result.fresh, AUTOREPLY_BUDGET_MS);
      if (a.chats > 0 || a.marked > 0) console.info(`[channels/meta] autoreply chats ${a.chats}, sent ${a.sent}, marked for a person ${a.marked}`);
    } catch (e) {
      console.error("[channels/meta] autoreply failed:", e);
    }
  }

  // Photos, voice notes, videos and files: copied out of Meta now, while its
  // link is fresh. Whatever does not finish is picked up later.
  if (result.media.length > 0) {
    try {
      const m = await captureMedia(result.media, MEDIA_BUDGET_MS);
      console.info(`[channels/meta] files kept ${m.saved}, waiting ${m.left}`);
    } catch (e) {
      console.error("[channels/meta] keeping files failed:", e);
    }
  }

  return NextResponse.json({
    ok: true,
    received: events.length,
    stored: result.stored,
    duplicates: result.duplicates,
    unmatched: result.unmatched,
  });
}
