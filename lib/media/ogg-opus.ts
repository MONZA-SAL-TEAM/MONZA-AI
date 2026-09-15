/**
 * VOICE NOTES FROM CHROME — WebM/Opus repackaged as Ogg/Opus.
 *
 * WhatsApp shows a recording as a voice note (the bubble with a waveform) only
 * when it is Ogg with the Opus codec, sent with `"voice": true`. Chrome and
 * Edge record Opus but put it in a WebM container, which WhatsApp refuses.
 * The SOUND is already right — only the box is wrong — so this moves each Opus
 * packet from the WebM box into an Ogg box, untouched. No re-encoding, no
 * library, no loss.
 *
 * Firefox records Ogg itself and needs none of this. Safari records MP4/AAC,
 * which WhatsApp accepts as an ordinary audio file.
 *
 * PURE: bytes in, bytes out.
 */

/* ── Reading WebM (Matroska / EBML) ─────────────────────────────────────── */

const EL = {
  Segment: 0x18538067,
  Cluster: 0x1f43b675,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  Audio: 0xe1,
  BlockGroup: 0xa0,
  Block: 0xa1,
  SimpleBlock: 0xa3,
  TrackNumber: 0xd7,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  Channels: 0x9f,
} as const;

/** Elements whose content is more elements. Walked into, never skipped — so an
 *  element of "unknown size" (how a live recording writes them) reads fine. */
const CONTAINERS: ReadonlySet<number> = new Set([
  EL.Segment,
  EL.Cluster,
  EL.Tracks,
  EL.TrackEntry,
  EL.Audio,
  EL.BlockGroup,
]);

interface Vint {
  value: number;
  length: number;
  unknown: boolean;
}

/** A Matroska variable-length integer. IDs keep their length marker; sizes do not. */
function readVint(b: Uint8Array, pos: number, keepMarker: boolean): Vint | null {
  const first = b[pos];
  if (first === undefined || first === 0) return null;
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && (first & mask) === 0) {
    mask >>= 1;
    length++;
  }
  if (length > 8 || pos + length > b.length) return null;
  let value = keepMarker ? first : first & (mask - 1);
  let allOnes = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < length; i++) {
    value = value * 256 + b[pos + i];
    if (b[pos + i] !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

function uint(b: Uint8Array): number {
  let v = 0;
  for (const x of b) v = v * 256 + x;
  return v;
}

function ascii(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return s;
}

function startsWith(b: Uint8Array, text: string): boolean {
  if (b.length < text.length) return false;
  for (let i = 0; i < text.length; i++) if (b[i] !== text.charCodeAt(i)) return false;
  return true;
}

export interface OpusTrack {
  /** The 19+ byte OpusHead packet. */
  head: Uint8Array;
  packets: Uint8Array[];
}

/** An OpusHead for a stream whose container did not carry one. */
function defaultHead(channels: number): Uint8Array {
  const h = new Uint8Array(19);
  h.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64]); // "OpusHead"
  const dv = new DataView(h.buffer);
  h[8] = 1; // version
  h[9] = channels === 2 ? 2 : 1;
  dv.setUint16(10, 312, true); // pre-skip, what Chrome's encoder uses
  dv.setUint32(12, 48_000, true);
  dv.setInt16(16, 0, true);
  h[18] = 0; // channel mapping family
  return h;
}

/** The Opus packets of a WebM recording, in order — or null when it is not one. */
export function opusFromWebm(bytes: Uint8Array): OpusTrack | null {
  let pos = 0;
  let head: Uint8Array | null = null;
  let codec: string | null = null;
  let channels = 1;
  let trackNumber: number | null = null;
  let audioTrack: number | null = null;
  const packets: Uint8Array[] = [];

  while (pos < bytes.length) {
    const id = readVint(bytes, pos, true);
    if (!id) break;
    const size = readVint(bytes, pos + id.length, false);
    if (!size) break;
    const start = pos + id.length + size.length;

    if (CONTAINERS.has(id.value)) {
      pos = start;
      continue;
    }
    if (size.unknown) return null;
    const end = start + size.value;
    // A recording stopped mid-write can end inside its last block: keep what came before.
    if (end > bytes.length) break;
    const data = bytes.subarray(start, end);

    switch (id.value) {
      case EL.TrackNumber:
        trackNumber = uint(data);
        break;
      case EL.CodecID:
        codec = ascii(data);
        if (codec === "A_OPUS") audioTrack = trackNumber;
        break;
      case EL.CodecPrivate:
        if (startsWith(data, "OpusHead")) head = data.slice();
        break;
      case EL.Channels:
        channels = uint(data);
        break;
      case EL.SimpleBlock:
      case EL.Block: {
        const track = readVint(data, 0, false);
        if (!track || data.length < track.length + 3) break;
        const flags = data[track.length + 2];
        // Laced blocks pack several frames into one; browsers never write them.
        if ((flags & 0x06) !== 0) return null;
        if (audioTrack === null || track.value === audioTrack) {
          packets.push(data.slice(track.length + 3));
        }
        break;
      }
    }
    pos = end;
  }

  if (codec !== "A_OPUS" || packets.length === 0) return null;
  return { head: head ?? defaultHead(channels), packets };
}

