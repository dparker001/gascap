// WRITES (schema only) + a read-only verification query. Additive,
// idempotent (IF NOT EXISTS) columns for the 7-day getaway verification
// hold — see docs/reviews (getaway 7-day hold). No existing column, row, or
// entitlement data is touched. NOT run yet — awaiting approval to deploy.
//
// Uses `pg` directly, same pattern as scripts/add-getaway-fulfillment-columns.mjs.
//
// Usage: railway run node scripts/add-getaway-hold-columns.mjs
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

async function run() {
  try {
    await pool.query('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "getawayHoldUntil" TEXT');
    await pool.query('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "getawayQualificationRevokedAt" TEXT');
    console.log('getawayHoldUntil / getawayQualificationRevokedAt columns added (or already existed).');

    // Read-only verification — confirms both columns actually exist now,
    // rather than trusting the ADD COLUMN calls silently succeeded.
    const { rows } = await pool.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'User'
         AND column_name IN ('getawayHoldUntil', 'getawayQualificationRevokedAt')
       ORDER BY column_name`,
    );
    console.log('Verification query result:');
    console.table(rows);
    if (rows.length !== 2) {
      console.error(`Expected 2 columns, found ${rows.length}. Investigate before relying on this migration.`);
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
