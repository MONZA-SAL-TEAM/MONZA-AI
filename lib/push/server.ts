/**
 * Push notifications, server side: which devices asked for them, and knocking on them.
 *
 * The rules and the request itself are lib/push/webpush.ts (pure, tested). This file is the I/O:
 * the two tables of migration 019 and the calls to the push services.
 *
 * BEST EFFORT, ALWAYS. A notification is a convenience on top of the product. Nothing here may throw
 * into the webhook (rule 16: a failure of ours must never make Meta retry or switch the channel off) or
 * keep it waiting: every entry point has a time budget and swallows its own errors into the log.
 */

import { channelDb } from "@/lib/channels/store";
import { encodeThreadId } from "@/lib/channels/live-map";
import { GENERIC_NOTE, alertNote, isPushEndpoint, messageNote, sendPush, vapidFromEnv, type PushNote } from "@/lib/push/webpush";

/** A person's devices: a phone, a laptop, a tablet — and a few they forgot. */
const MAX_DEVICES_PER_STAFF = 8;
/** A subscription that failed this many times in a row is dropped; the device subscribes again when it is opened. */
const MAX_FAILURES = 12;
/** A device may ask "what happened?" by its own address for this long after a signed-in person last opened the app on it. */
const DEVICE_TRUST_DAYS = 30;
/** How long the phone may take to ask "what happened?" after being woken. */
const OUTBOX_FRESH_MS = 10 * 60_000;

export type PushSetup = "ready" | "no_keys" | "no_database";

export function pushSetup(): PushSetup {
  if (!vapidFromEnv()) return "no_keys";
  return channelDb() ? "ready" : "no_database";
}

export async function saveSubscription(staffId: string, endpoint: unknown, userAgent: string | null): Promise<"saved" | "bad_endpoint" | "unavailable"> {
  if (!isPushEndpoint(endpoint)) return "bad_endpoint";
  const sb = channelDb();
  if (!sb) return "unavailable";
  const { error } = await sb
    .from("push_subscriptions")
    .upsert({ staff_id: staffId, endpoint, user_agent: userAgent ? userAgent.slice(0, 300) : null, failures: 0, confirmed_at: new Date().toISOString() }, { onConflict: "endpoint" });
  if (error) {
    console.error(`[push] could not save a subscription (${error.code ?? "?"}) — is migration 019 applied?`);
    return "unavailable";
  }
  // Keep the newest few per person.
  const { data } = await sb.from("push_subscriptions").select("id").eq("staff_id", staffId).order("created_at", { ascending: false });
  const extra = Array.isArray(data) ? data.slice(MAX_DEVICES_PER_STAFF).map((r) => (r as { id: string }).id) : [];
  if (extra.length > 0) await sb.from("push_subscriptions").delete().in("id", extra);
  return "saved";
}

export async function removeSubscription(staffId: string, endpoint: unknown): Promise<boolean> {
  const sb = channelDb();
  if (!sb || typeof endpoint !== "string") return false;
  const { error } = await sb.from("push_subscriptions").delete().eq("staff_id", staffId).eq("endpoint", endpoint);
  return !error;
}

/**
 * Is this the address of a device a signed-in staff member confirmed recently? The sign-in cookie lasts
 * an hour; a phone in a pocket is woken long after that. Its push address is a long random secret that
 * only the device, its push service and this table hold, so it can stand in for the sign-in — for the
 * notification's one line only, and only for DEVICE_TRUST_DAYS after somebody signed in on it.
 */
export async function isTrustedDevice(endpoint: unknown): Promise<boolean> {
  if (!isPushEndpoint(endpoint)) return false;
  const sb = channelDb();
  if (!sb) return false;
  const since = new Date(Date.now() - DEVICE_TRUST_DAYS * 86_400_000).toISOString();
  const { data, error } = await sb.from("push_subscriptions").select("id").eq("endpoint", endpoint).gte("confirmed_at", since).limit(1);
  return !error && Array.isArray(data) && data.length === 1;
}

