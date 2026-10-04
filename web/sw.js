// Offline support: keeps a copy of the app so it opens even without the
// Python server or an internet connection. Packing then runs in the browser
// (JavaScript engine). API calls always go to the network.
// Bump VERSION whenever the app's files change.
const VERSION = 'spa-v9';
const SHELL = [
  './',
  'css/app.css',
  'data/catalog.json',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'index.html',
  'js/account.js',
  'js/api.js',
  'js/cloud.js',
  'js/dom.js',
  'js/engine/geometry.js',
  'js/engine/glb.js',
  'js/engine/math.js',
  'js/engine/renderer.js',
  'js/i18n.js',
  'js/main.js',
  'js/models.js',
  'js/packer/engine.js',
  'js/packer/worker.js',
  'js/scene.js',
  'js/sync.js',
  'js/suitcase.js',
  'js/thumbs.js',
  'manifest.webmanifest',
  'sync.json',
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
  // 'no-cache' makes the browser ask the server rather than reuse its own copy
  // (GitHub Pages lets it keep files for 10 minutes): after an update every
  // file comes from the same version, as a mix of old and new modules breaks.
  const fresh = e.request.mode === 'navigate'
    ? fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
    : fetch(e.request, { cache: 'no-cache' });
  e.respondWith(
    fresh
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
