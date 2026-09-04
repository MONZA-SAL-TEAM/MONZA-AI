"use client";

/**
 * WhatsApp Sales — the media store, in TWO modes behind one interface.
 *
 * STORAGE MODE (NEXT_PUBLIC_AI_SUPABASE_URL + NEXT_PUBLIC_AI_SUPABASE_ANON_KEY
 * both set): files live in the shared Supabase Storage bucket "wasales-media",
 * so every person with this dashboard sees the same catalog. Reads and lists
 * use the anon key directly (the bucket is public-read). Writes NEVER go
 * through the anon key — the bucket deliberately has no anon write policy.
 * Instead the server route /api/wasales-media (service-role key) mints a
 * signed upload URL and the BROWSER uploads the bytes straight to Supabase,
 * so no file ever squeezes through a serverless body limit. Deletes are
 * server-side by path. Until Samer pastes the service-role key into the
 * server env, the route answers 503 keyMissing and uploads show the honest
 * sentence: "Shared uploads are almost ready — one server key is still
 * missing."
 *
 * Object path scheme: <carId>/<kind>/<uuid>__<safeOriginalName> — the display
 * name is the part after the first "__", so cards always show the REAL name
 * of the uploaded file.
 *
 * LOCAL MODE (env absent — local dev): today's behavior, unchanged. Files
 * live in IndexedDB in THIS browser on THIS computer; playback uses object
 * URLs managed by the hook.
 *
 * Hydration safety: storageMode() reads process.env.NEXT_PUBLIC_* inline —
 * build-time constants, identical on server and client, safe in render.
 * Everything that touches indexedDB / fetch / crypto.randomUUID runs only in
 * effects and handlers, never during render.
 *
 * Every API fails soft: lists come back empty and writes come back
 * { ok: false, error } with the error in plain words.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AI_ANON_KEY, AI_URL } from "@/lib/env-public";
import {
  MEDIA_BUCKET,
  STORAGE_MAX_BYTES,
  VIDEO_EXTENSIONS as STORAGE_VIDEO_EXTENSIONS,
  buildMediaPath,
  contentTypeFor,
  displayNameOf,
  extensionOf,
  isValidCarId,
  isValidColourId,
  mediaPrefix,
} from "@/lib/wasales/media-paths";

/* ---------------------------------------------------------------- types --- */

export type MediaKind = "video" | "brochure";

/** One media record, either mode.
 *  Local mode:   id = generated id, blob set, url unset (the hook makes one).
 *  Storage mode: id = the full object path, url = public URL, blob unset. */
export interface StoredMediaFile {
  id: string;
  carId: string;
  kind: MediaKind;
  /** Which colour a video shows; always null for a brochure. */
  colourId: string | null;
  /** The ORIGINAL file name, as shown on cards and chips. */
  name: string;
  /** MIME type ("" when unknown). */
  type: string;
  size: number;
  blob?: Blob;
  url?: string;
}

/** What the UI renders: the record plus a ready-to-use URL. */
export interface CarMediaItem {
  id: string;
  carId: string;
  kind: MediaKind;
  /** Which colour a video shows; always null for a brochure. */
  colourId: string | null;
  name: string;
  type: string;
  size: number;
  /** Playable/openable URL; "" if none could be made. */
  url: string;
}

export type AddFileResult =
  | { ok: true; file: StoredMediaFile }
  | { ok: false; error: string };

/* ----------------------------------------------------------------- mode --- */

// The Monza AI Supabase project's PUBLIC client pair. These are public by
// design — the anon key ships in every visitor's browser bundle and grants
// only what the database's RLS and storage policies allow (here: read-only
// on the media bucket). Env vars win when set; the committed defaults keep
// shared mode on without any dashboard configuration. The SERVICE key is the
// secret — it lives only in the server environment, never here.
const STORAGE_URL = AI_URL;
const STORAGE_ANON = AI_ANON_KEY;

/** True when the shared Supabase media library is configured. Build-time
 *  constant — safe to call during render. */
export function storageMode(): boolean {
  return STORAGE_URL !== "" && STORAGE_ANON !== "";
}

const BUCKET = MEDIA_BUCKET;
const API_ROUTE = "/api/wasales-media";