/** How many 48 kHz samples one Opus packet decodes to (RFC 6716 §3.1). */
export function opusPacketSamples(p: Uint8Array): number {
  if (p.length === 0) return 0;
  const toc = p[0];
  const config = toc >> 3;
  const frame =
    config < 12 ? [480, 960, 1920, 2880][config & 3] : config < 16 ? [480, 960][config & 1] : [120, 240, 480, 960][config & 3];
  const code = toc & 3;
  const frames = code === 0 ? 1 : code === 3 ? (p.length > 1 ? p[1] & 0x3f : 0) : 2;
  return frame * frames;
}

/* ── Writing Ogg (RFC 3533, RFC 7845) ───────────────────────────────────── */

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

/** Ogg's page checksum: CRC-32, polynomial 0x04C11DB7, not reflected, starting at 0. */
export function oggCrc(page: Uint8Array): number {
  let c = 0;
  for (const b of page) c = ((c << 8) ^ CRC_TABLE[((c >>> 24) ^ b) & 0xff]) >>> 0;
  return c;
}

const BOS = 0x02;
const EOS = 0x04;

function oggPage(packets: readonly Uint8Array[], granule: number, serial: number, seq: number, flags: number): Uint8Array {
  const lacing: number[] = [];
  let bodyLength = 0;
  for (const p of packets) {
    let n = p.length;
    while (n >= 255) {
      lacing.push(255);
      n -= 255;
    }
    lacing.push(n);
    bodyLength += p.length;
  }
  const out = new Uint8Array(27 + lacing.length + bodyLength);
  const dv = new DataView(out.buffer);
  out.set([0x4f, 0x67, 0x67, 0x53]); // "OggS"
  out[4] = 0;
  out[5] = flags;
  dv.setUint32(6, granule % 0x1_0000_0000, true);
  dv.setUint32(10, Math.floor(granule / 0x1_0000_0000), true);
  dv.setUint32(14, serial, true);
  dv.setUint32(18, seq, true);
  dv.setUint32(22, 0, true);
  out[26] = lacing.length;
  out.set(lacing, 27);
  let o = 27 + lacing.length;
  for (const p of packets) {
    out.set(p, o);
    o += p.length;
  }
  dv.setUint32(22, oggCrc(out), true);
  return out;
}

function opusTags(): Uint8Array {
  const vendor = "MONZA AI";
  const out = new Uint8Array(8 + 4 + vendor.length + 4);
  const dv = new DataView(out.buffer);
  out.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73]); // "OpusTags"
  dv.setUint32(8, vendor.length, true);
  for (let i = 0; i < vendor.length; i++) out[12 + i] = vendor.charCodeAt(i);
  dv.setUint32(12 + vendor.length, 0, true); // no comments
  return out;
}

/** Packets per audio page: about a second of speech, well inside 255 segments. */
const PACKETS_PER_PAGE = 50;

/** An Ogg/Opus file holding exactly the packets of `track`. */
export function opusToOgg(track: OpusTrack, serial = 0x4d4f4e5a): Uint8Array {
  const pages: Uint8Array[] = [oggPage([track.head], 0, serial, 0, BOS), oggPage([opusTags()], 0, serial, 1, 0)];
  let seq = 2;
  let granule = 0;
  let batch: Uint8Array[] = [];
  let segments = 0;
  for (const p of track.packets) {
    const need = Math.floor(p.length / 255) + 1;
    if (batch.length > 0 && (segments + need > 255 || batch.length >= PACKETS_PER_PAGE)) {
      pages.push(oggPage(batch, granule, serial, seq++, 0));
      batch = [];
      segments = 0;
    }
    batch.push(p);
    segments += need;
    granule += opusPacketSamples(p);
  }
  pages.push(oggPage(batch, granule, serial, seq, EOS));

  const total = pages.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of pages) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** WebM/Opus → Ogg/Opus, or null when the recording is not WebM/Opus. */
export function webmToOgg(bytes: Uint8Array): Uint8Array | null {
  const track = opusFromWebm(bytes);
  return track ? opusToOgg(track) : null;
}

export function isOgg(bytes: Uint8Array): boolean {
  return startsWith(bytes, "OggS");
}
