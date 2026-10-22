/**
 * FITTING A VIDEO UNDER A CHANNEL'S LIMIT — in the browser, at the SAME resolution.
 *
 * Samer (2026-10-20/22): "send the videos in full HD, no effect on the resolution …
 * I will not send a file or link to a customer — I want to send him the video with
 * his original or HD resolution." Meta's hard limits for a VIDEO MESSAGE are 16 MB
 * on WhatsApp (MP4, H.264 + AAC, one sound track) and 25 MB on Instagram and
 * Messenger. A full-HD walkaround is often more, and WhatsApp also refuses H.265
 * (iPhones, many Androids) and MOV outright. The only way such a video can arrive
 * as a playable video is to make it smaller FIRST: every pixel kept (1080p stays
 * 1080p), fewer bits per second. That is what this does, on the staff member's own
 * machine — Vercel cannot run an encoder.
 *
 * Two halves:
 *   PURE   `needsFit` (does this video have to be touched at all?), `planFit` (what
 *          bitrate fits, how it will look) and the words for the sheet. Tested in
 *          Node with no browser.
 *   BROWSER `inspectVideo` and `fitVideo`, on WebCodecs through mediabunny (MPL-2.0,
 *          loaded only when a video needs it). The ONE library exception in
 *          lib/media/: an MP4 that Android and WhatsApp accept is where a hand-made
 *          muxer fails silently, and the video is re-encoded anyway.
 *
 * A video that already fits (MP4, H.264, AAC or silent, under the limit) is NEVER
 * touched: it goes byte for byte, as before.
 */

const MB = 1024 * 1024;

/** The largest video the browser is asked to read at all. */
export const FIT_INPUT_MAX_BYTES = 1024 * MB;
/**
 * Room left under the limit for the container and the encoder's own drift. Measured
 * 2026-10-22 in Chromium: a variable-bitrate pass lands ~15% over its target, so the
 * encoder is asked for a CONSTANT bitrate and given this margin — one pass, usually.
 */
const TARGET_SHARE = 0.92;
/** The sound, when it has to be re-encoded (AAC). */
export const AUDIO_BPS = 128_000;
/** Below this the picture is no longer worth sending at full resolution. */
export const MIN_VIDEO_BPS = 250_000;
/** How often a keyframe goes in: short, so WhatsApp's player seeks and previews well. */
export const KEYFRAME_SECONDS = 2;
/** A pass that lands over the limit is made again with this much less, at most this many times. */
export const RETRY_FACTOR = 0.85;
export const MAX_PASSES = 3;

/** What the browser read from the file's own boxes, before anything is decided. */
export interface VideoFacts {
  bytes: number;
  seconds: number;
  width: number;
  height: number;
  fps: number;
  /** Bits per second of the picture, on average. */
  videoBitrate: number;
  /** mediabunny's codec name: avc, hevc, vp9, av1…; null when unknown. */
  videoCodec: string | null;
  /** aac, opus, mp3…; null when there is no sound. */
  audioCodec: string | null;
  audioBitrate: number;
  audioTracks: number;
  /** The container as a MIME type: video/mp4, video/quicktime, video/webm… */
  container: string;
}

export type FitChannel = "whatsapp" | "instagram" | "facebook";

/** The boxes Instagram and Messenger take a video in (their rules name mp4, mov, webm). */
const META_CONTAINERS: ReadonlySet<string> = new Set(["video/mp4", "video/quicktime", "video/webm"]);

/**
 * The picture's bits per second over the WHOLE file — the file's own size minus the
 * sound, over its length. A measurement over the first few seconds would starve a
 * clip that opens quietly (a title card, a fade from black). Never negative.
 */
export function wholeFileVideoBitrate(bytes: number, seconds: number, audioBitrate: number): number {
  if (!(seconds > 0)) return 0;
  return Math.max(0, Math.floor((bytes * 8) / seconds - audioBitrate));
}

/** H.264 wants even sides: an odd width or height loses its last line (cropped, never stretched). */
export function evenSize(width: number, height: number): { width: number; height: number } {
  return { width: Math.max(2, width & ~1), height: Math.max(2, height & ~1) };
}

/** Why a video has to be re-made before it can go, or that it can go as it is. */
export type FitNeed = { fit: false } | { fit: true; why: "size" | "codec" | "container" | "audio" | "tracks" };

/**
 * WhatsApp takes MP4 / 3GP with H.264 and AAC (or no sound), ONE sound track, under
 * the limit. Instagram and Messenger take MP4, MOV and WEBM under theirs; their
 * codec rules are not documented, so only the size decides there.
 */
