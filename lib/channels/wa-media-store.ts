/**
 * WHATSAPP FILES, server half — keeping the files customers send, handing
 * staff short-lived links to them, taking the files staff attach, and deleting
 * files with their messages after 12 months. The rules are in wa-media.ts.
 *
 * SERVER ONLY: the service-role client (lib/channels/store.ts) and each
 * number's key (lib/env.ts). The bucket is PRIVATE (migration 010); nothing
 * here makes anything public.
 *
 * ── Copying a file out of Meta, three ways ──────────────────────────────────
 * Meta keeps a received file for 7 days. So it is copied:
 *   1. by the webhook, straight after the message is stored (a few seconds);
 *   2. when somebody opens the thread, for anything still waiting;
 *   3. by the daily job (/api/channels/retention), for anything left.
 * Each copy lands at a path made from ids, so doing it twice keeps it once.
 */

import { channelDb, listAccounts, type MediaJob } from "@/lib/channels/store";
import { channelToken } from "@/lib/env";
import {
  META_MEDIA_DAYS,
  SIGNED_URL_SECONDS,
  WA_MEDIA_BUCKET,
  extFor,
  fetchWhatsAppMedia,
  inboundMediaPath,
  mergeAttachments,
  readAttachments,
  type StoredAttachment,
} from "@/lib/channels/wa-media";

const DAY_MS = 86_400_000;

/** A stored message row, as far as copying its files needs. */
interface MediaRow {
  id: string;
  external_message_id?: string | null;
  sent_at: string;
  attachments: unknown;
}

/** The files of these rows that are still waiting to be copied. */
export function mediaJobsFromRows(
  rows: readonly MediaRow[],
  account: { id: string; externalId: string; tokenEnv: string },
  conversationId: string
): MediaJob[] {
  const jobs: MediaJob[] = [];
  for (const row of rows) {
    const attachments = readAttachments(row.attachments);
    if (!row.external_message_id || !attachments.some((a) => a.state === "pending")) continue;
    jobs.push({
      messageId: row.id,
      accountId: account.id,
      conversationId,
      externalMessageId: row.external_message_id,
      phoneNumberId: account.externalId,
      tokenEnv: account.tokenEnv,
      sentAt: row.sent_at,
      attachments,
    });
  }
  return jobs;
}

/**
 * Copy waiting files out of Meta into our bucket, within `budgetMs`. What is
 * left over stays "pending" for the next of the three chances; what cannot be
 * had (gone, too large, a bad checksum) is marked so, and never retried.
 */
export async function captureMedia(
  jobs: readonly MediaJob[],
  budgetMs: number,
  fetchFn: typeof fetch = fetch
): Promise<{ saved: number; left: number }> {
  let saved = 0;
  let left = 0;
  if (jobs.length === 0) return { saved, left };
  const sb = channelDb();
  if (!sb) return { saved, left: jobs.length };
  const deadline = Date.now() + budgetMs;

  for (const job of jobs) {
    const token = channelToken(job.tokenEnv);
    const next: StoredAttachment[] = job.attachments.map((a) => ({ ...a }));
    let changed = false;

    for (let i = 0; i < next.length; i++) {
      const a = next[i];
      if (a.state !== "pending") continue;
      if (!a.mediaId || Date.now() - Date.parse(job.sentAt) > META_MEDIA_DAYS * DAY_MS) {
        next[i] = { ...a, state: "unavailable" };
        changed = true;
        continue;
      }
      if (!token || Date.now() > deadline) {
        left++;
        continue;
      }

      const got = await fetchWhatsAppMedia(
        { mediaId: a.mediaId, phoneNumberId: job.phoneNumberId, sha256: a.sha256, mime: a.mime },
        token,
        fetchFn
      );
      if (!got.ok) {
        // No customer content in the log: the reason and the state only.
        console.warn(`[channels/wa-media] ${got.state}: ${got.problem}`);
        if (got.state === "retry") {
          left++;
        } else {
          next[i] = { ...a, state: got.state };
          changed = true;
        }
        continue;
      }

      const path = inboundMediaPath(job.accountId, job.conversationId, job.externalMessageId, i, extFor(got.mime, a.filename));
      const up = await sb.storage.from(WA_MEDIA_BUCKET).upload(path, got.bytes, { contentType: got.mime, upsert: false });
      // Already there is success: an earlier attempt kept it.
      if (up.error && !/exist|duplicate/i.test(up.error.message)) {
        console.error(`[channels/wa-media] could not keep a file: ${up.error.message}`);
        left++;
        continue;
      }
      next[i] = { ...a, state: "stored", path, mime: got.mime, size: got.bytes.length };
      changed = true;
      saved++;
    }

    if (changed) {
      // Merged with what is there NOW, so a slower copy never undoes a faster one.
      const current = await sb
        .from("channel_messages")
        .select("attachments")
        .eq("id", job.messageId)
        .eq("account_id", job.accountId)
        .maybeSingle();
      const merged = mergeAttachments(readAttachments(current.data?.attachments), next);
      const { error } = await sb
        .from("channel_messages")
        .update({ attachments: merged })
        .eq("id", job.messageId)
        .eq("account_id", job.accountId);
      if (error) console.error(`[channels/wa-media] could not record a kept file: ${error.message}`);
    }
  }
  return { saved, left };
}

