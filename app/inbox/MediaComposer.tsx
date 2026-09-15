"use client";

/**
 * Attach and record, like WhatsApp (Samer, 2026-09-15):
 *
 *   📎  pick a photo, video, audio file or document — or drop / paste one into
 *       the conversation — see it, add a caption, press Send;
 *   🎤  record a voice note; stop sends it, the bin throws it away.
 *
 * A person always presses Send (rule 24). Nothing is uploaded until they do,
 * and the server checks everything again (lib/inbox/send-media.ts).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { formatBytes, formatClock } from "@/lib/inbox/media";
import { MAX_CAPTION } from "@/lib/channels/wa-media";
import { prepareFile, prepareRecording, recorderMimeType, sendFile, type ReadyFile } from "@/lib/inbox/send-media";

/** WhatsApp's own ceiling for a voice note is far longer; this keeps one under 16 MB with room. */
const MAX_RECORDING_MS = 15 * 60_000;

const ACCEPT =
  "image/*,video/mp4,video/3gpp,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,application/pdf";

interface Props {
  conversationId: string;
  /** Live WhatsApp thread with its reply window open. */
  enabled: boolean;
  /** Why it is not, in words, for the buttons' titles. */
  disabledReason: string;
  /** A file dropped or pasted into the conversation. */
  dropped: File | null;
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

export default function MediaComposer({ conversationId, enabled, disabledReason, dropped, onDroppedTaken, onSent, onNote }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<{ file: ReadyFile; preview: string | null } | null>(null);
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
  useEffect(() => {
    setCanRecord(recorderMimeType() !== null && !!navigator.mediaDevices?.getUserMedia);
  }, []);

  const close = useCallback(() => {
    setPicked((p) => {
      if (p?.preview) URL.revokeObjectURL(p.preview);
      return null;
    });
    setCaption("");
    setProblem(null);
    setStage(null);
  }, []);

  const take = useCallback(
    async (file: File) => {
      if (!enabled) {
        onNote(disabledReason);
        return;
      }
      setStage("preparing");
      const r = await prepareFile(file);
      setStage(null);
      if (!r.ok) {
        onNote(r.problem);
        return;
      }
      const showable = r.file.kind === "image" || r.file.kind === "video" || r.file.kind === "audio";
      setPicked({ file: r.file, preview: showable ? URL.createObjectURL(r.file.blob) : null });
      setCaption("");
      setProblem(null);
    },
    [enabled, disabledReason, onNote]
  );

  useEffect(() => {
    if (!dropped) return;
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

  /* ── Recording ─────────────────────────────────────────────────────── */

  useEffect(() => {
    if (recording === null) return;
    const t = setInterval(() => {
      const ms = Date.now() - recording;
      setClock(ms);
      if (ms >= MAX_RECORDING_MS) finish(true);
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
          const ready = await prepareRecording(blob, r.mimeType || type);
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
        accept={ACCEPT}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void take(f);
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
              <h3>{picked.file.kind === "document" ? "Send a document" : picked.file.kind === "audio" ? "Send audio" : picked.file.kind === "video" ? "Send a video" : "Send a photo"}</h3>
              <button type="button" className="ibx-icon-btn" aria-label="Cancel" disabled={busy} onClick={close}>
                ✕
              </button>
            </div>
            <div className="ibx-sheet-preview">
              {picked.preview && picked.file.kind === "image" && (
                // eslint-disable-next-line @next/next/no-img-element -- a local preview of the picked file
                <img src={picked.preview} alt="The photo to send" />
              )}
              {picked.preview && picked.file.kind === "video" && <video src={picked.preview} controls playsInline />}
              {picked.preview && picked.file.kind === "audio" && <audio src={picked.preview} controls />}
              {picked.file.kind === "document" && (
                <div className="ibx-att-file is-static">
                  <span className="ibx-att-file-icon" aria-hidden="true">📄</span>
                  <span className="ibx-att-file-body">
                    <span className="ibx-att-file-name">{picked.file.filename}</span>
                    <span className="ibx-att-file-sub">{formatBytes(picked.file.blob.size)}</span>
                  </span>
                </div>
              )}
            </div>
            {picked.file.kind !== "audio" && (
              <textarea
                className="ibx-sheet-caption"
                rows={2}
                maxLength={MAX_CAPTION}
                placeholder="Add a caption…"
                value={caption}
                disabled={busy}
                onChange={(e) => setCaption(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !busy) {
                    e.preventDefault();
                    void send(picked.file, caption.trim()).then((ok) => ok && close());
                  }
                }}
                aria-label="Caption"
              />
            )}
            {problem && <p className="ibx-sheet-problem" role="alert">{problem}</p>}
            <div className="ibx-sheet-actions">
              <span className="ibx-sheet-size">{formatBytes(picked.file.blob.size)}</span>
              <button type="button" className="ibx-btn" disabled={busy} onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="ibx-send"
                disabled={busy || !enabled}
                onClick={() => void send(picked.file, caption.trim()).then((ok) => ok && close())}
              >
                <Svg d={SEND} />
                {busy ? stageWords : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
