/**
 * Voice notes from Chrome (2026-09-15). WhatsApp shows a recording as a voice
 * note only when it is Ogg/Opus; Chrome records Opus inside WebM. Pinned here:
 *
 *   - every Opus packet moves across untouched, in order;
 *   - the Ogg pages are valid: header first, tags second, end marked, CRCs right;
 *   - the playing time (granule position) adds up;
 *   - anything that is not a WebM/Opus recording is refused, not mangled.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { isOgg, oggCrc, opusFromWebm, opusPacketSamples, webmToOgg } from "@/lib/media/ogg-opus";

/* ── Building a WebM the way MediaRecorder writes one ────────────────────── */

function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function idBytes(id: number): number[] {
  const out: number[] = [];
  let v = id;
  while (v > 0) {
    out.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return out;
}

function size8(n: number): number[] {
  const out = [0x01, 0, 0, 0, 0, 0, 0, 0];
  let v = n;
  for (let i = 7; i >= 1; i--) {
    out[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  return out;
}

/** "Unknown size" — how a live recording writes its Segment and Clusters. */
const UNKNOWN = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

const el = (id: number, ...children: (Uint8Array | number[])[]) => {
  const data = concat(...children);
  return concat(idBytes(id), size8(data.length), data);
};
const open = (id: number, ...children: (Uint8Array | number[])[]) => concat(idBytes(id), UNKNOWN, ...children);
const text = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

const HEAD = new Uint8Array([...text("OpusHead"), 1, 1, 0x38, 0x01, 0x80, 0xbb, 0, 0, 0, 0, 0]);

/** A fake Opus packet: TOC 0xF8 = CELT, 20 ms, one frame = 960 samples. */
function packet(n: number, length: number): Uint8Array {
  const p = new Uint8Array(length);
  p[0] = 0xf8;
  for (let i = 1; i < length; i++) p[i] = (n * 31 + i) & 0xff;
  return p;
}

const block = (p: Uint8Array) => el(0xa3, [0x81, 0x00, 0x00, 0x80], p);

function recording(packets: Uint8Array[], opts: { head?: boolean; codec?: string } = {}): Uint8Array {
  const entry = [
    el(0xd7, [1]),
    el(0x86, text(opts.codec ?? "A_OPUS")),
    ...(opts.head === false ? [] : [el(0x63a2, HEAD)]),
    el(0xe1, el(0x9f, [1])),
  ];
  return concat(
    el(0x1a45dfa3, el(0x4282, text("webm"))),
    open(0x18538067, el(0x1654ae6b, el(0xae, ...entry)), open(0x1f43b675, el(0xe7, [0]), ...packets.map(block)))
  );
}

/* ── Reading the Ogg back ────────────────────────────────────────────────── */

interface Page {
  flags: number;
  granule: number;
  serial: number;
  seq: number;
  crcOk: boolean;
  packets: Uint8Array[];
}

function pagesOf(ogg: Uint8Array): Page[] {
  const pages: Page[] = [];
  const dv = new DataView(ogg.buffer, ogg.byteOffset, ogg.byteLength);
  let pos = 0;
  while (pos < ogg.length) {
    assert.equal(String.fromCharCode(...ogg.subarray(pos, pos + 4)), "OggS");
    const segments = ogg[pos + 26];
    const lacing = ogg.subarray(pos + 27, pos + 27 + segments);
    const bodyLength = lacing.reduce((n, x) => n + x, 0);
    const end = pos + 27 + segments + bodyLength;
    const copy = ogg.slice(pos, end);
    new DataView(copy.buffer).setUint32(22, 0, true);

    const packets: Uint8Array[] = [];
    let o = pos + 27 + segments;
    let current: number[] = [];
    for (const x of lacing) {
      current.push(...ogg.subarray(o, o + x));
      o += x;
      if (x < 255) {
        packets.push(new Uint8Array(current));
        current = [];
      }
    }
    pages.push({
      flags: ogg[pos + 5],
      granule: dv.getUint32(pos + 6, true) + dv.getUint32(pos + 10, true) * 2 ** 32,
      serial: dv.getUint32(pos + 14, true),
      seq: dv.getUint32(pos + 18, true),
      crcOk: oggCrc(copy) === dv.getUint32(pos + 22, true),
      packets,
    });
    pos = end;
  }
  return pages;
}

describe("a Chrome voice recording becomes a WhatsApp voice note", () => {
  const packets = Array.from({ length: 61 }, (_, i) => packet(i, i === 10 ? 300 : 40));

  test("every packet moves across untouched, in order, in valid Ogg pages", () => {
    const ogg = webmToOgg(recording(packets));
    assert.ok(ogg, "converted");
    assert.ok(isOgg(ogg));
    const pages = pagesOf(ogg);

    assert.ok(pages.every((p) => p.crcOk), "every page checksum is right");
    assert.ok(pages.every((p) => p.serial === pages[0].serial), "one stream");
    assert.deepEqual(pages.map((p) => p.seq), pages.map((_, i) => i), "pages numbered in order");

    assert.equal(pages[0].flags, 0x02, "the first page begins the stream");
    assert.deepEqual(pages[0].packets, [HEAD], "…and holds the OpusHead, alone");
    assert.equal(String.fromCharCode(...pages[1].packets[0].subarray(0, 8)), "OpusTags");
    assert.equal(pages[pages.length - 1].flags & 0x04, 0x04, "the last page ends it");

    const audio = pages.slice(2).flatMap((p) => p.packets);
    assert.deepEqual(audio, packets, "the sound itself is not touched");
  });

  test("the playing time adds up: 61 packets × 20 ms", () => {
    const pages = pagesOf(webmToOgg(recording(packets))!);
    const granules = pages.slice(2).map((p) => p.granule);
    assert.equal(granules[granules.length - 1], 61 * 960);
    assert.ok(granules.every((g, i) => i === 0 || g >= granules[i - 1]), "never goes backwards");
  });

  test("a recording cut off mid-write keeps everything before the cut", () => {
    const whole = recording(packets);
    const track = opusFromWebm(whole.subarray(0, whole.length - 10));
    assert.ok(track);
    assert.equal(track.packets.length, 60);
  });

  test("a recording without an OpusHead gets a mono one", () => {
    const track = opusFromWebm(recording(packets.slice(0, 3), { head: false }));
    assert.ok(track);
    assert.equal(String.fromCharCode(...track.head.subarray(0, 8)), "OpusHead");
    assert.equal(track.head[9], 1, "one channel — WhatsApp wants mono");
  });

  test("anything that is not a WebM/Opus recording is refused, not mangled", () => {
    assert.equal(webmToOgg(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), null);
    assert.equal(webmToOgg(recording(packets, { codec: "A_VORBIS" })), null);
    assert.equal(webmToOgg(new Uint8Array(0)), null);
  });
});

describe("the details", () => {
  test("Ogg's checksum: CRC-32, polynomial 0x04C11DB7, from zero, no final inversion", () => {
    // CRC-32/POSIX of "123456789" is 0x765E7680; Ogg's is the same without the final XOR.
    assert.equal(oggCrc(new Uint8Array(text("123456789"))), 0x89a1897f);
  });

  test("samples per packet, from the Opus TOC byte", () => {
    assert.equal(opusPacketSamples(new Uint8Array([0xf8])), 960, "CELT 20 ms");
    assert.equal(opusPacketSamples(new Uint8Array([0x08])), 960, "SILK 20 ms");
    assert.equal(opusPacketSamples(new Uint8Array([0x18])), 2880, "SILK 60 ms");
    assert.equal(opusPacketSamples(new Uint8Array([0x80])), 120, "CELT 2.5 ms");
    assert.equal(opusPacketSamples(new Uint8Array([0xf9])), 1920, "two frames");
    assert.equal(opusPacketSamples(new Uint8Array([0xfb, 0x03])), 2880, "three frames, counted");
    assert.equal(opusPacketSamples(new Uint8Array([])), 0);
  });
});
