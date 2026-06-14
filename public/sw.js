// Minimal service worker for Sonic Bloom PWA.
// - Precaches a small static shell on install.
// - Network-first for /api/* (falls back to cache only as a last resort).
// - Cache-first for everything else.
const CACHE_NAME = 'sonic-bloom-v1';
const STATIC_ASSETS = [
  '/',
  '/app',
  '/favicon.ico',
  '/manifest.webmanifest',
  '/icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => {
        // Swallow precache errors so an install never blocks activation.
      }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    // Network-first for API, fall back to cache only as a last resort.
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request).then((cached) => cached || Response.error()),
      ),
    );
    return;
  }

  // Cache-first for everything else.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request)),
  );
});