/** The daily job's pass: files from the last 7 days still waiting to be copied. */
export async function sweepPendingMedia(budgetMs: number): Promise<{ saved: number; left: number; checked: number }> {
  const sb = channelDb();
  if (!sb) return { saved: 0, left: 0, checked: 0 };
  const accounts = (await listAccounts()).filter((a) => a.channel === "whatsapp");
  if (accounts.length === 0) return { saved: 0, left: 0, checked: 0 };
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const since = new Date(Date.now() - META_MEDIA_DAYS * DAY_MS).toISOString();
  const { data, error } = await sb
    .from("channel_messages")
    .select("id, account_id, conversation_id, external_message_id, sent_at, attachments")
    .in("account_id", accounts.map((a) => a.id))
    .gte("sent_at", since)
    // A STRING, so PostgREST reads it as jsonb. An array here is written as a
    // Postgres array literal ("{[object Object]}") and never matches.
    .contains("attachments", JSON.stringify([{ state: "pending" }]))
    .order("sent_at", { ascending: false })
    .limit(40);
  if (error || !data) {
    if (error) console.error(`[channels/wa-media] sweep read failed: ${error.message}`);
    return { saved: 0, left: 0, checked: 0 };
  }

  const jobs: MediaJob[] = [];
  for (const row of data) {
    const account = byId.get(row.account_id as string);
    if (account) jobs.push(...mediaJobsFromRows([row as MediaRow], account, row.conversation_id as string));
  }
  const r = await captureMedia(jobs, budgetMs);
  return { ...r, checked: jobs.length };
}

/**
 * Links to kept files, valid for an hour. Files that are only ever downloaded
 * (documents, anything not verified as a photo, video or audio) get a link
 * that downloads under their own name rather than opening in the page.
 */
export async function signLinks(
  items: readonly { path: string; download?: string }[]
): Promise<Map<string, { url: string; expiresAt: string }>> {
  const out = new Map<string, { url: string; expiresAt: string }>();
  if (items.length === 0) return out;
  const sb = channelDb();
  if (!sb) return out;
  const bucket = sb.storage.from(WA_MEDIA_BUCKET);
  // Reported a minute early, so nothing is shown a link in its last seconds.
  const expiresAt = new Date(Date.now() + (SIGNED_URL_SECONDS - 60) * 1000).toISOString();

  const inline = items.filter((i) => !i.download).map((i) => i.path);
  if (inline.length > 0) {
    const { data } = await bucket.createSignedUrls(inline, SIGNED_URL_SECONDS);
    for (const d of data ?? []) {
      if (d.path && d.signedUrl && !d.error) out.set(d.path, { url: d.signedUrl, expiresAt });
    }
  }
  for (const i of items) {
    if (!i.download) continue;
    const { data } = await bucket.createSignedUrl(i.path, SIGNED_URL_SECONDS, { download: i.download });
    if (data?.signedUrl) out.set(i.path, { url: data.signedUrl, expiresAt });
  }
  return out;
}

/** A one-time upload the browser uses to put a file straight into the bucket —
 *  file bytes never pass through a Vercel route (4.5 MB body limit). */
export async function signUpload(path: string): Promise<{ ok: true; token: string } | { ok: false }> {
  const sb = channelDb();
  if (!sb) return { ok: false };
  const { data, error } = await sb.storage.from(WA_MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.token) {
    if (error) console.error(`[channels/wa-media] could not sign an upload: ${error.message}`);
    return { ok: false };
  }
  return { ok: true, token: data.token };
}

