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
// 2026-10-08 — /api/auth/* (NextAuth session/csrf/providers/signin/signout,
// callbacks, and our custom verify/reset routes) must NEVER be answered from a
// cache. Today nothing caches them: next-pwa's default "apis" entry skips
// '/api/auth/' and its "others" entry skips every '/api/' path, so these URLs
// match no runtime route at all. That is by design in next-pwa (issue #131:
// Safari's OAuth flow breaks if the SW intercepts the callback navigation), but
// it is an implicit guarantee that a next-pwa upgrade or a future edit to the
// predicates below could silently change. So it is made explicit:
//   - non-navigation requests (the fetches NextAuth's client makes for
//     session/csrf/providers) are NetworkOnly — never a cached response, no
//     10 s timeout fallback;
//   - navigations (OAuth callbacks, sign-in/out pages, emailed verify/reset
//     links) are still NOT intercepted, exactly as before, to keep the Safari
//     OAuth behaviour next-pwa protects;
//   - '/api/auth/' is also excluded in the "apis" wrapper below.
// Verified against the BUILT worker with scripts/check-sw-auth.mjs (CI runs it
// after `next build`).
//
// KNOWN, SEPARATE DEFECT (not changed here): the "apis" wrapper below closes
// over `origPattern`, and that closure does NOT survive serialization into
// public/sw.js — the built predicate calls an undefined `origPattern`, so for
// any URL that reaches it (all same-origin /api/* except the exclusions, and
// pages) it throws a ReferenceError and Workbox falls through to the network.
// See the PR that introduced this note.
//
// IMPORTANT: urlPattern predicates below use INLINE STRING LITERALS, not a
// shared array constant — a prior attempt to reference an outer-scope
// NETWORK_ONLY_PATHS array here did not survive next-pwa/workbox-webpack-
// plugin's serialization of the compiled predicate into public/sw.js
// (verified by inspecting the built file directly). Any future addition
// here must follow the same inline-literal pattern.
const runtimeCaching = [
  {
    urlPattern: ({ url, request }) =>
      url.pathname.startsWith('/gas/') ||
      url.pathname.startsWith('/api/vehicles') ||
      url.pathname.startsWith('/api/user/profile') ||
      url.pathname.startsWith('/api/favorites') ||
      (url.pathname.startsWith('/api/auth/') && request.mode !== 'navigate'),
    handler: 'NetworkOnly',
  },
  ...defaultCache.map((entry) => {
    if (
      entry.options?.cacheName === 'apis' &&
      typeof entry.urlPattern === 'function'
    ) {
      const origPattern = entry.urlPattern;
      return {
        ...entry,
        urlPattern: (ctx) => {
          const { pathname } = ctx.url ?? {};
          if (pathname?.startsWith('/api/auth/')) return false;
          if (pathname?.startsWith('/api/nearby-gas')) return false;
          if (pathname?.startsWith('/api/vehicles')) return false;
          if (pathname?.startsWith('/api/user/profile')) return false;
          if (pathname?.startsWith('/api/favorites')) return false;
          return origPattern(ctx);
        },
      };
    }
    return entry;
  }),
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