/** The exact honest sentence for the not-yet-configured server key. */
const KEY_MISSING_MSG =
  "Shared uploads are almost ready — one server key is still missing.";

/**
 * Turn a refused API response into one plain sentence for the person at the
 * screen. The server sends a stable machine code plus a message; we key on the
 * code (never on status alone — a proxy or mid-deploy 503 must not masquerade
 * as a configuration message) and fall back to a generic line.
 *
 * Every one of these is a state a person can act on: sign in, ask an admin, or
 * try again. None of them exposes anything about the server's configuration
 * beyond "this isn't available to you right now".
 */
async function apiErrorMessage(
  res: Response,
  what: "upload" | "delete"
): Promise<string> {
  let code = "";
  try {
    const body: unknown = await res.clone().json();
    if (body && typeof body === "object") {
      const e = (body as { error?: unknown }).error;
      if (typeof e === "string") code = e;
    }
  } catch {
    /* not JSON — fall through to the generic sentence */
  }

  switch (code) {
    case "keyMissing":
      return KEY_MISSING_MSG;
    case "signInRequired":
      return "Please sign in to Monza AI first, then try again.";
    case "demoMode":
      return "This is the demo — the shared media library can only be changed once staff sign-in is connected.";
    case "forbidden":
      return "Your account doesn't include managing sales material — ask an owner to grant it.";
    default:
      return what === "upload"
        ? "The server couldn't prepare the upload — please try again."
        : "Couldn't remove that file — please try again.";
  }
}

let sbClient: SupabaseClient | null = null;

/** Anon Supabase client for the shared library (reads + signed uploads). */
function getStorageClient(): SupabaseClient {
  if (!sbClient) {
    sbClient = createClient(STORAGE_URL, STORAGE_ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return sbClient;
}

/* ---------------------------------------------------------------- limits --- */

const LOCAL_MAX_BYTES = 300 * 1024 * 1024; // 300 MB (this browser only)

const LOCAL_VIDEO_EXTENSIONS = [
  "mp4", "mov", "m4v", "webm", "mkv", "avi", "3gp", "mpg", "mpeg", "ogv",
];


/** video/* by MIME, or a known video extension when the OS reported none. */
function looksLikeVideo(file: File): boolean {
  const t = (file.type || "").toLowerCase();
  if (t.startsWith("video/")) return true;
  return t === "" && LOCAL_VIDEO_EXTENSIONS.includes(extensionOf(file.name));
}

/** PDFs only: the .pdf extension is required, and the MIME (when the browser
 *  reports one) must be application/pdf. */
function looksLikePdf(file: File): boolean {
  if (extensionOf(file.name) !== "pdf") return false;
  const t = (file.type || "").toLowerCase();
  return t === "" || t === "application/pdf";
}

/* ------------------------------------------------------------------- ids --- */

/** Fallback counter for engines without crypto.randomUUID. */
let idSeq = 1;

function makeId(name: string, size: number): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the deterministic fallback
  }
  const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  return `f-${idSeq++}-${size}-${safeName}`;
}


/* ------------------------------------------------------- the local db --- */

const DB_NAME = "monza-wasales-media";
const DB_VERSION = 1;
const STORE = "files";

let dbPromise: Promise<IDBDatabase> | null = null;

/** Open (and memoize) the database. Rejects softly when IndexedDB is missing
 *  or blocked; callers catch and degrade. Never call during render. */
export function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available"));
  }
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      let req: IDBOpenDBRequest;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        dbPromise = null;
        reject(err instanceof Error ? err : new Error("IndexedDB open failed"));
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("carId", "carId", { unique: false });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // If another tab upgrades the schema later, get out of its way.
        db.onversionchange = () => {
          try {
            db.close();
          } catch {
            /* already closing */
          }
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        dbPromise = null;
        reject(req.error ?? new Error("IndexedDB open failed"));
      };
    });
  }
  return dbPromise;
}

/* ------------------------------------------------------ change broadcast --- */

/** Every mounted hook re-reads after any add/delete, so the dialog, the card
 *  faces and the simulator all agree without prop-drilling refresh calls. */
type MediaListener = () => void;
const listeners = new Set<MediaListener>();

export function subscribeMediaChanges(fn: MediaListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notifyChanged(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a broken listener never breaks the others */
    }
  });
}

