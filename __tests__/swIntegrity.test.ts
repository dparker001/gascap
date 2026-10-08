/**
 * Service-worker integrity & privacy contract.
 *
 * Background (2026-10-08): the built public/sw.js called an undefined
 * `origPattern` (a closure in next.config.js that Workbox's Function#toString
 * serialization cannot carry). Every same-origin URL reaching that matcher threw
 * a ReferenceError and fell through to the network, which kept next-pwa's
 * default "apis" / "others" / "cross-origin" caches dead — accidentally safe.
 * Repairing the closure would have switched those caches ON for authenticated,
 * user-specific API data and pages. These tests hold the line:
 *   - no matcher throws and none depends on an outer variable;
 *   - EVERY API route (generated from the repo's route inventory) is NetworkOnly,
 *     except one explicitly documented public endpoint;
 *   - pages / RSC payloads / cross-origin requests are never runtime-cached;
 *   - auth fetches are NetworkOnly, auth navigations stay un-intercepted;
 *   - the generated worker classifies identically to the config.
 *
 * Config-level tests run in `npm test`. Built-artifact tests need `next build`
 * and run with VERIFY_BUILT_SW=1 (CI runs the same contract via
 * scripts/check-sw-integrity.mjs right after the build step).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import { existsSync, mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import vm from 'vm';
import path from 'path';
import { pathToFileURL } from 'url';

const root = path.resolve(__dirname, '..');
const ORIGIN = 'https://www.gascap.app';
const esm = (rel: string) => import(pathToFileURL(path.join(root, rel)).href);

interface Entry {
  urlPattern: RegExp | ((ctx: unknown) => boolean);
  handler: string;
  method?: string;
  options?: { cacheName?: string; [k: string]: unknown };
}

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

function classifyConfig(rc: Entry[], href: string, mode: string): { handler: string; cache: string | null } {
  const url = new URL(href, ORIGIN);
  const ctx = { url, request: { url: url.href, method: 'GET', mode, destination: '' }, sameOrigin: url.origin === ORIGIN, event: {} };
  for (const e of rc) {
    if ((e.method ?? 'GET') !== 'GET') continue;
    const m = e.urlPattern;
    let ok: boolean;
    if (typeof m === 'function') ok = !!m(ctx);
    else { const r = m.exec(url.href); ok = !!r && (url.origin === ORIGIN || r.index === 0); }
    if (ok) return { handler: e.handler, cache: e.options?.cacheName ?? null };
  }
  return { handler: 'NO ROUTE', cache: null };
}

/**
 * Render a worker the way Workbox does: each function predicate becomes its own
 * Function#toString text (so closures are lost), regexes become literals.
 */
function renderWorker(rc: Entry[]): string {
  const routes = rc.map((e) => {
    const m = typeof e.urlPattern === 'function' ? Function.prototype.toString.call(e.urlPattern) : String(e.urlPattern);
    const opts = e.options?.cacheName ? JSON.stringify({ cacheName: e.options.cacheName }) : '';
    return `e.registerRoute(${m},new e.${e.handler}(${opts}),"GET");`;
  });
  return `define(["./workbox-x"],function(e){${routes.join('')}});`;
}

let rc: Entry[];
let contract: Array<{ url: string; mode: string; handler: string; cache: string | null; why: string }>;
let inv: Array<{ url: string; methods: string[]; class: string }>;
let prevSelf: unknown;
beforeAll(async () => {
  prevSelf = (globalThis as { self?: unknown }).self;
  (globalThis as { self?: unknown }).self = { origin: ORIGIN };
  rc = loadRuntimeCaching();
  contract = (await esm('scripts/sw-contract.mjs')).buildContract();
  inv = (await esm('scripts/sw-route-inventory.mjs')).inventory();
});
afterAll(() => { (globalThis as { self?: unknown }).self = prevSelf; });

// ── inventory ────────────────────────────────────────────────────────────────
describe('route inventory (the source of the default-deny contract)', () => {
  it('finds the app\'s route handlers and classifies every one', () => {
    expect(inv.length).toBeGreaterThanOrEqual(150);
    for (const r of inv) expect(['ADMIN', 'AUTH', 'CRON', 'GAS', 'PUBLIC', 'USER']).toContain(r.class);
  });
  it('knows the private classes exist and are GET-reachable (so the contract is not vacuous)', () => {
    for (const c of ['ADMIN', 'AUTH', 'CRON', 'GAS', 'USER']) {
      expect(inv.filter((r) => r.class === c && r.methods.includes('GET')).length, c).toBeGreaterThan(0);
    }
  });
  it('the contract covers every GET-capable route', () => {
    const covered = new Set(contract.map((c) => c.url.split('?')[0]));
    for (const r of inv.filter((x) => x.methods.includes('GET'))) expect(covered.has(r.url), r.url).toBe(true);
  });
});

