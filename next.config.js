const defaultCache = require('next-pwa/cache');

// Exclude dynamic/location-based API routes from SW cache — they must always
// hit the network. The default next-pwa cache has a 10s networkTimeout that
// silently falls back to cache when it expires; for these routes there is no
// cached response, causing the client to hang forever.
//
// /gas/nearby gets a NetworkOnly entry placed FIRST so the SW never touches it.
// Without this, WKWebView's service worker intercepts the fetch and hangs
// indefinitely (the request never reaches the network) in the Capacitor shell.
//
// 2026-08-25 post-release audit — /api/vehicles hit the SAME class of bug:
// on a slower native connection, the default "apis" cache's 10s
// networkTimeout could silently serve a STALE cached vehicle list (missing a
// just-saved fuelGaugeStyle change) instead of waiting for the fresh
// network response, which is why the gauge style appeared to "not update" in
// the native app specifically — the same web code runs there, but native
// requests are more likely to cross that 10s threshold than a fast local/
// wifi web session. No native rebuild is required: this is the hosted
// service worker the native shell loads, same as the /gas/nearby fix below.
//
// Phase 4B (2026-08-26) — /api/user/profile now also serves the global
// fuel-gauge-style preference (same "changing it should show up immediately
// on native/PWA" requirement), so it gets the identical NetworkOnly
// treatment preemptively rather than waiting to reproduce the same bug a
// third time.
//
// 2026-09-30 — /api/favorites now resolves saved stations' CURRENT prices
// live on every GET. Served from the "apis" cache it could hand back an old
// favorites list (old prices) on a slow native connection — exactly the bug
// the live lookup exists to fix — so it is NetworkOnly too.
//
// 2026-10-08 — SERVICE-WORKER INTEGRITY (replaces the per-path exclusion list).
//
// What was wrong. The previous config wrapped next-pwa's default "apis" entry
// in a predicate that closed over `origPattern`. That closure is NOT carried
// into the generated public/sw.js (Workbox serializes a predicate with
// Function#toString), so the built worker called an undefined `origPattern`:
// every same-origin URL that reached it threw a ReferenceError, Workbox's
// router has no try/catch, and the request silently fell through to the
// network. The three default caches behind it — "apis" (NetworkFirst, 10 s
// timeout, stale fallback for 24 h), "others" (the same, for pages) and
// "cross-origin" — therefore never ran. That was accidentally SAFE.
//
// Do NOT "repair" that by making origPattern serialize. Doing so would turn
// those caches on for authenticated, user-specific data (/api/fillups,
// /api/admin/*, /api/activity, …) and for authenticated PAGES / RSC payloads:
// stale data, and another user's data on a shared browser.
//
// Policy now (docs/SW_CACHING_POLICY.md). Default-deny, no closures:
//   1. EVERY same-origin /api/* request made via fetch()/XHR is NetworkOnly.
//      New routes are therefore private-by-default; nobody has to remember
//      to add them. /gas/* and the four historical paths below are NetworkOnly
//      for ALL request modes (unchanged).
//   2. /api/* NAVIGATIONS are not intercepted (OAuth callbacks, sign-in/out,
//      emailed verify/unsubscribe links, file downloads). next-pwa keeps the SW
//      away from /api/auth/ on purpose — Safari's OAuth flow breaks otherwise
//      (next-pwa issue #131). Not intercepted = identical to today.
//   3. The ONLY cached API endpoint is /api/gas-price/history: the EIA national
//      Regular weekly series, public, identical for every user, parameterised
//      only by ?weeks=, changing weekly. Stale-safe. Everything else — including
//      the other public fuel-price routes (location/IP/freshness dependent) —
//      is NetworkOnly: correctness over hit rate.
//   4. The default "apis", "others" and "cross-origin" entries are REMOVED (they
//      were already dead). Pages, RSC payloads and cross-origin requests go
//      straight to the network, exactly as they effectively did before.
//   5. Static-asset caches (fonts, images, js, css, audio/video, next-data,
//      static data) are the next-pwa defaults, untouched.
//
// Enforced against the BUILT worker, not just this file: scripts/check-sw-integrity.mjs
// (`npm run check:sw`, run in CI after `next build`) fails if any matcher throws,
// any free variable is left unserialized, or any private route could reach a cache.
//
// IMPORTANT: urlPattern predicates below use INLINE STRING LITERALS, not a
// shared array constant — a prior attempt to reference an outer-scope
// NETWORK_ONLY_PATHS array here did not survive next-pwa/workbox-webpack-
// plugin's serialization of the compiled predicate into public/sw.js
// (verified by inspecting the built file directly). The same applies to ANY
// outer variable or helper: predicates must be fully self-contained. Any
// future addition here must follow the same inline-literal pattern.
const runtimeCaching = [
  {
    urlPattern: ({ url, request }) =>
      url.pathname.startsWith('/gas/') ||
      url.pathname.startsWith('/api/vehicles') ||
      url.pathname.startsWith('/api/user/profile') ||
      url.pathname.startsWith('/api/favorites') ||
      (url.pathname.startsWith('/api/') &&
        request.mode !== 'navigate' &&
        url.pathname !== '/api/gas-price/history'),
    handler: 'NetworkOnly',
  },
  {
    urlPattern: ({ url }) => url.pathname === '/api/gas-price/history',
    handler: 'NetworkFirst',
    options: {
      cacheName: 'public-fuel-history',
      networkTimeoutSeconds: 10,
      expiration: { maxEntries: 8, maxAgeSeconds: 24 * 60 * 60 },
    },
  },
  // next-pwa defaults for static assets only. "apis", "others" and
  // "cross-origin" are the three entries whose predicates are functions and
  // whose scope is private/authenticated traffic — see the policy above.
  ...defaultCache.filter(
    (entry) => !['apis', 'others', 'cross-origin'].includes(entry.options?.cacheName),
  ),
];

