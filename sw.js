const CACHE = 'sa-surf-v17';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './spots.json',
  './tides_bom.json',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Network-first for API calls
  if (url.hostname.endsWith('open-meteo.com')) {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request);
        return res;
      } catch {
        const cached = await caches.match(e.request);
        return cached || Response.error();
      }
    })());
    return;
  }

  // Network-first for HTML navigations (avoid sticky old UI on iOS)
  const accept = e.request.headers.get('accept') || '';
  if (e.request.mode === 'navigate' || accept.includes('text/html')) {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request);
        // Update cache with latest shell
        const c = await caches.open(CACHE);
        c.put(e.request, res.clone()).catch(()=>{});
        return res;
      } catch {
        const cached = await caches.match(e.request);
        return cached || Response.error();
      }
    })());
    return;
  }

  // Cache-first for local static assets
  e.respondWith((async () => {
    const cached = await caches.match(e.request);
    return cached || fetch(e.request);
  })());
});