// ── serialization safety ─────────────────────────────────────────────────────
describe('no matcher depends on anything outside itself (Workbox serialization)', () => {
  const PROBE_URLS = ['/', '/signin', '/api/x', '/api/auth/session', '/api/gas-price/history', '/gas/x', 'https://x.example/api/y', '/_next/static/a.js'];
  const fnEntries = () => rc.filter((e) => typeof e.urlPattern === 'function');

  it('there are no function predicates other than the two explicit, self-contained ones', () => {
    expect(fnEntries()).toHaveLength(2);
  });
  it('each function predicate runs correctly when re-created in an EMPTY sandbox (the same loss Workbox causes)', () => {
    for (const e of fnEntries()) {
      const src = Function.prototype.toString.call(e.urlPattern);
      const fn = vm.runInNewContext(`(${src})`, {}) as (c: unknown) => boolean;
      for (const mode of ['cors', 'navigate']) for (const u of PROBE_URLS) {
        const url = new URL(u, ORIGIN);
        expect(() => fn({ url, request: { mode, method: 'GET' }, sameOrigin: true, event: {} }), `${u} ${mode}`).not.toThrow();
      }
    }
  });
  it('regression: the OLD wrapper shape (closing over an outer matcher) really does fail that test', () => {
    const origPattern = () => true; // eslint-disable-line @typescript-eslint/no-unused-vars
    const wrapper = (ctx: { url: URL }) => { const { pathname } = ctx.url; if (pathname.startsWith('/api/vehicles')) return false; return origPattern(); };
    const rebuilt = vm.runInNewContext(`(${wrapper.toString().replace('origPattern', 'origPattern')})`, {}) as (c: unknown) => boolean;
    expect(() => rebuilt({ url: new URL('/api/fillups', ORIGIN) })).toThrow(/origPattern/);
  });
  it('the config source has no `origPattern` and no wrapped default matcher outside comments', () => {
    const code = readFileSync(path.join(root, 'next.config.js'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/origPattern/);
    expect(code).not.toMatch(/NETWORK_ONLY_PATHS/);
  });
  it('the dead default caches are gone: no "apis", "others" or "cross-origin"', () => {
    const names = rc.map((e) => e.options?.cacheName);
    for (const n of ['apis', 'others', 'cross-origin']) expect(names).not.toContain(n);
  });
  it('route table is exactly: 1 NetworkOnly, 1 public history, 11 static-asset caches', () => {
    expect(rc.map((e) => e.options?.cacheName ?? e.handler)).toEqual([
      'NetworkOnly', 'public-fuel-history', 'google-fonts-webfonts', 'google-fonts-stylesheets', 'static-font-assets',
      'static-image-assets', 'next-image', 'static-audio-assets', 'static-video-assets', 'static-js-assets',
      'static-style-assets', 'next-data', 'static-data-assets',
    ]);
  });
});

// ── the requested named cases ────────────────────────────────────────────────
describe('named security cases (config level)', () => {
  const at = (u: string, mode = 'cors') => classifyConfig(rc, u, mode);

  it('/api/auth/session fetch -> NetworkOnly', () => { expect(at('/api/auth/session')).toEqual({ handler: 'NetworkOnly', cache: null }); });
  it('auth navigation / OAuth callback -> no route (not intercepted)', () => {
    for (const u of ['/api/auth/callback/google', '/api/auth/signin', '/api/auth/signout', '/api/auth/verify-email?token=abc', '/api/auth/error']) {
      expect(at(u, 'navigate'), u).toEqual({ handler: 'NO ROUTE', cache: null });
    }
  });
  it.each([
    '/api/fillups', '/api/fillups/savings', '/api/admin/engagement-baseline', '/api/admin/users', '/api/activity',
    '/api/user/profile', '/api/user/giveaway-entries', '/api/favorites', '/api/vehicles', '/api/giveaway/daily-bonus',
    '/api/referral', '/api/rental-sessions', '/api/stripe/session-amount',
  ])('%s -> NetworkOnly, not in any cache', (u) => {
    expect(at(u)).toEqual({ handler: 'NetworkOnly', cache: null });
  });
  it('public fuel-price endpoints: only the weekly EIA history is cached; the rest are NetworkOnly', () => {
    expect(at('/api/gas-price/history')).toEqual({ handler: 'NetworkFirst', cache: 'public-fuel-history' });
    expect(at('/api/gas-price/history?weeks=52')).toEqual({ handler: 'NetworkFirst', cache: 'public-fuel-history' });
    for (const u of ['/api/gas-price', '/api/gas-price?lat=1&lng=2', '/api/gas-price/national?grade=regular', '/api/gas-price/pulse', '/api/electricity-price']) {
      expect(at(u), u).toEqual({ handler: 'NetworkOnly', cache: null });
    }
  });
  it('a brand-new API route is private by default', () => {
    expect(at('/api/some-feature-added-next-year')).toEqual({ handler: 'NetworkOnly', cache: null });
    expect(at('/api/a/b/c/d')).toEqual({ handler: 'NetworkOnly', cache: null });
  });
  it('pages and RSC payloads are never runtime-cached', () => {
    for (const u of ['/signin', '/settings', '/admin', '/rewards']) {
      expect(at(u, 'navigate'), u).toEqual({ handler: 'NO ROUTE', cache: null });
      expect(at(`${u}?_rsc=abc`, 'cors'), `${u} rsc`).toEqual({ handler: 'NO ROUTE', cache: null });
    }
  });
  it('existing NetworkOnly routes are intact in EVERY request mode', () => {
    for (const u of ['/gas/nearby', '/gas/rental-nearby', '/gas/report-price', '/api/vehicles', '/api/user/profile', '/api/favorites']) {
      for (const m of ['cors', 'navigate']) expect(at(u, m), `${u} ${m}`).toEqual({ handler: 'NetworkOnly', cache: null });
    }
  });
  it('NO protected (non-allowlisted) API route can enter any named cache, in either mode', () => {
    for (const r of inv.filter((x) => x.methods.includes('GET') && (x.url.startsWith('/api/') || x.url.startsWith('/gas/')))) {
      if (r.url === '/api/gas-price/history') continue;
      for (const m of ['cors', 'navigate']) {
        const got = at(r.url, m);
        expect(got.cache, `${r.url} ${m}`).toBeNull();
        expect(['NetworkOnly', 'NO ROUTE'], `${r.url} ${m}`).toContain(got.handler);
      }
    }
  });
  it('every API route in the inventory is NetworkOnly for fetch() except the single allowlisted endpoint', () => {
    for (const r of inv.filter((x) => x.methods.includes('GET') && x.url.startsWith('/api/'))) {
      const got = at(r.url, 'cors');
      if (r.url === '/api/gas-price/history') expect(got.handler).toBe('NetworkFirst');
      else expect(got, r.url).toEqual({ handler: 'NetworkOnly', cache: null });
    }
  });
});

describe('the whole contract (config level)', () => {
  it(`all ${'~270'} expectations hold against next.config.js`, () => {
    const bad = contract.filter((e) => {
      const got = classifyConfig(rc, e.url, e.mode);
      return got.handler !== e.handler || got.cache !== e.cache;
    });
    expect(bad.map((e) => `${e.mode} ${e.url}`)).toEqual([]);
    expect(contract.length).toBeGreaterThan(200);
  });
});

// ── the guard script: it must FAIL CLOSED ────────────────────────────────────
describe('scripts/check-sw-integrity.mjs', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sw-guard-'));
  const run = (src: string | null) => {
    const f = path.join(dir, `sw-${Math.random().toString(36).slice(2)}.js`);
    if (src !== null) writeFileSync(f, src);
    return spawnSync(process.execPath, [path.join(root, 'scripts/check-sw-integrity.mjs')], { env: { ...process.env, SW_PATH: f }, encoding: 'utf8', timeout: 60000 });
  };
  const wrap = (body: string) => `define(["./workbox-x"],function(e){${body}});`;

  it('PASSES on a worker rendered from the real config the way Workbox serializes it', () => {
    const r = run(renderWorker(rc));
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/satisfies the contract/);
  });
  it('FAILS on a worker rendered from the OLD shape (matcher closing over origPattern)', () => {
    const base = renderWorker(rc);
    const broken = base.replace(
      'e.registerRoute(',
      'e.registerRoute(({url:s})=>{const{pathname:a}=s;return!a.startsWith("/api/vehicles")&&origPattern({url:s})},new e.NetworkFirst({cacheName:"apis"}),"GET");e.registerRoute(',
    );
    const r = run(broken);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/origPattern/);
    expect(r.stderr).toMatch(/free variable/);
  });
  it('FAILS when a matcher throws', () => {
    const r = run(wrap(`e.registerRoute(({url:s})=>{throw new Error("boom")},new e.NetworkOnly,"GET");`));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/matcher exception/);
  });
  it('FAILS on an unserialized free variable even when it never throws (typeof short-circuit)', () => {
    const r = run(wrap(`e.registerRoute(({url:s})=>typeof someOuterThing==="undefined"&&false,new e.NetworkOnly,"GET");`));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/someOuterThing/);
  });
  it('FAILS when a user-specific API route is served by NetworkFirst (the default "apis" shape)', () => {
    const r = run(wrap(`e.registerRoute(({url:s})=>s.pathname.startsWith("/api/"),new e.NetworkFirst({cacheName:"apis"}),"GET");`));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/private route reaches a cache/);
  });
  it('FAILS when CacheFirst / StaleWhileRevalidate / CacheOnly could serve a protected route', () => {
    for (const H of ['CacheFirst', 'StaleWhileRevalidate', 'CacheOnly']) {
      const r = run(wrap(`e.registerRoute(({url:s})=>s.pathname==="/api/fillups",new e.${H}({cacheName:"x"}),"GET");`));
      expect(r.status, H).toBe(1);
    }
  });
  it('FAILS when an auth fetch is not NetworkOnly (worker has only an unrelated route)', () => {
    const r = run(wrap(`e.registerRoute(/\\.png$/i,new e.CacheFirst({cacheName:"imgs"}),"GET");`));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/contract violation/);
    expect(r.stderr).toMatch(/\[cors\] \/api\/auth\/session/);
  });
  it('FAILS when auth navigations are intercepted (would reintroduce the Safari OAuth bug)', () => {
    const r = run(wrap(`e.registerRoute(({url:s})=>s.pathname.startsWith("/api/"),new e.NetworkOnly,"GET");`));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/\[navigate\] \/api\/auth\//);
  });
  it('FAILS when an existing NetworkOnly route regresses', () => {
    // everything else perfect, but /gas/ missing: render the real worker minus the first (NetworkOnly) route's /gas/ clause
    const base = renderWorker(rc).replace(`s.pathname.startsWith("/gas/")||`, '').replace(`url.pathname.startsWith('/gas/') ||`, '');
    const r = run(base.replace(/url\.pathname\.startsWith\("\/gas\/"\)\|\|/g, ''));
    expect(r.status).toBe(1);
  });
  it('exits 2 (not 0) when public/sw.js does not exist', () => { expect(run(null).status).toBe(2); });
  it('exits 2 when the worker cannot be executed in the sandbox', () => { expect(run('this is ( not javascript').status).toBe(2); });
  it('exits 2 when the worker registers no routes (refuses to certify an empty table)', () => {
    expect(run('/* nothing */').status).toBe(2);
  });
});

