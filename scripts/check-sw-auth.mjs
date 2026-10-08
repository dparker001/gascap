#!/usr/bin/env node
/**
 * READS ONLY. Verifies the BUILT service worker (public/sw.js) against real
 * URLs: executes the generated file in a sandbox with a stub Workbox that
 * records every registerRoute() call, then reports which route/strategy the
 * FIRST matching entry would apply to each URL (Workbox: first match wins).
 *
 * Why this exists: next.config.js builds the runtime-cache predicates as
 * functions that next-pwa/workbox serialize into public/sw.js. Source
 * assertions cannot prove the serialized result still says what we wrote
 * (a prior shared-array attempt silently failed to serialize), so this checks
 * the generated artifact itself.
 *
 * Contract being enforced (see the note in next.config.js):
 *   - /api/auth/* FETCH requests (NextAuth client: session, csrf, providers…) -> NetworkOnly
 *   - /api/auth/* NAVIGATIONS (OAuth callbacks, sign-in/out pages, emailed links) -> NOT
 *     intercepted by any route (next-pwa issue #131: Safari OAuth), and must not throw.
 *
 *   node scripts/check-sw-auth.mjs            # exit 1 if the contract above is violated
 *   node scripts/check-sw-auth.mjs --report   # print the table, never fail
 *   node scripts/check-sw-auth.mjs --json     # machine-readable
 */
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const SW_PATH = process.env.SW_PATH || 'public/sw.js';
const ORIGIN  = 'https://www.gascap.app';

export function loadRoutes(swSource) {
  const routes = [];
  const mk = (kind) => class { constructor(opts) { this.kind = kind; this.opts = opts ?? {}; } };
  const workbox = new Proxy({}, {
    get: (_t, name) => {
      if (name === 'registerRoute') return (matcher, handler, method) => routes.push({ matcher, handler, method: method || 'GET' });
      // Strategies and plugins are constructed with `new`; everything else (precacheAndRoute, clientsClaim, …) is a plain call.
      if (typeof name === 'string' && /^[A-Z]/.test(name)) return mk(name);
      return () => {};
    },
  });
  const self = {
    origin: ORIGIN,
    location: { href: `${ORIGIN}/sw.js`, origin: ORIGIN },
    addEventListener() {}, skipWaiting() {}, clients: { claim() {} },
    registration: {}, define: (_deps, factory) => factory(workbox),
  };
  const ctx = vm.createContext({
    self, URL, Promise, console,
    define: self.define, importScripts() {}, location: self.location,
    document: undefined,
  });
  try {
    vm.runInContext(swSource, ctx, { filename: 'sw.js', timeout: 5000 });
  } catch (e) {
    // Never echo the (huge) source; just the reason.
    throw new Error(`could not evaluate ${SW_PATH}: ${String(e && e.message).slice(0, 200)}`);
  }
  return routes;
}

/** A matcher that THROWS (e.g. a ReferenceError from a closure variable that was not serialized) is reported, not hidden. */
class MatcherError extends Error {}

function matches(route, url, mode) {
  const m = route.matcher;
  const ctx = { url, request: { url: url.href, method: 'GET', destination: '', mode }, sameOrigin: url.origin === ORIGIN, event: {} };
  if (typeof m === 'function') {
    try { return !!m(ctx); } catch (e) { throw new MatcherError(`${e.name}: ${e.message}`); }
  }
  // Regex literals created inside the vm sandbox belong to ITS realm, so instanceof RegExp is false for them.
  if (Object.prototype.toString.call(m) === '[object RegExp]') { const r = m.exec(url.href); return !!r && (url.origin === ORIGIN || r.index === 0); }
  if (typeof m === 'string') return url.origin === ORIGIN && url.pathname === m;
  return false;
}

export function classify(routes, href, mode = 'cors') {
  const url = new URL(href, ORIGIN);
  let hit;
  try {
    hit = routes.find((r) => r.method === 'GET' && matches(r, url, mode));
  } catch (e) {
    // In a real service worker an exception here aborts route matching inside the
    // fetch event handler, so the request is NOT handled by any route.
    return { handler: `THROWS (${e.message})`, cache: null };
  }
  if (!hit) return { handler: 'NO ROUTE (browser/network default)', cache: null };
  const h = hit.handler ?? {};
  return { handler: h.kind ?? 'unknown', cache: h.opts?.cacheName ?? null };
}

