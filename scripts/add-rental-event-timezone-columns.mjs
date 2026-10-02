// WRITES (schema only) — ONLY with --apply. Default is a DRY RUN that reads
// information_schema and prints what would be added; it never alters
// anything without the flag.
//
// Rental event-timezone model (2026-10-02, approved): six ADDITIVE,
// NULLABLE columns on "RentalSession". No defaults, no backfill, no data
// rewrite, no drop. Idempotent (ADD COLUMN IF NOT EXISTS). The legacy
// "timeZone" column is untouched.
//
// DEPLOY ORDER (mandatory): run this with --apply in production and verify
// all six columns exist BEFORE merging/deploying any code that reads them —
// Prisma selects every scalar column, so timezone-aware code against a
// database without these columns would fail every RentalSession query.
// Old code is unaffected by the extra nullable columns.
//
// Usage:
//   node scripts/add-rental-event-timezone-columns.mjs           # dry run
//   node scripts/add-rental-event-timezone-columns.mjs --apply   # writes
// Requires DATABASE_URL (railway run … in production).
import { fileURLToPath } from 'url';

export const TABLE = 'RentalSession';
export const COLUMNS = [
  { name: 'pickupTimeZone',       sqlType: 'TEXT' },
  { name: 'returnTimeZone',       sqlType: 'TEXT' },
  { name: 'pickupLatitude',       sqlType: 'DOUBLE PRECISION' },
  { name: 'pickupLongitude',      sqlType: 'DOUBLE PRECISION' },
  { name: 'pickupTimeZoneSource', sqlType: 'TEXT' },
  { name: 'returnTimeZoneSource', sqlType: 'TEXT' },
];

export function buildStatements() {
  return COLUMNS.map((c) => `ALTER TABLE "${TABLE}" ADD COLUMN IF NOT EXISTS "${c.name}" ${c.sqlType}`);
}

export const isApply = (argv) => argv.includes('--apply');

async function existing(pool) {
  const { rows } = await pool.query(
    `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_name = $1 AND column_name = ANY($2)
      ORDER BY column_name`,
    [TABLE, COLUMNS.map((c) => c.name)],
  );
  return rows;
}

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  });
  const apply = isApply(process.argv);
  try {
    const before = await existing(pool);
    console.log(`BEFORE: ${before.length}/${COLUMNS.length} event-timezone columns present`);
    console.table(before);
    const have = new Set(before.map((r) => r.column_name));
    const statements = buildStatements().filter((_, i) => !have.has(COLUMNS[i].name));
    if (!apply) {
      console.log(statements.length ? `DRY RUN — would execute:\n${statements.join(';\n')};` : 'DRY RUN — nothing to add.');
      console.log('No changes made. Re-run with --apply to write.');
      return;
    }
    for (const sql of statements) await pool.query(sql);
    const after = await existing(pool);
    console.log(`AFTER: ${after.length}/${COLUMNS.length} event-timezone columns present`);
    console.table(after);
    const bad = after.filter((r) => r.is_nullable !== 'YES' || r.column_default != null);
    if (after.length !== COLUMNS.length || bad.length) {
      console.error('VERIFICATION FAILED — do NOT merge/deploy timezone-aware code. Investigate.');
      process.exitCode = 1;
    } else {
      console.log('VERIFIED: all six columns present, nullable, no default.');
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
