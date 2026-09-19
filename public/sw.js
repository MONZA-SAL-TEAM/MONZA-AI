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
