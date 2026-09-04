"use client";

/**
 * Monza WhatsApp Sales Control — the whole control panel + simulator.
 *
 * Server API this client speaks (GET /api/whatsapp-sales, exactly):
 *   { imported, source, warnings, catalog: WaCar[], folderVideoCounts }
 *   401                                            — link to /login
 *
 * Honesty rules baked in:
 *   - No WhatsApp number is connected, so NOTHING here ever sends. The
 *     simulator says "Would send now" — never "Sent". The would-have-sent
 *     KPI shows "—", never an invented count.
 *   - Every catalog change (add / edit / toggle / alias) updates this screen
 *     only and resets on refresh; added cars wear "Added by you — example".
 *   - The ONE exception: uploaded videos/brochures are REAL files
 *     (lib/wasales/media-store.ts). In storage mode they live in the shared
 *     Supabase library — everyone with this dashboard sees the same catalog;
 *     in local mode they live in IndexedDB in this browser. NOTHING fake is
 *     ever shown: cards, readiness, the simulator verdict and the reply
 *     preview count ONLY real uploads, and a car with none says so.
 *   - The simulator runs the REAL flow (lib/wasales/flow.ts advance()) with the
 *     same conversation state a webhook handler will thread through, so what
 *     appears here IS production behaviour rather than a description of it. It
 *     is a conversation, not a verdict: ask the colour, take the answer, show
 *     what would go out.
 *   - Two sources of "what is sendable", never blended: the FOLDER listing
 *     (what the import found on disk) and UPLOADS (what is really in the
 *     shared bucket). The screen says which is in use every single time — a
 *     preview that promises a video nobody can send is worse than none.
 *   - Hydration-safe: no Date, no random; new-car ids come from a ref counter.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import Link from "next/link";
import type { WaAsset, WaCar, WaSource } from "@/lib/wasales/matcher";
import type { WaColour } from "@/lib/wasales/colours";
import {
  INITIAL_STATE,
  advance,
  type CarMedia,
  type SalesAction,
  type SalesState,
} from "@/lib/wasales/flow";
import { SAMPLE_MESSAGES } from "@/lib/wasales/catalog-data";
import type { MediaKind } from "@/lib/wasales/media-store";
import {
  deleteColour,
  listAllFiles,
  listColourIds,
  storageMode,
  subscribeMediaChanges,
  useCarMedia,
  deleteFile,
} from "@/lib/wasales/media-store";
import { colourIdFrom, colourNameFrom } from "@/lib/wasales/media-paths";
import {
  checkColourFit,
  type ColourWarning,
  type ExistingFile,
} from "@/lib/wasales/colour-check";

/* ------------------------------------------------------------- constants --- */

const DEMO_NOTE = "Example data — not connected to the Monza systems yet.";

/** Build-time constant (NEXT_PUBLIC env) — identical on server and client. */
const SHARED = storageMode();

/** The honest one-liner about where uploaded files actually live. */
const MEDIA_HONESTY = SHARED
  ? "Files are shared — everyone with this dashboard sees the same catalog."
  : "Saved in this browser on this computer — files move to shared team storage when WhatsApp is connected.";

/** The loading line while the store answers. */
const MEDIA_CHECKING = SHARED
  ? "Checking the shared files…"
  : "Checking this browser's saved files…";
const LOGIN_HREF = "/login?next=" + encodeURIComponent("/sales");

const SOURCE_LABEL: Record<WaSource, string> = {
  facebook: "Facebook post",
  instagram: "Instagram post",
  website: "Website",
  direct: "Direct",
};

/** The guard rails, restated in plain words for the always-visible list. */
const RULES = [
  "Sends only when the master Auto-send switch is on.",
  "Sends only to a NEW number — anyone with an existing conversation gets your team, not the robot.",
  "Sends only on the FIRST message of the conversation.",
  "Sends only when the message clearly names ONE car — typos and wrong spelling still count (“pasion l” finds the Passion L).",
  "Two cars mentioned, a bare “hi”, or no car at all — nothing sends; the chat is handed to your team.",
  "A car missing a video or its brochure never auto-sends.",
];

/* ------------------------------------------------- defensive api parsing --- */

function asAsset(v: unknown): WaAsset | null {
  if (!v || typeof v !== "object") return null;
  const a = v as Partial<WaAsset>;
  if (typeof a.label !== "string" || typeof a.fileName !== "string") return null;
  return { label: a.label, fileName: a.fileName };
}

function asCar(v: unknown): WaCar | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Partial<WaCar>;
  if (
    typeof c.id !== "string" ||
    typeof c.name !== "string" ||
    typeof c.enabled !== "boolean" ||
    !Array.isArray(c.aliases) ||
    !Array.isArray(c.videos) ||
    typeof c.oneLiner !== "string"
  ) {
    return null;
  }
  return {
    id: c.id,
    name: c.name,
    enabled: c.enabled,
    aliases: c.aliases.filter((a): a is string => typeof a === "string"),
    videos: c.videos.map(asAsset).filter((a): a is WaAsset => a !== null),
    // Colours are discovered from the imported sales folder, never invented
    // here, so a car arriving over the wire without them has none yet.
    colours: Array.isArray(c.colours)
      ? (c.colours as unknown[])
          .map(asColour)
          .filter((x): x is WaColour => x !== null)
      : [],
    brochure: c.brochure ? asAsset(c.brochure) : null,
    oneLiner: c.oneLiner,
  };
}

function asColour(v: unknown): WaColour | null {
  if (!v || typeof v !== "object") return null;
  const c = v as { id?: unknown; name?: unknown; aliases?: unknown };
  if (typeof c.id !== "string" || typeof c.name !== "string") return null;
  return {
    id: c.id,
    name: c.name,
    aliases: Array.isArray(c.aliases)
      ? c.aliases.filter((a): a is string => typeof a === "string")
      : [],
  };
}

function asCatalog(v: unknown): WaCar[] | null {
  if (!Array.isArray(v)) return null;
  return v.map(asCar).filter((c): c is WaCar => c !== null);
}

/* ----------------------------------------------------------- small glyphs --- */

function BackGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

/** The send-plane — same drawing as the sidebar item, so they match. */
function PlaneGlyph({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4z" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/** Play triangle — marks a video file chip. */
function PlayGlyph() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden>
      <path d="M7 4.5v15l13-7.5z" />
    </svg>
  );
}

/** Document sheet — marks the brochure chip. */
function DocGlyph() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

/* ----------------------------------------------------------- small pieces --- */

/** A 44px-tall labelled switch — the only toggle drawing on the page. */
function Switch({
  on,
  onFlip,
  label,
}: {
  on: boolean;
  onFlip: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="ws-switch"
      data-on={on}
      onClick={onFlip}
    >
      <span className="ws-switch-track" aria-hidden>
        <span className="ws-switch-knob" />
      </span>
      <span className="ws-switch-text">{on ? "On" : "Off"}</span>
    </button>
  );
}

/* ------------------------------------------------------- car media dialog --- */

/** "12.4 MB", "830 KB" — deterministic, plain. */
/**
 * The colour a stored video belongs to, in words.
 *
 * Falls back to the raw id rather than hiding an unknown: a video filed under
 * a colour the catalogue no longer lists is exactly the thing somebody needs
 * to see, and printing nothing would make it look correctly filed.
 */
