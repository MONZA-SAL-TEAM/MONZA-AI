"use client";

/**
 * WhatsApp Sales — the local media store.
 *
 * Real uploads with no backend yet: files live in IndexedDB in THIS browser
 * on THIS computer, so they survive refreshes, videos play inline and PDFs
 * open. They move to shared team storage when the WhatsApp Business
 * connection work lands. This is DELIBERATELY different from the rest of the
 * /whatsapp-sales page, which resets on refresh — the page says so in plain
 * words wherever it matters.
 *
 * Hydration safety: nothing here touches window/indexedDB at module scope,
 * and no function in this file is ever called during render — every entry
 * point runs inside an effect or an event handler. That is also why ids may
 * use crypto.randomUUID (guarded — with a name+size+counter fallback):
 * randomness is fine in effect-only code, and the records persist across
 * sessions, so ids must be unique across sessions, which a bare counter
 * alone could not guarantee.
 *
 * Every API fails soft: a blocked or broken IndexedDB never throws into the
 * UI — lists come back empty and writes come back { ok: false, error } with
 * the error in plain words.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ---------------------------------------------------------------- types --- */

export type MediaKind = "video" | "brochure";

/** The record as it sits in IndexedDB. */
export interface StoredMediaFile {
  id: string;
  carId: string;
  kind: MediaKind;
  name: string;
  /** The file's MIME type as the browser reported it (may be ""). */
  type: string;
  size: number;
  blob: Blob;
}

/** What the UI renders: the stored record plus a ready-to-use object URL. */
export interface CarMediaItem {
  id: string;
  carId: string;
  kind: MediaKind;
  name: string;
  type: string;
  size: number;
  /** Object URL created by useCarMedia; "" if creation failed. */
  url: string;
}

export type AddFileResult =
  | { ok: true; file: StoredMediaFile }
  | { ok: false; error: string };

/* ---------------------------------------------------------------- limits --- */

const MAX_BYTES = 300 * 1024 * 1024; // 300 MB

const VIDEO_EXTENSIONS = [
  "mp4", "mov", "m4v", "webm", "mkv", "avi", "3gp", "mpg", "mpeg", "ogv",
];

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** video/* by MIME, or a known video extension when the OS reported none. */
function looksLikeVideo(file: File): boolean {
  const t = (file.type || "").toLowerCase();
  if (t.startsWith("video/")) return true;
  return t === "" && VIDEO_EXTENSIONS.includes(extensionOf(file.name));
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

/* ---------------------------------------------------------------- the db --- */

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

/* ------------------------------------------------------------- operations --- */

/**
 * Store one uploaded file for a car. Validates size and kind first, in plain
 * words. A brochure REPLACES the car's previous uploaded brochure (one per
 * car); videos append. Resolves { ok: false, error } instead of throwing.
 */
export async function addFile(
  carId: string,
  kind: MediaKind,
  file: File
): Promise<AddFileResult> {
  if (file.size > MAX_BYTES) {
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

/** All stored files for one car. Fails soft: an unavailable DB yields []. */
export async function listFiles(carId: string): Promise<StoredMediaFile[]> {
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

/** Every stored file, all cars. Fails soft: an unavailable DB yields []. */
export async function listAllFiles(): Promise<StoredMediaFile[]> {
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

/** Delete one file by id. Fails soft: resolves either way, notifies on success. */
export async function deleteFile(id: string): Promise<void> {
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

/* ------------------------------------------------------------- the hook --- */

export interface CarMediaState {
  /** false until the first read of this browser's store has finished. */
  loaded: boolean;
  /** Uploaded videos for the car, each with a playable object URL. */
  videos: CarMediaItem[];
  /** The car's one uploaded brochure PDF, or null. */
  brochure: CarMediaItem | null;
  /** Validates + stores; returns the plain-words error on refusal. */
  add: (kind: MediaKind, file: File) => Promise<AddFileResult>;
  /** Removes one uploaded file. */
  remove: (id: string) => Promise<void>;
}

/**
 * React hook: the uploaded media of one car, kept fresh after every
 * add/delete (from ANY hook instance, via the change broadcast), with object
 * URLs created once per file id and revoked on removal and on unmount.
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

  // Object URL lifecycle: create for new ids, revoke for removed ids.
  useEffect(() => {
    const map = urlMapRef.current;
    const wanted = new Set(records.map((r) => r.id));
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
        name: r.name,
        type: r.type,
        size: r.size,
        url: urls[r.id] ?? "",
      })),
    [records, urls]
  );

  const videos = useMemo(() => items.filter((f) => f.kind === "video"), [items]);
  const brochure = useMemo(
    () => items.find((f) => f.kind === "brochure") ?? null,
    [items]
  );

  const add = useCallback(
    async (kind: MediaKind, file: File): Promise<AddFileResult> => {
      if (!carId) {
        return { ok: false, error: "No car selected." };
      }
      return addFile(carId, kind, file);
    },
    [carId]
  );

  const remove = useCallback(async (id: string): Promise<void> => {
    await deleteFile(id);
  }, []);

  return { loaded, videos, brochure, add, remove };
}
