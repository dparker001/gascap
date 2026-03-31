const CACHE_NAME = 'vnetcard-studio-v1';

const PRE_CACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json'
];

const STATIC_EXTENSIONS = [
  '.html', '.css', '.js', '.json',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
  '.woff', '.woff2', '.ttf', '.eot'
];

const CDN_ORIGINS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'esm.sh'
];

// ── Install: pre-cache shell assets ──────────────────────────────────

self.addEventListener('install', (event) => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Pre-cache explicit URLs
      await cache.addAll(PRE_CACHE_URLS);

      // Discover and cache pages/*.html, js/*.js, assets/**,
      // templates/** at install time by fetching a manifest of files.
      // Since we cannot enumerate files from a service worker, the
      // PRE_CACHE_URLS list above covers the critical shell. Additional
      // static assets are cached on first fetch via the runtime handler.
    })
  );
});

// ── Activate: purge old caches ───────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Helpers ──────────────────────────────────────────────────────────

function isStaticAsset(url) {
  const pathname = url.pathname.toLowerCase();
  return STATIC_EXTENSIONS.some((ext) => pathname.endsWith(ext));
}

function isCDNRequest(url) {
  return CDN_ORIGINS.some((origin) => url.hostname.includes(origin));
}

function isNavigationRequest(request) {
  return request.mode === 'navigate';
}

// ── Fetch handler ────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // ── Navigation requests: serve cached index.html (SPA fallback) ──
  if (isNavigationRequest(event.request)) {
    event.respondWith(
      caches.match('/index.html').then((cached) =>
        cached || fetch(event.request)
      )
    );
    return;
  }

  // ── External CDN / Google Fonts: network-first, cache fallback ────
  if (isCDNRequest(url)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) =>
              cache.put(event.request, clone)
            );
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // ── Same-origin static assets: cache-first, network fallback ──────
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;

        return fetch(event.request).then((response) => {
          if (response && response.ok && isStaticAsset(url)) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) =>
              cache.put(event.request, clone)
            );
          }
          return response;
        });
      })
    );
    return;
  }
});
