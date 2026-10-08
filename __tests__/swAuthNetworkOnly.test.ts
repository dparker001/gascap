/**
 * /api/auth/* must never be answered from a service-worker cache.
 *
 * Context (2026-10-08): during post-deploy smoke testing the browser's
 * request for exactly /api/auth/session failed, making the app look signed
 * out. The service worker was audited as a suspect. Findings that shape these
 * tests:
 *   - next-pwa 5.6.0's default "apis" entry already skips '/api/auth/' and its
 *     "others" entry skips every '/api/' path, so auth URLs matched NO runtime
 *     route. That guarantee was implicit; this makes it explicit and tested.
 *   - Auth FETCHES are now NetworkOnly. Auth NAVIGATIONS (OAuth callbacks,
 *     sign-in/out pages, emailed links) must stay un-intercepted — next-pwa
 *     keeps the SW away from them on purpose (Safari OAuth, issue #131).
 *   - Config-level behaviour is not the same as built behaviour: the "apis"
 *     wrapper closes over `origPattern`, which does not survive serialization
 *     into public/sw.js. That separate defect is deliberately NOT asserted
 *     away here; the built-artifact checks below only pin the auth contract.
 *
 * Config-level tests run in `npm test`. Built-artifact tests need a prior
 * `next build`, so they run when VERIFY_BUILT_SW=1 (CI runs the same logic via
 * scripts/check-sw-auth.mjs right after the build step).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import { existsSync, mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const root = path.resolve(__dirname, '..');
const ORIGIN = 'https://www.gascap.app';

interface Entry {
  urlPattern: RegExp | ((ctx: unknown) => boolean);
  handler: string;
  method?: string;
  options?: { cacheName?: string };
}

/** Load next.config.js with next-pwa stubbed, returning the runtimeCaching it would hand to Workbox. */
function loadRuntimeCaching(): Entry[] {
  const req = createRequire(path.join(root, 'package.json'));
  const nextPwa = req.resolve('next-pwa');
  req.cache[nextPwa] = {
    id: nextPwa, filename: nextPwa, loaded: true, children: [], paths: [], path: '',
    exports: (opts: unknown) => (cfg: object) => ({ ...cfg, __pwa: opts }),
  } as unknown as NodeJS.Module;
  const cfgPath = req.resolve('./next.config.js');
  delete req.cache[cfgPath];
  return (req('./next.config.js') as { __pwa: { runtimeCaching: Entry[] } }).__pwa.runtimeCaching;
}

/** Workbox semantics: first matching GET route wins. */
function classify(rc: Entry[], href: string, mode: 'cors' | 'navigate' = 'cors'): string {
  const url = new URL(href, ORIGIN);
  const ctx = { url, request: { url: url.href, method: 'GET', mode, destination: '' }, sameOrigin: url.origin === ORIGIN, event: {} };
  for (const e of rc) {
    if ((e.method ?? 'GET') !== 'GET') continue;
    const m = e.urlPattern;
    let ok: boolean;
    if (typeof m === 'function') ok = !!m(ctx);
    else { const r = m.exec(url.href); ok = !!r && (url.origin === ORIGIN || r.index === 0); }
    if (ok) return e.handler + (e.options?.cacheName ? `:${e.options.cacheName}` : '');
  }
  return 'NO_ROUTE';
}

let rc: Entry[];
let prevSelf: unknown;
beforeAll(() => {
  prevSelf = (globalThis as { self?: unknown }).self;
  (globalThis as { self?: unknown }).self = { origin: ORIGIN };
  rc = loadRuntimeCaching();
});
afterAll(() => { (globalThis as { self?: unknown }).self = prevSelf; });

const AUTH_PATHS = [
  '/api/auth/session', '/api/auth/session?x=1', '/api/auth/csrf', '/api/auth/providers',
  '/api/auth/signin', '/api/auth/signin/google', '/api/auth/signout', '/api/auth/error', '/api/auth/_log',
  '/api/auth/callback/google', '/api/auth/callback/credentials', '/api/auth/callback/credentials-otp',
  '/api/auth/register', '/api/auth/forgot-password', '/api/auth/reset-password',
  '/api/auth/verify-email?token=abc', '/api/auth/resend-verification', '/api/auth/verify-password',
];
const AUTH_NAV_PATHS = [
  '/api/auth/signin', '/api/auth/signin/google', '/api/auth/signout', '/api/auth/error',
  '/api/auth/callback/google', '/api/auth/callback/credentials-otp', '/api/auth/verify-email?token=abc',
];

