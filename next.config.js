const withPWA = require('next-pwa')({
  dest:            'public',
  register:        true,
  skipWaiting:     true,
  disable:         process.env.NODE_ENV === 'development',
  runtimeCaching:  require('next-pwa/cache'),
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
  // Canonical redirect: gascap.app → www.gascap.app (apex sub-routes return 404 without this)
  redirects: async () => [
    {
      source:      '/:path*',
      has:         [{ type: 'host', value: 'gascap.app' }],
      destination: 'https://www.gascap.app/:path*',
      permanent:   true,
    },
  ],

  headers: async () => [
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

