/**
 * FACEBOOK MESSENGER — messages to the Pages.
 *
 * ── Why this is a separate file from instagram.ts, given how similar they are
 *
 * Because the similarity is a trap. The envelope is the same shape, so the
 * temptation is one parser with a flag — and then the differences, each of
 * which is small, accumulate somewhere nobody is looking:
 *
 *   object            "page"                  vs "instagram"
 *   entry[].id        the PAGE id             vs the IG account id
 *   sender.id         a Page-scoped id (PSID) vs an IG-scoped id (IGSID)
 *   sender name       fetchable from the PSID vs not available at all
 *   send endpoint     /me/messages with a PAGE token, and the token is
 *                     per-Page, not per-portfolio
 *
 * The third line is the one that matters and the reason both adapters exist:
 * a PSID and an IGSID are DIFFERENT NAMESPACES. The same human writing to the
 * Voyah Page and to @voyahlebanon arrives as two unrelated ids, and there is
 * no call that relates them. Anything that assumes one person is one id across
 * channels is wrong, which is why lib/leads exists and why it joins people by
 * phone number or by a human decision and never by an id.
 *
 * ── What the Page ids are ───────────────────────────────────────────────────
 * Recorded in CLAUDE.md's account registry, not here: connecting an account is
 * an operations step, and a committed constant would let the code and the
 * database disagree about which brand a message belongs to.
 *
 * Everything else — echoes dropped, payload timestamps, untrusted text, the
 * 24-hour window — is the same rule as Instagram, deliberately, because a rule
 * written once is a rule that binds all three transports.
 */

import type {
  ChannelAccount,
  ChannelAdapter,
  InboundAttachment,
  InboundEvent,
  InboundReferral,
  OutboundMessage,
  SendResult,
} from "@/lib/channels/types";
import { outboundMessagePart } from "@/lib/channels/types";

const GRAPH = "https://graph.facebook.com/v21.0";

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function attachmentsOf(message: Record<string, unknown>): InboundAttachment[] {
  const raw = message.attachments;
  if (!Array.isArray(raw)) return [];

  return raw.map((entry): InboundAttachment => {
    const a = obj(entry);
    const type = str(a?.type) ?? "";
    const payload = obj(a?.payload);
    const kind: InboundAttachment["kind"] =
      type === "image" || type === "video" || type === "audio"
        ? type
        : type === "file"
          ? "file"
          : // Messenger sends "fallback" for a shared link, and "template" for
            // a structured card. Neither is media, and neither is nothing.
            "unknown";
    return { kind, url: str(payload?.url) };
  });
}

/**
 * The referral, when the person arrived from somewhere.
 *
 * Messenger has one shape Instagram does not: `postback.referral`, which
 * arrives when somebody taps a Get Started button that carried an ad
 * reference. Missing it loses the attribution for every Click-to-Messenger
 * campaign that uses a welcome screen — which is most of them.
 */
function referralOf(
  event: Record<string, unknown>,
  message: Record<string, unknown> | null
): InboundReferral | null {
  const postback = obj(event.postback);
  const direct =
    obj(event.referral) ??
    obj(message?.referral) ??
    obj(postback?.referral);

  if (direct) {
    const ads = obj(direct.ads_context_data);
    return {
      source: str(direct.source),
      type: str(direct.type),
      ref: str(direct.ref) ?? str(direct.ad_id) ?? str(ads?.post_id),
      headline: str(ads?.ad_title),
      sourceUrl: str(direct.source_url),
      ctwaClid: null,
      storyId: null,
      raw: direct,
    };
  }
  return null;
}

function isoFrom(timestamp: unknown, fallback: string): string {
  const ms =
    typeof timestamp === "number"
      ? timestamp
      : typeof timestamp === "string"
        ? Number(timestamp)
        : NaN;
  if (!Number.isFinite(ms) || ms <= 0) return fallback;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}

export function parseMessenger(
  body: unknown,
  accounts: readonly ChannelAccount[],
  receivedAt = new Date().toISOString()
): InboundEvent[] {
  const root = obj(body);
  if (!root) return [];
  // Instagram uses the identical envelope with object:"instagram". Routing on
  // this string is what keeps one webhook endpoint serving both without either
  // adapter seeing the other's traffic.
  if (str(root.object) !== "page") return [];

  const entries = Array.isArray(root.entry) ? root.entry : [];
  const out: InboundEvent[] = [];

  for (const rawEntry of entries) {
    const entry = obj(rawEntry);
    if (!entry) continue;

    // The PAGE id. Which brand this belongs to is decided HERE, from a
    // verified id, before any text is read — rule 1.
    const pageId = str(entry.id);
    const account = pageId
      ? (accounts.find(
          (a) => a.channel === "facebook" && a.externalId === pageId
        ) ?? null)
      : null;

    const events = Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const rawEvent of events) {
      const event = obj(rawEvent);
      if (!event) continue;

      const message = obj(event.message);

      // A postback with no message is a button tap. It carries attribution
      // worth keeping but is not something a customer said, so it produces no
      // inbox message — the referral reaches the lead through the next real
      // message, and inventing a message here would put words in their mouth.
      if (!message) continue;

      if (message.is_echo === true) continue;

      const mid = str(message.mid);
      if (!mid) continue;

      const sender = obj(event.sender);
      const from = str(sender?.id);
      if (!from) continue;

      // The Page messaging itself is not a customer conversation.
      if (pageId && from === pageId) continue;

      const attachments = attachmentsOf(message);
      const text = str(message.text) ?? "";
      if (text === "" && attachments.length === 0) continue;

      out.push({
        accountId: account?.id ?? null,
        fromExternalId: from,
        // Messenger CAN give a name, but only through a separate Graph call
        // with its own permission. Never guessed, and never taken from the
        // payload as if it were an identity — rule 3.
        fromDisplay: null,
        externalMessageId: mid,
        text,
        at: isoFrom(event.timestamp, receivedAt),
        attachments,
        referral: referralOf(event, message),
      });
    }
  }

  return out;
}

export async function sendMessenger(
  message: OutboundMessage,
  token: string,
  fetchFn: typeof fetch = fetch
): Promise<SendResult> {
  if (!message.accountId) {
    return { ok: false, error: "No account.", retryable: false };
  }

  try {
    const res = await fetchFn(`${GRAPH}/me/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      // Messenger fetches a file before it answers: up to 75 s for a video.
      signal: AbortSignal.timeout(message.attachment ? 90_000 : 20_000),
      body: JSON.stringify({
        recipient: { id: message.toExternalId },
        // Words, or one file Messenger fetches from a short-lived link.
        message: outboundMessagePart(message),
        // Messenger requires the tag or type to be stated. RESPONSE means "we
        // are answering something they said", which is the only thing this
        // product does — anything else needs a message tag and a policy
        // review, and must not be reachable by accident.
        messaging_type: "RESPONSE",
      }),
    });

    const payload = (await res.json().catch(() => null)) as {
      message_id?: unknown;
      error?: { message?: unknown };
    } | null;

    if (res.ok) {
      const id = str(payload?.message_id);
      return { ok: true, externalMessageId: id ?? `fb-unknown-${Date.now()}` };
    }

    const detail = str(payload?.error?.message) ?? `HTTP ${res.status}`;
    const retryable = res.status >= 500 || res.status === 429;
    return { ok: false, error: detail, retryable };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Network error.",
      retryable: true,
    };
  }
}

export const messengerAdapter: ChannelAdapter = {
  channel: "facebook",
  parse: (body, accounts) => parseMessenger(body, accounts),
  send: sendMessenger,
};
