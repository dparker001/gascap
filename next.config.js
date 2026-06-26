const defaultCache = require('next-pwa/cache');

// Exclude dynamic/location-based API routes from SW cache — they must always
// hit the network. The default next-pwa cache has a 10s networkTimeout that
// silently falls back to cache when it expires; for these routes there is no
// cached response, causing the client to hang forever.
//
// /gas/nearby gets a NetworkOnly entry placed FIRST so the SW never touches it.
// Without this, WKWebView's service worker intercepts the fetch and hangs
// indefinitely (the request never reaches the network) in the Capacitor shell.
const runtimeCaching = [
  {
    urlPattern: ({ url }) => url.pathname.startsWith('/gas/'),
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
          if (pathname?.startsWith('/api/nearby-gas')) return false;
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
      source:      '/((?!\\.well-known/).*)',
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

