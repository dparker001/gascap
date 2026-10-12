// WRITES (schema only, destructive) — rollback for
// scripts/add-acquisition-attribution-columns.mjs. Drops the 4 User
// columns and the AcquisitionCampaignCode table this migration added.
//
// DESTRUCTIVE: any captured attribution data (acqSource/acqCampaign/
// acqCapturedAt/acqAmbiguous values, and every row in
// AcquisitionCampaignCode) is permanently lost. This is acceptable ONLY
// because this data is a reporting signal, never an entitlement or
// financial record (see lib/acquisitionAttribution.ts's module header) —
// do not run this once real attribution data exists unless that data is
// genuinely disposable at the time.
//
// Prints before-state counts before dropping anything, so a rollback run
// leaves a record of what was lost, even though it cannot be recovered
// after the fact (per CLAUDE.md: a destructive script must print
// before/after state).
//
// NOT RUN AGAINST ANY DATABASE as part of this task.
//
// Usage (when authorized): railway run node scripts/rollback-acquisition-attribution-columns.mjs
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

async function run() {
  try {
    const { rows: before } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM "User" WHERE "acqCapturedAt" IS NOT NULL) AS captured_rows_about_to_be_lost,
        (SELECT COUNT(*) FROM "AcquisitionCampaignCode")                AS registered_codes_about_to_be_lost
    `);
    console.log('BEFORE (about to be permanently dropped):', before[0]);

    await pool.query(`DROP TABLE IF EXISTS "AcquisitionCampaignCode"`);
    await pool.query(`ALTER TABLE "User" DROP COLUMN IF EXISTS "acqSource"`);
    await pool.query(`ALTER TABLE "User" DROP COLUMN IF EXISTS "acqCampaign"`);
    await pool.query(`ALTER TABLE "User" DROP COLUMN IF EXISTS "acqCapturedAt"`);
    await pool.query(`ALTER TABLE "User" DROP COLUMN IF EXISTS "acqAmbiguous"`);

    const { rows: after } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'User' AND column_name LIKE 'acq%'
    `);
    console.log('AFTER — remaining acq* columns (expect none):', after);
  } finally {
    await pool.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
