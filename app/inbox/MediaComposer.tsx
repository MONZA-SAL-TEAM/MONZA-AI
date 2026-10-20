"use client";

/**
 * Attach and record, like WhatsApp (Samer, 2026-09-15):
 *
 *   📎  pick photos, videos, audio files or documents — several at once (Samer,
 *       2026-10-20: "send two videos together"), or drop / paste them into the
 *       conversation — see them, add a caption, press Send: they go one after
 *       the other, in order;
 *   🎤  record a voice note; stop sends it, the bin throws it away.
 *
 * A person always presses Send (rule 24). Nothing is uploaded until they do,
 * and the server checks everything again (lib/inbox/send-media.ts).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { formatBytes, formatClock } from "@/lib/inbox/media";
import { limitWords, MAX_CAPTION, rulesFor, type MediaChannel } from "@/lib/channels/wa-media";
import { prepareFile, prepareRecording, recorderMimeType, sendFile, type ReadyFile } from "@/lib/inbox/send-media";
import { enterSends, hasTouchKeyboard } from "@/lib/inbox/keys";

/**
 * The longest recording per channel: WhatsApp's Ogg is small (15 minutes fits
 * 16 MB with room); Instagram and Facebook get WAV, ~2 MB a minute under 25 MB.
 */
const MAX_RECORDING_MS: Readonly<Record<MediaChannel, number>> = {
  whatsapp: 15 * 60_000,
  instagram: 11 * 60_000,
  facebook: 11 * 60_000,
};

/** What the file picker offers, per channel's own rules (lib/channels/wa-media.ts). */
const ACCEPT: Readonly<Record<MediaChannel, string>> = {
  whatsapp: "image/*,video/mp4,video/3gpp,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,application/pdf",
  instagram: "image/*,video/mp4,video/quicktime,video/webm,audio/aac,audio/mp4,audio/x-m4a,audio/wav,.m4a,.aac,.wav,.pdf,application/pdf",
  facebook:
    "image/*,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/mp4,audio/aac,audio/wav,.mp3,.m4a,.wav,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip",
};

function mediaChannel(channel: string): MediaChannel {
  return channel === "instagram" || channel === "facebook" ? channel : "whatsapp";
}

interface Props {
  conversationId: string;
  /** Which channel the conversation is on: its rules decide what may be sent. */
  channel: string;
  /** Live thread with its reply window open. */
  enabled: boolean;
  /** Why it is not, in words, for the buttons' titles. */
  disabledReason: string;
  /** Files dropped or pasted into the conversation. */
  dropped: File[] | null;
  onDroppedTaken: () => void;
  onSent: () => void;
  onNote: (text: string) => void;
}

type Stage = null | "preparing" | "uploading" | "sending";

