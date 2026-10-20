/**
 * The ad a customer came from, shown in their chat (Samer, 2026-10-20: "see the image a client is referring to,
 * as it doesn't appear before the message"). SERVER ONLY.
 *
 * A Click-to-WhatsApp ad (and an Instagram ad) hands us its headline, words and a picture with the FIRST message
 * of the thread — kept since 2026-09 in lead_touchpoints.raw. Meta's picture link dies within weeks (its `oe`
 * expiry), so the picture is copied ONCE per ad (Meta's ad id) into the private bucket (`ads/<id>.<ext>`,
 * migration 030 `ad_creatives`) and shown by a signed link. It is the business's own ad, never a customer's file.
 * Only Meta's own CDN hosts are fetched (`isMetaCdn`) — a link in a payload is never followed anywhere else.
 */

import { channelDb } from "@/lib/channels/store";
import { WA_MEDIA_BUCKET } from "@/lib/channels/wa-media";
import { isMetaCdn } from "@/lib/inbox/media";
import type { AdCard } from "@/lib/inbox/types";

export type { AdCard };

const MAX_BYTES = 8 * 1024 * 1024;
const FETCH_MS = 5_000;

/** The ad's facts from a touchpoint's raw referral — WhatsApp's shape or Instagram's `ads_context_data`. */
export function adOfRaw(raw: unknown): { sourceId: string | null; headline: string | null; body: string | null; mediaType: "image" | "video" | null; picture: string | null; sourceUrl: string | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const ctx = (r.ads_context_data && typeof r.ads_context_data === "object" ? r.ads_context_data : {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const picture = s(r.image_url) ?? s(r.thumbnail_url) ?? s(ctx.photo_url) ?? s(ctx.video_thumbnail_url);
  const headline = s(r.headline) ?? s(ctx.ad_title);
  if (!picture && !headline) return null;
  const media = s(r.media_type) ?? (s(r.video_url) || s(ctx.video_url) ? "video" : picture ? "image" : null);
  return {
    sourceId: s(r.source_id) ?? s(r.ad_id),
    headline,
    body: s(r.body),
    mediaType: media === "video" ? "video" : media === "image" ? "image" : null,
    picture: picture && isMetaCdn(picture) ? picture : null,
    sourceUrl: s(r.source_url),
  };
}

/** Meta's CDN links carry their expiry (`oe`, hex seconds). */
export function metaLinkAlive(url: string, nowMs = Date.now()): boolean {
  const m = /[?&]oe=([0-9A-Fa-f]{6,10})/.exec(url);
  if (!m) return true;
  return parseInt(m[1], 16) * 1000 > nowMs + 60_000;
}

async function copyPicture(sourceId: string, url: string): Promise<string | null> {
  const sb = channelDb();
  if (!sb || !isMetaCdn(url) || !metaLinkAlive(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS), redirect: "error" });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : type === "image/jpeg" ? "jpg" : null;
    if (!ext) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;
    const path = `ads/${sourceId.replace(/[^0-9A-Za-z_-]/g, "").slice(0, 60)}.${ext}`;
    const { error } = await sb.storage.from(WA_MEDIA_BUCKET).upload(path, bytes, { contentType: type, upsert: true });
    return error ? null : path;
  } catch {
    return null;
  }
}

/** The same, for an Instagram / Facebook thread known by Meta's id (its conversation row, when one exists). */
export async function adForMetaThread(accountId: string, metaConversationId: string): Promise<AdCard | null> {
  const sb = channelDb();
  if (!sb) return null;
  const { data } = await sb.from("channel_conversations").select("id").eq("account_id", accountId).eq("meta_conversation_id", metaConversationId).limit(1).maybeSingle();
  const id = (data as { id?: string } | null)?.id;
  return id ? adForConversation(id) : null;
}

/** The ad a conversation came from (its lead's first ad or post touchpoint), with a picture that still shows. */
export async function adForConversation(conversationId: string): Promise<AdCard | null> {
  const sb = channelDb();
  if (!sb) return null;
  try {
    const { data: link } = await sb.from("lead_conversations").select("lead_id").eq("conversation_id", conversationId).limit(1).maybeSingle();
    const leadId = (link as { lead_id?: string } | null)?.lead_id;
    if (!leadId) return null;
    const { data: tps } = await sb
      .from("lead_touchpoints")
      .select("raw, occurred_at, source_kind")
      .eq("lead_id", leadId)
      .in("source_kind", ["ad_click", "social_post"])
      .order("occurred_at", { ascending: true })
      .limit(1);
    const tp = (tps ?? [])[0] as { raw: unknown; occurred_at: string } | undefined;
    const ad = tp ? adOfRaw(tp.raw) : null;
    if (!tp || !ad) return null;

    let imagePath: string | null = null;
    if (ad.sourceId) {
      const { data: kept } = await sb.from("ad_creatives").select("image_path, tried_at").eq("source_id", ad.sourceId).maybeSingle();
      const row = kept as { image_path: string | null; tried_at: string } | null;
      imagePath = row?.image_path ?? null;
      // Not kept yet: copy it now, while Meta's link works — at most once an hour per ad.
      if (!imagePath && ad.picture && (!row || Date.now() - Date.parse(row.tried_at) > 3_600_000)) {
        imagePath = await copyPicture(ad.sourceId, ad.picture);
        await sb.from("ad_creatives").upsert(
          {
            source_id: ad.sourceId,
            headline: ad.headline?.slice(0, 300) ?? null,
            body: ad.body?.slice(0, 2000) ?? null,
            media_type: ad.mediaType,
            image_path: imagePath,
            source_url: ad.sourceUrl?.slice(0, 1000) ?? null,
            captured_at: imagePath ? new Date().toISOString() : null,
            tried_at: new Date().toISOString(),
          },
          { onConflict: "source_id" }
        );
      }
    }
    let imageUrl: string | null = null;
    if (imagePath) {
      const { data } = await sb.storage.from(WA_MEDIA_BUCKET).createSignedUrl(imagePath, 3600);
      imageUrl = data?.signedUrl ?? null;
    }
    if (!imageUrl && ad.picture && metaLinkAlive(ad.picture)) imageUrl = ad.picture;
    return { headline: ad.headline, body: ad.body, mediaType: ad.mediaType, imageUrl, sourceUrl: ad.sourceUrl, at: tp.occurred_at };
  } catch (e) {
    console.error("[channels/ad] could not read the ad:", e instanceof Error ? e.message : String(e));
    return null;
  }
}
