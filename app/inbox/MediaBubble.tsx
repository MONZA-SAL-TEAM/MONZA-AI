"use client";

/**
 * What a message carries, drawn the way WhatsApp draws it: photos you can
 * open full screen, videos, voice notes with a player, documents to download,
 * locations and contact cards (Samer, 2026-09-15).
 *
 * Links are short-lived and only ever point into MONZA AI's private bucket.
 * Documents — and anything whose type was not verified as a photo, video or
 * audio — are only ever downloaded, never opened in the page.
 */

import { useEffect, useRef, useState } from "react";
import type { InboxAttachment } from "@/lib/inbox/types";
import {
  embeddableLinks,
  facebookEmbedUrl,
  formatBytes,
  formatClock,
  instagramEmbedUrl,
  isMetaCdn,
  mapsLink,
  mediaLabel,
} from "@/lib/inbox/media";
import "./media.css";

const NOT_READY: Readonly<Record<Exclude<InboxAttachment["state"], "ready">, string>> = {
  pending: "Saving… it appears in a moment",
  too_large: "Too large to keep here — see it on the phone",
  unavailable: "Not saved in Monza AI — see it on the phone",
};

function Note({ a, text }: { a: InboxAttachment; text: string }) {
  return (
    <div className="ibx-att-note" data-state={a.state}>
      <span className="ibx-att-note-kind">{mediaLabel(a.kind, a.filename)}</span>
      <span>{text}</span>
    </div>
  );
}

/** A voice note or audio file: play, progress, time and speed, like WhatsApp. */
function VoicePlayer({ url, voice }: { url: string; voice: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = rate;
  }, [rate]);

  if (broken) {
    return (
      <a className="ibx-att-file" href={url} target="_blank" rel="noreferrer">
        <span className="ibx-att-file-icon" aria-hidden="true">🎵</span>
        <span className="ibx-att-file-name">{voice ? "Voice message" : "Audio"} — this browser cannot play it; download</span>
      </a>
    );
  }

  const known = Number.isFinite(duration) && duration > 0;
  return (
    <div className="ibx-voice" data-voice={voice}>
      <audio
        ref={audio}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onError={() => setBroken(true)}
      />
      <button
        type="button"
        className="ibx-voice-play"
        aria-label={playing ? "Pause" : "Play"}
        onClick={() => {
          const el = audio.current;
          if (!el) return;
          if (el.paused) void el.play().catch(() => setBroken(true));
          else el.pause();
        }}
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" /></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z" fill="currentColor" /></svg>
        )}
      </button>
      <input
        className="ibx-voice-bar"
        type="range"
        min={0}
        max={known ? duration : 1}
        step={0.01}
        value={known ? Math.min(current, duration) : 0}
        disabled={!known}
        aria-label="Position"
        onChange={(e) => {
          if (audio.current) audio.current.currentTime = Number(e.target.value);
        }}
      />
      <span className="ibx-voice-time">{formatClock(playing || current > 0 ? current : known ? duration : 0)}</span>
      <button
        type="button"
        className="ibx-voice-rate"
        aria-label="Playback speed"
        onClick={() => setRate((r) => (r === 1 ? 1.5 : r === 1.5 ? 2 : 1))}
      >
        {rate}×
      </button>
      {voice && <span className="ibx-voice-mic" aria-hidden="true">🎤</span>}
    </div>
  );
}

/**
 * An Instagram or Facebook post, drawn by Instagram or Facebook itself inside
 * the chat — the picture or video with its caption — and a link to open it.
 */
function PostEmbed({ network, embed, link, title }: { network: "instagram" | "facebook"; embed: string; link: string; title: string }) {
  const video = embed.includes("/plugins/video.php");
  return (
    <div className="ibx-att-share">
      <iframe
        className={network === "instagram" ? "ibx-att-embed" : video ? "ibx-att-embed ibx-att-embed-fbv" : "ibx-att-embed ibx-att-embed-fb"}
        src={embed}
        title={title}
        loading="lazy"
        scrolling="no"
        allow="encrypted-media; picture-in-picture; autoplay; clipboard-write"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      />
      <a className="ibx-att-share-label" href={link} target="_blank" rel="noreferrer noopener">
        {network === "instagram" ? "Open in Instagram" : "Open in Facebook"}
      </a>
    </div>
  );
}

/** Instagram and Facebook post links inside the words, shown as the posts (like WhatsApp's link preview). */
export function LinkEmbeds({ text }: { text: string }) {
  const links = embeddableLinks(text);
  if (links.length === 0) return null;
  return (
    <div className="ibx-att ibx-link-embeds">
      {links.map((l) => (
        <PostEmbed key={l.embed} network={l.network} embed={l.embed} link={l.link} title="Shared post" />
      ))}
    </div>
  );
}

/** A shared post, reel or story: the post itself, its picture when Meta hosts one, else a link. */
function Share({ a, onOpenImage }: { a: InboxAttachment; onOpenImage: (url: string) => void }) {
  const [broken, setBroken] = useState(false);
  const url = a.url ?? "";
  const label = a.label ?? "Shared post";
  const ig = instagramEmbedUrl(url);
  if (ig) return <PostEmbed network="instagram" embed={ig} link={url} title={label} />;
  const fb = facebookEmbedUrl(url);
  if (fb) return <PostEmbed network="facebook" embed={fb} link={url} title={label} />;
  if (isMetaCdn(url) && !broken) {
    return (
      <div className="ibx-att-share">
        <button type="button" className="ibx-att-img" aria-label="Open the shared post" onClick={() => onOpenImage(url)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Meta's own short-lived link */}
          <img src={url} alt={label} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        </button>
        <span className="ibx-att-share-label">🔗 {label}</span>
      </div>
    );
  }
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    host = "";
  }
  return (
    <a className="ibx-att-card" href={url} target="_blank" rel="noreferrer noopener">
      <span className="ibx-att-card-icon" aria-hidden="true">🔗</span>
      <span className="ibx-att-card-body">
        <span className="ibx-att-card-title">{label}</span>
        <span className="ibx-att-card-sub">{host ? `Open · ${host}` : "Open"}</span>
      </span>
    </a>
  );
}