/**
 * A short-lived link for Meta to fetch a file staff are sending on Instagram
 * or Facebook — they take files by link, not by upload. Minutes, not hours:
 * Meta fetches it while the send request is open.
 */
export async function signFor(path: string, seconds: number): Promise<string | null> {
  const sb = channelDb();
  if (!sb) return null;
  const { data, error } = await sb.storage.from(WA_MEDIA_BUCKET).createSignedUrl(path, seconds);
  if (error || !data?.signedUrl) {
    if (error) console.error(`[channels/wa-media] could not sign a file for Meta: ${error.message}`);
    return null;
  }
  return data.signedUrl;
}

/**
 * The 12-month rule for files staff sent on Instagram and Facebook
 * (channel_sent_files, migration 011): the files first, then their rows — a
 * row is only deleted once its file is gone. Before migration 011 there is no
 * table, and nothing to do.
 */
export async function purgeSentFiles(before: string): Promise<{ ok: true; removed: number } | { ok: false; error: string }> {
  const sb = channelDb();
  if (!sb) return { ok: false, error: "The database key for this product is not configured." };
  let removed = 0;
  for (let round = 0; round < 20; round++) {
    const { data, error } = await sb
      .from("channel_sent_files")
      .select("id, path")
      .lt("sent_at", before)
      .order("sent_at")
      .limit(500);
    if (error) {
      if (/channel_sent_files/.test(error.message) && /exist|find/i.test(error.message)) return { ok: true, removed };
      return { ok: false, error: error.message };
    }
    const rows = (data ?? []) as { id: string; path: string }[];
    if (rows.length === 0) break;
    if (!(await removeMedia(rows.map((r) => r.path)))) return { ok: false, error: "Some sent files could not be deleted." };
    const del = await sb.from("channel_sent_files").delete().in("id", rows.map((r) => r.id));
    if (del.error) return { ok: false, error: del.error.message };
    removed += rows.length;
    if (rows.length < 500) break;
  }
  return { ok: true, removed };
}

/** A file staff uploaded, read back to hand to WhatsApp. */
export async function readUploaded(path: string): Promise<{ ok: true; bytes: Uint8Array; mime: string } | { ok: false }> {
  const sb = channelDb();
  if (!sb) return { ok: false };
  const { data, error } = await sb.storage.from(WA_MEDIA_BUCKET).download(path);
  if (error || !data) return { ok: false };
  return { ok: true, bytes: new Uint8Array(await data.arrayBuffer()), mime: data.type };
}

/** Delete kept files. False when any batch could not be deleted. */
export async function removeMedia(paths: readonly string[]): Promise<boolean> {
  if (paths.length === 0) return true;
  const sb = channelDb();
  if (!sb) return false;
  let ok = true;
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await sb.storage.from(WA_MEDIA_BUCKET).remove(paths.slice(i, i + 100));
    if (error) {
      console.error(`[channels/wa-media] could not delete files: ${error.message}`);
      ok = false;
    }
  }
  return ok;
}

/**
 * The 12-month rule, for files: delete the files of every WhatsApp message
 * sent before `before`. Runs BEFORE the messages are deleted, and when it
 * fails the messages are kept for tomorrow's run — a message deleted first
 * would leave its file behind with nothing pointing at it.
 */
export async function purgeWhatsAppMedia(before: string): Promise<{ ok: true; removed: number } | { ok: false; error: string }> {
  const sb = channelDb();
  if (!sb) return { ok: false, error: "The database key for this product is not configured." };
  const ids = (await listAccounts()).filter((a) => a.channel === "whatsapp").map((a) => a.id);
  if (ids.length === 0) return { ok: true, removed: 0 };

  const PAGE = 500;
  const paths: string[] = [];
  for (let page = 0; page < 40; page++) {
    const { data, error } = await sb
      .from("channel_messages")
      .select("attachments")
      .in("account_id", ids)
      .lt("sent_at", before)
      .contains("attachments", JSON.stringify([{ state: "stored" }]))
      .order("id")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) return { ok: false, error: error.message };
    for (const row of data ?? []) {
      for (const a of readAttachments(row.attachments)) if (a.state === "stored" && a.path) paths.push(a.path);
    }
    if (!data || data.length < PAGE) break;
  }
  if (!(await removeMedia(paths))) return { ok: false, error: "Some files could not be deleted." };
  return { ok: true, removed: paths.length };
}
