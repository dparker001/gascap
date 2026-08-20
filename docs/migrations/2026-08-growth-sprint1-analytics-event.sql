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
--
-- FAIL-CLOSED, TRANSACTIONAL, NO "IF NOT EXISTS". The production
-- precondition this migration expects is that "AnalyticsEvent" does not
-- exist at all — this is a brand-new table, never previously created here
-- or anywhere else. Deliberately NOT using `CREATE TABLE IF NOT EXISTS` /
-- `CREATE INDEX IF NOT EXISTS`: those forms silently no-op against an
-- unexpectedly pre-existing object of the same name, which could mean this
-- migration is quietly running against a table with the wrong shape (wrong
-- columns, wrong constraints, wrong FK behavior) rather than the one
-- actually defined below — a false "success" that's worse than an honest
-- failure. Wrapped in BEGIN/COMMIT so that if ANY statement fails (the
-- table already exists, an index name collides, a constraint is rejected),
-- Postgres rolls back the whole transaction — no partial schema (e.g. the
-- table created but an index missing) is ever left behind. If this
-- transaction fails for any reason, STOP and investigate why "AnalyticsEvent"
-- already exists or why a statement was rejected, rather than re-running
-- with IF NOT EXISTS added back in to "fix" it.

BEGIN;

CREATE TABLE "AnalyticsEvent" (
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

CREATE INDEX "AnalyticsEvent_userId_idx"
  ON "AnalyticsEvent"("userId");
CREATE INDEX "AnalyticsEvent_userId_eventType_idx"
  ON "AnalyticsEvent"("userId", "eventType");
CREATE INDEX "AnalyticsEvent_eventType_createdAt_idx"
  ON "AnalyticsEvent"("eventType", "createdAt");
CREATE INDEX "AnalyticsEvent_createdAt_idx"
  ON "AnalyticsEvent"("createdAt");

COMMIT;

-- ── Verification queries — run AFTER the COMMIT above (i.e. only once the
--    transaction has actually succeeded), before any application code
--    depends on this, to confirm the migration applied as expected. If the
--    transaction rolled back, none of these will find anything — that is
--    the correct, fail-closed outcome, not a reason to retry with
--    IF NOT EXISTS added back in. ─────────────────────────────────────────

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
