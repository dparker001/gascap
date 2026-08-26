// WRITES (schema only) + a read-only verification query. Additive, idempotent
// (IF NOT EXISTS) columns for Phase 4 fuel-gauge VISUAL styles (2026-08-25).
// No existing column, row, or fuel data is touched — this is a display
// preference only (see lib/gaugeStyles.ts). No index needed — neither
// column is ever queried/filtered on.
//
// Adds:
//   "Vehicle".fuelGaugeStyle       TEXT (nullable — null = GasCap default)
//   "RentalSession".fuelGaugeStyle TEXT (nullable — null = fall back to the
//                                        linked Vehicle's style, then default)
//
// Uses `pg` directly, same pattern as scripts/add-rental-fillup-columns.mjs.
//
// Usage: railway run node scripts/add-gauge-style-columns.mjs
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

async function run() {
  try {
    await pool.query(`ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "fuelGaugeStyle" TEXT`);
    await pool.query(`ALTER TABLE "RentalSession" ADD COLUMN IF NOT EXISTS "fuelGaugeStyle" TEXT`);
    console.log('fuelGaugeStyle columns added to "Vehicle" and "RentalSession" (or already existed).');

    const { rows } = await pool.query(
      `SELECT table_name, column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name IN ('Vehicle', 'RentalSession')
         AND column_name = 'fuelGaugeStyle'
       ORDER BY table_name`,
    );
    console.log('Verification query result:');
    console.table(rows);
    if (rows.length !== 2) {
      console.error(`Expected 2 rows (one per table), found ${rows.length}. Investigate before relying on this migration.`);
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
