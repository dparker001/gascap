-- Sprint 2 hardening — additive schema changes.
--
-- NOT YET RUN AGAINST PRODUCTION. Written for review per /CLAUDE.md: never
-- blind `prisma db push`, use direct additive SQL, explain the migration
-- impact, get explicit approval before executing against production.
--
-- Every statement here is purely additive:
--   - 4 new nullable/defaulted columns on "User" (no existing row changes value)
--   - 3 new tables (no existing table touched)
-- Nothing is dropped, renamed, or backfilled with a guessed value. Rollback
-- for any single statement is `ALTER TABLE ... DROP COLUMN` / `DROP TABLE`
-- — safe because nothing else depends on these until the corresponding
-- application code (this same sprint) is deployed to read/write them.

-- ── User: admin role ────────────────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'user';

-- ── User: RevenueCat entitlement provenance ─────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "revenueCatActive"    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "revenueCatInterval"  TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "revenueCatProductId" TEXT;

-- ── RevenueCat webhook idempotency ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "RevenueCatWebhookEvent" (
  "id"          TEXT PRIMARY KEY,       -- RevenueCat's own event.id
  "eventType"   TEXT NOT NULL,
  "userId"      TEXT,
  "status"      TEXT NOT NULL DEFAULT 'received',
  "receivedAt"  TEXT NOT NULL,
  "processedAt" TEXT,
  "error"       TEXT
);
CREATE INDEX IF NOT EXISTS "RevenueCatWebhookEvent_userId_idx" ON "RevenueCatWebhookEvent"("userId");

-- ── Admin audit log ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AdminAuditLog" (
  "id"          TEXT PRIMARY KEY,
  "actorUserId" TEXT NOT NULL,
  "action"      TEXT NOT NULL,
  "targetType"  TEXT,
  "targetId"    TEXT,
  "metadata"    JSONB,
  "success"     BOOLEAN NOT NULL,
  "createdAt"   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "AdminAuditLog_actorUserId_idx" ON "AdminAuditLog"("actorUserId");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_createdAt_idx"   ON "AdminAuditLog"("createdAt");

-- ── AMOE entries (migration target — data/amoe-entries.json stays authoritative
--    until backfill is verified; see docs/migrations/2026-08-sprint2-amoe-backfill.md) ──
CREATE TABLE IF NOT EXISTS "AmoeEntry" (
  "id"          TEXT PRIMARY KEY,
  "firstName"   TEXT NOT NULL,
  "lastName"    TEXT NOT NULL,
  "email"       TEXT NOT NULL,
  "month"       TEXT NOT NULL,
  "submittedAt" TEXT NOT NULL,
  CONSTRAINT "AmoeEntry_email_month_key" UNIQUE ("email", "month")
);
CREATE INDEX IF NOT EXISTS "AmoeEntry_month_idx" ON "AmoeEntry"("month");

-- ── Verification queries — run after the above, before any application code
--    depends on these, to confirm the migration applied as expected ──────────
-- SELECT column_name, data_type, column_default FROM information_schema.columns
--   WHERE table_name = 'User' AND column_name IN
--     ('role','revenueCatActive','revenueCatInterval','revenueCatProductId');
-- SELECT count(*) FROM "User" WHERE role != 'user';        -- expect 0 immediately after
-- SELECT count(*) FROM "RevenueCatWebhookEvent";            -- expect 0
-- SELECT count(*) FROM "AdminAuditLog";                     -- expect 0
-- SELECT count(*) FROM "AmoeEntry";                         -- expect 0 (backfill is separate)

-- ── Don's admin-role backfill — SEPARATE, explicit, run only after the above
--    is confirmed applied. One row, one identity, confirmed with Don directly
--    (2026-08-18) rather than inferred. ──────────────────────────────────────
-- UPDATE "User" SET role = 'admin' WHERE email = 'dparker001@gmail.com';
-- -- Verify immediately after:
-- SELECT id, email, role FROM "User" WHERE role = 'admin';   -- expect exactly 1 row