/** /api/auth/* URLs requested via fetch()/XHR — must be NetworkOnly. */
export const AUTH_FETCH_URLS = [
  '/api/auth/session', '/api/auth/session?x=1', '/api/auth/csrf', '/api/auth/providers',
  '/api/auth/signin', '/api/auth/signin/google', '/api/auth/signout', '/api/auth/error', '/api/auth/_log',
  '/api/auth/callback/google', '/api/auth/callback/credentials', '/api/auth/callback/credentials-otp',
  '/api/auth/register', '/api/auth/forgot-password', '/api/auth/reset-password',
  '/api/auth/verify-email?token=abc', '/api/auth/resend-verification', '/api/auth/verify-password',
];

/** /api/auth/* URLs loaded as page navigations — must stay un-intercepted (and must not throw). */
export const AUTH_NAV_URLS = [
  '/api/auth/signin', '/api/auth/signin/google', '/api/auth/signout', '/api/auth/error',
  '/api/auth/callback/google', '/api/auth/callback/credentials-otp', '/api/auth/verify-email?token=abc',
];

/** Behaviour that must NOT change (frozen from the pre-fix build). */
export const OTHER_URLS = [
  '/gas/nearby', '/gas/rental-nearby', '/api/vehicles', '/api/user/profile', '/api/favorites', '/api/nearby-gas',
  '/api/fillups', '/api/fillups/savings', '/api/gas-price', '/api/gas-price/national?grade=regular',
  '/api/admin/engagement-baseline', '/api/activity', '/api/giveaway/daily-bonus', '/api/user-count',
  '/', '/signin', '/settings', '/admin', '/manifest.json', '/icons/icon-192.png',
  '/_next/static/chunks/main.js', '/_next/static/css/app.css', '/_next/image?url=%2Fx.png&w=64&q=75',
  'https://fonts.gstatic.com/s/x.woff2', 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.es6.js',
];

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!existsSync(SW_PATH)) { console.error(`${SW_PATH} not found — run \`npm run build\` first.`); process.exit(2); }
  const routes = loadRoutes(readFileSync(SW_PATH, 'utf8'));
  const rows = (urls, mode) => urls.map((u) => ({ url: u, mode, ...classify(routes, u, mode) }));
  const authFetch = rows(AUTH_FETCH_URLS, 'cors');
  const authNav   = rows(AUTH_NAV_URLS, 'navigate');
  const other     = rows(OTHER_URLS, 'cors');
  const bad = [
    ...authFetch.filter((r) => r.handler !== 'NetworkOnly').map((r) => ({ ...r, want: 'NetworkOnly' })),
    ...authNav.filter((r) => !r.handler.startsWith('NO ROUTE')).map((r) => ({ ...r, want: 'NO ROUTE (not intercepted)' })),
  ];

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ routes: routes.length, authFetch, authNav, other }, null, 1));
  } else {
    console.log(`sw.js: ${routes.length} registered routes`);
    const pad = (s, n) => String(s).padEnd(n);
    const show = (title, list, w) => { console.log(`\n${title} —`); list.forEach((r) => console.log(`  ${pad(r.url, w)} ${pad(r.handler, 38)} ${r.cache ?? ''}`)); };
    show('/api/auth/* via fetch() (must be NetworkOnly)', authFetch, 42);
    show('/api/auth/* via navigation (must NOT be intercepted)', authNav, 42);
    show('other URLs (informational; must not change)', other, 62);
  }
  if (!process.argv.includes('--report') && bad.length) {
    console.error(`\n✗ ${bad.length} /api/auth/* case(s) violate the contract in the built service worker:`);
    bad.forEach((r) => console.error(`    [${r.mode}] ${r.url} -> ${r.handler}   (want ${r.want})`));
    process.exit(1);
  }
  if (!process.argv.includes('--report') && !process.argv.includes('--json')) {
    console.log(`\n✓ built service worker: ${authFetch.length} auth fetch URLs are NetworkOnly; ${authNav.length} auth navigations are not intercepted`);
  }
}
