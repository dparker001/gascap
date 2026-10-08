#!/usr/bin/env node
/**
 * READS ONLY. Verifies the BUILT service worker (public/sw.js) against the
 * security contract in scripts/sw-contract.mjs. Fails closed.
 *
 * Why the BUILT file: next.config.js builds runtime-cache predicates as
 * functions that next-pwa/workbox serialize with Function#toString. Anything a
 * predicate closed over (an outer array, a wrapped default matcher) is simply
 * absent in sw.js. A previous config shipped exactly that: the built worker
 * called an undefined `origPattern` and threw on every URL that reached it.
 * Source-level assertions cannot see that; executing the artifact can.
 *
 * It FAILS (exit 1) if any of:
 *   1. a registered matcher throws for any probed URL/mode;
 *   2. any free (unserialized) variable is referenced by the worker, or the
 *      literal `origPattern` is present;
 *   3. a private/user-specific route could reach NetworkFirst / CacheFirst /
 *      StaleWhileRevalidate / CacheOnly, or any named cache;
 *   4. an auth fetch is not NetworkOnly;
 *   5. an auth navigation is intercepted (Safari OAuth);
 *   6. an explicitly NetworkOnly route regresses;
 *   7. any other contract expectation (public allowlist, pages, static) differs.
 * Exit 2 if the worker cannot be located or executed safely in the sandbox.
 *
 *   node scripts/check-sw-integrity.mjs            # contract check
 *   node scripts/check-sw-integrity.mjs --routes   # also print the registered route table
 *   node scripts/check-sw-integrity.mjs --json     # machine-readable
 */
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { buildContract, CACHING_HANDLERS } from './sw-contract.mjs';

const SW_PATH = process.env.SW_PATH || 'public/sw.js';
const ORIGIN  = 'https://www.gascap.app';

/** Names the generated worker may legitimately reference from outside its own code. */
const GLOBALS = new Set(['self', 'define', 'importScripts', 'location', 'URL', 'Promise', 'console', 'document']);

class SandboxError extends Error {}

export function loadWorker(swSource) {
  const routes = [];
  const freeVars = new Set();
  const mk = (kind) => class { constructor(opts) { this.kind = kind; this.opts = opts ?? {}; } };
  const workbox = new Proxy({}, {
    get: (_t, name) => {
      if (name === 'registerRoute') return (matcher, handler, method) => routes.push({ matcher, handler, method: method || 'GET' });
      if (typeof name === 'string' && /^[A-Z]/.test(name)) return mk(name);
      return () => {};
    },
  });
  const self = {
    origin: ORIGIN, location: { href: `${ORIGIN}/sw.js`, origin: ORIGIN },
    addEventListener() {}, skipWaiting() {}, clients: { claim() {} }, registration: {},
    define: (_deps, factory) => factory(workbox),
  };
  // Every identifier the worker cannot resolve inside its OWN scopes reaches this
  // `with` scope. Known globals fall through to the sandbox; anything else is a
  // free variable that did not survive serialization — record it.
  const scope = new Proxy(Object.create(null), {
    has: (_t, k) => typeof k === 'string' && !GLOBALS.has(k),
    get: (_t, k) => { if (typeof k === 'string') freeVars.add(k); return undefined; },
  });
  const ctx = vm.createContext({
    self, URL, Promise, console, document: undefined,
    define: self.define, importScripts() {}, location: self.location, __scope: scope,
  });
  try {
    vm.runInContext(`with (__scope) {\n${swSource}\n}`, ctx, { filename: 'sw.js', timeout: 5000 });
  } catch (e) {
    throw new SandboxError(`could not execute ${SW_PATH} in the sandbox: ${String(e && e.message).slice(0, 200)}`);
  }
  if (routes.length === 0) throw new SandboxError('the worker registered no routes — refusing to certify an empty route table');
  return { routes, freeVars };
}

class MatcherError extends Error {}

function matches(route, url, mode) {
  const m = route.matcher;
  const ctx = { url, request: { url: url.href, method: 'GET', destination: '', mode }, sameOrigin: url.origin === ORIGIN, event: {} };
  if (typeof m === 'function') {
    try { return !!m(ctx); } catch (e) { throw new MatcherError(`${e.name}: ${e.message}`); }
  }
  // Regex literals created in the sandbox belong to ITS realm, so instanceof RegExp is false for them.
  if (Object.prototype.toString.call(m) === '[object RegExp]') {
    const r = m.exec(url.href);
    return !!r && (url.origin === ORIGIN || r.index === 0);
  }
  if (typeof m === 'string') return url.origin === ORIGIN && url.pathname === m;
  return false;
}

/** Workbox semantics: first matching GET route wins. A throwing matcher aborts matching. */
export function classify(routes, href, mode = 'cors') {
  const url = new URL(href, ORIGIN);
  let hit;
  try { hit = routes.find((r) => r.method === 'GET' && matches(r, url, mode)); }
  catch (e) { return { handler: `THROWS (${e.message})`, cache: null, threw: true }; }
  if (!hit) return { handler: 'NO ROUTE', cache: null };
  const h = hit.handler ?? {};
  return { handler: h.kind ?? 'unknown', cache: h.opts?.cacheName ?? null };
}

