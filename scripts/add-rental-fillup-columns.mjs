// WRITES (schema only) + a read-only verification query. Additive, idempotent
// (IF NOT EXISTS) columns/indexes for the Phase 3A rental canonical Fillup
// architecture (2026-08-25). No existing column, row, or entitlement data is
// touched — no historical RentalSession.refuelLogs data is read or migrated
// by this script (that's a separate, later Phase 3B decision).
//
// Adds to "Fillup":
//   rentalSessionId TEXT
//   fillupType      TEXT   ('trip' | 'final_return', validated in app code)
//   filledAt        TEXT   (full ISO transaction timestamp)
//   stationLat      DOUBLE PRECISION
//   stationLng      DOUBLE PRECISION
//   clientRefuelId  TEXT   (idempotency key for rental refuel submissions)
//
// Indexes:
//   Fillup_rentalSessionId_idx            — plain index, query performance.
//   Fillup_clientRefuelId_key             — unique, nullable-safe (Postgres
//                                            treats multiple NULLs as distinct).
//   Fillup_one_final_return_per_rental    — PARTIAL unique index enforcing at
//                                            most one fillupType='final_return'
//                                            row per rentalSessionId. Prisma's
//                                            schema syntax cannot express a
//                                            partial/filtered unique
//                                            constraint, so this exists ONLY
//                                            here in raw SQL — prisma/schema.prisma
//                                            documents this gap in a comment
//                                            on the Fillup model. Application
//                                            code (lib/rentalFillups.ts) also
//                                            pre-checks for a friendly error
//                                            message, but this index is the
//                                            actual concurrency-safe guarantee.
//
// Uses `pg` directly, same pattern as scripts/add-rental-reminder-columns.mjs.
//
// Usage: railway run node scripts/add-rental-fillup-columns.mjs
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

const TEXT_COLUMNS = ['rentalSessionId', 'fillupType', 'filledAt', 'clientRefuelId'];
const FLOAT_COLUMNS = ['stationLat', 'stationLng'];

async function run() {
  try {
    for (const col of TEXT_COLUMNS) {
      await pool.query(`ALTER TABLE "Fillup" ADD COLUMN IF NOT EXISTS "${col}" TEXT`);
    }
    for (const col of FLOAT_COLUMNS) {
      await pool.query(`ALTER TABLE "Fillup" ADD COLUMN IF NOT EXISTS "${col}" DOUBLE PRECISION`);
    }
    console.log(`${[...TEXT_COLUMNS, ...FLOAT_COLUMNS].join(' / ')} columns added to "Fillup" (or already existed).`);

    await pool.query(`CREATE INDEX IF NOT EXISTS "Fillup_rentalSessionId_idx" ON "Fillup"("rentalSessionId")`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS "Fillup_clientRefuelId_key" ON "Fillup"("clientRefuelId")`);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "Fillup_one_final_return_per_rental"
      ON "Fillup"("rentalSessionId")
      WHERE "fillupType" = 'final_return'
    `);
    console.log('Indexes created (or already existed).');

    const { rows: columnRows } = await pool.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'Fillup'
         AND column_name = ANY($1)
       ORDER BY column_name`,
      [[...TEXT_COLUMNS, ...FLOAT_COLUMNS]],
    );
    console.log('Column verification:');
    console.table(columnRows);
    if (columnRows.length !== TEXT_COLUMNS.length + FLOAT_COLUMNS.length) {
      console.error(`Expected ${TEXT_COLUMNS.length + FLOAT_COLUMNS.length} columns, found ${columnRows.length}. Investigate before relying on this migration.`);
      process.exitCode = 1;
    }

    const { rows: indexRows } = await pool.query(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE tablename = 'Fillup'
         AND indexname = ANY($1)
       ORDER BY indexname`,
      [['Fillup_rentalSessionId_idx', 'Fillup_clientRefuelId_key', 'Fillup_one_final_return_per_rental']],
    );
    console.log('Index verification:');
    console.table(indexRows);
    if (indexRows.length !== 3) {
      console.error(`Expected 3 indexes, found ${indexRows.length}. Investigate before relying on this migration.`);
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