/* ------------------------------------------------- storage-mode helpers --- */

/** Ask the server route for something; null on network failure. */
async function postApi(body: object): Promise<Response | null> {
  try {
    return await fetch(API_ROUTE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
}

interface RawEntry {
  name?: unknown;
  id?: unknown;
  metadata?: unknown;
}

/** List one <carId>/<kind> prefix of the shared bucket. Fails soft: []. */
/** The immediate child FOLDER names under a prefix (Supabase marks them with
 *  a null id and no metadata — the same signal we skip when listing files). */
async function listFolderNames(prefix: string): Promise<string[]> {
  try {
    const sb = getStorageClient();
    const { data, error } = await sb.storage
      .from(BUCKET)
      .list(prefix, { limit: 200, sortBy: { column: "name", order: "asc" } });
    if (error || !Array.isArray(data)) return [];
    return (data as RawEntry[])
      .filter((raw) => raw.id === null || raw.id === undefined)
      .map((raw) => (typeof raw.name === "string" ? raw.name : ""))
      .filter((name) => name !== "" && !name.startsWith("."));
  } catch {
    return [];
  }
}

/**
 * The files sitting directly under one prefix.
 *
 * `colourId` is what the caller already knows about where it is looking — it
 * is recorded on each record rather than parsed back out of the path, so the
 * colour a file reports is the folder it was actually found in.
 */
async function listPrefixStorage(
  carId: string,
  kind: MediaKind,
  colourId: string | null
): Promise<StoredMediaFile[]> {
  try {
    const sb = getStorageClient();
    const prefix = mediaPrefix(carId, kind, colourId);
    const { data, error } = await sb.storage.from(BUCKET).list(prefix, {
      limit: 100,
      sortBy: { column: "created_at", order: "asc" },
    });
    if (error || !Array.isArray(data)) return [];
    const out: StoredMediaFile[] = [];
    for (const raw of data as RawEntry[]) {
      const name = typeof raw.name === "string" ? raw.name : "";
      // Folders come back with a null id and no metadata — skip them, and
      // skip Supabase's placeholder objects.
      if (name === "" || name.startsWith(".")) continue;
      if (raw.id === null || raw.id === undefined) continue;
      const meta =
        raw.metadata && typeof raw.metadata === "object"
          ? (raw.metadata as Record<string, unknown>)
          : {};
      const path = `${prefix}/${name}`;
      out.push({
        id: path,
        carId,
        kind,
        colourId: kind === "video" ? colourId : null,
        name: displayNameOf(name),
        type: typeof meta.mimetype === "string" ? meta.mimetype : "",
        size: typeof meta.size === "number" ? meta.size : 0,
        url: sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * One car's files. Videos live a level deeper than brochures — under a folder
 * per colour — so this discovers the colours that actually exist in the bucket
 * rather than asking the catalogue what it expects. A colour somebody uploaded
 * before the catalogue knew about it still shows up; a catalogue colour with
 * nothing in it costs no request.
 */
async function listFilesStorage(carId: string): Promise<StoredMediaFile[]> {
  const colourIds = await listFolderNames(`${carId}/video`);
  const [brochures, ...videoLists] = await Promise.all([
    listPrefixStorage(carId, "brochure", null),
    ...colourIds.map((colourId) => listPrefixStorage(carId, "video", colourId)),
  ]);
  return [...videoLists.flat(), ...brochures];
}

async function listAllFilesStorage(): Promise<StoredMediaFile[]> {
  try {
    const sb = getStorageClient();
    const { data, error } = await sb.storage.from(BUCKET).list("", { limit: 200 });
    if (error || !Array.isArray(data)) return [];
    const carIds = (data as RawEntry[])
      .map((e) => (typeof e.name === "string" ? e.name : ""))
      .filter((n) => /^[a-z0-9-]+$/.test(n));
    const lists = await Promise.all(carIds.map((id) => listFilesStorage(id)));
    return lists.flat();
  } catch {
    return [];
  }
}

async function addFileStorage(
  carId: string,
  kind: MediaKind,
  colourId: string | null,
  file: File
): Promise<AddFileResult> {
  // Session-added cars reset on refresh, so their files would sit orphaned
  // in the shared library forever. Honest refusal instead. The id shape itself
  // comes from lib/wasales/media-paths so the browser and the server agree on
  // exactly one definition (the old local copy was stricter than the server's
  // and would have rejected real source-system ids).
  if (!isValidCarId(carId)) {
    return {
      ok: false,
      error:
        "This car lives on this screen only until the live catalog is connected — files can be uploaded to the catalog cars for now.",
    };
  }
  // A video without a colour has nowhere correct to go: the sales flow sends
  // "this colour's videos", so an uncoloured one could never be sent and would
  // sit in the bucket looking like material we have. Refuse it at the door.
  if (kind === "video" && (!colourId || !isValidColourId(colourId))) {
    return {
      ok: false,
      error: "Pick which colour this video shows before uploading it.",
    };
  }
  if (file.size > STORAGE_MAX_BYTES) {
    return {
      ok: false,
      error:
        // Derived, never written out: a hardcoded number here told people to
        // compress files that were already fine the day the bucket's cap was
        // raised.
        `That file is over ${Math.round(STORAGE_MAX_BYTES / 1024 / 1024)} MB, which is the shared library's limit — please compress it or pick a smaller file.`,
    };
  }
  const ext = extensionOf(file.name);
  if (kind === "video" && !STORAGE_VIDEO_EXTENSIONS.includes(ext)) {
    return {
      ok: false,
      error:
        "Videos in the shared library must be MP4, MOV, WebM or MKV files.",
    };
  }
  if (kind === "brochure" && !looksLikePdf(file)) {
    return {
      ok: false,
      error: "The brochure must be a PDF file (ending in .pdf).",
    };
  }
  const contentType = contentTypeFor(file.name);
  if (!contentType) {
    return {
      ok: false,
      error: "That file type isn't supported in the shared library.",
    };
  }

  const path = buildMediaPath(
    carId,
    kind,
    kind === "video" ? colourId : null,
    makeId(file.name, file.size),
    file.name
  );

  const res = await postApi({ action: "sign-upload", path, contentType });
  if (!res) {
    return {
      ok: false,
      error: "Couldn't reach the server — please check the connection and try again.",
    };
  }
  if (!res.ok) {
    return { ok: false, error: await apiErrorMessage(res, "upload") };
  }
  let token = "";
  try {
    const parsed: unknown = await res.json();
    if (parsed && typeof parsed === "object") {
      const t = (parsed as Record<string, unknown>).token;
      if (typeof t === "string") token = t;
    }
  } catch {
    /* falls through to the empty-token error below */
  }
  if (token === "") {
    return {
      ok: false,
      error: "The server couldn't prepare the upload — please try again.",
    };
  }

  try {
    const sb = getStorageClient();
    const { error } = await sb.storage
      .from(BUCKET)
      .uploadToSignedUrl(path, token, file, { contentType });
    if (error) {
      return {
        ok: false,
        error: "The upload didn't finish — please check the connection and try again.",
      };
    }
  } catch {
    return {
      ok: false,
      error: "The upload didn't finish — please check the connection and try again.",
    };
  }

  // Brochure replace, loss-proof: the old file is retired only now that the
  // new one is safely up.
  if (kind === "brochure") {
    await sweepOldBrochure(path);
  }

  notifyChanged();
  return {
    ok: true,
    file: {
      id: path,
      carId,
      kind,
      colourId: kind === "video" ? colourId : null,
      name: file.name,
      type: contentType,
      size: file.size,
      url: getStorageClient().storage.from(BUCKET).getPublicUrl(path).data.publicUrl,
    },
  };
}

/** After a brochure upload lands, retire the car's previous brochure.
 *  A failure here leaves an extra old file — never a missing new one — so it
 *  is reported to the caller rather than thrown. */
async function sweepOldBrochure(keepPath: string): Promise<void> {
  await postApi({ action: "sweep-brochure", keepPath });
}

/** Server-side delete by path. Every failure comes back in plain words. */
async function deleteFileStorage(path: string): Promise<{ ok: boolean; error?: string }> {
  const res = await postApi({ action: "delete", path });
  if (res && res.ok) {
    notifyChanged();
    return { ok: true };
  }
  if (!res) {
    return {
      ok: false,
      error:
        "Couldn't remove that file — please check the connection and try again.",
    };
  }
  return { ok: false, error: await apiErrorMessage(res, "delete") };
}

/* --------------------------------------------------- local-mode operations --- */

async function addFileLocal(
  carId: string,
  kind: MediaKind,
  colourId: string | null,
  file: File
): Promise<AddFileResult> {
  if (file.size > LOCAL_MAX_BYTES) {
    return {
      ok: false,
      error: "That file is over 300 MB — please compress it or pick a smaller file.",
    };
  }
  if (kind === "video" && !looksLikeVideo(file)) {
    return {
      ok: false,
      error: "That doesn't look like a video file — please pick a video (MP4, MOV, WebM…).",
    };
  }
  if (kind === "brochure" && !looksLikePdf(file)) {
    return {
      ok: false,
      error: "The brochure must be a PDF file (ending in .pdf).",
    };
  }

  const record: StoredMediaFile = {
    id: makeId(file.name, file.size),
    carId,
    kind,
    colourId: kind === "video" ? colourId : null,
    name: file.name,
    type: file.type || "",
    size: file.size,
    blob: file,
  };

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("write failed"));
      tx.onabort = () => reject(tx.error ?? new Error("write aborted"));
      const store = tx.objectStore(STORE);
      if (kind === "brochure") {
        // One brochure per car: sweep the old one(s) out, then put the new.
        const cursorReq = store.index("carId").openCursor(IDBKeyRange.only(carId));
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            const existing = cursor.value as StoredMediaFile;
            if (existing.kind === "brochure") cursor.delete();
            cursor.continue();
          } else {
            store.put(record);
          }
        };
      } else {
        store.put(record);
      }
    });
    notifyChanged();
    return { ok: true, file: record };
  } catch {
    return {
      ok: false,
      error: "Couldn't save the file in this browser — storage may be blocked or full.",
    };
  }
}

async function listFilesLocal(carId: string): Promise<StoredMediaFile[]> {
  try {
    const db = await openDb();
    return await new Promise<StoredMediaFile[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).index("carId").getAll(IDBKeyRange.only(carId));
      req.onsuccess = () => resolve((req.result as StoredMediaFile[]) ?? []);
      req.onerror = () => reject(req.error ?? new Error("read failed"));
    });
  } catch {
    return [];
  }
}

