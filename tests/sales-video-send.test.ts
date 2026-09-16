/**
 * Small send copies of colour videos live under <carId>/video-send/<colourId>/
 * (Samer, 2026-09-16: "i want it to send me the video", not a link). The path
 * rules accept them exactly like a video, and nothing else changes.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { checkUpload, parseMediaPath } from "@/lib/wasales/media-paths";

test("a send copy is a video with its colour, marked as a copy", () => {
  assert.deepEqual(parseMediaPath("voyah-courage/video-send/white/abc123__Courage-White.mp4"), {
    carId: "voyah-courage",
    kind: "video",
    colourId: "white",
    objectName: "abc123__Courage-White.mp4",
    sendCopy: true,
  });
  assert.equal(checkUpload("voyah-courage/video-send/white/abc123__Courage-White.mp4", "video/mp4").ok, true);
});

test("a send copy still needs a colour, a video type and a safe name", () => {
  assert.equal(parseMediaPath("voyah-courage/video-send/abc__a.mp4"), null);
  assert.equal(checkUpload("voyah-courage/video-send/white/abc__a.pdf", "application/pdf").ok, false);
  assert.equal(parseMediaPath("voyah-courage/video-send/../x/abc__a.mp4"), null);
  assert.equal(parseMediaPath("voyah-courage/brochure-send/abc__a.pdf"), null);
});

test("originals are read exactly as before", () => {
  assert.deepEqual(parseMediaPath("voyah-free/video/black/abc123__walkaround.mp4"), {
    carId: "voyah-free",
    kind: "video",
    colourId: "black",
    objectName: "abc123__walkaround.mp4",
  });
});
