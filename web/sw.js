// Offline support: keeps a copy of the app so it opens even without the
// Python server or an internet connection. Packing then runs in the browser
// (JavaScript engine). API calls always go to the network.
// Bump VERSION whenever the app's files change.
const VERSION = 'spa-v4';
const SHELL = [
  './',
  'css/app.css',
  'data/catalog.json',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'index.html',
  'js/api.js',
  'js/engine/geometry.js',
  'js/engine/glb.js',
  'js/engine/math.js',
  'js/engine/renderer.js',
  'js/main.js',
  'js/models.js',
  'js/packer/engine.js',
  'js/packer/worker.js',
  'js/scene.js',
  'js/suitcase.js',
  'js/thumbs.js',
  'manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  // Network first (so updates show up straight away), cache as the fallback.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })
        .then((hit) => hit || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()))),
  );
});
