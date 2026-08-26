// WRITES (schema only) + a read-only verification query. Additive, idempotent
// (IF NOT EXISTS) new table for Phase 5C — the CampaignCommunication ledger
// (2026-08-26). No existing table, column, or row is touched. See
// prisma/schema.prisma's CampaignCommunication model — this script's DDL
// must stay in sync with that.
//
// Supersedes lib/emailLog.ts's hasEmailBeenSent() as the Feedback Campaign
// dedup gate (it has no campaignId column and no unique constraint — see
// the Phase 5C correctness audit for why that was insufficient). EmailLog
// itself is untouched.
//
// Uses `pg` directly, same pattern as scripts/add-feedback-campaign-tables.mjs.
//
// Usage: railway run node scripts/add-campaign-communication-table.mjs
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

async function run() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "CampaignCommunication" (
        "id"                TEXT PRIMARY KEY,
        "campaignId"        TEXT NOT NULL REFERENCES "Campaign"("id") ON DELETE CASCADE,
        "userId"            TEXT REFERENCES "User"("id") ON DELETE SET NULL,
        "kind"              TEXT NOT NULL,
        "state"             TEXT NOT NULL DEFAULT 'claimed',
        "attemptedAt"       TIMESTAMP(3) NOT NULL DEFAULT now(),
        "sentAt"            TIMESTAMP(3),
        "providerMessageId" TEXT,
        "lastError"         TEXT,
        "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT now(),
        "updatedAt"         TIMESTAMP(3) NOT NULL
      )
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS "CampaignCommunication_campaignId_userId_kind_key" ON "CampaignCommunication"("campaignId", "userId", "kind")`);
    await pool.query(`CREATE INDEX IF NOT EXISTS "CampaignCommunication_campaignId_kind_state_idx" ON "CampaignCommunication"("campaignId", "kind", "state")`);
    await pool.query(`CREATE INDEX IF NOT EXISTS "CampaignCommunication_userId_idx" ON "CampaignCommunication"("userId")`);

    console.log('CampaignCommunication table created (or already existed).');

    const { rows } = await pool.query(`
      SELECT table_name FROM information_schema.tables WHERE table_name = 'CampaignCommunication'
    `);
    console.log('Verification query result:');
    console.table(rows);
    if (rows.length !== 1) {
      console.error(`Expected 1 table, found ${rows.length}. Investigate before relying on this migration.`);
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
