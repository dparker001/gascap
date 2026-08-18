-- Sprint 2 hardening — additive schema changes.
-- Revised 2026-08-18 (Revision 1, independent review) — see corrections below.
--
-- NOT YET RUN AGAINST PRODUCTION. Written for review per /CLAUDE.md: never
-- blind `prisma db push`, use direct additive SQL, explain the migration
-- impact, get explicit approval before executing against production.
--
-- Every statement here is purely additive:
--   - 5 new columns on "User" (4 nullable/boolean-defaulted RevenueCat/role
--     columns, plus 1 nullable getaway-email marker added in Revision 1)
--   - 4 new tables (no existing table touched): RateLimitCounter,
--     RevenueCatWebhookEvent, AdminAuditLog, AmoeEntry
--     (Revision 1 correction: an earlier version of this file said "3 new
--     tables" — re-counted directly against prisma/schema.prisma; it's 4.
--     Per /CLAUDE.md's own standing rule: re-run the actual count, don't
--     trust a prior one, including this file's own prior count.)
-- Nothing is dropped, renamed, or backfilled with a guessed value. Rollback
-- for any single statement is `ALTER TABLE ... DROP COLUMN` / `DROP TABLE`
-- — safe because nothing else depends on these until the corresponding
-- application code (this same sprint) is deployed to read/write them.
--
-- Revision 1 correction on the "role" column below: describing this as
-- "no existing row changes value" was ambiguous and is corrected here.
-- `ADD COLUMN ... DEFAULT 'user'` DOES set a real value — `'user'` — on
-- EVERY existing row; the column did not exist before, so every row moves
-- from "no role column at all" to "role = 'user'". What's true is narrower:
-- no row's *effective application behavior* changes, because every
-- pre-migration user was already being treated as a non-admin everywhere
-- role is checked. The column addition makes that implicit state explicit
-- and queryable — it is still a real write to every row, not a no-op.

-- ── User: admin role ────────────────────────────────────────────────────────
-- Sets role='user' on every existing row (see the Revision 1 note above —
-- a real value is written, even though no row's effective behavior changes).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'user';

-- ── User: RevenueCat entitlement provenance ─────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "revenueCatActive"    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "revenueCatInterval"  TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "revenueCatProductId" TEXT;

-- ── User: durable one-time getaway-choose-email marker (Revision 1 addition) ─
-- Closes a crash-window duplicate-send risk in the RevenueCat webhook's
-- getaway fulfillment path — see app/api/native/revenuecat/route.ts's
-- maybeSendGetaway() for the atomic claim this drives.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "getawayChooseEmailSentAt" TEXT;

-- ── Postgres-backed rate limiting ───────────────────────────────────────────
-- Revision 1: "resetAt" changed from TEXT to a real timestamp — this table
-- had not been deployed to production yet, so the type change carries no
-- migration-data risk. TIMESTAMP(3) matches Prisma's default column mapping
-- for an unannotated `DateTime` field on the postgresql provider (see
-- prisma/schema.prisma's other DateTime fields — foundingMemberAt,
-- lifetimePerksUntil, OtpCode.expires — for the existing convention this
-- follows). Driven by lib/rateLimitDb.ts's atomic
-- INSERT ... ON CONFLICT ... DO UPDATE, which compares "resetAt" against
-- NOW() directly in SQL.
CREATE TABLE IF NOT EXISTS "RateLimitCounter" (
  "key"     TEXT PRIMARY KEY,
  "count"   INTEGER NOT NULL DEFAULT 0,
  "resetAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "RateLimitCounter_resetAt_idx" ON "RateLimitCounter"("resetAt");

-- ── RevenueCat webhook idempotency ──────────────────────────────────────────
-- Revision 1: added "claimToken" — the compare-and-swap ownership token that
-- makes concurrent reclaim of a failed/stale-processing row safe (a plain
-- read-then-write reclaim, which the original version of this table
-- implicitly assumed, was a genuine race between two concurrent retries).
-- See lib/revenueCatEvents.ts.
CREATE TABLE IF NOT EXISTS "RevenueCatWebhookEvent" (
  "id"          TEXT PRIMARY KEY,       -- RevenueCat's own event.id
  "eventType"   TEXT NOT NULL,
  "userId"      TEXT,
  "status"      TEXT NOT NULL DEFAULT 'received',
  "claimToken"  TEXT,
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
--     ('role','revenueCatActive','revenueCatInterval','revenueCatProductId','getawayChooseEmailSentAt');
-- SELECT count(*) FROM "User" WHERE role != 'user';        -- expect 0 immediately after
-- SELECT count(*) FROM "RevenueCatWebhookEvent";            -- expect 0
-- SELECT count(*) FROM "AdminAuditLog";                     -- expect 0
-- SELECT count(*) FROM "AmoeEntry";                         -- expect 0 (backfill is separate)
-- SELECT count(*) FROM "RateLimitCounter";                  -- expect 0

-- ── Don's admin-role backfill — SEPARATE, explicit, run only after the above
--    is confirmed applied. One row, one identity, confirmed with Don directly
--    (2026-08-18) rather than inferred. ──────────────────────────────────────
-- UPDATE "User" SET role = 'admin' WHERE email = 'dparker001@gmail.com';
-- -- Verify immediately after:
-- SELECT id, email, role FROM "User" WHERE role = 'admin';   -- expect exactly 1 row