function Svg({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const CLIP = "M21.4 11.6l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5";
const MIC = "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z M19 10v2a7 7 0 0 1-14 0v-2 M12 19v3";
const BIN = "M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6";
const SEND = "M22 2L11 13 M22 2l-7 20-4-9-9-4z";
/** At most this many files in one go. */
const MAX_FILES = 10;

export default function MediaComposer({
  conversationId,
  channel: channelName,
  enabled,
  disabledReason,
  dropped,
  onDroppedTaken,
  onSent,
  onNote,
}: Props) {
  const channel = mediaChannel(channelName);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pickedList, setPickedList] = useState<{ file: ReadyFile; preview: string | null }[]>([]);
  const [shown, setShown] = useState(0);
  const [progress, setProgress] = useState<string | null>(null);
  const picked = pickedList[Math.min(shown, pickedList.length - 1)] ?? null;
  const setPicked = (one: { file: ReadyFile; preview: string | null } | null) => {
    setPickedList(one ? [one] : []);
    setShown(0);
  };
  const [caption, setCaption] = useState("");
  const [stage, setStage] = useState<Stage>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const [recording, setRecording] = useState<number | null>(null); // started at
  const [clock, setClock] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const discard = useRef(false);
  // Decided after the page is in the browser, so the server's HTML and the
  // browser's first render agree.
  const [canRecord, setCanRecord] = useState(false);
  const [touchKeyboard, setTouchKeyboard] = useState(false);
  useEffect(() => {
    setCanRecord(recorderMimeType() !== null && !!navigator.mediaDevices?.getUserMedia);
    setTouchKeyboard(hasTouchKeyboard());
  }, []);

  const close = useCallback(() => {
    setPickedList((list) => {
      for (const p of list) if (p.preview) URL.revokeObjectURL(p.preview);
      return [];
    });
    setShown(0);
    setProgress(null);
    setCaption("");
    setProblem(null);
    setStage(null);
  }, []);

  const take = useCallback(
    async (files: File[]) => {
      if (!enabled) {
        onNote(disabledReason);
        return;
      }
      if (files.length > MAX_FILES) onNote(`Up to ${MAX_FILES} files at once — the first ${MAX_FILES} are ready to send.`);
      setStage("preparing");
      const ready: { file: ReadyFile; preview: string | null }[] = [];
      const refused: string[] = [];
      for (const f of files.slice(0, MAX_FILES)) {
        const r = await prepareFile(f, channel);
        if (!r.ok) {
          refused.push(`${f.name}: ${r.problem}`);
          continue;
        }
        const showable = r.file.kind === "image" || r.file.kind === "video" || r.file.kind === "audio" || r.file.asFile === true;
        ready.push({ file: r.file, preview: showable ? URL.createObjectURL(r.file.blob) : null });
      }
      setStage(null);
      if (refused.length) onNote(refused.join(" · "));
      if (ready.length === 0) return;
      setPickedList(ready);
      setShown(0);
      setCaption("");
      setProblem(refused.length ? `Not added: ${refused.join(" · ")}` : null);
    },
    [enabled, disabledReason, onNote, channel]
  );

  useEffect(() => {
    if (!dropped || dropped.length === 0) return;
    onDroppedTaken();
    void take(dropped);
  }, [dropped, onDroppedTaken, take]);

  // Another conversation opened: whatever was half-prepared stays with this one.
  useEffect(() => close, [conversationId, close]);

  async function send(file: ReadyFile, words: string): Promise<boolean> {
    setProblem(null);
    const r = await sendFile(conversationId, file, words, setStage);
    setStage(null);
    if (!r.ok) {
      setProblem(r.message);
      onNote(r.message);
      return false;
    }
    onSent();
    return true;
  }

  /** Every picked file, in order; the caption goes with the first. A failure stops there and keeps the rest. */
  async function sendAll(words: string): Promise<boolean> {
    const list = pickedList;
    for (let i = 0; i < list.length; i++) {
      if (list.length > 1) setProgress(`${i + 1} of ${list.length}`);
      const ok = await send(list[i].file, i === 0 ? words : "");
      if (!ok) {
        // What went is gone from the sheet; what did not stays, with the reason.
        for (const p of list.slice(0, i)) if (p.preview) URL.revokeObjectURL(p.preview);
        setPickedList(list.slice(i));
        setShown(0);
        setProgress(null);
        if (i > 0) setCaption("");
        return false;
      }
    }
    setProgress(null);
    return true;
  }

  /* ── Recording ─────────────────────────────────────────────────────── */

  useEffect(() => {
    if (recording === null) return;
    const t = setInterval(() => {
      const ms = Date.now() - recording;
      setClock(ms);
      if (ms >= MAX_RECORDING_MS[channel]) finish(true);
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- finish reads refs only
  }, [recording]);

  async function start() {
    const type = recorderMimeType();
    if (!enabled || !type) {
      onNote(enabled ? "This browser cannot record voice notes." : disabledReason);
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      stream.current = s;
      chunks.current = [];
      discard.current = false;
      const r = new MediaRecorder(s, { mimeType: type, audioBitsPerSecond: 32_000 });
      r.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      r.onstop = () => {
        stream.current?.getTracks().forEach((t) => t.stop());
        stream.current = null;
        if (discard.current) return;
        const blob = new Blob(chunks.current, { type: r.mimeType || type });
        void (async () => {
          setStage("preparing");
          const ready = await prepareRecording(blob, r.mimeType || type, channel);
          if (!ready.ok) {
            setStage(null);
            onNote(ready.problem);
            return;
          }
          // A voice note that did not go is not thrown away: it waits in the
          // sheet, with the reason, for Send to be pressed again.
          if (!(await send(ready.file, ""))) {
            setPicked({ file: ready.file, preview: URL.createObjectURL(ready.file.blob) });
          }
        })();
      };
      recorder.current = r;
      r.start(1000);
      setClock(0);
      setRecording(Date.now());
    } catch {
      onNote("Monza AI could not use the microphone — allow it for this site in the browser, then try again.");
    }
  }

  function finish(keep: boolean) {
    discard.current = !keep;
    setRecording(null);
    const r = recorder.current;
    recorder.current = null;
    if (r && r.state !== "inactive") r.stop();
    else stream.current?.getTracks().forEach((t) => t.stop());
  }

  // Leaving the conversation mid-recording throws the recording away.
  useEffect(() => () => finish(false), [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = stage !== null;
  const stageWords = stage === "preparing" ? "Preparing…" : stage === "uploading" ? "Uploading…" : stage === "sending" ? "Sending…" : "";

  return (
    <>
      <button
        type="button"
        className="ibx-icon-btn"
        title={enabled ? "Attach a photo, video or file" : disabledReason}
        aria-label="Attach a photo, video or file"
        disabled={!enabled || busy || recording !== null}
        onClick={() => inputRef.current?.click()}
      >
        <Svg d={CLIP} />
      </button>
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={ACCEPT[channel]}
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) void take(files);
        }}
      />
      {canRecord && (
        <button
          type="button"
          className="ibx-icon-btn"
          title={enabled ? "Record a voice note" : disabledReason}
          aria-label="Record a voice note"
          disabled={!enabled || busy || recording !== null}
          onClick={() => void start()}
        >
          <Svg d={MIC} />
        </button>
      )}

      {(recording !== null || (busy && !picked)) && (
        <div className="ibx-rec" role="status">
          {recording !== null ? (
            <>
              <button type="button" className="ibx-icon-btn" title="Throw it away" aria-label="Throw the recording away" onClick={() => finish(false)}>
                <Svg d={BIN} />
              </button>
              <span className="ibx-rec-dot" aria-hidden="true" />
              <span className="ibx-rec-time">{formatClock(clock / 1000)}</span>
              <span className="ibx-rec-hint">Recording a voice note…</span>
              <button type="button" className="ibx-send" onClick={() => finish(true)}>
                <Svg d={SEND} />
                Send
              </button>
            </>
          ) : (
            <span className="ibx-rec-hint">{stageWords}</span>
          )}
        </div>
      )}

      {picked && (
        <div className="ibx-sheet" role="dialog" aria-modal="true" aria-label="Send a file" onClick={() => !busy && close()}>
          <div className="ibx-sheet-card" onClick={(e) => e.stopPropagation()}>
            <div className="ibx-sheet-head">
              <h3>
                {pickedList.length > 1
                  ? `Send ${pickedList.length} files`
                  : picked.file.kind === "document" && !picked.file.asFile ? "Send a document" : picked.file.kind === "audio" ? "Send audio" : picked.file.kind === "video" || picked.file.asFile ? "Send a video" : "Send a photo"}
              </h3>
              <button type="button" className="ibx-icon-btn" aria-label="Cancel" disabled={busy} onClick={close}>
                ✕
              </button>
            </div>
            <div className="ibx-sheet-preview">
              {picked.preview && picked.file.kind === "image" && (
                // eslint-disable-next-line @next/next/no-img-element -- a local preview of the picked file
                <img src={picked.preview} alt="The photo to send" />
              )}
              {picked.preview && (picked.file.kind === "video" || picked.file.asFile) && <video src={picked.preview} controls playsInline />}
              {picked.preview && picked.file.kind === "audio" && <audio src={picked.preview} controls />}
              {picked.file.kind === "document" && !picked.file.asFile && (
                <div className="ibx-att-file is-static">
                  <span className="ibx-att-file-icon" aria-hidden="true">📄</span>
                  <span className="ibx-att-file-body">
                    <span className="ibx-att-file-name">{picked.file.filename}</span>
                    <span className="ibx-att-file-sub">{formatBytes(picked.file.blob.size)}</span>
                  </span>
                </div>
              )}
            </div>
            {picked.file.asFile && picked.file.blob.size > rulesFor(channel).video.maxBytes && (
              <p className="ibx-sheet-note">
                Over {limitWords(rulesFor(channel).video)}, so it goes as a file: the original video, full resolution, nothing
                re-encoded. The customer opens it in their player.
              </p>
            )}
            {channel === "whatsapp" && (picked.file.kind === "video" || picked.file.asFile) && picked.file.blob.size <= rulesFor(channel).video.maxBytes && (
              <label className="ibx-sheet-check">
                <input
                  type="checkbox"
                  checked={picked.file.asFile === true}
                  disabled={busy}
                  onChange={(e) => {
                    // The same bytes either way; only how WhatsApp shows them. A video message plays inline
                    // (but Android does not play H.264 High profile with B-frames — Meta's note); a file keeps
                    // the original and opens in the customer's player.
                    const asFile = e.target.checked;
                    setPickedList((list) =>
                      list.map((p, i) =>
                        i === shown && (p.file.kind === "video" || p.file.asFile)
                          ? { ...p, file: { ...p.file, kind: asFile ? "document" : "video", asFile: asFile || undefined } }
                          : p
                      )
                    );
                  }}
                />
                <span>
                  Send as a file — the original quality on every phone (opens in the customer&apos;s player instead of playing inline)
                </span>
              </label>
            )}
            {pickedList.length > 1 && (
              <div className="ibx-sheet-strip" role="group" aria-label="Files to send">
                {pickedList.map((p, i) => (
                  <button key={i} type="button" className="ibx-sheet-thumb" aria-pressed={i === shown} title={p.file.filename} onClick={() => setShown(i)}>
                    {p.preview && p.file.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a local preview of a picked file
                      <img src={p.preview} alt="" />
                    ) : (
                      <span>{p.file.kind === "video" || p.file.asFile ? "Video" : p.file.kind === "audio" ? "Audio" : "File"}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {picked.file.kind !== "audio" && (
              <textarea
                className="ibx-sheet-caption"
                rows={2}
                maxLength={MAX_CAPTION}
                placeholder={channel === "whatsapp" ? "Add a caption…" : "Add a message — sent right after the file…"}
                value={caption}
                disabled={busy}
                onChange={(e) => setCaption(e.target.value)}
                onKeyDown={(e) => {
                  if (!busy && enterSends({ key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, isComposing: e.nativeEvent.isComposing }, touchKeyboard)) {
                    e.preventDefault();
                    void sendAll(caption.trim()).then((ok) => ok && close());
                  }
                }}
                aria-label="Caption"
              />
            )}
            {problem && <p className="ibx-sheet-problem" role="alert">{problem}</p>}
            <div className="ibx-sheet-actions">
              <span className="ibx-sheet-size">
                {pickedList.length > 1 ? `${pickedList.length} files · ${formatBytes(pickedList.reduce((a, p) => a + p.file.blob.size, 0))}` : formatBytes(picked.file.blob.size)}
              </span>
              <button type="button" className="ibx-btn" disabled={busy} onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="ibx-send"
                disabled={busy || !enabled}
                onClick={() => void sendAll(caption.trim()).then((ok) => ok && close())}
              >
                <Svg d={SEND} />
                {busy ? `${progress ? `${progress} · ` : ""}${stageWords}` : pickedList.length > 1 ? `Send ${pickedList.length}` : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