const withPWA = require('next-pwa')({
  dest:            'public',
  register:        true,
  skipWaiting:     true,
  disable:         process.env.NODE_ENV === 'development',
  runtimeCaching,
  customWorkerDir: 'worker',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Railway injects PORT; tell Next.js to bind to it
  env: {
    PORT: process.env.PORT ?? '3000',
    NEXT_PUBLIC_GA_MEASUREMENT_ID: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || 'G-2RN8CFQFPB',
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'api.qrserver.com',
        pathname: '/v1/create-qr-code/**',
      },
    ],
  },
  // Serve the Android TWA Digital Asset Links at the well-known path (a leading-
  // dot folder can't be a Next route, so rewrite to an API route that reads env).
  rewrites: async () => [
    { source: '/.well-known/assetlinks.json', destination: '/api/assetlinks' },
    { source: '/.well-known/apple-app-site-association', destination: '/api/apple-app-site-association' },
  ],
  // Canonical redirect: gascap.app → www.gascap.app (apex sub-routes return 404 without this)
  // /.well-known/* is excluded so Apple (AASA) and Google (assetlinks) can fetch
  // those files directly from the apex domain without following a redirect.
  redirects: async () => [
    {
      source:      '/:path((?!\\.well-known/).*)',
      has:         [{ type: 'host', value: 'gascap.app' }],
      destination: 'https://www.gascap.app/:path*',
      permanent:   true,
    },
  ],

  headers: async () => [
    {
      // Prevent Railway Hikari (and any CDN) from caching HTML pages.
      // Without this, s-maxage=31536000 is applied and redeployments serve
      // stale HTML → stale JS bundle hashes → users see old code for up to a year.
      source: '/((?!_next/static|_next/image|favicon|icons|manifest).*)',
      headers: [
        { key: 'Cache-Control', value: 'no-store, must-revalidate' },
      ],
    },
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options',           value: 'DENY' },
        { key: 'X-Content-Type-Options',    value: 'nosniff' },
        { key: 'X-DNS-Prefetch-Control',    value: 'on' },
        { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        { key: 'Permissions-Policy',        value: 'microphone=()' },
      ],
    },
  ],
};

module.exports = withPWA(nextConfig);

