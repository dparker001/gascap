// WRITES (schema only) + a read-only verification query. Additive,
// idempotent (IF NOT EXISTS) columns for the getaway fulfillment state
// machine — see docs/reviews/2026-08-24-getaway-fulfillment-idempotency.md.
// No existing column, row, or entitlement data is touched.
//
// Uses `pg` directly rather than the Prisma client — this repo's Prisma 7
// client (lib/prisma.ts) is a driver-adapter setup over `./generated/prisma`
// with its own singleton/pooling concerns; for a two-statement additive
// migration, a direct `pg` connection (same connection string, same
// production SSL handling as lib/prisma.ts) is simpler and avoids pulling
// in unrelated Prisma runtime configuration for a script that doesn't need
// the ORM layer at all.
//
// Usage: railway run node scripts/add-getaway-fulfillment-columns.mjs
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

async function run() {
  try {
    await pool.query('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "getawayFulfillmentStatus" TEXT');
    await pool.query('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "getawayFulfilledAt" TEXT');
    console.log('getawayFulfillmentStatus / getawayFulfilledAt columns added (or already existed).');

    // Read-only verification — confirms both columns actually exist now,
    // rather than trusting the ADD COLUMN calls silently succeeded.
    const { rows } = await pool.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'User'
         AND column_name IN ('getawayFulfillmentStatus', 'getawayFulfilledAt')
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
