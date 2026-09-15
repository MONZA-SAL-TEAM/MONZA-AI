/**
 * VOICE NOTES FOR INSTAGRAM AND FACEBOOK — a recording as a WAV file.
 *
 * WhatsApp takes a voice note as Ogg/Opus (lib/media/ogg-opus.ts). Instagram
 * and Messenger do not take Ogg at all; of what they do take (AAC, M4A, WAV,
 * and MP3 on Messenger), WAV is the one a browser can write without a library:
 * the browser decodes the recording itself (Web Audio), and this turns the
 * sound into a plain WAV — one channel, 16 kHz, 16-bit, about 2 MB a minute,
 * so Meta's 25 MB holds about twelve minutes. Speech loses nothing it needs.
 *
 * PURE: numbers in, bytes out. The decoding is the browser's (lib/inbox/send-media.ts).
 */

/** The rate voice notes are written at: telephone-plus quality, small files. */
export const VOICE_SAMPLE_RATE = 16_000;

/** Several channels of sound → one, by averaging. */
export function downmix(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const n = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const c of channels) s += c[i];
    out[i] = s / channels.length;
  }
  return out;
}

/** Change the sample rate by straight-line interpolation — plenty for speech. */
export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const length = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const out = new Float32Array(length);
  const step = fromRate / toRate;
  for (let i = 0; i < length; i++) {
    const at = i * step;
    const j = Math.floor(at);
    const frac = at - j;
    const a = input[Math.min(j, input.length - 1)];
    const b = input[Math.min(j + 1, input.length - 1)];
    out[i] = a + (b - a) * frac;
  }
  return out;
}

function ascii(dv: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) dv.setUint8(offset + i, text.charCodeAt(i));
}

/** One channel of sound (−1…1) as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const out = new Uint8Array(44 + dataBytes);
  const dv = new DataView(out.buffer);
  ascii(dv, 0, "RIFF");
  dv.setUint32(4, 36 + dataBytes, true);
  ascii(dv, 8, "WAVE");
  ascii(dv, 12, "fmt ");
  dv.setUint32(16, 16, true); // fmt chunk size
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // one channel
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true); // bytes per second
  dv.setUint16(32, 2, true); // bytes per sample frame
  dv.setUint16(34, 16, true); // bits per sample
  ascii(dv, 36, "data");
  dv.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    dv.setInt16(44 + i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  return out;
}

/** Decoded sound, any rate and channel count → a voice-note WAV. */
export function voiceWav(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  return encodeWav(resample(downmix(channels), sampleRate, VOICE_SAMPLE_RATE), VOICE_SAMPLE_RATE);
}
