/**
 * The service-worker SECURITY CONTRACT, as data. Shared by:
 *   - scripts/check-sw-integrity.mjs  (runs it against the BUILT public/sw.js, in CI)
 *   - __tests__/swIntegrity.test.ts   (runs it against next.config.js, and against the built file when present)
 *
 * Every expectation is an exact {handler, cache} for a (URL, request mode).
 * `handler: 'NO ROUTE'` means no Workbox route matches, so the browser handles
 * the request itself — nothing is cached and the service worker is not involved.
 *
 * Default-deny: expectations for API routes are GENERATED from the repo's actual
 * route inventory (scripts/sw-route-inventory.mjs), so a route added tomorrow is
 * held to NetworkOnly automatically.
 */
import { inventory } from './sw-route-inventory.mjs';

/** Public, user-independent, stale-safe, intentionally cached. Keep this list SHORT. */
export const PUBLIC_CACHEABLE = {
  // EIA national Regular weekly series: identical for every user, ?weeks= only, changes weekly.
  '/api/gas-price/history': { handler: 'NetworkFirst', cache: 'public-fuel-history' },
};

/** Historical explicit NetworkOnly prefixes — NetworkOnly for EVERY request mode, navigations included. */
export const ALWAYS_NETWORK_ONLY_PREFIXES = ['/gas/', '/api/vehicles', '/api/user/profile', '/api/favorites'];

/** Spelled out so a reviewer can see the headline cases without reading the generator. */
export const PROTECTED_EXAMPLES = [
  '/api/auth/session', '/api/auth/csrf', '/api/auth/providers', '/api/auth/signin', '/api/auth/signout',
  '/api/auth/callback/google', '/api/auth/callback/credentials-otp',
  '/api/auth/register', '/api/auth/forgot-password', '/api/auth/reset-password',
  '/api/auth/verify-email?token=abc', '/api/auth/resend-verification', '/api/auth/verify-password',
  '/api/fillups', '/api/fillups/savings', '/api/fillups/stations',
  '/api/admin/engagement-baseline', '/api/admin/users', '/api/admin/rental-pilot',
  '/api/activity', '/api/user/profile', '/api/user/giveaway-entries', '/api/favorites', '/api/vehicles',
  '/api/giveaway/daily-bonus', '/api/referral', '/api/rental-sessions',
  '/api/stripe/session-amount', '/api/email/unsubscribe?id=1',
  // public but location / IP / freshness dependent, or live counters -> NetworkOnly
  '/api/gas-price', '/api/gas-price/national', '/api/gas-price/pulse', '/api/electricity-price',
  '/api/user-count', '/api/stats/aggregate', '/api/founding/status', '/api/partner-stations',
  // a route that does not exist yet: default-deny must already cover it
  '/api/__a_route_added_next_year__', '/api/__new__/nested/route',
];

/** Pages / RSC payloads must never be runtime-cached (they can embed per-user server output). */
export const PAGES_NEVER_CACHED = ['/signin', '/signup', '/settings', '/admin', '/rewards', '/giveaway', '/ambassador', '/upgrade', '/help'];

/** Static assets: pinned to today's behaviour (public, user-independent). */
export const STATIC_EXPECTED = {
  '/manifest.json':                       ['NetworkFirst', 'static-data-assets'],
  '/icons/icon-192.png':                  ['StaleWhileRevalidate', 'static-image-assets'],
  '/_next/static/chunks/main.js':         ['StaleWhileRevalidate', 'static-js-assets'],
  '/_next/static/css/app.css':            ['StaleWhileRevalidate', 'static-style-assets'],
  '/_next/image?url=%2Fx.png&w=64&q=75':  ['StaleWhileRevalidate', 'next-image'],
  'https://fonts.gstatic.com/s/x.woff2':  ['CacheFirst', 'google-fonts-webfonts'],
  // cross-origin scripts are NOT cached (the old "cross-origin" default was dead code)
  'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.es6.js': ['NO ROUTE', null],
};

