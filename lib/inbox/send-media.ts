/**
 * Sending a photo, video, voice note or file from the inbox — the browser's
 * half (Samer, 2026-09-15). BROWSER ONLY.
 *
 *   1. ask MONZA AI for a one-time upload (/api/channels/media) — every gate
 *      the send has is checked before anything is uploaded;
 *   2. put the file straight into the private bucket (file bytes never pass
 *      through a Vercel route, whose bodies stop at 4.5 MB);
 *   3. ask MONZA AI to send it (/api/channels/send), which checks it again,
 *      hands it to WhatsApp and records it in the thread.
 *
 * Before step 1 the file is made acceptable to WhatsApp where that can be done
 * without loss of meaning: a photo over 5 MB or in a format WhatsApp refuses is
 * redrawn as a JPG, and a Chrome voice recording is repackaged from WebM into
 * the Ogg WhatsApp needs for a voice note (lib/media/ogg-opus.ts). A VIDEO the
 * channel would refuse — over its limit, H.265, a MOV — is re-made under the
 * limit AT THE SAME RESOLUTION (lib/media/video-fit.ts; Samer, 2026-10-22: the
 * customer must get a playable video, full HD, never a file or a link). One
 * that already fits goes byte for byte.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AI_ANON_KEY, AI_URL } from "@/lib/env-public";
import { checkOutbound, classifyFile, rulesFor, type MediaChannel, type OutboundKind } from "@/lib/channels/wa-media";
import { isOgg, webmToOgg } from "@/lib/media/ogg-opus";
import { fitVideo, inspectVideo, needsFit } from "@/lib/media/video-fit";
import { voiceWav } from "@/lib/media/wav";

export interface ReadyFile {
  blob: Blob;
  kind: OutboundKind;
  mime: string;
  filename: string;
  /** A recording made here, to be shown as a voice note. */
  voice: boolean;
  /** A video re-made under the channel's limit: what was kept and how it will look. */
  fitted?: string;
}

type Prepared = { ok: true; file: ReadyFile } | { ok: false; problem: string };

/** A photo redrawn as a JPG under the channel's limit, or null when the browser cannot read it. */
async function toJpeg(file: Blob, maxBytes: number): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    let longest = 2560;
    for (const quality of [0.86, 0.78, 0.7, 0.6]) {
      const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#fff"; // a transparent PNG becomes white, not black
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= maxBytes) return blob;
      longest = Math.round(longest * 0.8);
    }
    return null;
  } catch {
    return null;
  }
}

function renamed(name: string, ext: string): string {
  const base = name.replace(/\.[A-Za-z0-9]{1,5}$/, "") || (ext === "mp4" ? "Video" : "Photo");
  return `${base}.${ext}`;
}

/**
 * A file somebody picked, dropped or pasted, made ready for that channel — or why
 * it cannot go. `onProgress` carries the words while a video is being fitted.
 */
export async function prepareFile(
  file: File,
  channel: MediaChannel = "whatsapp",
  onProgress: (words: string) => void = () => {},
  cancelled: () => boolean = () => false
): Promise<Prepared> {
  const c = classifyFile(file, channel);
  if (!c.ok) return c;
  if (c.convert) {
    const jpg = await toJpeg(file, rulesFor(channel).image.maxBytes);
    if (!jpg) return { ok: false, problem: "This photo could not be prepared — save it as a JPG and try again." };
    return { ok: true, file: { blob: jpg, kind: "image", mime: "image/jpeg", filename: renamed(file.name, "jpg"), voice: false } };
  }
  if (c.kind === "video") return prepareVideo(file, c.mime, channel, onProgress, cancelled);
  return { ok: true, file: { blob: file, kind: c.kind, mime: c.mime, filename: file.name || "Monza", voice: false } };
}

/**
 * A video goes as it is when the channel takes it as it is; otherwise it is
 * fitted. When the browser cannot even read it, the plain rules decide (an MP4
 * under the limit still goes), so a reading failure never blocks what used to work.
 */
const CONTAINER_EXT: Readonly<Record<string, string>> = {
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

async function prepareVideo(
  file: File,
  mime: string,
  channel: MediaChannel,
  onProgress: (words: string) => void,
  cancelled: () => boolean
): Promise<Prepared> {
  const cap = rulesFor(channel).video.maxBytes;
  // What the file IS decides, not what the browser or its name said: a ".mov" whose bytes are an MP4 goes as one.
  const asIs = (container: string | null): Prepared => {
    const real = container && CONTAINER_EXT[container] ? container : mime;
    const plain = checkOutbound("video", real, file.size, channel);
    if (!plain.ok) return plain;
    const name = real !== mime && CONTAINER_EXT[real] ? renamed(file.name, CONTAINER_EXT[real]) : file.name || "Monza";
    return { ok: true, file: { blob: file, kind: "video", mime: plain.mime, filename: name, voice: false } };
  };
  const looked = await inspectVideo(file);
  if (!looked.ok) {
    const plain = asIs(null);
    return plain.ok ? plain : { ok: false, problem: looked.problem };
  }
  if (!needsFit(looked.facts, cap, channel).fit) return asIs(looked.facts.container);
  onProgress(`Reading the video…`);
  const fitted = await fitVideo(file, cap, channel, onProgress, cancelled);
  if (!fitted.ok) return fitted;
  return {
    ok: true,
    file: { blob: fitted.blob, kind: "video", mime: "video/mp4", filename: renamed(file.name, "mp4"), voice: false, fitted: fitted.words },
  };
}

/** The best recording format this browser has, WhatsApp's own first. */
export function recorderMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}