export function needsFit(facts: VideoFacts, maxBytes: number, channel: FitChannel): FitNeed {
  if (facts.bytes > maxBytes) return { fit: true, why: "size" };
  if (channel !== "whatsapp") return META_CONTAINERS.has(facts.container) ? { fit: false } : { fit: true, why: "container" };
  if (facts.container !== "video/mp4" && facts.container !== "video/3gpp") return { fit: true, why: "container" };
  if (facts.videoCodec !== "avc") return { fit: true, why: "codec" };
  if (facts.audioTracks > 1) return { fit: true, why: "tracks" };
  // A sound track in a codec the reader does not know is not "no sound": WhatsApp would refuse it.
  if (facts.audioTracks > 0 && facts.audioCodec === null) return { fit: true, why: "audio" };
  if (facts.audioCodec !== null && facts.audioCodec !== "aac") return { fit: true, why: "audio" };
  return { fit: false };
}

/** How the result will look, from bits per pixel per frame — the measure encoders are judged by. */
export type Look = "sharp" | "fine" | "soft" | "poor";

export function lookOf(videoBitrate: number, width: number, height: number, fps: number): Look {
  const bpp = videoBitrate / Math.max(1, width * height * Math.max(1, fps));
  if (bpp >= 0.075) return "sharp";
  if (bpp >= 0.045) return "fine";
  if (bpp >= 0.025) return "soft";
  return "poor";
}

export interface FitPlan {
  ok: true;
  /** Bits per second for the picture, never above what the original carries. */
  videoBitrate: number;
  /** Bits per second for the sound: the original's when it is copied, AUDIO_BPS when re-encoded. */
  audioBitrate: number;
  /** Whether the sound goes across untouched. */
  copyAudio: boolean;
  targetBytes: number;
  seconds: number;
  width: number;
  height: number;
  fps: number;
  look: Look;
}

export type FitPlanOrNot = FitPlan | { ok: false; problem: string };

function seconds(n: number): string {
  const s = Math.max(1, Math.round(n));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} min`;
}

function megabytes(bytes: number): string {
  const mb = bytes / MB;
  return `${mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb)} MB`;
}

/**
 * The bitrate that lands under `maxBytes` at the video's own resolution and frame
 * rate. The sound is copied when it is already AAC (WhatsApp's requirement), else
 * re-encoded at AUDIO_BPS. A video so long that the picture would get less than
 * MIN_VIDEO_BPS is refused, with the length that would work.
 */
export function planFit(facts: VideoFacts, maxBytes: number, channelWords: string): FitPlanOrNot {
  if (!(facts.seconds > 0) || !(facts.width > 0) || !(facts.height > 0)) {
    return { ok: false, problem: "This video's length or size could not be read." };
  }
  const targetBytes = Math.floor(maxBytes * TARGET_SHARE);
  // Only the primary sound track travels, so AAC is copied even when a second track is dropped.
  const copyAudio = facts.audioCodec === "aac";
  const hasSound = facts.audioTracks > 0 || facts.audioCodec !== null;
  const audioBitrate = !hasSound ? 0 : copyAudio ? facts.audioBitrate : AUDIO_BPS;
  const budgetBits = targetBytes * 8 - audioBitrate * facts.seconds;
  const fits = Math.floor(budgetBits / facts.seconds);
  if (fits < MIN_VIDEO_BPS) {
    const longest = Math.floor((targetBytes * 8) / (MIN_VIDEO_BPS + audioBitrate));
    return {
      ok: false,
      problem: `This video is ${seconds(facts.seconds)} long — too long to fit ${channelWords}'s ${megabytes(maxBytes)} at ${facts.width}×${facts.height}. A clip under ${seconds(longest)} would.`,
    };
  }
  // Never more bits than the original has: that would only make the file bigger, not better.
  const videoBitrate = facts.videoBitrate > 0 ? Math.max(MIN_VIDEO_BPS, Math.min(fits, Math.floor(facts.videoBitrate * 0.98))) : fits;
  const size = evenSize(facts.width, facts.height);
  return {
    ok: true,
    videoBitrate,
    audioBitrate,
    copyAudio,
    targetBytes,
    seconds: facts.seconds,
    width: size.width,
    height: size.height,
    fps: facts.fps,
    look: lookOf(videoBitrate, size.width, size.height, facts.fps),
  };
}

const LOOK_WORDS: Readonly<Record<Look, string>> = {
  sharp: "it will look sharp",
  fine: "it will look fine",
  soft: "it will look a little soft — a shorter clip would look better",
  poor: "it will look blocky — a much shorter clip would look far better",
};