export function describeRoutes(routes) {
  return routes.map((r, i) => {
    const m = r.matcher;
    const isRe = Object.prototype.toString.call(m) === '[object RegExp]';
    const src = typeof m === 'function' ? Function.prototype.toString.call(m).replace(/\s+/g, ' ').slice(0, 150) : String(m);
    return { i, kind: r.handler?.kind ?? '?', cache: r.handler?.opts?.cacheName ?? null, matcher: isRe ? `regex ${src}` : typeof m === 'function' ? `fn ${src}` : `string ${src}` };
  });
}

/** Extra shapes probed ONLY so every matcher branch executes (free-variable detection). */
const PROBES = [
  '/', '/signin', '/anything', '/api/', '/api/x', '/api/a/b/c', '/gas/x', '/q/abc', '/_next/static/x.js', '/x.png',
  'https://other.example/api/fillups', 'https://fonts.googleapis.com/css', 'http://localhost:3000/api/auth/session',
];

export function evaluate(routes, contract) {
  const violations = [];
  for (const e of contract) {
    const got = classify(routes, e.url, e.mode);
    const gotCache = got.cache ?? null;
    if (got.handler !== e.handler || gotCache !== e.cache) {
      violations.push({ ...e, got: `${got.handler}${gotCache ? ':' + gotCache : ''}` });
    }
    // Belt and braces for rule 3, independent of the exact-match table above:
    // anything contracted as NetworkOnly / NO ROUTE must never reach a cache.
    if ((e.handler === 'NetworkOnly' || e.handler === 'NO ROUTE') && (CACHING_HANDLERS.includes(got.handler) || gotCache)) {
      violations.push({ ...e, got: `${got.handler}:${gotCache} (private route reaches a cache)`, rule: 'private-in-cache' });
    }
  }
  const thrown = [];
  for (const u of [...PROBES, ...contract.map((c) => c.url)]) for (const mode of ['cors', 'navigate']) {
    const got = classify(routes, u, mode);
    if (got.threw) thrown.push({ url: u, mode, got: got.handler });
  }
  return { violations, thrown };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!existsSync(SW_PATH)) { console.error(`${SW_PATH} not found — run \`npm run build\` first.`); process.exit(2); }
  const src = readFileSync(SW_PATH, 'utf8');
  let worker;
  try { worker = loadWorker(src); } catch (e) { console.error(`✗ ${e.message}`); process.exit(2); }
  const { routes, freeVars } = worker;
  const contract = buildContract();
  const { violations, thrown } = evaluate(routes, contract);
  const hasOrigPattern = /origPattern/.test(src);
  // Probe once more with the contract URLs so every branch ran before reading freeVars.
  const free = [...freeVars].sort();

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ routes: describeRoutes(routes), expectations: contract.length, violations, thrown, freeVars: free, hasOrigPattern }, null, 1));
  } else {
    console.log(`sw.js: ${routes.length} registered routes, ${contract.length} contract expectations`);
    if (process.argv.includes('--routes')) {
      console.log('\nregistered routes (first match wins):');
      for (const r of describeRoutes(routes)) console.log(`  ${String(r.i + 1).padStart(2)}. ${r.kind.padEnd(22)} ${String(r.cache ?? '').padEnd(24)} ${r.matcher}`);
      const by = {};
      for (const e of contract) { const k = `${e.handler}${e.cache ? ':' + e.cache : ''}`; by[k] = (by[k] ?? 0) + 1; }
      console.log('\ncontract by resolved strategy:'); for (const [k, n] of Object.entries(by).sort()) console.log(`  ${String(n).padStart(4)}  ${k}`);
    }
  }

  const problems = [];
  if (thrown.length) problems.push(`${thrown.length} matcher exception(s), e.g. [${thrown[0].mode}] ${thrown[0].url} -> ${thrown[0].got}`);
  if (free.length) problems.push(`unserialized free variable(s) referenced by the worker: ${free.join(', ')}`);
  if (hasOrigPattern) problems.push('the literal `origPattern` is present in the built worker');
  if (violations.length) problems.push(`${violations.length} contract violation(s)`);

  if (problems.length) {
    console.error(`\n✗ built service worker FAILS the security contract:`);
    problems.forEach((p) => console.error(`  - ${p}`));
    violations.slice(0, 25).forEach((v) => console.error(`    [${v.mode}] ${v.url}\n        want ${v.handler}${v.cache ? ':' + v.cache : ''}   got ${v.got}   (${v.why})`));
    if (violations.length > 25) console.error(`    … and ${violations.length - 25} more`);
    process.exit(1);
  }
  if (!process.argv.includes('--json')) {
    console.log(`\n✓ built service worker satisfies the contract: no matcher throws, no free variables, ${contract.length}/${contract.length} expectations hold`);
  }
}