describe('1. /api/auth/session is NetworkOnly', () => {
  it('fetch of the exact URL NextAuth polls', () => {
    expect(classify(rc, '/api/auth/session')).toBe('NetworkOnly');
  });
  it('with a query string too', () => {
    expect(classify(rc, '/api/auth/session?x=1')).toBe('NetworkOnly');
  });
});

describe('2. every other /api/auth/* fetch is NetworkOnly', () => {
  it.each(AUTH_PATHS)('%s', (p) => {
    expect(classify(rc, p, 'cors')).toBe('NetworkOnly');
  });
  it('no auth URL, in either mode, resolves to a CACHING handler', () => {
    for (const p of AUTH_PATHS) for (const mode of ['cors', 'navigate'] as const) {
      expect(classify(rc, p, mode)).not.toMatch(/NetworkFirst|CacheFirst|StaleWhileRevalidate|CacheOnly/);
    }
  });
});

describe('auth NAVIGATIONS stay un-intercepted (Safari OAuth, next-pwa #131)', () => {
  it.each(AUTH_NAV_PATHS)('%s is not handled by any route', (p) => {
    expect(classify(rc, p, 'navigate')).toBe('NO_ROUTE');
  });
});

describe('3. auth is excluded from the default "apis" cache', () => {
  const apis = () => rc.find((e) => e.options?.cacheName === 'apis')!;
  it('the apis route exists and is the cache that holds user-specific API data', () => {
    expect(apis()).toBeTruthy();
    expect(apis().handler).toBe('NetworkFirst');
  });
  it.each(AUTH_PATHS)('apis predicate rejects %s', (p) => {
    const url = new URL(p, ORIGIN);
    for (const mode of ['cors', 'navigate']) {
      expect((apis().urlPattern as (c: unknown) => boolean)({ url, request: { mode, method: 'GET' }, sameOrigin: true, event: {} })).toBe(false);
    }
  });
  it('the exclusion is an inline literal in next.config.js (Workbox serialization rule)', () => {
    const src = readFileSync(path.join(root, 'next.config.js'), 'utf8');
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n'); // the file's own warning comment names the forbidden pattern
    expect(code).toMatch(/if \(pathname\?\.startsWith\('\/api\/auth\/'\)\) return false;/);
    expect(code).toMatch(/url\.pathname\.startsWith\('\/api\/auth\/'\) && request\.mode !== 'navigate'/);
    expect(code).not.toMatch(/NETWORK_ONLY_PATHS/);
  });
});

describe('4. existing NetworkOnly routes are intact', () => {
  it.each(['/gas/nearby', '/gas/rental-nearby', '/api/vehicles', '/api/user/profile', '/api/favorites'])('%s', (p) => {
    expect(classify(rc, p)).toBe('NetworkOnly');
    expect(classify(rc, p, 'navigate')).toBe('NetworkOnly');
  });
  it('/api/nearby-gas is still excluded from the apis cache (no route)', () => {
    expect(classify(rc, '/api/nearby-gas')).toBe('NO_ROUTE');
  });
});

describe('6. no unrelated caching behaviour changed (frozen from the pre-change config)', () => {
  const FROZEN: Record<string, string> = {
    '/api/fillups': 'NetworkFirst:apis',
    '/api/fillups/savings': 'NetworkFirst:apis',
    '/api/gas-price': 'NetworkFirst:apis',
    '/api/gas-price/national?grade=regular': 'NetworkFirst:apis',
    '/api/admin/engagement-baseline': 'NetworkFirst:apis',
    '/api/activity': 'NetworkFirst:apis',
    '/api/giveaway/daily-bonus': 'NetworkFirst:apis',
    '/api/user-count': 'NetworkFirst:apis',
    '/': 'NetworkFirst:others',
    '/signin': 'NetworkFirst:others',
    '/settings': 'NetworkFirst:others',
    '/admin': 'NetworkFirst:others',
    '/manifest.json': 'NetworkFirst:static-data-assets',
    '/icons/icon-192.png': 'StaleWhileRevalidate:static-image-assets',
    '/_next/static/chunks/main.js': 'StaleWhileRevalidate:static-js-assets',
    '/_next/static/css/app.css': 'StaleWhileRevalidate:static-style-assets',
    '/_next/image?url=%2Fx.png&w=64&q=75': 'StaleWhileRevalidate:next-image',
    'https://fonts.gstatic.com/s/x.woff2': 'CacheFirst:google-fonts-webfonts',
    'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.es6.js': 'NetworkFirst:cross-origin',
  };
  it.each(Object.entries(FROZEN))('%s -> %s', (p, want) => {
    expect(classify(rc, p)).toBe(want);
  });
  it('the route list is unchanged: same 15 routes in the same order (next-pwa adds start-url at build time -> 16 in sw.js)', () => {
    expect(rc.map((e) => e.options?.cacheName ?? e.handler)).toEqual([
      'NetworkOnly', 'google-fonts-webfonts', 'google-fonts-stylesheets', 'static-font-assets', 'static-image-assets',
      'next-image', 'static-audio-assets', 'static-video-assets', 'static-js-assets', 'static-style-assets', 'next-data',
      'static-data-assets', 'apis', 'others', 'cross-origin',
    ]);
  });
});

