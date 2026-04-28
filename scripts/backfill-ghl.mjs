/**
 * One-time GHL backfill — sync all existing users from Railway PostgreSQL
 * into the GasCap™ GHL sub-account as contacts.
 *
 * Run with:
 *   node scripts/backfill-ghl.mjs
 *
 * Applies the same tags as the live signup flow:
 *   gascap, gascap-lang-*, gascap-pro/free/fleet,
 *   gascap-new-signup, gascap-trial-30day, gascap-backfill
 * Plus beta-tester tag for beta users.
 * Skips test accounts (isTestAccount = true).
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env.local manually ──────────────────────────────────────────────────
const envPath = resolve(__dirname, '..', '.env.local');
const envLines = readFileSync(envPath, 'utf8').split('\n');
for (const line of envLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq < 0) continue;
  const key = trimmed.slice(0, eq).trim();
  const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
  if (!process.env[key]) process.env[key] = val;
}

// ── Config ────────────────────────────────────────────────────────────────────
const DATABASE_URL   = process.env.DATABASE_URL;
const GHL_API_KEY    = 'pit-f01cc7d6-15c0-4d22-a916-cce8457da800';
const GHL_LOCATION_ID = 'CvoeirX6lIeXP021VqmY';
const GHL_BASE       = 'https://services.leadconnectorhq.com';
const RATE_LIMIT_MS  = 250; // pause between GHL API calls

if (!DATABASE_URL) {
  console.error('❌  DATABASE_URL not found in .env.local');
  process.exit(1);
}

// ── GHL helpers ───────────────────────────────────────────────────────────────
const PLAN_TAGS = { free: 'gascap-free', pro: 'gascap-pro', fleet: 'gascap-fleet' };

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function upsertGhlContact(user) {
  const [firstName, ...rest] = (user.name ?? '').trim().split(' ');
  const lastName = rest.join(' ') || '';
  const locale   = user.locale === 'es' ? 'es' : 'en';
  const plan     = user.plan  ?? 'free';

  // ── Tags ──
  const tags = [
    'gascap',
    `gascap-lang-${locale}`,
    PLAN_TAGS[plan] ?? 'gascap-free',
    'gascap-new-signup',   // all app signups went through the signup flow
    'gascap-trial-30day',  // all signups received the 30-day Pro trial
    'gascap-backfill',     // marks retroactive sync
    ...(user.is_beta_tester ? ['gascap-beta-tester'] : []),
    ...(user.is_pro_trial   ? ['gascap-trial-active'] : []),
  ];

  // ── Custom fields ──
  const customFields = [
    { key: 'gascap_plan',   field_value: plan   },
    { key: 'gascap_locale', field_value: locale },
  ];

  const body = {
    locationId: GHL_LOCATION_ID,
    firstName,
    lastName,
    email:        user.email,
    tags,
    customFields,
    source:       'GasCap Signup',
  };

  const res = await fetch(`${GHL_BASE}/contacts/upsert`, {
    method:  'POST',
    headers: {
      Authorization: `Bearer ${GHL_API_KEY}`,
      'Content-Type': 'application/json',
      Version:        '2021-07-28',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`  ✗  ${user.email} — HTTP ${res.status}: ${err.slice(0, 120)}`);
    return false;
  }

  const data = await res.json();
  console.log(`  ✓  ${user.email} (${plan}) → GHL id: ${data.contact?.id ?? '?'}`);
  return true;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const { Pool } = pg;
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();
  let users;
  try {
    const result = await client.query(
      `SELECT id, email, name, plan, locale,
              "isBetaTester"  AS is_beta_tester,
              "isProTrial"    AS is_pro_trial,
              "isTestAccount" AS is_test_account,
              "createdAt"     AS created_at
       FROM "User"
       ORDER BY "createdAt" ASC`,
    );
    users = result.rows;
  } finally {
    client.release();
  }

  console.log(`\n📋  Found ${users.length} total users in Railway PostgreSQL\n`);

  const toSync  = users.filter((u) => !u.is_test_account);
  const skipped = users.length - toSync.length;

  if (skipped > 0) {
    console.log(`⏭   Skipping ${skipped} test account(s)\n`);
  }

  console.log(`🚀  Syncing ${toSync.length} users to GHL (${GHL_LOCATION_ID})…\n`);

  let ok = 0, fail = 0;

  for (let i = 0; i < toSync.length; i++) {
    const user = toSync[i];
    process.stdout.write(`[${i + 1}/${toSync.length}] `);
    const success = await upsertGhlContact(user);
    if (success) ok++; else fail++;
    if (i < toSync.length - 1) await sleep(RATE_LIMIT_MS);
  }

  console.log(`\n──────────────────────────────────────────`);
  console.log(`✅  Done — ${ok} synced, ${fail} failed, ${skipped} skipped`);
  if (fail > 0) console.log(`⚠️   Re-run the script to retry failures (upsert is idempotent)`);
  await pool.end();
}

run().catch((err) => {
  console.error('❌  Fatal error:', err);
  process.exit(1);
});
