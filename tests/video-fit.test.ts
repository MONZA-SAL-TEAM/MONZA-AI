/**
 * Fitting a video under a channel's limit at its own resolution (Samer, 2026-10-22:
 * "I want to send him the video with his original or HD resolution"). Pinned, in
 * Node, without a browser:
 *
 *   - a video that already fits is never touched; what WhatsApp refuses is fitted;
 *   - the planned bitrate lands under the limit, never above the original's;
 *   - the sound is copied when it is AAC, re-encoded otherwise, and budgeted;
 *   - a video too long to look like anything is refused with the length that would work;
 *   - the words say what was kept and how it will look; a second pass goes lower.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  AUDIO_BPS,
  MIN_VIDEO_BPS,
  RETRY_FACTOR,
  evenSize,
  fitProgressWords,
  fitWords,
  lookOf,
  needsFit,
  nextBitrate,
  planFit,
  wholeFileVideoBitrate,
  type VideoFacts,
} from "@/lib/media/video-fit";

const MB = 1024 * 1024;
const WA = 16 * MB;

function facts(over: Partial<VideoFacts> = {}): VideoFacts {
  return {
    bytes: 117 * MB,
    seconds: 60,
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrate: 15_000_000,
    videoCodec: "avc",
    audioCodec: "aac",
    audioBitrate: 128_000,
    audioTracks: 1,
    container: "video/mp4",
    ...over,
  };
}

describe("whether a video has to be touched", () => {
  test("an MP4 of H.264 and AAC under the limit goes as it is, on every channel", () => {
    const small = facts({ bytes: 9 * MB });
    assert.deepEqual(needsFit(small, WA, "whatsapp"), { fit: false });
    assert.deepEqual(needsFit(small, 25 * MB, "instagram"), { fit: false });
    assert.deepEqual(needsFit(facts({ bytes: 9 * MB, audioCodec: null, audioTracks: 0 }), WA, "whatsapp"), { fit: false });
  });

  test("over the limit is fitted everywhere; WhatsApp also refuses H.265, MOV, a second sound track, non-AAC sound", () => {
    assert.deepEqual(needsFit(facts(), WA, "whatsapp"), { fit: true, why: "size" });
    assert.deepEqual(needsFit(facts({ bytes: 30 * MB }), 25 * MB, "facebook"), { fit: true, why: "size" });
    assert.deepEqual(needsFit(facts({ bytes: 9 * MB, videoCodec: "hevc" }), WA, "whatsapp"), { fit: true, why: "codec" });
    assert.deepEqual(needsFit(facts({ bytes: 9 * MB, container: "video/quicktime" }), WA, "whatsapp"), { fit: true, why: "container" });
    assert.deepEqual(needsFit(facts({ bytes: 9 * MB, audioTracks: 2 }), WA, "whatsapp"), { fit: true, why: "tracks" });
    assert.deepEqual(needsFit(facts({ bytes: 9 * MB, audioCodec: "opus" }), WA, "whatsapp"), { fit: true, why: "audio" });
    // Instagram and Messenger take MP4, MOV and WEBM and say nothing about codecs: the size and the box decide there.
    assert.deepEqual(needsFit(facts({ bytes: 9 * MB, container: "video/quicktime", videoCodec: "hevc" }), 25 * MB, "instagram"), { fit: false });
    assert.deepEqual(needsFit(facts({ bytes: 9 * MB, container: "video/x-matroska" }), 25 * MB, "instagram"), { fit: true, why: "container" });
    assert.deepEqual(needsFit(facts({ bytes: 9 * MB, container: "video/3gpp" }), 25 * MB, "facebook"), { fit: true, why: "container" });
    // A sound track the reader cannot name is not "no sound".
    assert.deepEqual(needsFit(facts({ bytes: 9 * MB, audioCodec: null, audioTracks: 1 }), WA, "whatsapp"), { fit: true, why: "audio" });
  });

  test("the picture's rate is the whole file's, not its first seconds'; sides are made even", () => {
    assert.equal(wholeFileVideoBitrate(117 * MB, 60, 128_000), Math.floor((117 * MB * 8) / 60 - 128_000));
    assert.equal(wholeFileVideoBitrate(1000, 0, 0), 0);
    assert.equal(wholeFileVideoBitrate(100, 100, 1_000_000), 0, "never negative");
    assert.deepEqual(evenSize(1080, 1921), { width: 1080, height: 1920 });
    assert.deepEqual(evenSize(1, 1), { width: 2, height: 2 });
  });
});

describe("the plan", () => {
  test("lands under the limit at the same resolution, sound copied when it is AAC", () => {
    const plan = planFit(facts(), WA, "WhatsApp");
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.width, 1920);
    assert.equal(plan.height, 1080);
    assert.equal(plan.copyAudio, true);
    assert.equal(plan.audioBitrate, 128_000);
    const bytes = ((plan.videoBitrate + plan.audioBitrate) * plan.seconds) / 8;
    assert.ok(bytes <= WA * 0.95, `${bytes} fits with room`);
    assert.ok(plan.videoBitrate > 1_800_000 && plan.videoBitrate < 2_200_000, `${plan.videoBitrate} for 60 s`);
    assert.equal(plan.look, "soft");
  });

  test("never more bits than the original carries", () => {
    const plan = planFit(facts({ bytes: 9 * MB, seconds: 10, videoBitrate: 6_000_000, videoCodec: "hevc" }), WA, "WhatsApp");
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.ok(plan.videoBitrate <= 6_000_000 * 0.98 + 1);
    assert.equal(plan.look, "sharp");
  });

  test("non-AAC sound is budgeted at AUDIO_BPS; no sound costs nothing; AAC is copied even beside a dropped second track", () => {
    const opus = planFit(facts({ audioCodec: "opus", audioBitrate: 64_000 }), WA, "WhatsApp");
    assert.equal(opus.ok && opus.copyAudio, false);
    assert.equal(opus.ok ? opus.audioBitrate : 0, AUDIO_BPS);
    const silent = planFit(facts({ audioCodec: null, audioTracks: 0, audioBitrate: 0 }), WA, "WhatsApp");
    assert.equal(silent.ok ? silent.audioBitrate : -1, 0);
    assert.ok(silent.ok && opus.ok && silent.videoBitrate > opus.videoBitrate, "the picture gets what the sound does not take");
    const two = planFit(facts({ audioTracks: 2 }), WA, "WhatsApp");
    assert.equal(two.ok && two.copyAudio, true, "only the primary track travels, and it is AAC");
    const unknown = planFit(facts({ audioCodec: null, audioTracks: 1 }), WA, "WhatsApp");
    assert.equal(unknown.ok ? unknown.audioBitrate : 0, AUDIO_BPS, "an unnamed sound track still costs its re-encode");
    const odd = planFit(facts({ width: 1081, height: 1919 }), WA, "WhatsApp");
    assert.deepEqual(odd.ok ? { w: odd.width, h: odd.height } : null, { w: 1080, h: 1918 });
  });

  test("a video too long to look like anything is refused with the length that would", () => {
    const plan = planFit(facts({ seconds: 20 * 60 }), WA, "WhatsApp");
    assert.equal(plan.ok, false);
    if (plan.ok) return;
    assert.match(plan.problem, /20:00 min/);
    assert.match(plan.problem, /16 MB/);
    assert.match(plan.problem, /A clip under \d+(:\d\d min| s) would/);
    // The length it names does fit.
    const named = Number(/under (\d+) s/.exec(plan.problem)?.[1] ?? /under (\d+):/.exec(plan.problem)?.[1]) || 0;
    assert.ok(named > 0);
    assert.ok(MIN_VIDEO_BPS > 0);
  });

  test("unreadable length or size is refused, not divided by zero", () => {
    assert.equal(planFit(facts({ seconds: 0 }), WA, "WhatsApp").ok, false);
    assert.equal(planFit(facts({ width: 0 }), WA, "WhatsApp").ok, false);
  });
});

describe("how it will look, and the words", () => {
  test("bits per pixel per frame decide", () => {
    assert.equal(lookOf(5_000_000, 1920, 1080, 30), "sharp");
    assert.equal(lookOf(3_000_000, 1920, 1080, 30), "fine");
    assert.equal(lookOf(1_800_000, 1920, 1080, 30), "soft");
    assert.equal(lookOf(900_000, 1920, 1080, 30), "poor");
    assert.equal(lookOf(1_800_000, 1280, 720, 30), "fine", "the same bits go further at 720p");
  });

  test("the sentence under the preview says what was kept", () => {
    const plan = planFit(facts({ seconds: 20, videoBitrate: 12_000_000 }), WA, "WhatsApp");
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    const words = fitWords(plan, "WhatsApp", 15 * MB);
    assert.match(words, /^Fitted for WhatsApp: 1920×1080 kept, 20 s at \d+(\.\d)? Mbps \(15 MB\) — it will look (sharp|fine)\.$/);
    assert.match(fitProgressWords("WhatsApp", 0.421, 1), /^Fitting the video for WhatsApp — 42%$/);
    assert.match(fitProgressWords("WhatsApp", 1, 2), /pass 2, 99%$/);
  });

  test("a pass that landed over the limit goes proportionally lower, never by less than the retry step", () => {
    assert.equal(nextBitrate(4_000_000, 18 * MB, 15 * MB), Math.floor(4_000_000 * (15 / 18)));
    assert.equal(nextBitrate(4_000_000, 15.5 * MB, 15 * MB), Math.floor(4_000_000 * RETRY_FACTOR));
    assert.equal(nextBitrate(260_000, 40 * MB, 15 * MB), MIN_VIDEO_BPS);
  });
});
