// WRITES (schema only) + read-only verification queries.
//
// Phase 0.5B (2026-10-07). Additive and idempotent (IF NOT EXISTS) — safe to
// re-run any number of times:
//   1. Creates the "FuelPriceSnapshot" table (+ unique + lookup index).
//   2. Adds four NULLABLE columns to "Fillup": baselinePrice, baselineSource,
//      baselineArea, baselinePeriod.
// No existing table is dropped or altered destructively, no existing row is
// modified (new columns default to NULL), no data is deleted. Nothing is
// backfilled here — price history comes from the cron route
// (/api/cron/fuel-price-snapshot?weeks=156), which is read-only against EIA
// and insert-only against this table.
//
// MUST be run BEFORE the code that references these objects is deployed.
// prisma/schema.prisma's FuelPriceSnapshot model and the Fillup baseline
// columns must stay in sync with this DDL.
//
// Prints before/after state. Uses `pg` directly, same pattern as
// scripts/add-campaign-communication-table.mjs.
//
// Usage: railway run node scripts/add-fuel-price-snapshot.mjs
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

const FILLUP_COLUMNS = ['baselinePrice', 'baselineSource', 'baselineArea', 'baselinePeriod'];

async function state(label) {
  const t = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_name = 'FuelPriceSnapshot'`,
  );
  const c = await pool.query(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_name = 'Fillup' AND column_name = ANY($1) ORDER BY column_name`,
    [FILLUP_COLUMNS],
  );
  const n = t.rows.length
    ? (await pool.query(`SELECT count(*)::int AS n FROM "FuelPriceSnapshot"`)).rows[0].n
    : null;
  const f = (await pool.query(`SELECT count(*)::int AS n FROM "Fillup"`)).rows[0].n;
  console.log(`\n── ${label} ──`);
  console.log(`FuelPriceSnapshot table present: ${t.rows.length === 1}  (rows: ${n ?? 'n/a'})`);
  console.log(`Fillup rows (must be unchanged): ${f}`);
  console.log('Fillup baseline columns present:');
  console.table(c.rows);
  return { tablePresent: t.rows.length === 1, fillupCols: c.rows.length, fillupRows: f };
}

async function run() {
  try {
    const before = await state('BEFORE');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "FuelPriceSnapshot" (
        "id"         TEXT PRIMARY KEY,
        "source"     TEXT NOT NULL,
        "duoarea"    TEXT NOT NULL,
        "product"    TEXT NOT NULL,
        "grade"      TEXT NOT NULL,
        "observedOn" TEXT NOT NULL,
        "price"      DOUBLE PRECISION NOT NULL,
        "fetchedAt"  TIMESTAMP(3) NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS "FuelPriceSnapshot_source_duoarea_product_observedOn_key" ON "FuelPriceSnapshot"("source", "duoarea", "product", "observedOn")`);
    await pool.query(`CREATE INDEX IF NOT EXISTS "FuelPriceSnapshot_duoarea_grade_observedOn_idx" ON "FuelPriceSnapshot"("duoarea", "grade", "observedOn")`);

    await pool.query(`ALTER TABLE "Fillup" ADD COLUMN IF NOT EXISTS "baselinePrice"  DOUBLE PRECISION`);
    await pool.query(`ALTER TABLE "Fillup" ADD COLUMN IF NOT EXISTS "baselineSource" TEXT`);
    await pool.query(`ALTER TABLE "Fillup" ADD COLUMN IF NOT EXISTS "baselineArea"   TEXT`);
    await pool.query(`ALTER TABLE "Fillup" ADD COLUMN IF NOT EXISTS "baselinePeriod" TEXT`);

    const after = await state('AFTER');

    const ok =
      after.tablePresent &&
      after.fillupCols === FILLUP_COLUMNS.length &&
      after.fillupRows === before.fillupRows;
    if (!ok) {
      console.error('\nVerification FAILED — investigate before deploying dependent code.');
      process.exitCode = 1;
    } else {
      console.log('\nVerification OK: table + 4 nullable Fillup columns present; Fillup row count unchanged.');
    }
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
