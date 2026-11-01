/* Teach Assist service worker — lets the app open without a connection, so on-device AI works offline.
   • The page itself: network first (updates arrive straight away), the saved copy when offline.
   • Libraries from the CDNs (versioned URLs): cache first.
   • Everything else is left alone: the Claude/OpenAI APIs, and model downloads — the on-device
     engines keep those in their own storage (WebLLM: Cache Storage; wllama: the origin private file system). */
const CACHE = 'teach-assist-shell-v1';
const CDN = /^https:\/\/(cdnjs\.cloudflare\.com\/ajax\/libs\/(?!pdf\.js\/)|cdn\.jsdelivr\.net\/npm\/(mammoth|xlsx)@|fonts\.googleapis\.com\/css2|fonts\.gstatic\.com\/)/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('teach-assist-shell-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        if (res.ok) await c.put(url.origin + url.pathname, res.clone());
        return res;
      } catch (err) {
        const hit = await c.match(url.origin + url.pathname);
        if (hit) return hit;
        // Any saved copy of the app (index.html and teach-assist.html are the same page).
        for (const k of await c.keys()) if (new URL(k.url).origin === url.origin) return c.match(k);
        throw err;
      }
    })());
    return;
  }
  if (CDN.test(req.url)) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone()).catch(() => {});
      return res;
    })());
  }
});