export function Attachments({
  items,
  onOpenImage,
}: {
  items: readonly InboxAttachment[];
  onOpenImage: (url: string) => void;
}) {
  const [copied, setCopied] = useState<number | null>(null);
  return (
    <div className="ibx-att">
      {items.map((a, i) => {
        if (a.kind === "location" && a.lat !== undefined && a.lng !== undefined) {
          return (
            <a key={i} className="ibx-att-card" href={mapsLink(a.lat, a.lng)} target="_blank" rel="noreferrer">
              <span className="ibx-att-card-icon" aria-hidden="true">📍</span>
              <span className="ibx-att-card-body">
                <span className="ibx-att-card-title">{a.label ?? "Shared location"}</span>
                <span className="ibx-att-card-sub">Open in Google Maps</span>
              </span>
            </a>
          );
        }
        if (a.kind === "contact") {
          return (
            <div key={i} className="ibx-att-card">
              <span className="ibx-att-card-icon" aria-hidden="true">👤</span>
              <span className="ibx-att-card-body">
                <span className="ibx-att-card-title">{a.name ?? "Contact"}</span>
                {a.phone && <span className="ibx-att-card-sub">{a.phone}</span>}
              </span>
              {a.phone && (
                <button
                  type="button"
                  className="ibx-att-copy"
                  onClick={() => {
                    void navigator.clipboard?.writeText(a.phone ?? "");
                    setCopied(i);
                  }}
                >
                  {copied === i ? "Copied" : "Copy"}
                </button>
              )}
            </div>
          );
        }
        if (a.state !== "ready") return <Note key={i} a={a} text={NOT_READY[a.state]} />;
        if (!a.url) return <Note key={i} a={a} text="Could not load it just now" />;

        switch (a.kind) {
          case "image":
          case "sticker":
            return (
              <button
                key={i}
                type="button"
                className={a.kind === "sticker" ? "ibx-att-sticker" : "ibx-att-img"}
                aria-label="Open the photo"
                onClick={() => onOpenImage(a.url!)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived private link */}
                <img src={a.url} alt={a.kind === "sticker" ? "Sticker" : "Photo"} loading="lazy" referrerPolicy="no-referrer" />
              </button>
            );
          case "video":
            return <video key={i} className="ibx-att-video" src={a.url} controls preload="metadata" playsInline />;
          case "voice":
          case "audio":
            return <VoicePlayer key={i} url={a.url} voice={a.kind === "voice"} />;
          case "share":
            return <Share key={i} a={a} onOpenImage={onOpenImage} />;
          default:
            return (
              <a key={i} className="ibx-att-file" href={a.url} download={a.filename ?? true} target="_blank" rel="noreferrer">
                <span className="ibx-att-file-icon" aria-hidden="true">📄</span>
                <span className="ibx-att-file-body">
                  <span className="ibx-att-file-name">{a.filename ?? "Document"}</span>
                  <span className="ibx-att-file-sub">{[formatBytes(a.size), "Download"].filter(Boolean).join(" · ")}</span>
                </span>
              </a>
            );
        }
      })}
    </div>
  );
}

/** Photos full screen: arrows or ← → between the thread's photos, Esc to close. */
export function Lightbox({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: readonly string[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      if (e.key === "ArrowRight" && index < images.length - 1) onIndex(index + 1);
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [index, images.length, onIndex, onClose]);

  const url = images[index];
  if (!url) return null;
  return (
    <div className="ibx-lightbox" role="dialog" aria-modal="true" aria-label="Photo" onClick={onClose}>
      <div className="ibx-lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span>
          {index + 1} / {images.length}
        </span>
        <a className="ibx-lightbox-btn" href={url} target="_blank" rel="noreferrer">
          Open original
        </a>
        <button type="button" className="ibx-lightbox-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {index > 0 && (
        <button
          type="button"
          className="ibx-lightbox-nav is-prev"
          aria-label="Previous photo"
          onClick={(e) => {
            e.stopPropagation();
            onIndex(index - 1);
          }}
        >
          ‹
        </button>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived private link */}
      <img className="ibx-lightbox-img" src={url} alt="Photo" onClick={(e) => e.stopPropagation()} />
      {index < images.length - 1 && (
        <button
          type="button"
          className="ibx-lightbox-nav is-next"
          aria-label="Next photo"
          onClick={(e) => {
            e.stopPropagation();
            onIndex(index + 1);
          }}
        >
          ›
        </button>
      )}
    </div>
  );
}

/** ✓ sent · ✓✓ delivered · blue ✓✓ read · ! not delivered. */
export function Ticks({ status, error }: { status: string; error?: string }) {
  switch (status) {
    case "failed":
      return (
        <span className="ibx-tick is-failed" title={error ?? "Not delivered"}>
          ! Not delivered{error ? ` — ${error}` : ""}
        </span>
      );
    case "read":
      return <span className="ibx-tick is-read" title="Read">✓✓</span>;
    case "delivered":
      return <span className="ibx-tick" title="Delivered">✓✓</span>;
    case "queued":
      return <span className="ibx-tick" title="Waiting to send">🕓</span>;
    default:
      return <span className="ibx-tick" title="Sent">✓</span>;
  }
}