/** The sentence under the preview: what was kept, what was given up. */
export function fitWords(plan: FitPlan, channelWords: string, resultBytes: number): string {
  const mbps = Math.round(plan.videoBitrate / 100_000) / 10;
  return `Fitted for ${channelWords}: ${plan.width}×${plan.height} kept, ${seconds(plan.seconds)} at ${mbps} Mbps (${megabytes(resultBytes)}) — ${LOOK_WORDS[plan.look]}.`;
}

/** The words while it runs. */
export function fitProgressWords(channelWords: string, fraction: number, pass: number): string {
  const pct = Math.max(0, Math.min(99, Math.round(fraction * 100)));
  return pass > 1
    ? `Fitting the video for ${channelWords} — pass ${pass}, ${pct}%`
    : `Fitting the video for ${channelWords} — ${pct}%`;
}

/** The next pass, when the last landed over the limit: proportionally less, never above RETRY_FACTOR. */
export function nextBitrate(videoBitrate: number, resultBytes: number, targetBytes: number): number {
  const ratio = Math.min(RETRY_FACTOR, targetBytes / Math.max(1, resultBytes));
  return Math.max(MIN_VIDEO_BPS, Math.floor(videoBitrate * ratio));
}

/* ── The browser half ──────────────────────────────────────────────────────── */

export type FitOutcome =
  | { ok: true; blob: Blob; plan: FitPlan; passes: number; words: string }
  | { ok: false; problem: string };

/** Whether this browser can do it at all (WebCodecs: Chrome, Edge, Safari 16.4+, Firefox 130+). */
export function browserCanFit(): boolean {
  return typeof VideoEncoder !== "undefined" && typeof VideoDecoder !== "undefined";
}

type Bunny = typeof import("mediabunny");

let bunny: Promise<Bunny> | null = null;
/** The library, fetched once; a failed fetch (offline, a blocked chunk) is forgotten so the next try fetches again. */
function loadBunny(): Promise<Bunny> {
  bunny ??= import("mediabunny").catch((e) => {
    bunny = null;
    throw e;
  });
  return bunny;
}

const CANNOT_READ = "This video could not be read in the browser.";

/** What the file says about itself, or why it cannot be read. Never throws. */
export async function inspectVideo(file: Blob): Promise<{ ok: true; facts: VideoFacts } | { ok: false; problem: string }> {
  let b: Bunny;
  let input: InstanceType<Bunny["Input"]>;
  try {
    b = await loadBunny();
    input = new b.Input({ source: new b.BlobSource(file), formats: b.ALL_FORMATS });
  } catch {
    return { ok: false, problem: CANNOT_READ };
  }
  try {
    if (!(await input.canRead())) return { ok: false, problem: "This video's format could not be read in the browser." };
    const video = await input.getPrimaryVideoTrack();
    if (!video) return { ok: false, problem: "No picture track was found in this video." };
    const [container, seconds, videoStats, audioTracks] = await Promise.all([
      input.getMimeType(),
      input.computeDuration(),
      video.computePacketStats(200),
      input.getAudioTracks(),
    ]);
    const audio = await input.getPrimaryAudioTrack();
    // The sound's rate over its whole length is cheap (the index only); the picture's is taken from the file.
    const audioStats = audio ? await audio.computePacketStats() : null;
    const audioBitrate = audioStats?.averageBitrate ?? 0;
    return {
      ok: true,
      facts: {
        bytes: file.size,
        seconds,
        width: video.displayWidth,
        height: video.displayHeight,
        fps: videoStats.averagePacketRate, // 200 packets: a fine estimate of the frame rate, a poor one of the bitrate
        videoBitrate: wholeFileVideoBitrate(file.size, seconds, audioBitrate),
        videoCodec: video.codec,
        audioCodec: audio ? audio.codec : null,
        audioBitrate,
        audioTracks: audioTracks.length,
        container: container.split(";")[0].trim().toLowerCase(),
      },
    };
  } catch {
    return { ok: false, problem: CANNOT_READ };
  } finally {
    input.dispose();
  }
}

