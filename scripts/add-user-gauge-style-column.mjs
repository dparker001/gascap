// WRITES (schema only) + a read-only verification query. Additive, idempotent
// (IF NOT EXISTS) column for Phase 4B — the global fuel-gauge style default
// (2026-08-26). No existing column, row, or fuel data is touched. Display
// preference only — see lib/gaugeStyles.ts. Distinct script from the
// historical Phase 4 migration (scripts/add-gauge-style-columns.mjs), which
// is left unmodified.
//
// Adds:
//   "User".fuelGaugeStyle TEXT (nullable — null = no explicit global
//                                preference, resolves to analog_needle)
//
// Uses `pg` directly, same pattern as scripts/add-gauge-style-columns.mjs.
//
// Usage: railway run node scripts/add-user-gauge-style-column.mjs
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

async function run() {
  try {
    await pool.query(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fuelGaugeStyle" TEXT`);
    console.log('fuelGaugeStyle column added to "User" (or already existed).');

    const { rows } = await pool.query(
      `SELECT table_name, column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'User' AND column_name = 'fuelGaugeStyle'`,
    );
    console.log('Verification query result:');
    console.table(rows);
    if (rows.length !== 1) {
      console.error(`Expected 1 row, found ${rows.length}. Investigate before relying on this migration.`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