async function listAllFilesLocal(): Promise<StoredMediaFile[]> {
  try {
    const db = await openDb();
    return await new Promise<StoredMediaFile[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as StoredMediaFile[]) ?? []);
      req.onerror = () => reject(req.error ?? new Error("read failed"));
    });
  } catch {
    return [];
  }
}

async function deleteFileLocal(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("delete failed"));
      tx.onabort = () => reject(tx.error ?? new Error("delete aborted"));
      tx.objectStore(STORE).delete(id);
    });
    notifyChanged();
  } catch {
    /* nothing to surface — the list simply keeps what it has */
  }
}

/* --------------------------------------------------- the shared interface --- */

/**
 * Store one uploaded file for a car. Validates size and kind first, in plain
 * words. A brochure REPLACES the car's previous brochure (one per car);
 * videos append. Resolves { ok: false, error } instead of throwing.
 */
export async function addFile(
  carId: string,
  kind: MediaKind,
  colourId: string | null,
  file: File
): Promise<AddFileResult> {
  return storageMode()
    ? addFileStorage(carId, kind, colourId, file)
    : addFileLocal(carId, kind, colourId, file);
}

/** All stored files for one car. Fails soft: an unavailable store yields []. */
export async function listFiles(carId: string): Promise<StoredMediaFile[]> {
  return storageMode() ? listFilesStorage(carId) : listFilesLocal(carId);
}