// ── The guard script itself: it must FAIL CLOSED ─────────────────────────────
describe('scripts/check-sw-auth.mjs fails closed', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sw-guard-'));
  const run = (src: string | null) => {
    const f = path.join(dir, `sw-${Math.random().toString(36).slice(2)}.js`);
    if (src !== null) writeFileSync(f, src);
    return spawnSync(process.execPath, [path.join(root, 'scripts/check-sw-auth.mjs')], { env: { ...process.env, SW_PATH: f }, encoding: 'utf8' });
  };
  const wrap = (body: string) => `define(["./workbox-x"],function(e){${body}});`;
  const GOOD = wrap(`e.registerRoute(({url:s,request:r})=>s.pathname.startsWith("/api/auth/")&&"navigate"!==r.mode,new e.NetworkOnly,"GET");`);

  it('passes when auth fetches are NetworkOnly and navigations are untouched', () => {
    const r = run(GOOD);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/NetworkOnly/);
  });
  it('fails when auth has no NetworkOnly route', () => {
    expect(run(wrap(``)).status).toBe(1);
  });
  it('fails when a caching route would serve auth (the default-apis shape)', () => {
    const r = run(wrap(`e.registerRoute(({url:s})=>s.pathname.startsWith("/api/"),new e.NetworkFirst({cacheName:"apis"}),"GET");`));
    expect(r.status).toBe(1);
  });
  it('fails when auth navigations are intercepted (would reintroduce the Safari OAuth bug)', () => {
    const r = run(wrap(`e.registerRoute(({url:s})=>s.pathname.startsWith("/api/auth/"),new e.NetworkOnly,"GET");`));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/navigate/);
  });
  it('fails when a matcher throws (a ReferenceError from an unserialized closure)', () => {
    const r = run(wrap(`e.registerRoute(({url:s})=>notDefined(s),new e.NetworkOnly,"GET");`));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/THROWS/);
  });
  it('exits 2 (not 0) when public/sw.js does not exist', () => {
    expect(run(null).status).toBe(2);
  });
});

// ── Built artifact (needs `next build` first) ────────────────────────────────
describe.runIf(process.env.VERIFY_BUILT_SW === '1')('5. the BUILT public/sw.js', () => {
  it('exists and satisfies the auth contract', async () => {
    const swPath = path.join(root, 'public/sw.js');
    expect(existsSync(swPath)).toBe(true);
    const mod = await import(pathToFileURL(path.join(root, 'scripts/check-sw-auth.mjs')).href);
    const routes = mod.loadRoutes(readFileSync(swPath, 'utf8'));
    for (const p of mod.AUTH_FETCH_URLS) expect(mod.classify(routes, p, 'cors').handler, p).toBe('NetworkOnly');
    for (const p of mod.AUTH_NAV_URLS) expect(mod.classify(routes, p, 'navigate').handler, p).toMatch(/^NO ROUTE/);
  });
  it('contains the "/api/auth/" literal in both edited predicates', () => {
    const sw = readFileSync(path.join(root, 'public/sw.js'), 'utf8');
    expect((sw.match(/"\/api\/auth\/"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(sw).toMatch(/"navigate"!==\w+\.mode/);
  });
  it('preserves the existing NetworkOnly routes', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'scripts/check-sw-auth.mjs')).href);
    const routes = mod.loadRoutes(readFileSync(path.join(root, 'public/sw.js'), 'utf8'));
    for (const p of ['/gas/nearby', '/api/vehicles', '/api/user/profile', '/api/favorites']) {
      expect(mod.classify(routes, p, 'cors').handler, p).toBe('NetworkOnly');
    }
  });
});
