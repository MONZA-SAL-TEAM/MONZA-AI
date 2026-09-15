/**
 * THE INBOX'S SAVED COPY — storage. IndexedDB, in the staff member's browser.
 *
 * What is saved: the conversation list rows (name, the latest message, when,
 * which account), each account's place in paging through its history, the
 * last 20 messages of any conversation that was opened, and when each
 * conversation was last read — so a reload shows everything at once and only
 * asks Meta for what is new (the rules are in lib/inbox/sync.ts).
 *
 * ONE DATABASE PER SIGNED-IN PERSON. The name carries their staff id, so two
 * people sharing a computer never see each other's read state, and nothing is
 * ever sent to MONZA AI's servers from here.
 *
 * EVERY CALL FAILS SOFT. If the browser refuses storage (a private window, a
 * setting, a full disk), openInboxCache answers null and the inbox works
 * exactly as it did before: read from Meta on every visit.
 */

import type { Conversation, InboxMessage } from "@/lib/inbox/types";

/** Where one account stands in paging through its history. */
export interface AccountMeta {
  id: string;
  /** Meta's cursor for the next OLDER page, saved after every page. */
  backfillCursor: string | null;
  /** True once Meta has said there is nothing older. */
  complete: boolean;
  /** Meta answered this account with the lighter list; start there next time. */
  lite: boolean;
  lastSyncAt: string | null;
}

export function emptyMeta(id: string): AccountMeta {
  return { id, backfillCursor: null, complete: false, lite: false, lastSyncAt: null };
}

export interface CacheSnapshot {
  conversations: Conversation[];
  meta: Record<string, AccountMeta>;
  seen: Record<string, string>;
  baselineAt: string | null;
}

export interface InboxCache {
  load(): Promise<CacheSnapshot>;
  putConversations(list: readonly Conversation[]): Promise<void>;
  putMeta(meta: AccountMeta): Promise<void>;
  setSeen(entries: readonly (readonly [string, string])[]): Promise<void>;
  setBaseline(at: string): Promise<void>;
  getThread(id: string): Promise<InboxMessage[] | null>;
  putThread(id: string, messages: readonly InboxMessage[]): Promise<void>;
  /** Delete everything saved for this person on this computer. */
  clear(): Promise<void>;
}

const VERSION = 1;
const CONV = "conversations";
const META = "accounts";
const SEEN = "seen";
const THREADS = "threads";
const KV = "kv";

export function cacheName(viewerKey: string): string {
  return `monza-ai-inbox:${viewerKey.replace(/[^A-Za-z0-9-]/g, "").slice(0, 64) || "anon"}`;
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const EMPTY_SNAPSHOT: CacheSnapshot = { conversations: [], meta: {}, seen: {}, baselineAt: null };

export async function openInboxCache(viewerKey: string): Promise<InboxCache | null> {
  if (typeof indexedDB === "undefined") return null;
  const name = cacheName(viewerKey);

  let db: IDBDatabase;
  try {
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(name, VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains(CONV)) d.createObjectStore(CONV, { keyPath: "id" });
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META, { keyPath: "id" });
        if (!d.objectStoreNames.contains(SEEN)) d.createObjectStore(SEEN, { keyPath: "id" });
        if (!d.objectStoreNames.contains(THREADS)) d.createObjectStore(THREADS, { keyPath: "id" });
        if (!d.objectStoreNames.contains(KV)) d.createObjectStore(KV);
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error("The saved inbox is open elsewhere."));
    });
  } catch {
    return null;
  }

  async function write(store: string, fill: (s: IDBObjectStore) => void): Promise<void> {
    try {
      const tx = db.transaction(store, "readwrite");
      fill(tx.objectStore(store));
      await finished(tx);
    } catch {
      // Saving is a convenience. A refused write must never break the inbox.
    }
  }

  return {
    async load() {
      try {
        const tx = db.transaction([CONV, META, SEEN, KV], "readonly");
        const [conversations, metas, seens, baselineAt] = await Promise.all([
          request(tx.objectStore(CONV).getAll() as IDBRequest<Conversation[]>),
          request(tx.objectStore(META).getAll() as IDBRequest<AccountMeta[]>),
          request(tx.objectStore(SEEN).getAll() as IDBRequest<{ id: string; at: string }[]>),
          request(tx.objectStore(KV).get("baselineAt") as IDBRequest<string | undefined>),
        ]);
        return {
          conversations,
          meta: Object.fromEntries(metas.map((m) => [m.id, m])),
          seen: Object.fromEntries(seens.map((s) => [s.id, s.at])),
          baselineAt: typeof baselineAt === "string" ? baselineAt : null,
        };
      } catch {
        return EMPTY_SNAPSHOT;
      }
    },
    putConversations(list) {
      return write(CONV, (s) => {
        for (const c of list) s.put(c);
      });
    },
    putMeta(meta) {
      return write(META, (s) => {
        s.put(meta);
      });
    },
    setSeen(entries) {
      return write(SEEN, (s) => {
        for (const [id, at] of entries) s.put({ id, at });
      });
    },
    setBaseline(at) {
      return write(KV, (s) => {
        s.put(at, "baselineAt");
      });
    },
    async getThread(id) {
      try {
        const tx = db.transaction(THREADS, "readonly");
        const row = (await request(tx.objectStore(THREADS).get(id))) as
          | { id: string; messages: InboxMessage[] }
          | undefined;
        return row?.messages ?? null;
      } catch {
        return null;
      }
    },
    putThread(id, messages) {
      return write(THREADS, (s) => {
        s.put({ id, messages: [...messages] });
      });
    },
    async clear() {
      db.close();
      await new Promise<void>((resolve) => {
        const r = indexedDB.deleteDatabase(name);
        r.onsuccess = () => resolve();
        r.onerror = () => resolve();
        r.onblocked = () => resolve();
      });
    },
  };
}
