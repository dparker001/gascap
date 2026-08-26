// WRITES (schema only) + a read-only verification query. Additive, idempotent
// (IF NOT EXISTS) new tables for Phase 5A — Feedback Campaign foundation
// (2026-08-26). No existing table, column, or row is touched. See
// prisma/schema.prisma's Campaign/CampaignParticipation/FeedbackResponse/
// DrawingEntry models — this script's DDL must stay in sync with those.
//
// Deliberately separate from the existing GiveawayDraw/monthly-drawing
// tables — see the schema comment above the Campaign model for why.
//
// Uses `pg` directly, same pattern as scripts/add-gauge-style-columns.mjs.
//
// Usage: railway run node scripts/add-feedback-campaign-tables.mjs
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

async function run() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "Campaign" (
        "id"        TEXT PRIMARY KEY,
        "key"       TEXT NOT NULL,
        "name"      TEXT NOT NULL,
        "startsAt"  TIMESTAMP(3) NOT NULL,
        "endsAt"    TIMESTAMP(3),
        "drawingAt" TIMESTAMP(3),
        "timezone"  TEXT NOT NULL DEFAULT 'America/New_York',
        "config"    JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP(3) NOT NULL
      )
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS "Campaign_key_key" ON "Campaign"("key")`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "CampaignParticipation" (
        "id"                       TEXT PRIMARY KEY,
        "campaignId"               TEXT NOT NULL REFERENCES "Campaign"("id") ON DELETE CASCADE,
        "userId"                   TEXT REFERENCES "User"("id") ON DELETE SET NULL,
        "eligibleAt"               TIMESTAMP(3),
        "inviteShownAt"            TIMESTAMP(3),
        "inviteSentAt"             TIMESTAMP(3),
        "pushSentAt"               TIMESTAMP(3),
        "openedAt"                 TIMESTAMP(3),
        "startedAt"                TIMESTAMP(3),
        "submittedAt"              TIMESTAMP(3),
        "drawingEntryGrantedAt"    TIMESTAMP(3),
        "lifetimeOfferShownAt"     TIMESTAMP(3),
        "lifetimeOfferExpiresAt"   TIMESTAMP(3),
        "lifetimeOfferConvertedAt" TIMESTAMP(3),
        "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT now(),
        "updatedAt"                TIMESTAMP(3) NOT NULL
      )
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS "CampaignParticipation_campaignId_userId_key" ON "CampaignParticipation"("campaignId", "userId")`);
    await pool.query(`CREATE INDEX IF NOT EXISTS "CampaignParticipation_userId_idx" ON "CampaignParticipation"("userId")`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "FeedbackResponse" (
        "id"                  TEXT PRIMARY KEY,
        "campaignId"          TEXT NOT NULL REFERENCES "Campaign"("id") ON DELETE CASCADE,
        "userId"              TEXT REFERENCES "User"("id") ON DELETE SET NULL,
        "overallSatisfaction" INTEGER NOT NULL,
        "primaryFeature"      TEXT NOT NULL,
        "likes"               TEXT NOT NULL,
        "frustrations"        TEXT NOT NULL,
        "hadIssue"            BOOLEAN NOT NULL,
        "issueDescription"    TEXT,
        "improvementRequest"  TEXT NOT NULL,
        "featureRequest"      TEXT NOT NULL,
        "pmfResponse"         TEXT NOT NULL,
        "rentalEaseScore"     INTEGER,
        "rentalHelpfulness"   TEXT,
        "rentalImprovement"   TEXT,
        "platform"            TEXT,
        "appVersion"          TEXT,
        "submittedAt"         TIMESTAMP(3) NOT NULL DEFAULT now(),
        "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT now(),
        "updatedAt"           TIMESTAMP(3) NOT NULL
      )
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS "FeedbackResponse_campaignId_userId_key" ON "FeedbackResponse"("campaignId", "userId")`);
    await pool.query(`CREATE INDEX IF NOT EXISTS "FeedbackResponse_userId_idx" ON "FeedbackResponse"("userId")`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "DrawingEntry" (
        "id"         TEXT PRIMARY KEY,
        "campaignId" TEXT NOT NULL REFERENCES "Campaign"("id") ON DELETE CASCADE,
        "userId"     TEXT REFERENCES "User"("id") ON DELETE SET NULL,
        "kind"       TEXT NOT NULL,
        "source"     TEXT,
        "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS "DrawingEntry_campaignId_userId_key" ON "DrawingEntry"("campaignId", "userId")`);
    await pool.query(`CREATE INDEX IF NOT EXISTS "DrawingEntry_userId_idx" ON "DrawingEntry"("userId")`);
    await pool.query(`CREATE INDEX IF NOT EXISTS "DrawingEntry_kind_idx" ON "DrawingEntry"("kind")`);

    console.log('Feedback Campaign tables created (or already existed): Campaign, CampaignParticipation, FeedbackResponse, DrawingEntry.');

    const { rows } = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('Campaign', 'CampaignParticipation', 'FeedbackResponse', 'DrawingEntry')
      ORDER BY table_name
    `);
    console.log('Verification query result:');
    console.table(rows);
    if (rows.length !== 4) {
      console.error(`Expected 4 tables, found ${rows.length}. Investigate before relying on this migration.`);
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
