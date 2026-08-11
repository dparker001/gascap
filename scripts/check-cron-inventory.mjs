#!/usr/bin/env node
/**
 * Asserts every cron route has a schedule, and every schedule points at a real
 * route.
 *
 * The win-back campaign existed for weeks — fully built, tested, with its own
 * email sequence — and simply was never added to crons.yml. Nothing failed,
 * nothing logged, it just never ran, and 29 eligible users were never
 * contacted. This is the cheapest possible guard against that.
 *
 * Deliberately a build-time script rather than part of the runtime
 * integrity-check: the deployed container has no source tree to scan.
 *
 *   node scripts/check-cron-inventory.mjs
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CRON_DIR = 'app/api/cron';
const WORKFLOW = '.github/workflows/crons.yml';

// Endpoints intentionally invoked by something other than the shared schedule.
const EXEMPT = new Set([
  'trial-conversion', // has its own date-gated workflow (trial-conversion.yml)
  'giveaway-draw',    // fires from the daily draw workflow with its own guard
  'winner-claim-check',
  'digest',           // weekly, matched separately below
]);

const routes = readdirSync(CRON_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(CRON_DIR, d.name, 'route.ts')))
  .map((d) => d.name);

const yml = readFileSync(WORKFLOW, 'utf8');
const scheduled = new Set(
  [...yml.matchAll(/endpoint=([a-z0-9-]+)/g)].map((m) => m[1]),
);

const unscheduled = routes.filter((r) => !scheduled.has(r) && !EXEMPT.has(r));
const orphaned    = [...scheduled].filter((s) => !routes.includes(s));

let failed = false;

if (unscheduled.length) {
  failed = true;
  console.error('\n✗ cron routes with no schedule in crons.yml:');
  unscheduled.forEach((r) => console.error(`    /api/cron/${r}`));
  console.error('  Add a schedule entry + case branch, or add to EXEMPT with a reason.');
}

if (orphaned.length) {
  failed = true;
  console.error('\n✗ crons.yml references routes that do not exist:');
  orphaned.forEach((r) => console.error(`    ${r}`));
}

if (failed) process.exit(1);

console.log(`✓ cron inventory: ${routes.length} routes, ${scheduled.size} scheduled, ${EXEMPT.size} exempt`);