const CHANNEL_WORDS: Readonly<Record<FitChannel, string>> = { whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Facebook" };

/**
 * Re-make the video under `maxBytes` at its own resolution: H.264 (what every
 * channel plays), AAC sound copied when it already is AAC, keyframes every
 * KEYFRAME_SECONDS, the index at the front of the file. A pass that lands over
 * the limit is made again lower, up to MAX_PASSES.
 */
export async function fitVideo(
  file: Blob,
  maxBytes: number,
  channel: FitChannel,
  onProgress: (words: string) => void = () => {},
  /** Asked at every step: true stops the work (the person left the chat), and nothing is returned as a result. */
  cancelled: () => boolean = () => false
): Promise<FitOutcome> {
  const who = CHANNEL_WORDS[channel];
  const CANCELLED = { ok: false as const, problem: "Stopped." };
  if (!browserCanFit()) {
    return { ok: false, problem: `This browser cannot fit a video for ${who}. Use Chrome, Edge or Safari, or send a video under the limit.` };
  }
  if (file.size > FIT_INPUT_MAX_BYTES) return { ok: false, problem: `That video is ${megabytes(file.size)} — too large to read here.` };

  const looked = await inspectVideo(file);
  if (!looked.ok) return looked;
  if (cancelled()) return CANCELLED;
  const facts = looked.facts;
  const plan = planFit(facts, maxBytes, who);
  if (!plan.ok) return plan;

  let b: Bunny;
  try {
    b = await loadBunny();
    if (!(await b.canEncodeVideo("avc", { width: plan.width, height: plan.height, bitrate: plan.videoBitrate }))) {
      return { ok: false, problem: `This browser cannot encode H.264 at ${plan.width}×${plan.height}. Use Chrome, Edge or Safari.` };
    }
  } catch {
    return { ok: false, problem: CANNOT_READ };
  }

  let videoBitrate = plan.videoBitrate;
  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    if (cancelled()) return CANCELLED;
    onProgress(fitProgressWords(who, 0, pass));
    const input = new b.Input({ source: new b.BlobSource(file), formats: b.ALL_FORMATS });
    const target = new b.BufferTarget();
    const output = new b.Output({ format: new b.Mp4OutputFormat({ fastStart: "in-memory" }), target });
    let stopped = false;
    try {
      const conversion = await b.Conversion.init({
        input,
        output,
        tracks: "primary", // one picture, one sound: WhatsApp refuses a second sound track
        video: {
          codec: "avc",
          // The even size of the plan; `cover` crops the one spare line an odd source has, never stretches.
          width: plan.width,
          height: plan.height,
          fit: "cover",
          quality: new b.Quality({ bitrate: videoBitrate, bitrateMode: "constant" }),
          forceTranscode: true,
          keyFrameInterval: KEYFRAME_SECONDS,
        },
        // AAC sound is COPIED (no bitrate asked for, so nothing forces a re-encode); anything else becomes AAC.
        audio: (track) => (track.codec === "aac" ? { codec: "aac" } : { codec: "aac", quality: new b.Quality({ bitrate: AUDIO_BPS }) }),
        showWarnings: false,
      });
      const video = await input.getPrimaryVideoTrack();
      const audio = await input.getPrimaryAudioTrack();
      const dropped = conversion.discardedTracks;
      if (!conversion.isValid || (video && dropped.some((d) => d.track === video))) {
        const reason = dropped.find((d) => d.track === video)?.reason;
        return {
          ok: false,
          problem:
            reason === "undecodable_source_codec"
              ? `This browser cannot read this video's picture (${facts.videoCodec ?? "unknown codec"}). Chrome or Edge on a PC with H.265 support, or Safari, can.`
              : "This video could not be converted in the browser.",
        };
      }
      if (audio && dropped.some((d) => d.track === audio)) {
        return { ok: false, problem: "This video's sound could not be converted to AAC in this browser — try Chrome or Edge." };
      }
      conversion.onProgress = (fraction) => {
        if (cancelled() && !stopped) {
          stopped = true;
          void conversion.cancel();
          return;
        }
        onProgress(fitProgressWords(who, fraction, pass));
      };
      await conversion.execute();
    } catch {
      return stopped || cancelled() ? CANCELLED : { ok: false, problem: "The video could not be converted in the browser." };
    } finally {
      input.dispose();
    }
    if (cancelled()) return CANCELLED;
    const bytes = target.buffer;
    if (!bytes || bytes.byteLength === 0) return { ok: false, problem: "The conversion produced nothing." };
    if (bytes.byteLength <= maxBytes) {
      const made = { ...plan, videoBitrate, look: lookOf(videoBitrate, plan.width, plan.height, plan.fps) };
      return { ok: true, blob: new Blob([bytes], { type: "video/mp4" }), plan: made, passes: pass, words: fitWords(made, who, bytes.byteLength) };
    }
    videoBitrate = nextBitrate(videoBitrate, bytes.byteLength, plan.targetBytes);
  }
  return { ok: false, problem: `The video would not fit under ${who}'s ${megabytes(maxBytes)} after ${MAX_PASSES} passes — try a shorter clip.` };
}