function colourNameOf(car: WaCar, colourId: string | null): string {
  if (!colourId) return "No colour";
  return car.colours.find((c) => c.id === colourId)?.name ?? colourId;
}

function formatSize(bytes: number): string {
  const kb = 1024;
  const mb = kb * 1024;
  const gb = mb * 1024;
  if (bytes >= gb) return `${(bytes / gb).toFixed(1)} GB`;
  if (bytes >= mb) return `${(bytes / mb).toFixed(1)} MB`;
  if (bytes >= kb) return `${Math.round(bytes / kb)} KB`;
  return `${bytes} B`;
}

/**
 * The CAR MEDIA dialog — opened by pressing a catalog card. Shows the car's
 * REAL uploads (playable videos, openable PDF) — and nothing else — and
 * takes new uploads. Native <dialog>, same family pattern as the add/edit
 * dialog below.
 */
function CarMediaDialog({
  car,
  catalog,
  onClose,
}: {
  car: WaCar | null;
  /** Every car, so a file name can be tested against the OTHER models — the
   *  check that caught a Passion L video sitting in the Voyah Passion folder. */
  catalog: readonly WaCar[];
  onClose: () => void;
}) {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const { loaded, videos, brochure, add, remove } = useCarMedia(car?.id ?? null);

  /**
   * Which colour the next uploaded video shows.
   *
   * A video has to say this — the flow sends "the colour they asked for", so a
   * video filed under no colour could never be sent. Defaulting to the car's
   * first colour keeps the common case one click, and the picker sits next to
   * the button so it is impossible to upload without having seen it.
   */
  const [uploadColour, setUploadColour] = useState<string>("");

  /** Colour ids discovered in the LIBRARY, which may include ones a person
   *  added here and the imported catalogue has never heard of. */
  const [libraryColours, setLibraryColours] = useState<string[]>([]);
  /** The "add a colour" field, as typed. */
  const [newColour, setNewColour] = useState("");
  /** Warnings about the files just picked. Never blocking — a person decides. */
  const [fitWarnings, setFitWarnings] = useState<ColourWarning[]>([]);
  /** The colour a delete is being confirmed for, or null. */
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  /** Every file in the library, so "this exact file is already filed under X"
   *  can be spotted across cars, not just within this one. */
  const [existingEverywhere, setExistingEverywhere] = useState<ExistingFile[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);

  const open = car !== null;

  // Drive the native <dialog>: showModal gives focus trapping + Esc for free.
  // The guard covers engines where showModal throws (already-open, old WebKit).
  useEffect(() => {
    const d = dlgRef.current;
    if (!d) return;
    if (open) {
      if (!d.open) {
        try {
          d.showModal();
        } catch {
          d.setAttribute("open", "");
        }
      }
    } else if (d.open) {
      d.close();
    }
    if (!open) return;
    // The non-modal fallback gets no free Esc handling — cover it ourselves.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /**
   * Every colour this car has: the catalogue's, plus any found in the library.
   *
   * The two can legitimately differ. The catalogue is a snapshot of the sales
   * folder at import time; the library is what exists NOW. A colour added on
   * this screen lives only in the library until somebody re-imports, and it
   * must still be usable — otherwise adding one would appear to do nothing.
   */
  const allColours: WaColour[] = useMemo(() => {
    if (!car) return [];
    const byId = new Map(car.colours.map((c) => [c.id, c]));
    for (const id of libraryColours) {
      if (byId.has(id)) continue;
      // Only the id is recorded in storage, so the name is derived from it.
      byId.set(id, { id, name: colourNameFrom(id), aliases: [id] });
    }
    return [...byId.values()];
  }, [car, libraryColours]);

  const refreshColours = useCallback(async () => {
    if (!car) return;
    setLibraryColours(await listColourIds(car.id));
  }, [car]);

  const refreshEverything = useCallback(async () => {
    const all = await listAllFiles();
    setExistingEverywhere(
      all.map((f) => ({
        carId: f.carId,
        colourId: f.colourId ?? null,
        name: f.name,
        size: f.size,
      }))
    );
  }, []);

  // Discover the library's colours whenever the car changes or files move.
  useEffect(() => {
    void refreshColours();
    void refreshEverything();
    return subscribeMediaChanges(() => {
      void refreshColours();
      void refreshEverything();
    });
  }, [refreshColours, refreshEverything]);

  // A fresh car gets a fresh slate and its own first colour.
  useEffect(() => {
    setUploadError(null);
    setFitWarnings([]);
    setNewColour("");
    setConfirmingDelete(null);
    setUploadColour(car?.colours[0]?.id ?? "");
  }, [car?.id, car?.colours]);

  const uploadFiles = useCallback(
    async (kind: MediaKind, files: File[]) => {
      if (files.length === 0) return;
      setUploadError(null);
      setBusy(true);
      const errors: string[] = [];
      const warnings: ColourWarning[] = [];

      for (const f of files) {
        // Look at the name BEFORE uploading, so the warning is attached to the
        // file that caused it. It never blocks: file names are frequently
        // meaningless, and a check that refuses those teaches people to
        // ignore it.
        if (kind === "video" && car) {
          warnings.push(
            ...checkColourFit({
              car: { ...car, colours: allColours },
              colourId: uploadColour,
              fileName: f.name,
              size: f.size,
              existing: existingEverywhere,
              catalog,
            })
          );
        }
        const result = await add(kind, kind === "video" ? uploadColour : null, f);
        if (!result.ok) errors.push(`${f.name}: ${result.error}`);
      }

      setBusy(false);
      setFitWarnings(warnings);
      if (errors.length > 0) setUploadError(errors.join(" "));
    },
    [add, uploadColour, car, allColours, existingEverywhere, catalog]
  );

  /** Add a colour: it becomes real as soon as a video is filed under it, so
   *  this only selects it — nothing is written until an upload. */
  const addColour = useCallback(() => {
    const id = colourIdFrom(newColour);
    if (id === "") {
      setUploadError("Give the colour a name — letters or numbers.");
      return;
    }
    if (allColours.some((c) => c.id === id)) {
      setUploadColour(id);
      setNewColour("");
      return;
    }
    setLibraryColours((prev) => [...prev, id]);
    setUploadColour(id);
    setNewColour("");
    setUploadError(null);
  }, [newColour, allColours]);

  const removeColour = useCallback(
    async (colourId: string) => {
      setConfirmingDelete(null);
      setBusy(true);
      const result = await deleteColour(car?.id ?? "", colourId);
      setBusy(false);
      if (!result.ok) {
        setUploadError(result.error ?? "Couldn't remove that colour.");
        return;
      }
      // A colour that was only ever selected here has no files behind it, so
      // drop it from the local list too or it lingers looking real.
      setLibraryColours((prev) => prev.filter((id) => id !== colourId));
      if (uploadColour === colourId) setUploadColour(car?.colours[0]?.id ?? "");
      await refreshColours();
    },
    [car, uploadColour, refreshColours]
  );

  const onVideoPick = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      // SNAPSHOT before clearing: e.target.files is a LIVE list — resetting
      // the input's value empties it, and the upload would silently see zero
      // files (the bug Samer hit: "is not uploading", no error, nothing).
      const picked = Array.from(e.target.files ?? []);
      // Clear the input so picking the same file again re-fires onChange.
      e.target.value = "";
      void uploadFiles("video", picked);
    },
    [uploadFiles]
  );

  const onPdfPick = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const picked = Array.from(e.target.files ?? []);
      e.target.value = "";
      void uploadFiles("brochure", picked);
    },
    [uploadFiles]
  );

  return (
    <dialog
      ref={dlgRef}
      className="ws-dlg ws-dlg--media"
      aria-label={car ? `${car.name} — videos and brochure` : "Car media"}
      onClose={onClose}
      onClick={(e) => {
        // Backdrop click: the dialog element itself is the target only
        // when the click lands outside its content box.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {car !== null && (
        <div className="ws-dlg-body ws-media-body">
          <div className="ws-dlg-head">
            <h2 className="h2">{car.name}</h2>
            <p className="cap ws-dlg-sub">
              The videos and brochure this car would send on WhatsApp.
            </p>
          </div>

          {/* ------------------------------------------------- videos --- */}
          <section className="ws-media-sec" aria-label={`Videos for ${car.name}`}>
            <div className="ws-media-sec-head">
              <h3 className="eyebrow ws-media-sec-title">Videos</h3>
              <label className="ws-media-colour">
                <span className="cap">Colour</span>
                <select
                  value={uploadColour}
                  onChange={(e) => setUploadColour(e.target.value)}
                  disabled={busy || allColours.length === 0}
                  aria-label={`Which colour the next ${car.name} video shows`}
                >
                  {allColours.length === 0 ? (
                    <option value="">No colours yet</option>
                  ) : (
                    allColours.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <button
                type="button"
                className="btn ws-media-upload-btn"
                onClick={() => videoInputRef.current?.click()}
                disabled={busy || uploadColour === ""}
                title={
                  uploadColour === ""
                    ? "This car has no colours yet — import the sales folder first."
                    : undefined
                }
              >
                <PlusGlyph />
                Upload video
              </button>
              <input
                ref={videoInputRef}
                type="file"
                accept="video/*"
                multiple
                hidden
                onChange={onVideoPick}
                aria-label={`Upload video files for ${car.name}`}
              />
            </div>

            {/* THE COLOURS THIS CAR HAS.
                A colour exists because it has videos — so removing one means
                removing its videos, and the confirmation says exactly how
                many rather than "some". */}
            <div className="ws-colour-manager">
              <ul className="ws-colour-list">
                {allColours.map((c) => {
                  const count = videos.filter((v) => v.colourId === c.id).length;
                  const confirming = confirmingDelete === c.id;
                  return (
                    <li
                      key={c.id}
                      className="ws-colour-row"
                      data-selected={uploadColour === c.id}
                    >
                      <button
                        type="button"
                        className="ws-colour-pick"
                        onClick={() => setUploadColour(c.id)}
                        aria-pressed={uploadColour === c.id}
                      >
                        {c.name}
                        <span className="ws-colour-count">
                          {count === 0
                            ? "no video yet"
                            : `${count} video${count === 1 ? "" : "s"}`}
                        </span>
                      </button>

                      {confirming ? (
                        <span className="ws-colour-confirm">
                          <span className="cap">
                            {count === 0
                              ? "Remove it?"
                              : `Delete ${count} video${count === 1 ? "" : "s"}?`}
                          </span>
                          <button
                            type="button"
                            className="btn danger"
                            disabled={busy}
                            onClick={() => void removeColour(c.id)}
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            className="btn quiet"
                            onClick={() => setConfirmingDelete(null)}
                          >
                            Keep
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="btn quiet ws-colour-remove"
                          disabled={busy}
                          aria-label={`Remove the colour ${c.name} from the ${car.name}`}
                          onClick={() => setConfirmingDelete(c.id)}
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>

              <div className="ws-colour-add">
                <input
                  type="text"
                  value={newColour}
                  placeholder="Add a colour, e.g. Midnight Blue"
                  aria-label={`Add a colour to the ${car.name}`}
                  disabled={busy}
                  onChange={(e) => setNewColour(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addColour();
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={busy || newColour.trim() === ""}
                  onClick={addColour}
                >
                  Add colour
                </button>
              </div>
              <p className="cap ws-media-hint">
                A colour becomes real once it has a video. Add one, then upload
                its video with the colour selected.
              </p>
            </div>

            {fitWarnings.length > 0 && (
              <div className="ws-fit-warnings" role="status">
                <p className="cap ws-fit-title">Worth a second look</p>
                <ul>
                  {fitWarnings.map((w, i) => (
                    <li key={`${w.kind}-${i}`} data-kind={w.kind}>
                      {w.message}
                    </li>
                  ))}
                </ul>
                <p className="cap ws-fit-foot">
                  These come from the file name, not the footage — nothing here
                  can see what the video shows.
                </p>
                <button
                  type="button"
                  className="btn quiet"
                  onClick={() => setFitWarnings([])}
                >
                  Dismiss
                </button>
              </div>
            )}

            {!loaded ? (
              <p className="cap ws-media-hint">{MEDIA_CHECKING}</p>
            ) : videos.length > 0 ? (
              <div className="ws-media-grid">
                {videos.map((v) => (
                  <figure className="ws-media-tile" key={v.id}>
                    <video controls preload="metadata" src={v.url} />
                    <figcaption className="ws-media-meta">
                      <span className="ws-media-name" title={v.name}>
                        {v.name}
                      </span>
                      <span className="ws-media-size">
                        {colourNameOf(car, v.colourId)} · {formatSize(v.size)}
                      </span>
                    </figcaption>
                    <button
                      type="button"
                      className="btn quiet ws-media-remove"
                      aria-label={`Remove the uploaded video ${v.name}`}
                      onClick={() =>
                        void remove(v.id).then((r) => {
                          if (!r.ok) setUploadError(r.error ?? "Couldn't remove that file.");
                        })
                      }
                    >
                      Remove
                    </button>
                  </figure>
                ))}
              </div>
            ) : (
              <p className="cap ws-media-hint">
                No videos yet — the car won&apos;t auto-send until it has at
                least one.
              </p>
            )}
          </section>

          {/* ----------------------------------------------- brochure --- */}
          <section
            className="ws-media-sec"
            aria-label={`Brochure for ${car.name}`}
          >
            <div className="ws-media-sec-head">
              <h3 className="eyebrow ws-media-sec-title">Brochure</h3>
              <button
                type="button"
                className="btn ws-media-upload-btn"
                onClick={() => pdfInputRef.current?.click()}
                disabled={busy}
              >
                <PlusGlyph />
                {brochure ? "Replace brochure" : "Upload brochure (PDF)"}
              </button>
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf"
                hidden
                onChange={onPdfPick}
                aria-label={`Upload the brochure PDF for ${car.name}`}
              />
            </div>

            {!loaded ? (
              <p className="cap ws-media-hint">{MEDIA_CHECKING}</p>
            ) : brochure ? (
              <div className="ws-media-doc">
                <DocGlyph />
                <span className="ws-media-name" title={brochure.name}>
                  {brochure.name}
                </span>
                <span className="ws-media-size">{formatSize(brochure.size)}</span>
                <a
                  className="btn ws-media-open"
                  href={brochure.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open PDF
                </a>
                <button
                  type="button"
                  className="btn quiet ws-media-remove"
                  aria-label={`Remove the uploaded brochure ${brochure.name}`}
                  onClick={() =>
                    void remove(brochure.id).then((r) => {
                      if (!r.ok) setUploadError(r.error ?? "Couldn't remove that file.");
                    })
                  }
                >
                  Remove
                </button>
              </div>
            ) : (
              <p className="cap ws-media-hint">
                No brochure yet — the car won&apos;t auto-send until it has one.
              </p>
            )}
          </section>

          {uploadError && (
            <p className="ws-media-err" role="alert">
              {uploadError}
            </p>
          )}

          <div className="ws-dlg-actions">
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
          <p className="cap ws-media-foot">{MEDIA_HONESTY}</p>
        </div>
      )}
    </dialog>
  );
}

/* ------------------------------------------------------ add / edit dialog --- */

/** Name, one-liner and aliases only — the ACTUAL videos and brochure are
 *  uploaded through the car's media dialog, never typed as file names. */
interface CarFormState {
  name: string;
  oneLiner: string;
  aliases: string; // comma-separated in the box
}

/** One line of the simulated conversation. */
interface SimTurn {
  from: "customer" | "monza";
  text?: string;
  action?: SalesAction;
}

const EMPTY_FORM: CarFormState = {
  name: "",
  oneLiner: "",
  aliases: "",
};

function formFromCar(car: WaCar): CarFormState {
  return {
    name: car.name,
    oneLiner: car.oneLiner,
    aliases: car.aliases.join(", "),
  };
}

/* --------------------------------------------------------------- the ui --- */

type Screen = "loading" | "login" | "error" | "notReady" | "ready";

/** The simulator inputs of the last Run — the decision derives from this. */
interface SimRun {
  text: string;
  isNewNumber: boolean;
  isFirstMessage: boolean;
  source: WaSource;
}

export default function WaSalesClient() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [demo, setDemo] = useState(false);
  const [notReady, setNotReady] = useState(
    "Live cataloging and automatic sending arrive with the WhatsApp Business connection work."
  );
  /** The catalog as edited this session — screen-only, resets on refresh. */
  const [cars, setCars] = useState<WaCar[]>([]);
  /** Ids of cars added this session — they wear the example tag. */
  const [addedIds, setAddedIds] = useState<string[]>([]);
  /** The master switch. Takes real effect only once WhatsApp is connected. */
  const [autoSend, setAutoSend] = useState(true);

  /* simulator inputs */
  const [simText, setSimText] = useState("");
  const [simNew, setSimNew] = useState(true);
  const [simFirst, setSimFirst] = useState(true);
  const [simSource, setSimSource] = useState<WaSource>("facebook");
  /** The conversation so far, and where the flow has got to in it. */
  const [simTurns, setSimTurns] = useState<SimTurn[]>([]);
  const [simState, setSimState] = useState<SalesState>(INITIAL_STATE);

  /** Which colours the import found on disk, per car. */
  const [folderVideoCounts, setFolderVideoCounts] = useState<
    Record<string, Record<string, number>>
  >({});
  /** What the import flagged for a person to fix. */
  const [warnings, setWarnings] = useState<string[]>([]);
  /** True once the real sales folder has been imported. */
  const [imported, setImported] = useState(false);
  /**
   * Preview using the sales-folder listing instead of the shared library.
   *
   * OFF by default, because the library is the truth about what could be sent
   * and it is no longer empty. It defaulted ON back when uploads carried no
   * colour and the library branch could only ever answer "nothing to send" —
   * that limitation is gone.
   *
   * The toggle stays because the difference is worth being able to see: it is
   * how you spot material that exists in the folder and was never uploaded.
   */
  const [previewFromFolder, setPreviewFromFolder] = useState(false);

  /* add / edit dialog */
  const [dlgCarId, setDlgCarId] = useState<string | null>(null); // "new" = add
  const [form, setForm] = useState<CarFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  /** Plain counter for added-car ids — deterministic, no Date, no random. */
  const addSeq = useRef(1);

  /* car media dialog + this browser's uploaded files (metadata only) */
  const [mediaCarId, setMediaCarId] = useState<string | null>(null);
  /**
   * Every uploaded file across all cars, blob-free — feeds the card-face
   * "N uploaded" tags, the readiness math and the simulator overlay. Loaded
   * in an effect (IndexedDB is never touched during render, so the server
   * and the first client render agree) and re-read after every add/delete
   * via the media store's change broadcast.
   */
  const [uploads, setUploads] = useState<
    {
      id: string;
      carId: string;
      kind: MediaKind;
      /** Which colour a video shows; null for a brochure. */
      colourId: string | null;
      name: string;
      size: number;
    }[]
  >([]);

  useEffect(() => {
    let alive = true;
    const loadUploads = () => {
      listAllFiles().then(async (files) => {
        if (!alive) return;
        // LOCAL MODE ONLY: files attached to a session-added car (ADD-*) are
        // orphans after a refresh — the car they belonged to no longer exists
        // and can never legitimately come back. Delete them so they neither
        // pile up nor reattach to anything. Seed cars have stable ids and
        // keep theirs. In storage mode the store refuses uploads for
        // session-added cars, so there is nothing to sweep.
        if (!SHARED) {
          const orphans = files.filter((u) => u.carId.startsWith("ADD-"));
          if (orphans.length > 0) {
            await Promise.all(orphans.map((u) => deleteFile(u.id).catch(() => {})));
            files = files.filter((u) => !u.carId.startsWith("ADD-"));
          }
        }
        setUploads(
          files.map(({ id, carId, kind, colourId, name, size }) => ({
            id,
            carId,
            kind,
            colourId: colourId ?? null,
            name,
            size,
          }))
        );
      });
    };
    loadUploads();
    const unsubscribe = subscribeMediaChanges(loadUploads);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const load = useCallback(async () => {
    setScreen("loading");
    try {
      const res = await fetch("/api/whatsapp-sales");
      if (res.status === 401) {
        setScreen("login");
        return;
      }
      if (!res.ok) {
        setScreen("error");
        return;
      }
      const raw: unknown = await res.json();
      const d = (raw && typeof raw === "object" ? raw : {}) as {
        imported?: unknown;
        catalog?: unknown;
        warnings?: unknown;
        folderVideoCounts?: unknown;
      };
      const parsed = asCatalog(d.catalog);
      if (parsed) {
        setImported(d.imported === true);
        // "Example data" is now only true BEFORE the real folder is imported.
        setDemo(d.imported !== true);
        setCars(parsed);
        setWarnings(
          Array.isArray(d.warnings)
            ? d.warnings.filter((w): w is string => typeof w === "string")
            : []
        );
        setFolderVideoCounts(
          d.folderVideoCounts && typeof d.folderVideoCounts === "object"
            ? (d.folderVideoCounts as Record<string, Record<string, number>>)
            : {}
        );
        setAddedIds([]);
        setSimTurns([]);
        setSimState(INITIAL_STATE);
        setDlgCarId(null);
        setMediaCarId(null);
        setScreen("ready");
        return;
      }
      setScreen("error");
    } catch {
      setScreen("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* ----- derived: KPIs + the live simulator verdict ----- */

  /** Uploaded-file metadata grouped per car id. */
  const uploadsByCar = useMemo(() => {
    const map: Record<string, typeof uploads> = {};
    for (const u of uploads) {
      (map[u.carId] ??= []).push(u);
    }
    return map;
  }, [uploads]);

  /**
   * How many UPLOADED videos each colour of each car has.
   *
   * This is the number that matters: it is what could actually be sent. The
   * folder counts describe files on somebody's disk and are shown separately.
   */
  const libraryVideoCounts = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    for (const u of uploads) {
      if (u.kind !== "video" || !u.colourId) continue;
      (out[u.carId] ??= {});
      out[u.carId][u.colourId] = (out[u.carId][u.colourId] ?? 0) + 1;
    }
    return out;
  }, [uploads]);

  /**
   * The catalogue's cars, plus any colour that exists only in the library.
   *
   * Somebody can add a colour on the media dialog and upload its video without
   * touching the sales folder. That colour is real — it can be sent — so it has
   * to appear on the card and be offerable by the flow, not wait for a
   * re-import to be acknowledged.
   */
  const carsWithLibrary = useMemo<WaCar[]>(
    () =>
      cars.map((car) => {
        const extra = Object.keys(libraryVideoCounts[car.id] ?? {}).filter(
          (id) => !car.colours.some((c) => c.id === id)
        );
        if (extra.length === 0) return car;
        return {
          ...car,
          colours: [
            ...car.colours,
            ...extra.map((id) => ({
              id,
              name: colourNameFrom(id),
              aliases: [id],
            })),
          ],
        };
      }),
    [cars, libraryVideoCounts]
  );

  /**
   * PURE OVERLAY — matcher.ts is untouched. Before the catalog reaches
   * decide(), each car's videos/brochure fields are REPLACED with the REAL
   * uploaded files, and nothing else: no uploads means no videos and no
   * brochure, whatever anyone typed anywhere. Readiness, the missing-asset
   * lines, the simulator verdict and the would-send chips all count only
   * files that actually exist.
   */
  const carsForBrain = useMemo<WaCar[]>(
    () =>
      carsWithLibrary.map((car) => {
        const ups = uploadsByCar[car.id] ?? [];
        const uploadedVideos: WaAsset[] = ups
          .filter((u) => u.kind === "video")
          .map((u) => ({ label: "Video", fileName: u.name }));
        const uploadedBrochure = ups.find((u) => u.kind === "brochure");
        return {
          ...car,
          videos: uploadedVideos,
          brochure: uploadedBrochure
            ? { label: "Brochure (PDF)", fileName: uploadedBrochure.name }
            : null,
        };
      }),
    [carsWithLibrary, uploadsByCar]
  );

  /** Overlaid car by id — the card face reads missing-asset truth from here. */
  const brainCarById = useMemo(() => {
    const map = new Map<string, WaCar>();
    for (const c of carsForBrain) map.set(c.id, c);
    return map;
  }, [carsForBrain]);

  const readyCount = useMemo(
    () =>
      carsForBrain.filter(
        (c) => c.enabled && c.videos.length > 0 && c.brochure !== null
      ).length,
    [carsForBrain]
  );

  /**
   * What the flow may treat as sendable.
   *
   * TWO SOURCES, never mixed silently:
   *
   *   the FOLDER   what the sales-folder import found on disk. Lets you see the
   *                real conversation today, but those files are not in the
   *                shared bucket, so nothing could actually go out.
   *   UPLOADS      what is really in the bucket. This is the truth about what
   *                could be sent — and it is empty until somebody uploads.
   *
   * The screen says which one is in use every time it shows a result. Blending
   * them would produce a preview that promises a video nobody can send.
   */
  const mediaLookup = useCallback(
    (carId: string): CarMedia => {
      const car = carsWithLibrary.find((c) => c.id === carId);
      if (!car) return { hasBrochure: false, videosByColour: {} };

      if (previewFromFolder) {
        return {
          hasBrochure: car.brochure !== null,
          videosByColour: folderVideoCounts[carId] ?? {},
        };
      }

      // Every uploaded video sits in a colour's folder, so it counts toward
      // that colour. (It did not always: videos used to be stored per car and
      // kind only, and an upload could not be attributed to a colour at all,
      // which is why this branch once reported none and the screen defaulted
      // to the folder.)
      const ups = uploadsByCar[carId] ?? [];
      return {
        hasBrochure: ups.some((u) => u.kind === "brochure"),
        videosByColour: libraryVideoCounts[carId] ?? {},
      };
    },
    [carsWithLibrary, previewFromFolder, folderVideoCounts, uploadsByCar, libraryVideoCounts]
  );

  /**
   * Send one message into the simulator.
   *
   * This calls the SAME advance() a webhook handler will call, with the same
   * state threaded through, so what appears here is production behaviour
   * rather than a description of it.
   */
  const sendSim = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed === "") return;
      const first = simTurns.length === 0;
      const result = advance(
        {
          text: trimmed,
          isNewNumber: simNew,
          isFirstMessage: first ? simFirst : false,
          source: simSource,
          autoSendEnabled: autoSend,
        },
        simState,
        cars,
        mediaLookup
      );
      setSimTurns((prev) => [
        ...prev,
        { from: "customer", text: trimmed },
        { from: "monza", action: result.action },
      ]);
      setSimState(result.next);
      setSimText("");
    },
    [simTurns, simNew, simFirst, simSource, autoSend, simState, cars, mediaLookup]
  );

  const resetSim = useCallback(() => {
    setSimTurns([]);
    setSimState(INITIAL_STATE);
    setSimText("");
  }, []);

  const runSim = useCallback(() => sendSim(simText), [sendSim, simText]);

  /** A quick try starts a FRESH conversation — otherwise it would arrive as
   *  the answer to whatever question is already on screen. */
  const tryChip = useCallback(
    (i: number) => {
      const sample = SAMPLE_MESSAGES[i];
      if (!sample) return;
      setSimNew(sample.isNewNumber);
      setSimFirst(sample.isFirstMessage);
      setSimSource(sample.source);
      setSimTurns([]);
      setSimState(INITIAL_STATE);
      const result = advance(
        {
          text: sample.text,
          isNewNumber: sample.isNewNumber,
          isFirstMessage: sample.isFirstMessage,
          source: sample.source,
          autoSendEnabled: autoSend,
        },
        INITIAL_STATE,
        cars,
        mediaLookup
      );
      setSimTurns([
        { from: "customer", text: sample.text },
        { from: "monza", action: result.action },
      ]);
      setSimState(result.next);
      setSimText("");
    },
    [autoSend, cars, mediaLookup]
  );

  /* ----- catalog editing (this screen only) ----- */

  const toggleCar = useCallback((id: string) => {
    setCars((prev) =>
      prev.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c))
    );
  }, []);

  const openMedia = useCallback((id: string) => {
    setMediaCarId(id);
  }, []);

  const closeMedia = useCallback(() => setMediaCarId(null), []);

  const openAdd = useCallback(() => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setDlgCarId("new");
  }, []);

  const openEdit = useCallback(
    (id: string) => {
      const car = cars.find((c) => c.id === id);
      if (!car) return;
      setForm(formFromCar(car));
      setFormError(null);
      setDlgCarId(id);
    },
    [cars]
  );

  const closeDialog = useCallback(() => setDlgCarId(null), []);

  // Drive the native <dialog>: showModal gives focus trapping + Esc for free.
  // The guard covers engines where showModal throws (already-open, old WebKit).
  useEffect(() => {
    const d = dlgRef.current;
    if (!d) return;
    if (dlgCarId !== null) {
      if (!d.open) {
        try {
          d.showModal();
        } catch {
          d.setAttribute("open", "");
        }
      }
    } else if (d.open) {
      d.close();
    }
    if (dlgCarId === null) return;
    // The non-modal fallback gets no free Esc handling — cover it ourselves.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDlgCarId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dlgCarId]);

  const setField = useCallback(
    (key: "name" | "oneLiner" | "aliases") =>
      (e: ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setForm((f) => ({ ...f, [key]: value }));
      },
    []
  );

  const submitCar = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const name = form.name.trim();
      if (!name) {
        setFormError("Please enter the car's name.");
        return;
      }
      const aliases = form.aliases
        .split(",")
        .map((a) => a.trim().toLowerCase())
        .filter((a, i, arr) => a !== "" && arr.indexOf(a) === i);
      // Media is NEVER typed as file names — a car starts with none and gets
      // its real videos and brochure through the media dialog uploads.
      const videos: WaAsset[] = [];
      const brochure: WaAsset | null = null;
      const oneLiner = form.oneLiner.trim();

      if (dlgCarId === "new") {
        // Uploads persist across sessions keyed by carId, while session
        // cars reset — a plain counter would restart at ADD-1 and let a new
        // car inherit another car's real files. A UUID (handler-only, never
        // in render) makes collisions impossible; the counter is the
        // fallback for engines without crypto.randomUUID.
        const id =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? `ADD-${crypto.randomUUID()}`
            : `ADD-${addSeq.current++}-${name.replace(/\W+/g, "").slice(0, 12)}`;
        const car: WaCar = {
          id,
          name,
          enabled: true,
          aliases,
          videos,
          // A car added by hand has no colours until its folder is imported.
          colours: [],
          brochure,
          oneLiner,
        };
        setCars((prev) => [car, ...prev]);
        setAddedIds((prev) => [...prev, id]);
      } else if (dlgCarId) {
        setCars((prev) =>
          prev.map((c) =>
            c.id === dlgCarId
              ? { ...c, name, aliases, videos, brochure, oneLiner }
              : c
          )
        );
      }
      setDlgCarId(null);
    },
    [form, dlgCarId]
  );

  /* ----- the four simple screens ----- */

  if (screen === "login") {
    return (
      <div className="ws-page">
        <div className="ws-empty">
          <p className="h2">Please sign in</p>
          <p className="cap">You need to be signed in to see WhatsApp Sales.</p>
          <a className="btn primary" href={LOGIN_HREF}>
            Go to sign in
          </a>
        </div>
      </div>
    );
  }

  if (screen === "loading") {
    return (
      <div className="ws-page">
        <div className="ws-empty" aria-live="polite">
          <p className="cap">Loading the catalog…</p>
        </div>
      </div>
    );
  }

  if (screen === "error") {
    return (
      <div className="ws-page">
        <div className="ws-wrap">
          <div className="note urgent">Couldn&apos;t load WhatsApp Sales.</div>
          <button className="btn" onClick={load} style={{ alignSelf: "flex-start" }}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (screen === "notReady") {
    return (
      <div className="ws-page">
        <div className="ws-wrap">
          <Link className="ws-back" href="/inbox">
            <BackGlyph />
            Back to the inbox
          </Link>
          <header className="ws-head">
            <div className="ws-head-main">
              <span className="ws-icon">
                <PlaneGlyph />
              </span>
              <div>
                <h1 className="h1">WhatsApp Sales Control</h1>
                <p className="cap ws-sub">
                  First-message auto-sender — catalog, guard rails and simulator.
                </p>
              </div>
            </div>
          </header>
          <div className="aurora" aria-hidden="true" />
          <div className="card pad stack">
            <p className="h2" style={{ margin: 0 }}>
              Not connected yet
            </p>
            <p className="lede">{notReady}</p>
            <Link className="btn" href="/chat" style={{ alignSelf: "flex-start" }}>
              Ask in the chat instead
            </Link>
          </div>
        </div>
      </div>
    );
  }

  /* ----- the control panel itself ----- */

  const dlgCar = dlgCarId && dlgCarId !== "new" ? cars.find((c) => c.id === dlgCarId) ?? null : null;
  const mediaCar = mediaCarId ? cars.find((c) => c.id === mediaCarId) ?? null : null;

  return (
    <div className="ws-page">
      <div className="ws-wrap">
        <Link className="ws-back" href="/inbox">
          <BackGlyph />
          Back to the inbox
        </Link>

        <header className="ws-head">
          <div className="ws-head-main">
            <span className="ws-icon">
              <PlaneGlyph />
            </span>
            <div className="grow">
              <div className="ws-title-row">
                <h1 className="h1">WhatsApp Sales Control</h1>
                <span className="tag">WhatsApp: not connected — preview</span>
              </div>
              <p className="cap ws-sub">
                A new number&apos;s first message about one car gets that car&apos;s
                videos and brochure — automatically, once connected.
              </p>
            </div>
          </div>
          <button className="btn primary ws-add-btn" onClick={openAdd}>
            <PlusGlyph />
            Add car
          </button>
        </header>

        <div className="aurora" aria-hidden="true" />

        {demo && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="note">{DEMO_NOTE}</div>
            <p className="ws-foot">
              Adding or editing cars, aliases and switches updates this screen
              only — refreshing the page resets them. Uploaded videos and
              brochures are the one exception: they are real files.{" "}
              {SHARED
                ? "Files are shared — everyone with this dashboard sees the same catalog."
                : "They are saved in this browser on this computer and survive a refresh — they move to shared team storage when WhatsApp is connected."}
            </p>
          </div>
        )}

        <div className="note">
          Automatic sending starts when the WhatsApp Business number is
          connected. Until then, every decision on this page is a preview —
          nothing is ever sent from here.
        </div>

        {/* What the folder import flagged. Shown HERE rather than left in a
            terminal, because the person who can fix these is the one looking
            at this page — and one of them (the same video under two models)
            would send a customer the wrong car. */}
        {warnings.length > 0 && (
          <div className="note urgent ws-warnings">
            <p className="ws-warnings-title">
              {warnings.length === 1
                ? "One thing needs your attention in the sales folder"
                : `${warnings.length} things need your attention in the sales folder`}
            </p>
            <ul className="ws-warning-list">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            {/* These describe the FOLDER as it was when it was imported. A gap
                filled by uploading here is already fixed, and the colours on
                each card show the live position — so this list can name a
                colour the cards show as ready. Saying so beats letting the two
                appear to contradict each other. */}
            <p className="cap ws-warnings-foot">
              From the last sales-folder import. Anything you have since
              uploaded here is already fixed — each card&rsquo;s colours show
              what the shared library really holds.
            </p>
          </div>
        )}

        <div className="ws-kpis">
          <div className="ws-kpi">
            <span className="ws-kpi-label">Cars in the catalog</span>
            <span className="ws-kpi-value">{cars.length}</span>
          </div>
          <div className="ws-kpi">
            <span className="ws-kpi-label">Ready to send</span>
            <span className="ws-kpi-value">{readyCount}</span>
            <span className="ws-kpi-cap">Enabled, with videos + brochure</span>
          </div>
          <div className="ws-kpi ws-kpi--accent">
            <span className="ws-kpi-label">Auto-send</span>
            <Switch
              on={autoSend}
              onFlip={() => setAutoSend((v) => !v)}
              label="Master auto-send switch"
            />
            <span className="ws-kpi-cap">Takes effect when WhatsApp is connected</span>
          </div>
          <div className="ws-kpi">
            <span className="ws-kpi-label">Would-have-sent today</span>
            <span className="ws-kpi-value">—</span>
            <span className="ws-kpi-cap">Starts counting when connected</span>
          </div>
        </div>

        <div className="ws-cols">
          {/* ------------------------------------------------ the catalog --- */}
          <section className="ws-catalog" aria-label="Car catalog">
            <h2 className="eyebrow ws-col-title">The catalog</h2>
            {cars.length === 0 ? (
              <div className="card ws-none">
                <p className="h2" style={{ margin: 0 }}>
                  No cars yet
                </p>
                <p className="cap" style={{ margin: 0 }}>
                  Use Add car to put the first model on the board.
                </p>
              </div>
            ) : (
              <div className="ws-grid">
                {cars.map((car) => {
                  // The overlaid car carries ONLY real uploads — the
                  // missing-asset line and readiness count nothing else.
                  const eff = brainCarById.get(car.id) ?? car;
                  const missing: string[] = [];
                  if (eff.videos.length === 0) missing.push("videos");
                  if (!eff.brochure) missing.push("its brochure");
                  const carUploads = uploadsByCar[car.id] ?? [];
                  const uploadCount = carUploads.length;
                  return (
                    <article
                      className="card ws-card ws-card--press"
                      key={car.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Open ${car.name} — videos and brochure`}
                      onClick={() => openMedia(car.id)}
                      onKeyDown={(e) => {
                        // Only the card itself — Enter on an inner button
                        // must not also open the media dialog.
                        if (e.target !== e.currentTarget) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openMedia(car.id);
                        }
                      }}
                    >
                      <div className="ws-card-top">
                        <div className="grow">
                          <div className="ws-name-row">
                            <p className="ws-name">{car.name}</p>
                            {addedIds.includes(car.id) && (
                              <span className="tag">Added by you — example</span>
                            )}
                          </div>
                          {car.oneLiner !== "" && (
                            <p className="cap ws-oneliner">{car.oneLiner}</p>
                          )}
                        </div>
                        <span
                          className="ws-stop"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Switch
                            on={car.enabled}
                            onFlip={() => toggleCar(car.id)}
                            label={`Enable auto-send for ${car.name}`}
                          />
                        </span>
                      </div>

                      {/* THE COLOURS, counted from the shared library — what
                          could really be sent — with the sales folder as a
                          fallback only where nothing has been uploaded yet.
                          A colour with nothing behind it is shown greyed
                          rather than hidden: the gap belongs on this screen,
                          where the person who can fill it is looking. */}
                      {car.colours.length > 0 && (
                        <div className="ws-colours">
                          {car.colours.map((colour) => {
                            const inLibrary =
                              libraryVideoCounts[car.id]?.[colour.id] ?? 0;
                            const inFolder =
                              folderVideoCounts[car.id]?.[colour.id] ?? 0;
                            const count = inLibrary > 0 ? inLibrary : 0;
                            const title =
                              inLibrary > 0
                                ? `${colour.name}: ${inLibrary} video${inLibrary === 1 ? "" : "s"} in the shared library`
                                : inFolder > 0
                                  ? `${colour.name}: ${inFolder} video${inFolder === 1 ? "" : "s"} in the sales folder, not uploaded yet`
                                  : `${colour.name}: no video anywhere, so it is never offered`;
                            return (
                              <span
                                className="ws-colour"
                                data-empty={count === 0}
                                data-pending={inLibrary === 0 && inFolder > 0}
                                key={colour.id}
                                title={title}
                              >
                                {colour.name}
                                {inLibrary > 0
                                  ? ""
                                  : inFolder > 0
                                    ? " — not uploaded"
                                    : " — no video"}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      {uploadCount > 0 ? (
                        <>
                          {/* REAL uploaded file names only — up to 3 + the rest counted. */}
                          <div className="ws-assets">
                            {carUploads.slice(0, 3).map((u) => (
                              <span
                                className="ws-file"
                                data-doc={u.kind === "brochure" ? "true" : undefined}
                                key={u.id}
                              >
                                {u.kind === "brochure" ? <DocGlyph /> : <PlayGlyph />}
                                <span className="ws-file-name">{u.name}</span>
                              </span>
                            ))}
                            {uploadCount > 3 && (
                              <span className="ws-file">
                                <span className="ws-file-label">
                                  +{uploadCount - 3} more
                                </span>
                              </span>
                            )}
                          </div>
                          <span className="tag ws-up-tag">
                            {uploadCount} uploaded —{" "}
                            {SHARED
                              ? "shared with the team"
                              : "saved in this browser"}
                          </span>
                        </>
                      ) : (
                        <p className="cap ws-nofiles">
                          No files yet — press to add videos and the brochure.
                        </p>
                      )}

                      {missing.length > 0 && (
                        <p className="ws-missing">
                          Won&apos;t auto-send — missing {missing.join(" and ")}.
                        </p>
                      )}

                      <div className="ws-card-actions">
                        <button
                          className="btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEdit(car.id);
                          }}
                        >
                          Edit
                        </button>
                        <span className="cap ws-card-open-hint" aria-hidden>
                          Press the card for videos &amp; brochure
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {/* ---------------------------------------------- the simulator --- */}
          <aside className="ws-sim" aria-label="Message simulator">
            <h2 className="eyebrow ws-col-title">Try an incoming message</h2>
            <div className="card ws-sim-card">
              <label className="ws-field">
                <span className="ws-label">Customer message</span>
                <textarea
                  className="ws-sim-text"
                  rows={3}
                  value={simText}
                  onChange={(e) => setSimText(e.target.value)}
                  placeholder="hi can i get more information about the passion l"
                  aria-label="The incoming customer message to test"
                />
              </label>

              <div className="ws-sim-row">
                <div className="ws-sim-toggle">
                  <span className="ws-label">New number?</span>
                  <Switch
                    on={simNew}
                    onFlip={() => setSimNew((v) => !v)}
                    label="Is this a new phone number?"
                  />
                </div>
                <div className="ws-sim-toggle">
                  <span className="ws-label">First message?</span>
                  <Switch
                    on={simFirst}
                    onFlip={() => setSimFirst((v) => !v)}
                    label="Is this the conversation's first message?"
                  />
                </div>
              </div>

              <label className="ws-field">
                <span className="ws-label">Came from</span>
                <select
                  value={simSource}
                  onChange={(e) => setSimSource(e.target.value as WaSource)}
                  aria-label="Where the message came from"
                >
                  {(Object.keys(SOURCE_LABEL) as WaSource[]).map((s) => (
                    <option key={s} value={s}>
                      {SOURCE_LABEL[s]}
                    </option>
                  ))}
                </select>
              </label>

              <div className="ws-run-row">
                <button className="btn primary ws-run" onClick={runSim}>
                  {simTurns.length === 0 ? "Run the brain" : "Send"}
                </button>
                {simTurns.length > 0 && (
                  <button type="button" className="btn quiet" onClick={resetSim}>
                    Start over
                  </button>
                )}
              </div>

              {/* Which files the flow is allowed to count. Never blended: a
                  preview that promises a video nobody can send is worse than
                  one that says nothing. */}
              <div className="ws-preview-toggle">
                <Switch
                  on={previewFromFolder}
                  onFlip={() => {
                    setPreviewFromFolder((v) => !v);
                    resetSim();
                  }}
                  label="Preview using the sales folder instead"
                />
                <p className="cap">
                  {previewFromFolder
                    ? "Counting what the sales folder import found on disk. Files that were never uploaded cannot actually go out — this is for spotting the gap, not for judging readiness."
                    : "Counting what is really in the shared library — the truth about what could be sent."}
                </p>
              </div>

              {simTurns.length > 0 && (
                <ol className="ws-convo" aria-live="polite">
                  {simTurns.map((turn, i) => {
                    if (turn.from === "customer") {
                      return (
                        <li className="ws-turn ws-turn-customer" key={i}>
                          <span className="ws-turn-who">Customer</span>
                          <p className="ws-turn-text">{turn.text}</p>
                        </li>
                      );
                    }
                    const a = turn.action;
                    if (!a) return null;
                    const sends = a.kind === "send";
                    return (
                      <li
                        className="ws-turn ws-turn-monza"
                        data-send={sends}
                        key={i}
                      >
                        <span className="ws-turn-who">
                          {a.kind === "hold"
                            ? "Nothing sent — handed to your team"
                            : sends
                              ? "Would send now"
                              : "Would ask"}
                        </span>
                        <p className="ws-turn-text">
                          {a.kind === "hold" ? a.reason : a.message}
                        </p>

                        {a.kind === "send" && (
                          <>
                            <div className="ws-assets">
                              {/* Count from the SAME source the decision used,
                                  or the panel contradicts the verdict above it
                                  — a send with no video listed, because the
                                  folder had none and the library did. */}
                              {(() => {
                                const n =
                                  (previewFromFolder
                                    ? folderVideoCounts[a.car.id]?.[a.colour.id]
                                    : libraryVideoCounts[a.car.id]?.[a.colour.id]) ?? 0;
                                if (n === 0) return null;
                                return (
                                  <span className="ws-file">
                                    <PlayGlyph />
                                    <span className="ws-file-label">
                                      {a.colour.name} video
                                    </span>
                                    <span className="ws-file-name">
                                      {n} file{n === 1 ? "" : "s"}
                                    </span>
                                  </span>
                                );
                              })()}
                              {a.car.brochure && (
                                <span className="ws-file" data-doc="true">
                                  <DocGlyph />
                                  <span className="ws-file-label">Catalogue</span>
                                  <span className="ws-file-name">
                                    {a.car.brochure.fileName}
                                  </span>
                                </span>
                              )}
                            </div>
                            <p className="cap ws-result-cap">
                              Preview only — nothing was sent. Sending starts when
                              the WhatsApp Business number is connected.
                            </p>
                          </>
                        )}

                        {(a.kind === "ask_colour" || a.kind === "reask_colour") && (
                          <div className="chip-row ws-colour-answers">
                            {a.colours.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                className="chip"
                                onClick={() => sendSim(c.name)}
                              >
                                {c.name}
                              </button>
                            ))}
                            <button
                              type="button"
                              className="chip"
                              onClick={() => sendSim("any")}
                            >
                              any
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}

              <div className="ws-chips">
                <span className="ws-label">Quick tries</span>
                <div className="chip-row">
                  {SAMPLE_MESSAGES.map((s, i) => (
                    <button
                      key={s.label}
                      type="button"
                      className="chip"
                      onClick={() => tryChip(i)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="card ws-rules">
              <h3 className="eyebrow ws-rules-title">The rules</h3>
              <ul className="ws-rules-list">
                {RULES.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          </aside>
        </div>

        <p className="ws-foot">
          The simulator runs the exact decision logic that will drive the live
          auto-sender. It never claims a message was sent — because none is,
          until the WhatsApp Business number is connected.
        </p>

        {/* Car media dialog — the car's real uploads, nothing else. */}
        <CarMediaDialog car={mediaCar} catalog={cars} onClose={closeMedia} />

        {/* Add / edit dialog — native <dialog> for focus trap + Esc. */}
        <dialog
          ref={dlgRef}
          className="ws-dlg"
          aria-label={dlgCarId === "new" ? "Add a car" : "Edit car"}
          onClose={closeDialog}
          onClick={(e) => {
            // Backdrop click: the dialog element itself is the target only
            // when the click lands outside its content box.
            if (e.target === e.currentTarget) closeDialog();
          }}
        >
          {dlgCarId !== null && (
            <form className="ws-dlg-body" onSubmit={submitCar} noValidate>
              <div className="ws-dlg-head">
                <h2 className="h2">{dlgCarId === "new" ? "Add a car" : `Edit ${dlgCar?.name ?? "car"}`}</h2>
                <p className="cap ws-dlg-sub">
                  Changes live on this screen only until the live catalog is
                  connected.
                </p>
              </div>

              <label className="ws-field">
                <span className="ws-label">Car name *</span>
                <input
                  value={form.name}
                  onChange={setField("name")}
                  placeholder="e.g. Voyah Passion L"
                  autoFocus
                  required
                />
              </label>

              <label className="ws-field">
                <span className="ws-label">One-liner</span>
                <input
                  value={form.oneLiner}
                  onChange={setField("oneLiner")}
                  placeholder="e.g. Long-wheelbase Passion — the chauffeured option."
                />
              </label>

              <label className="ws-field">
                <span className="ws-label">Aliases (comma-separated)</span>
                <input
                  value={form.aliases}
                  onChange={setField("aliases")}
                  placeholder="passion l, pasion l, pashion l"
                />
              </label>

              <div className="ws-field">
                <span className="ws-label">Videos &amp; brochure</span>
                <p className="cap ws-dlg-cap" style={{ margin: 0 }}>
                  Upload the actual files by pressing the car&apos;s card — no
                  file names are typed here. The car won&apos;t auto-send until
                  it has at least one video and its brochure.
                </p>
              </div>

              {formError && (
                <p className="ws-form-err" role="alert">
                  {formError}
                </p>
              )}

              <div className="ws-dlg-actions">
                <button type="submit" className="btn primary">
                  {dlgCarId === "new" ? "Add car" : "Save changes"}
                </button>
                <button type="button" className="btn" onClick={closeDialog}>
                  Cancel
                </button>
              </div>
              <p className="cap ws-dlg-cap">
                In the live system this saves the car and its files to the Monza
                catalog. Here it updates this screen only — refresh resets it.
              </p>
            </form>
          )}
        </dialog>
      </div>
    </div>
  );
}
