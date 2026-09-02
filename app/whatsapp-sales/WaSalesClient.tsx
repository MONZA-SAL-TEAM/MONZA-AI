"use client";

/**
 * Monza WhatsApp Sales Control — the whole control panel + simulator.
 *
 * Server API this client speaks (GET /api/whatsapp-sales, exactly):
 *   { demo: true,  catalog: WaCar[] }             — example catalog
 *   { demo: false, catalog: null, notReady: "…" } — honest not-wired state
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
 *   - The simulator runs the REAL brain (lib/wasales/matcher.ts decide()) on
 *     the catalog as edited — the last run is kept as an input snapshot and
 *     the decision derives from it, so flipping the master Auto-send switch
 *     or editing a car updates the verdict live.
 *   - Hydration-safe: no Date, no random; new-car ids come from a ref counter.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import Link from "next/link";
import type { Decision, WaAsset, WaCar, WaSource } from "@/lib/wasales/matcher";
import { decide } from "@/lib/wasales/matcher";
import { SAMPLE_MESSAGES } from "@/lib/wasales/catalog-data";
import type { MediaKind } from "@/lib/wasales/media-store";
import {
  listAllFiles,
  storageMode,
  subscribeMediaChanges,
  useCarMedia, deleteFile } from "@/lib/wasales/media-store";

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
const LOGIN_HREF = "/login?next=" + encodeURIComponent("/whatsapp-sales");

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
    brochure: c.brochure ? asAsset(c.brochure) : null,
    oneLiner: c.oneLiner,
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
  onClose,
}: {
  car: WaCar | null;
  onClose: () => void;
}) {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const { loaded, videos, brochure, add, remove } = useCarMedia(car?.id ?? null);
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

  // A fresh car gets a fresh error slate.
  useEffect(() => {
    setUploadError(null);
  }, [car?.id]);

  const uploadFiles = useCallback(
    async (kind: MediaKind, files: File[]) => {
      if (files.length === 0) return;
      setUploadError(null);
      setBusy(true);
      const errors: string[] = [];
      for (const f of files) {
        const result = await add(kind, f);
        if (!result.ok) errors.push(`${f.name}: ${result.error}`);
      }
      setBusy(false);
      if (errors.length > 0) setUploadError(errors.join(" "));
    },
    [add]
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
              <button
                type="button"
                className="btn ws-media-upload-btn"
                onClick={() => videoInputRef.current?.click()}
                disabled={busy}
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
                      <span className="ws-media-size">{formatSize(v.size)}</span>
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
  const [simRun, setSimRun] = useState<SimRun | null>(null);

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
    { id: string; carId: string; kind: MediaKind; name: string; size: number }[]
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
          files.map(({ id, carId, kind, name, size }) => ({
            id,
            carId,
            kind,
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
        demo?: unknown;
        catalog?: unknown;
        notReady?: unknown;
      };
      const parsed = asCatalog(d.catalog);
      if (parsed) {
        setDemo(d.demo === true);
        setCars(parsed);
        setAddedIds([]);
        setSimRun(null);
        setDlgCarId(null);
        setMediaCarId(null);
        setScreen("ready");
        return;
      }
      if (d.demo === false) {
        if (typeof d.notReady === "string" && d.notReady.trim() !== "") {
          setNotReady(d.notReady);
        }
        setScreen("notReady");
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
   * PURE OVERLAY — matcher.ts is untouched. Before the catalog reaches
   * decide(), each car's videos/brochure fields are REPLACED with the REAL
   * uploaded files, and nothing else: no uploads means no videos and no
   * brochure, whatever anyone typed anywhere. Readiness, the missing-asset
   * lines, the simulator verdict and the would-send chips all count only
   * files that actually exist.
   */
  const carsForBrain = useMemo<WaCar[]>(
    () =>
      cars.map((car) => {
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
    [cars, uploadsByCar]
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
   * The verdict re-derives from the last Run whenever the master switch or
   * the catalog changes — flipping Auto-send visibly flips the decision.
   */
  const simDecision: Decision | null = useMemo(() => {
    if (!simRun) return null;
    // An empty box isn't a mystery car — say the obvious thing instead.
    if (simRun.text.trim() === "") {
      return {
        decision: "hold",
        reason: "Type a message above (or tap a quick try) to see what the brain would do.",
      } as Decision;
    }
    // The overlaid catalog: same cars, same aliases, same matcher — the
    // videos/brochure fields carry ONLY the real uploads.
    return decide({ ...simRun, autoSendEnabled: autoSend }, carsForBrain);
  }, [simRun, autoSend, carsForBrain]);

  const runSim = useCallback(() => {
    setSimRun({
      text: simText,
      isNewNumber: simNew,
      isFirstMessage: simFirst,
      source: simSource,
    });
  }, [simText, simNew, simFirst, simSource]);

  const tryChip = useCallback((i: number) => {
    const s = SAMPLE_MESSAGES[i];
    if (!s) return;
    setSimText(s.text);
    setSimNew(s.isNewNumber);
    setSimFirst(s.isFirstMessage);
    setSimSource(s.source);
    setSimRun({
      text: s.text,
      isNewNumber: s.isNewNumber,
      isFirstMessage: s.isFirstMessage,
      source: s.source,
    });
  }, []);

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
          <Link className="ws-back" href="/chat">
            <BackGlyph />
            Back to chat
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
        <Link className="ws-back" href="/chat">
          <BackGlyph />
          Back to chat
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

              <button className="btn primary ws-run" onClick={runSim}>
                Run the brain
              </button>

              {simDecision && (
                <div
                  className="ws-result"
                  data-send={simDecision.decision === "send"}
                  aria-live="polite"
                >
                  {simDecision.decision === "send" && simDecision.model ? (
                    <>
                      <p className="ws-result-title">Would send now</p>
                      <p className="ws-result-sub">
                        {simDecision.reason}
                        {simDecision.confidence === "fuzzy" &&
                          " The spelling was corrected automatically."}
                      </p>
                      <div className="ws-assets">
                        {simDecision.model.videos.map((v, i) => (
                          <span className="ws-file" key={`${v.fileName}-${i}`}>
                            <PlayGlyph />
                            <span className="ws-file-label">{v.label}</span>
                            <span className="ws-file-name">{v.fileName}</span>
                          </span>
                        ))}
                        {simDecision.model.brochure && (
                          <span className="ws-file" data-doc="true">
                            <DocGlyph />
                            <span className="ws-file-label">
                              {simDecision.model.brochure.label}
                            </span>
                            <span className="ws-file-name">
                              {simDecision.model.brochure.fileName}
                            </span>
                          </span>
                        )}
                      </div>
                      <p className="ws-reply">
                        &ldquo;Here&apos;s the {simDecision.model.name} —{" "}
                        {simDecision.model.videos.length} video
                        {simDecision.model.videos.length === 1 ? "" : "s"} and the
                        brochure. A Monza team member will follow up.&rdquo;
                      </p>
                      <p className="cap ws-result-cap">
                        Preview only — nothing was sent. Sending starts when the
                        WhatsApp Business number is connected.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="ws-result-title">
                        Nothing sent — handed to your team
                      </p>
                      <p className="ws-result-sub">{simDecision.reason}</p>
                    </>
                  )}
                </div>
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
        <CarMediaDialog car={mediaCar} onClose={closeMedia} />

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
