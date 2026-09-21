/*
 * MONZA AI's service worker — deliberately the smallest one that is useful.
 *
 * THE RULE: nothing from MONZA AI is ever cached. No page, no API answer, no chat, no customer
 * record, no file. Every request goes to the network exactly as it does in a browser tab. A cached
 * inbox on a lost or shared phone would be a copy of customers' conversations that signing out could
 * not reach — so the only thing kept on the device is ONE static page with no data in it
 * (/offline.html, and the icon it shows), used when there is no connection.
 *
 * The policy is lib/pwa.ts `workerHandles`, tested in tests/pwa.test.ts, which also reads THIS file
 * and fails if it ever starts caching anything else.
 *
 * It also shows NOTIFICATIONS when the app is closed (the second half of this file) — and keeps
 * nothing there either: the one line it shows is asked for, shown, and gone.
 */

const OFFLINE_CACHE = "monza-ai-offline-v1";
const OFFLINE_FILES = ["/offline.html", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then((cache) => cache.addAll(OFFLINE_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  // Remove every cache that is not the offline page's — including anything an older worker kept.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== OFFLINE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const sameOrigin = new URL(request.url).origin === self.location.origin;

  // Only a PAGE navigation is looked at, and only to show the offline page if the network is down.
  // Everything else — every API call, every file, every other origin — is not touched at all.
  if (!(sameOrigin && request.method === "GET" && request.mode === "navigate")) return;

  event.respondWith(
    fetch(request).catch(async () => {
      const cache = await caches.open(OFFLINE_CACHE);
      return (await cache.match("/offline.html")) || Response.error();
    })
  );
});

/*
 * NOTIFICATIONS WHEN THE APP IS CLOSED (lib/push/webpush.ts).
 *
 * The push that wakes this worker carries NOTHING. The worker asks Monza AI what happened — one line:
 * who wrote and where, never what they wrote — and shows it. The answer is never kept: it is asked
 * with `cache: "no-store"` and goes straight into the notification. If the question cannot be asked
 * (no connection) the notification says only "New activity". A notification is ALWAYS shown: a phone
 * that is woken silently a few times withdraws the permission (Safari and Chrome both).
 */
const PUSH_NOTE_URL = "/api/push/latest";
const GENERIC_NOTE = { title: "Monza AI", body: "New activity — open Monza AI to see it.", url: "/inbox", tag: "monza-ai" };

// A tap may only ever open Monza AI itself.
function safeNoteUrl(url) {
  return typeof url === "string" && /^\/(?!\/)[A-Za-z0-9/_?=&%.~-]*$/.test(url) ? url : "/inbox";
}

async function whatHappened() {
  try {
    const sub = await self.registration.pushManager.getSubscription();
    const res = await fetch(PUSH_NOTE_URL, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub ? sub.endpoint : null }),
    });
    if (!res.ok) return GENERIC_NOTE;
    const note = await res.json();
    if (!note || typeof note.title !== "string" || typeof note.body !== "string") return GENERIC_NOTE;
    return { title: note.title.slice(0, 120), body: note.body.slice(0, 240), url: safeNoteUrl(note.url), tag: typeof note.tag === "string" ? note.tag.slice(0, 64) : GENERIC_NOTE.tag };
  } catch (e) {
    return GENERIC_NOTE;
  }
}

self.addEventListener("push", (event) => {
  event.waitUntil(
    whatHappened().then((note) =>
      self.registration.showNotification(note.title, {
        body: note.body,
        tag: note.tag,
        renotify: true,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        data: { url: note.url },
      })
    )
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safeNoteUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      // The app is already open somewhere: bring it forward and take it to the chat.
      for (const w of windows) {
        if (new URL(w.url).origin !== self.location.origin) continue;
        try {
          await w.focus();
          if ("navigate" in w) await w.navigate(url);
          return;
        } catch (e) {
          /* fall through: open a new window */
        }
      }
      await self.clients.openWindow(url);
    })
  );
});

// The browser replaced this device's push address (it does, rarely): the next time the app is opened
// signed in, the notification switch registers the new one (components/PushToggle.tsx).