/** What the last notification said — for the worker that was just woken. Null: say the generic thing. */
export async function latestNote(): Promise<PushNote | null> {
  const sb = channelDb();
  if (!sb) return null;
  const since = new Date(Date.now() - OUTBOX_FRESH_MS).toISOString();
  const { data, error } = await sb.from("push_outbox").select("title, body, url, tag").gte("created_at", since).order("created_at", { ascending: false }).limit(1);
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const r = data[0] as Record<string, unknown>;
  return { title: String(r.title), body: String(r.body), url: String(r.url), tag: String(r.tag) };
}

/**
 * Record what to say, then knock on every device. Returns how many knocks were accepted.
 * `budgetMs`: give up (quietly) rather than keep a webhook waiting.
 */
export async function notifyAll(note: PushNote, budgetMs = 4_000): Promise<number> {
  const keys = vapidFromEnv();
  const sb = channelDb();
  if (!keys || !sb) return 0;
  const deadline = Date.now() + budgetMs;
  try {
    const { error: outboxError } = await sb.from("push_outbox").insert({ title: note.title.slice(0, 120), body: note.body.slice(0, 240), url: note.url.slice(0, 400), tag: note.tag.slice(0, 64) });
    if (outboxError) {
      console.error(`[push] outbox not written (${outboxError.code ?? "?"}) — is migration 019 applied?`);
      return 0;
    }
    // Yesterday's notifications are nobody's business any more.
    void sb.from("push_outbox").delete().lt("created_at", new Date(Date.now() - 86_400_000).toISOString()).then(() => undefined, () => undefined);

    const { data } = await sb.from("push_subscriptions").select("id, endpoint, failures").limit(200);
    const subs = Array.isArray(data) ? (data as { id: string; endpoint: string; failures: number }[]) : [];
    if (subs.length === 0) return 0;

    let sent = 0;
    await Promise.all(
      subs.map(async (s) => {
        if (Date.now() > deadline) return;
        const outcome = await sendPush(s.endpoint, keys, note.tag);
        if (outcome === "sent") {
          sent++;
          await sb.from("push_subscriptions").update({ failures: 0, last_ok_at: new Date().toISOString() }).eq("id", s.id);
        } else if (outcome === "gone" || outcome === "rejected" || s.failures + 1 >= MAX_FAILURES) {
          await sb.from("push_subscriptions").delete().eq("id", s.id);
        } else {
          await sb.from("push_subscriptions").update({ failures: s.failures + 1 }).eq("id", s.id);
        }
      })
    );
    // Counts only: never who, never what.
    console.info(`[push] ${note.tag.split("-")[0]}: ${sent}/${subs.length} devices`);
    return sent;
  } catch (e) {
    console.error("[push] failed:", e instanceof Error ? e.message : e);
    return 0;
  }
}

/** New customer messages, as the webhook stored them: one notification per chat. */
export async function notifyNewMessages(fresh: readonly { accountId: string; channel: string; conversationId: string; peerExternalId: string }[], budgetMs = 4_000): Promise<number> {
  if (fresh.length === 0 || pushSetup() !== "ready") return 0;
  const sb = channelDb();
  if (!sb) return 0;
  const deadline = Date.now() + budgetMs;
  const chats = [...new Map(fresh.map((f) => [f.conversationId, f])).values()].slice(0, 3);
  let sent = 0;
  for (const f of chats) {
    if (Date.now() > deadline) break;
    let who: string | null = null;
    let brand: string | null = null;
    try {
      const { data } = await sb.from("channel_conversations").select("peer_display, brand").eq("id", f.conversationId).maybeSingle();
      const row = data as { peer_display?: string | null; brand?: string | null } | null;
      who = row?.peer_display?.trim() || (f.channel === "whatsapp" ? `+${f.peerExternalId.replace(/\D/g, "")}` : null);
      brand = row?.brand ?? null;
    } catch {
      /* the notification still goes, without a name */
    }
    const threadId = f.channel === "whatsapp" ? encodeThreadId(f.accountId, f.conversationId) : null;
    sent += await notifyAll(messageNote({ threadId, channel: f.channel, who, brand }), Math.max(500, deadline - Date.now()));
  }
  return sent;
}

export { GENERIC_NOTE, alertNote };