/**
 * Instagram and Facebook take no Ogg: the browser decodes the recording and it
 * goes as a one-channel 16 kHz WAV (lib/media/wav.ts). Safari's MP4 goes as is.
 */
async function recordingForMeta(blob: Blob, recordedAs: string, channel: MediaChannel): Promise<Prepared> {
  const limit = rulesFor(channel).audio.maxBytes;
  if (recordedAs.includes("mp4") || recordedAs.includes("aac")) {
    if (blob.size > limit) return { ok: false, problem: "That recording is too long to send." };
    return { ok: true, file: { blob, kind: "audio", mime: "audio/mp4", filename: "Voice message.m4a", voice: false } };
  }
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
    const sound = await ctx.decodeAudioData(await blob.arrayBuffer());
    const channels: Float32Array[] = [];
    for (let c = 0; c < sound.numberOfChannels; c++) channels.push(sound.getChannelData(c));
    const wav = voiceWav(channels, sound.sampleRate);
    if (wav.length > limit) return { ok: false, problem: "That recording is too long to send." };
    return {
      ok: true,
      file: { blob: new Blob([new Uint8Array(wav)], { type: "audio/wav" }), kind: "audio", mime: "audio/wav", filename: "Voice message.wav", voice: false },
    };
  } catch {
    return { ok: false, problem: "This recording could not be prepared for sending." };
  } finally {
    void ctx?.close();
  }
}

/** A finished recording, as the channel wants it. */
export async function prepareRecording(
  blob: Blob,
  recordedAs: string,
  channel: MediaChannel = "whatsapp"
): Promise<Prepared> {
  if (blob.size === 0) return { ok: false, problem: "Nothing was recorded." };
  if (channel !== "whatsapp") return recordingForMeta(blob, recordedAs, channel);
  if (blob.size > rulesFor("whatsapp").audio.maxBytes) return { ok: false, problem: "That recording is too long to send." };
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const voice = (ogg: Uint8Array): Prepared => ({
    ok: true,
    file: { blob: new Blob([new Uint8Array(ogg)], { type: "audio/ogg" }), kind: "audio", mime: "audio/ogg", filename: "Voice message.ogg", voice: true },
  });
  if (isOgg(bytes)) return voice(bytes); // Firefox
  if (recordedAs.includes("webm")) {
    const ogg = webmToOgg(bytes); // Chrome, Edge
    return ogg ? voice(ogg) : { ok: false, problem: "This recording could not be converted for WhatsApp." };
  }
  if (recordedAs.includes("mp4") || recordedAs.includes("aac")) {
    // Safari: WhatsApp takes it as an audio file, without the voice-note look.
    return { ok: true, file: { blob, kind: "audio", mime: "audio/mp4", filename: "Voice message.m4a", voice: false } };
  }
  return { ok: false, problem: "This browser records in a format WhatsApp does not accept." };
}

let storage: SupabaseClient | null = null;
function bucketClient(): SupabaseClient {
  storage ??= createClient(AI_URL, AI_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return storage;
}

type Sent = { ok: true } | { ok: false; message: string };

/** Upload and send one file on a conversation. `onStage` drives the button's words. */
export async function sendFile(
  conversationId: string,
  file: ReadyFile,
  caption: string,
  onStage: (stage: "uploading" | "sending") => void = () => {}
): Promise<Sent> {
  let grant: { ok?: boolean; bucket?: string; path?: string; token?: string; message?: string } | null;
  try {
    const res = await fetch("/api/channels/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, kind: file.kind, mime: file.mime, size: file.blob.size, filename: file.filename }),
    });
    grant = await res.json().catch(() => null);
    if (!res.ok || !grant?.ok || !grant.bucket || !grant.path || !grant.token) {
      return { ok: false, message: grant?.message ?? "The file could not be prepared — nothing was sent." };
    }
  } catch {
    return { ok: false, message: "Could not reach Monza AI — nothing was sent." };
  }

  onStage("uploading");
  const up = await bucketClient()
    .storage.from(grant.bucket)
    .uploadToSignedUrl(grant.path, grant.token, file.blob, { contentType: file.mime });
  if (up.error) return { ok: false, message: "The upload did not finish — check the connection and try again. Nothing was sent." };

  onStage("sending");
  try {
    const res = await fetch("/api/channels/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId,
        text: file.kind === "audio" ? "" : caption,
        attachment: { path: grant.path, kind: file.kind, filename: file.filename, voice: file.voice },
      }),
    });
    const json = (await res.json().catch(() => null)) as { delivered?: boolean; message?: string } | null;
    if (res.ok && json?.delivered) return { ok: true };
    return { ok: false, message: json?.message ?? "It was not sent." };
  } catch {
    return { ok: false, message: "Could not reach Monza AI — it may not have been sent. Check the thread before trying again." };
  }
}
