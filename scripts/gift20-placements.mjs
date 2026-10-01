#!/usr/bin/env node
/**
 * $20 Gift Campaign — create the card placements (docs/GIFT20_CAMPAIGN_SPEC.md §6.1).
 *
 * ── WRITES PRODUCTION DATA (only with --apply) ───────────────────────────────
 * Default is a DRY RUN: reads "CampaignPlacement" and prints what would be
 * inserted. With --apply it INSERTs only the missing GIFT00–GIFT10 rows
 * (ON CONFLICT (code) DO NOTHING — idempotent, never updates or deletes an
 * existing row), then prints the after-state.
 *
 *   GIFT00      — Don's test code (scan this one, never GIFT01–10)
 *   GIFT01–10   — the ten real cards
 *
 * Also prints the QR URL for each card and a link to the branded,
 * print-ready QR PNG from /api/qr (1200px, error-correction H).
 *
 * Usage:
 *   node scripts/gift20-placements.mjs            # dry run
 *   node scripts/gift20-placements.mjs --apply    # insert missing rows
 * Requires DATABASE_URL (read from .env.local if present).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }

const APPLY = process.argv.includes('--apply');
const SITE  = 'https://www.gascap.app';
const CODES = Array.from({ length: 11 }, (_, i) => `GIFT${String(i).padStart(2, '0')}`);

const row = (code) => ({
  id:              `plc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
  code,
  campaign:        '20dollar-gift',
  station:         code === 'GIFT00' ? 'Don Parker — TEST card (do not hand out)' : 'Don Parker — personal handout',
  city:            'Orlando',
  placement:       'card',
  headlineVariant: 'GIFT20-v1',
  landingPath:     '/gift/20',
  notes:           code === 'GIFT00' ? 'Test code for QA scans. Exclude from results.' : '$20 Gift Campaign card',
  createdAt:       new Date().toISOString(),
  active:          true,
  featured:        false,   // never surface a card as an in-app Partner Station
});

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

async function existing() {
  const { rows } = await client.query(
    `SELECT code, campaign, placement, "landingPath", active FROM "CampaignPlacement" WHERE code = ANY($1) ORDER BY code`,
    [CODES],
  );
  return rows;
}

const before = await existing();
console.log(`BEFORE: ${before.length}/${CODES.length} GIFT placements exist`);
console.table(before);

const have    = new Set(before.map((r) => r.code.toUpperCase()));
const missing = CODES.filter((c) => !have.has(c));
console.log(`Missing: ${missing.length ? missing.join(', ') : 'none'}`);

if (APPLY && missing.length) {
  for (const code of missing) {
    const r = row(code);
    await client.query(
      `INSERT INTO "CampaignPlacement"
         (id, code, campaign, station, city, placement, "headlineVariant", "landingPath", notes, "createdAt", active, featured)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (code) DO NOTHING`,
      [r.id, r.code, r.campaign, r.station, r.city, r.placement, r.headlineVariant, r.landingPath, r.notes, r.createdAt, r.active, r.featured],
    );
  }
  const after = await existing();
  console.log(`AFTER: ${after.length}/${CODES.length} GIFT placements exist`);
  console.table(after);
} else if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply to insert the missing rows.');
}

console.log('\nQR targets (print the PNG link at 1200px):');
for (const code of CODES) {
  const target = `${SITE}/q/${code}`;
  console.log(`${code}  ${target}  →  ${SITE}/api/qr?size=1200&data=${encodeURIComponent(target)}`);
}

await client.end();
