// WRITES (schema only) + read-only verification queries.
//
// Gamification G1 (2026-10-08). Additive and idempotent (IF NOT EXISTS) — safe to
// re-run any number of times:
//   1. Creates the "GasPointLedger" table (append-only GasPoints awards).
//   2. Adds the unique idempotency index, the two lookup indexes, and a
//      FOREIGN KEY to "User"(id) ON DELETE CASCADE (skipped if already present).
// No existing table is altered or dropped, no existing row is touched, nothing is
// backfilled (existing users earn GasPoints only through the new loop), and no data
// is deleted.
//
// MUST be run BEFORE the code that references the table is deployed.
// prisma/schema.prisma's GasPointLedger model must stay in sync with this DDL.
//
// Prints before/after state. Uses `pg` directly, same pattern as
// scripts/add-fuel-price-snapshot.mjs.
//
// Usage: railway run node scripts/add-gaspoint-ledger.mjs
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

async function state(label) {
  const t = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_name = 'GasPointLedger'`);
  const idx = t.rows.length
    ? (await pool.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'GasPointLedger' ORDER BY indexname`)).rows.map((r) => r.indexname)
    : [];
  const fk = t.rows.length
    ? (await pool.query(`SELECT conname FROM pg_constraint WHERE conrelid = '"GasPointLedger"'::regclass AND contype = 'f'`)).rows.map((r) => r.conname)
    : [];
  const n = t.rows.length ? (await pool.query(`SELECT count(*)::int AS n FROM "GasPointLedger"`)).rows[0].n : null;
  const users = (await pool.query(`SELECT count(*)::int AS n FROM "User"`)).rows[0].n;
  console.log(`\n── ${label} ──`);
  console.log(`GasPointLedger table present: ${t.rows.length === 1}  (rows: ${n ?? 'n/a'})`);
  console.log(`indexes: ${idx.join(', ') || 'n/a'}`);
  console.log(`foreign keys: ${fk.join(', ') || 'n/a'}`);
  console.log(`User rows (must be unchanged): ${users}`);
  return { tablePresent: t.rows.length === 1, indexes: idx.length, fks: fk.length, users };
}

async function run() {
  try {
    const before = await state('BEFORE');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "GasPointLedger" (
        "id"             TEXT PRIMARY KEY,
        "userId"         TEXT NOT NULL,
        "action"         TEXT NOT NULL,
        "points"         INTEGER NOT NULL,
        "idempotencyKey" TEXT NOT NULL,
        "sourceRef"      TEXT,
        "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS "GasPointLedger_idempotencyKey_key" ON "GasPointLedger"("idempotencyKey")`);
    await pool.query(`CREATE INDEX IF NOT EXISTS "GasPointLedger_userId_createdAt_idx" ON "GasPointLedger"("userId", "createdAt")`);
    await pool.query(`CREATE INDEX IF NOT EXISTS "GasPointLedger_userId_action_idx" ON "GasPointLedger"("userId", "action")`);
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'GasPointLedger_userId_fkey'
        ) THEN
          ALTER TABLE "GasPointLedger"
            ADD CONSTRAINT "GasPointLedger_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$;
    `);

    const after = await state('AFTER');
    const ok = after.tablePresent && after.indexes >= 4 && after.fks === 1 && after.users === before.users;
    if (!ok) {
      console.error('\nVerification FAILED — investigate before deploying dependent code.');
      process.exitCode = 1;
    } else {
      console.log('\nVerification OK: table, unique idempotency index, 2 lookup indexes and the cascade FK present; User row count unchanged.');
    }
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