/** Every stored file, all cars. Fails soft: an unavailable store yields []. */
export async function listAllFiles(): Promise<StoredMediaFile[]> {
  return storageMode() ? listAllFilesStorage() : listAllFilesLocal();
}

/** Delete one file by id (storage mode: id = the object path). */
export async function deleteFile(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  if (storageMode()) return deleteFileStorage(id);
  await deleteFileLocal(id);
  return { ok: true };
}

/* ------------------------------------------------------------- the hook --- */

export interface CarMediaState {
  /** false until the first read of the store has finished. */
  loaded: boolean;
  /** Uploaded videos for the car, each with a playable URL. */
  videos: CarMediaItem[];
  /**
   * How many uploaded videos each colour has, keyed by colour id — the shape
   * the sales flow's CarMedia takes, so the screen can show what would really
   * be sent instead of what the folder on somebody's disk contains.
   */
  videosByColour: Record<string, number>;
  /** The car's one uploaded brochure PDF, or null. */
  brochure: CarMediaItem | null;
  /**
   * Validates + stores; returns the plain-words error on refusal. `colourId`
   * says which colour a video shows and is required for one — pass null for a
   * brochure, which covers every colour.
   */
  add: (
    kind: MediaKind,
    colourId: string | null,
    file: File
  ) => Promise<AddFileResult>;
  /** Removes one uploaded file. */
  remove: (id: string) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * React hook: the uploaded media of one car, kept fresh after every
 * add/delete (from ANY hook instance, via the change broadcast). Storage-mode
 * records carry their public URL; local-mode records get object URLs created
 * once per file id and revoked on removal and on unmount.
 * Pass null to render the empty state (e.g. while no car is selected).
 */
export function useCarMedia(carId: string | null): CarMediaState {
  const [records, setRecords] = useState<StoredMediaFile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  /** id → object URL, stable across re-reads so playing videos keep playing. */
  const urlMapRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    let alive = true;
    const load = () => {
      if (!carId) {
        setRecords([]);
        setLoaded(true);
        return;
      }
      listFiles(carId).then((list) => {
        if (alive) {
          setRecords(list);
          setLoaded(true);
        }
      });
    };
    load();
    const unsubscribe = subscribeMediaChanges(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [carId]);

  // Object URL lifecycle (local-mode blobs only): create for new ids, revoke
  // for removed ids. Storage-mode records carry a URL and are passed through.
  useEffect(() => {
    const map = urlMapRef.current;
    const wanted = new Set(records.filter((r) => r.blob).map((r) => r.id));
    for (const [id, url] of Array.from(map.entries())) {
      if (!wanted.has(id)) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* already gone */
        }
        map.delete(id);
      }
    }
    const next: Record<string, string> = {};
    for (const r of records) {
      if (r.url) {
        next[r.id] = r.url;
        continue;
      }
      if (!r.blob) {
        next[r.id] = "";
        continue;
      }
      let url = map.get(r.id);
      if (!url) {
        try {
          url = URL.createObjectURL(r.blob);
          map.set(r.id, url);
        } catch {
          url = "";
        }
      }
      next[r.id] = url;
    }
    setUrls(next);
  }, [records]);

  // Revoke everything on unmount.
  useEffect(() => {
    const map = urlMapRef.current;
    return () => {
      for (const url of Array.from(map.values())) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* already gone */
        }
      }
      map.clear();
    };
  }, []);

  const items: CarMediaItem[] = useMemo(
    () =>
      records.map((r) => ({
        id: r.id,
        carId: r.carId,
        kind: r.kind,
        colourId: r.colourId ?? null,
        name: r.name,
        type: r.type,
        size: r.size,
        url: urls[r.id] ?? "",
      })),
    [records, urls]
  );

  const videos = useMemo(() => items.filter((f) => f.kind === "video"), [items]);

  /**
   * How many videos each colour has, keyed by colour id — the exact shape the
   * sales flow's CarMedia wants. Built from what is really in the library, so
   * a colour the catalogue lists but nobody has filmed reports nothing rather
   * than being absent from the map entirely.
   */
  const videosByColour = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const v of videos) {
      if (!v.colourId) continue;
      counts[v.colourId] = (counts[v.colourId] ?? 0) + 1;
    }
    return counts;
  }, [videos]);
  const brochure = useMemo(
    () => items.find((f) => f.kind === "brochure") ?? null,
    [items]
  );

  const add = useCallback(
    async (
      kind: MediaKind,
      colourId: string | null,
      file: File
    ): Promise<AddFileResult> => {
      if (!carId) {
        return { ok: false, error: "No car selected." };
      }
      return addFile(carId, kind, colourId, file);
    },
    [carId]
  );

  const remove = useCallback(
    async (id: string): Promise<{ ok: boolean; error?: string }> => {
      return deleteFile(id);
    },
    []
  );

  return { loaded, videos, videosByColour, brochure, add, remove };
}