// ── Built artifact (needs `next build`) ──────────────────────────────────────
describe.runIf(process.env.VERIFY_BUILT_SW === '1')('the BUILT public/sw.js', () => {
  const swPath = path.join(root, 'public/sw.js');
  it('exists, executes, and passes the full contract via the CLI', () => {
    expect(existsSync(swPath)).toBe(true);
    const r = spawnSync(process.execPath, [path.join(root, 'scripts/check-sw-integrity.mjs')], { cwd: root, encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });
  it('no matcher throws, no free variable, no origPattern', async () => {
    const m = await esm('scripts/check-sw-integrity.mjs');
    const src = readFileSync(swPath, 'utf8');
    expect(src).not.toMatch(/origPattern/);
    const { routes, freeVars } = m.loadWorker(src);
    const { thrown } = m.evaluate(routes, contract);
    expect(thrown).toEqual([]);
    expect([...freeVars]).toEqual([]);
  });
  it('GENERATED worker classifies identically to next.config.js for every contract case', async () => {
    const m = await esm('scripts/check-sw-integrity.mjs');
    const { routes } = m.loadWorker(readFileSync(swPath, 'utf8'));
    const diffs = contract.filter((e) => {
      const built = m.classify(routes, e.url, e.mode);
      const cfg = classifyConfig(rc, e.url, e.mode);
      return built.handler !== cfg.handler || (built.cache ?? null) !== cfg.cache;
    });
    expect(diffs.map((e) => `${e.mode} ${e.url}`)).toEqual([]);
  });
  it('no protected endpoint enters a named cache in the built worker', async () => {
    const m = await esm('scripts/check-sw-integrity.mjs');
    const { routes } = m.loadWorker(readFileSync(swPath, 'utf8'));
    for (const r of inv.filter((x) => x.methods.includes('GET') && (x.url.startsWith('/api/') || x.url.startsWith('/gas/')) && x.url !== '/api/gas-price/history')) {
      for (const mode of ['cors', 'navigate']) expect(m.classify(routes, r.url, mode).cache, `${r.url} ${mode}`).toBeNull();
    }
  });
  it('built route table: the intended 14 routes (13 configured + next-pwa start-url), no apis/others/cross-origin', async () => {
    const m = await esm('scripts/check-sw-integrity.mjs');
    const { routes } = m.loadWorker(readFileSync(swPath, 'utf8'));
    const names = m.describeRoutes(routes).map((r: { cache: string | null; kind: string }) => r.cache ?? r.kind);
    expect(routes).toHaveLength(14);
    for (const n of ['apis', 'others', 'cross-origin']) expect(names).not.toContain(n);
    expect(names).toContain('public-fuel-history');
  });
});
