-- Growth Sprint 1, P0A — additive schema change: AnalyticsEvent table.
--
-- NOT YET RUN AGAINST PRODUCTION. Written for review per /CLAUDE.md: never
-- blind `prisma db push`, use direct additive SQL, explain the migration
-- impact, get explicit approval before executing against production.
--
-- This statement is purely additive: one new table, no existing table
-- touched, no existing column touched. Rollback is `DROP TABLE
-- "AnalyticsEvent"` — safe because nothing else depends on this table until
-- P0B/P0C/P0D application code (later Growth Sprint 1 work, not yet
-- authorized) is deployed to read/write it. P0A ships the table and the
-- ingest infrastructure only — no real business mutation path writes to it
-- yet.
--
-- Foreign key behavior: "userId" -> "User"."id" is ON DELETE SET NULL, not
-- CASCADE (every other User-owned table in this schema cascades). This is
-- deliberate: deleting a GasCap account must not erase historical aggregate
-- funnel/conversion data, only sever the direct user association. Confirmed
-- against prisma/schema.prisma's `AnalyticsEvent.user` relation, which is
-- the only SetNull relation in the current schema — everything else here
-- (Vehicle, Fillup, RentalSession, etc.) cascades on user delete.

CREATE TABLE IF NOT EXISTS "AnalyticsEvent" (
  "id"             TEXT      PRIMARY KEY,
  "userId"         TEXT,
  "eventType"      TEXT      NOT NULL,
  "originPlatform" TEXT      NOT NULL,
  "emitter"        TEXT      NOT NULL,
  "source"         TEXT,
  "provider"       TEXT,
  "billing"        TEXT,
  "metadata"       JSONB,
  "idempotencyKey" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "AnalyticsEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL,
  CONSTRAINT "AnalyticsEvent_idempotencyKey_key" UNIQUE ("idempotencyKey")
);

CREATE INDEX IF NOT EXISTS "AnalyticsEvent_userId_idx"
  ON "AnalyticsEvent"("userId");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_userId_eventType_idx"
  ON "AnalyticsEvent"("userId", "eventType");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_eventType_createdAt_idx"
  ON "AnalyticsEvent"("eventType", "createdAt");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_createdAt_idx"
  ON "AnalyticsEvent"("createdAt");

-- ── Verification queries — run after the above, before any application code
--    depends on this, to confirm the migration applied as expected ──────────

-- 1. Table exists:
-- SELECT table_name FROM information_schema.tables
--   WHERE table_name = 'AnalyticsEvent';

-- 2. Expected columns/types exist:
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
--   WHERE table_name = 'AnalyticsEvent'
--   ORDER BY ordinal_position;
-- Expect: id (text, NO), userId (text, YES), eventType (text, NO),
--   originPlatform (text, NO), emitter (text, NO), source (text, YES),
--   provider (text, YES), billing (text, YES), metadata (jsonb, YES),
--   idempotencyKey (text, YES), createdAt (timestamp without time zone, NO).

-- 3. Nullable userId foreign key exists, targeting User(id):
-- SELECT tc.constraint_name, kcu.column_name, ccu.table_name AS foreign_table,
--        ccu.column_name AS foreign_column
--   FROM information_schema.table_constraints tc
--   JOIN information_schema.key_column_usage kcu
--     ON tc.constraint_name = kcu.constraint_name
--   JOIN information_schema.constraint_column_usage ccu
--     ON tc.constraint_name = ccu.constraint_name
--   WHERE tc.table_name = 'AnalyticsEvent' AND tc.constraint_type = 'FOREIGN KEY';
-- Expect: AnalyticsEvent_userId_fkey | userId | User | id

-- 4. Delete behavior is ON DELETE SET NULL (not CASCADE):
-- SELECT conname, confdeltype FROM pg_constraint
--   WHERE conrelid = '"AnalyticsEvent"'::regclass AND contype = 'f';
-- Expect: confdeltype = 'n' (SET NULL). 'c' would mean CASCADE — if this
-- ever shows 'c', STOP, this is wrong, do not proceed.

-- 5. Unique idempotency constraint exists:
-- SELECT conname FROM pg_constraint
--   WHERE conrelid = '"AnalyticsEvent"'::regclass AND contype = 'u';
-- Expect: AnalyticsEvent_idempotencyKey_key

-- 6. Expected indexes exist:
-- SELECT indexname FROM pg_indexes WHERE tablename = 'AnalyticsEvent';
-- Expect: AnalyticsEvent_pkey, AnalyticsEvent_idempotencyKey_key (unique
--   constraints create their own index), AnalyticsEvent_userId_idx,
--   AnalyticsEvent_userId_eventType_idx, AnalyticsEvent_eventType_createdAt_idx,
--   AnalyticsEvent_createdAt_idx.

-- 7. Row count sanity check immediately after (expect 0 — no writer deployed yet):
-- SELECT count(*) FROM "AnalyticsEvent";
