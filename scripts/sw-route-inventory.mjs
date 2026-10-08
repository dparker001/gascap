#!/usr/bin/env node
/**
 * READS ONLY. Inventory of every route handler in app/ with the signals that
 * decide whether a service worker may ever cache it.
 *
 *   node scripts/sw-route-inventory.mjs            # human table
 *   node scripts/sw-route-inventory.mjs --json     # machine-readable
 *
 * Used by scripts/check-sw-auth.mjs (the built-worker security contract) so
 * that ANY route added to the app is automatically held to the NetworkOnly
 * default — nobody has to remember to add it to a list.
 *
 * Classes (heuristic, reviewed by hand in docs/SW_CACHING_POLICY.md):
 *   ADMIN      admin-only (requireAdmin / sessionHasAdminRole / ADMIN_PASSWORD)
 *   CRON       scheduled job / webhook / server-to-server (CRON_SECRET, signatures)
 *   USER       reads a session or the signed-in user's plan (getServerSession, getLivePlan…)
 *   AUTH       /api/auth/* (NextAuth + registration/verification/reset)
 *   GAS        /gas/* (location-dependent or user-specific; already NetworkOnly)
 *   PUBLIC     no session, no secret in the handler
 * "PUBLIC" does NOT mean cacheable: location-, IP-, or freshness-dependent
 * public routes must still be NetworkOnly. Cacheability is an explicit
 * allowlist in scripts/check-sw-auth.mjs and next.config.js.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.env.ROUTES_ROOT || 'app';

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/^route\.(ts|js)$/.test(name)) yield p;
  }
}

/** app/api/vehicles/[id]/route.ts -> /api/vehicles/x ; [...nextauth] -> a concrete sample segment. */
export function urlFor(file) {
  const rel = path.relative(ROOT, path.dirname(file)).split(path.sep);
  const segs = rel.filter((s) => !/^\(.+\)$/.test(s)).map((s) => {
    if (/^\[\.\.\.(.+)\]$/.test(s)) return 'session';
    if (/^\[(.+)\]$/.test(s)) return 'x';
    return s;
  });
  return '/' + segs.join('/');
}

export function methodsOf(src) {
  const m = new Set();
  for (const r of src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) m.add(r[1]);
  for (const r of src.matchAll(/export\s+(?:const|let)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) m.add(r[1]);
  for (const blk of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const r of blk[1].matchAll(/\bas\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) m.add(r[1]);
    for (const r of blk[1].matchAll(/\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b(?!\s+as)/g)) m.add(r[1]);
  }
  return [...m].sort();
}

export function signalsOf(src) {
  const has = (re) => re.test(src);
  return {
    session:  has(/getServerSession|getLivePlan|requireUser|currentUser/),
    admin:    has(/requireAdmin|sessionHasAdminRole|legacyAdminPasswordOk|ADMIN_PASSWORD|isAdmin\(/),
    cron:     has(/CRON_SECRET/),
    webhook:  has(/stripe-signature|constructEvent|webhook|WEBHOOK|x-revenuecat|REVENUECAT/i),
  };
}

export function classify(url, sig) {
  if (url.startsWith('/api/auth/')) return 'AUTH';
  if (url.startsWith('/gas/'))      return 'GAS';
  if (sig.admin)   return 'ADMIN';
  if (sig.cron || (sig.webhook && !sig.session)) return 'CRON';
  if (sig.session) return 'USER';
  return 'PUBLIC';
}

export function inventory() {
  const rows = [];
  for (const file of walk(ROOT)) {
    const src = readFileSync(file, 'utf8');
    const url = urlFor(file);
    const sig = signalsOf(src);
    rows.push({ file: file.replaceAll(path.sep, '/'), url, methods: methodsOf(src), class: classify(url, sig), signals: sig });
  }
  return rows.sort((a, b) => a.url.localeCompare(b.url));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = inventory();
  if (process.argv.includes('--json')) { console.log(JSON.stringify(rows, null, 1)); process.exit(0); }
  const byClass = {};
  for (const r of rows) (byClass[r.class] ??= []).push(r);
  console.log(`${rows.length} route handlers\n`);
  for (const [c, list] of Object.entries(byClass).sort()) {
    const gets = list.filter((r) => r.methods.includes('GET')).length;
    console.log(`${c.padEnd(7)} ${String(list.length).padStart(3)} handlers, ${String(gets).padStart(3)} export GET`);
  }
  console.log('');
  for (const r of rows) console.log(`${r.class.padEnd(7)} ${r.methods.join(',').padEnd(22)} ${r.url}`);
}