const NAV = 'navigate', FETCH = 'cors';
const isAlways = (u) => ALWAYS_NETWORK_ONLY_PREFIXES.some((p) => u.startsWith(p));
const pathOf = (u) => u.split('?')[0];

/** [{url, mode, handler, cache, why}] */
export function buildContract(routesRoot) {
  const out = [];
  const add = (url, mode, handler, cache, why) => out.push({ url, mode, handler, cache: cache ?? null, why });

  // 1. Generated from the route inventory: every route that can answer a GET.
  const prev = process.env.ROUTES_ROOT;
  if (routesRoot) process.env.ROUTES_ROOT = routesRoot;
  const rows = inventory().filter((r) => r.methods.includes('GET'));
  if (routesRoot) { if (prev === undefined) delete process.env.ROUTES_ROOT; else process.env.ROUTES_ROOT = prev; }

  for (const r of rows) {
    const pub = PUBLIC_CACHEABLE[pathOf(r.url)];
    if (pub) {
      for (const mode of [FETCH, NAV]) add(r.url, mode, pub.handler, pub.cache, `${r.class} public-cacheable allowlist`);
    } else if (r.url.startsWith('/api/') || r.url.startsWith('/gas/')) {
      add(r.url, FETCH, 'NetworkOnly', null, `${r.class} route: default-deny`);
      if (isAlways(r.url)) add(r.url, NAV, 'NetworkOnly', null, `${r.class} route: historical NetworkOnly prefix`);
      else if (r.url.startsWith('/api/auth/')) add(r.url, NAV, 'NO ROUTE', null, 'auth navigation: not intercepted (Safari OAuth)');
      else add(r.url, NAV, 'NO ROUTE', null, `${r.class} navigation: not intercepted`);
    } else {
      add(r.url, FETCH, 'NO ROUTE', null, `${r.class} non-API route handler: never cached`);
      add(r.url, NAV, 'NO ROUTE', null, `${r.class} non-API route handler: never cached`);
    }
  }

  // 2. Headline cases, explicit.
  for (const u of PROTECTED_EXAMPLES) {
    const p = pathOf(u);
    add(u, FETCH, 'NetworkOnly', null, 'protected example');
    if (isAlways(p)) add(u, NAV, 'NetworkOnly', null, 'protected example (historical prefix)');
    else add(u, NAV, 'NO ROUTE', null, 'protected example navigation');
  }
  for (const u of PAGES_NEVER_CACHED) {
    add(u, NAV, 'NO ROUTE', null, 'page: never runtime-cached');
    add(`${u}?_rsc=abc`, FETCH, 'NO ROUTE', null, 'RSC payload: never runtime-cached');
  }
  for (const [u, [handler, cache]] of Object.entries(STATIC_EXPECTED)) add(u, FETCH, handler, cache, 'static asset: pinned');
  for (const [u, e] of Object.entries(PUBLIC_CACHEABLE)) { add(`${u}?weeks=52`, FETCH, e.handler, e.cache, 'public allowlist with query'); }

  // 3. Existing NetworkOnly routes, every mode.
  for (const u of ['/gas/nearby', '/gas/rental-nearby', '/gas/report-price', '/api/vehicles', '/api/user/profile', '/api/favorites']) {
    add(u, FETCH, 'NetworkOnly', null, 'historical NetworkOnly');
    add(u, NAV, 'NetworkOnly', null, 'historical NetworkOnly');
  }

  // de-duplicate (same url+mode keeps the first; contradictions are a bug in the contract)
  const seen = new Map();
  for (const e of out) {
    const k = `${e.mode} ${e.url}`;
    const prior = seen.get(k);
    if (prior && (prior.handler !== e.handler || prior.cache !== e.cache)) {
      throw new Error(`contract contradicts itself for ${k}: ${prior.handler}/${prior.cache} vs ${e.handler}/${e.cache}`);
    }
    if (!prior) seen.set(k, e);
  }
  return [...seen.values()];
}

/** Handlers that may hold a response in a named cache. */
export const CACHING_HANDLERS = ['NetworkFirst', 'CacheFirst', 'StaleWhileRevalidate', 'CacheOnly'];
