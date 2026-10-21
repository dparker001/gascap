// WRITES (schema only) + a read-only verification query. Additive, idempotent
// (IF NOT EXISTS) columns/table for Workstream 01's first-touch web
// acquisition attribution (2026-10-12). No existing column, row, or user
// data is touched — every new column is nullable or defaulted, and the
// new table starts empty. See lib/acquisitionAttribution.ts.
//
// Adds:
//   "User"."acqSource"       TEXT    (nullable — null = no attribution captured)
//   "User"."acqCampaign"     TEXT    (nullable)
//   "User"."acqCapturedAt"   TEXT    (nullable — ISO string; also the write-once gate)
//   "User"."acqAmbiguous"    BOOLEAN NOT NULL DEFAULT false
//   "AcquisitionCampaignCode" (new table — admin-managed UTM-code registry,
//     mirrors CampaignPlacement's existing role for QR codes)
//
// NOT RUN AGAINST ANY DATABASE as part of this task — prepared only, per
// "no schema mutation authorized." Rollback script is
// scripts/rollback-acquisition-attribution-columns.mjs, sibling to this one.
//
// Usage (when authorized): railway run node scripts/add-acquisition-attribution-columns.mjs
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

async function run() {
  try {
    await pool.query(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "acqSource" TEXT`);
    await pool.query(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "acqCampaign" TEXT`);
    await pool.query(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "acqCapturedAt" TEXT`);
    await pool.query(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "acqAmbiguous" BOOLEAN NOT NULL DEFAULT false`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "AcquisitionCampaignCode" (
        "code"      TEXT PRIMARY KEY,
        "source"    TEXT NOT NULL,
        "label"     TEXT,
        "active"    BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TEXT NOT NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS "AcquisitionCampaignCode_active_idx" ON "AcquisitionCampaignCode" ("active")`);

    // Read-only verification — confirms the columns/table exist and are
    // empty/null, as expected for a freshly-applied additive migration.
    const { rows: colCheck } = await pool.query(`
      SELECT column_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'User' AND column_name LIKE 'acq%'
      ORDER BY column_name
    `);
    console.log('User.acq* columns now present:', colCheck);

    const { rows: countCheck } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM "User" WHERE "acqCapturedAt" IS NOT NULL) AS already_captured,
        (SELECT COUNT(*) FROM "AcquisitionCampaignCode")                AS registered_codes
    `);
    console.log('Expect both 0 on a fresh apply:', countCheck[0]);
  } finally {
    await pool.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
