// WRITES (schema only) + a read-only verification query. Additive,
// idempotent (IF NOT EXISTS) columns for the 72-hour getaway verification
// hold and its durable pre-send claim marker. No existing column, row, or
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

const COLUMNS = ['getawayHoldUntil', 'getawayQualificationRevokedAt', 'getawayFulfillmentAttemptedAt'];

async function run() {
  try {
    for (const col of COLUMNS) {
      await pool.query(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "${col}" TEXT`);
    }
    console.log(`${COLUMNS.join(' / ')} columns added (or already existed).`);

    // Read-only verification — confirms all three columns actually exist
    // now, rather than trusting the ADD COLUMN calls silently succeeded.
    const { rows } = await pool.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'User'
         AND column_name = ANY($1)
       ORDER BY column_name`,
      [COLUMNS],
    );
    console.log('Verification query result:');
    console.table(rows);
    if (rows.length !== COLUMNS.length) {
      console.error(`Expected ${COLUMNS.length} columns, found ${rows.length}. Investigate before relying on this migration.`);
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
