// A deliberately small service worker. Its whole job is that the app opens
// instantly and doesn't die on a dropped connection — not to serve a portfolio
// from a cache, which would be showing somebody stale money.
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const OFFLINE = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.add(OFFLINE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Anything the API says is live data, and stale money is worse than no money
  if (url.pathname.startsWith('/api/')) return;

  // Next's build assets carry a content hash in the name, so a cached one can
  // never be the wrong one — serve it from disk and skip the network entirely
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(ASSETS).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      }),
    );
    return;
  }

  // Pages come from the network, so what you read is current. Offline, you get
  // a page that says so rather than the browser's dinosaur.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        // respondWith rejects on undefined, and a cache can always come up
        // empty — a plain 503 beats breaking the navigation
        const page = await caches.match(OFFLINE);
        return page ?? new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } });
      }),
    );
  }
});
