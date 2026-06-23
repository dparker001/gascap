/**
 * One-off: create the Review table in Postgres without a full `prisma db push`
 * (which would drop the drifted `smartcarAddonActive` column). Idempotent — safe
 * to re-run. SQL matches prisma/schema.prisma's Review model exactly.
 */
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const sql = `
CREATE TABLE IF NOT EXISTS "Review" (
  "id"          TEXT    NOT NULL,
  "userId"      TEXT    NOT NULL,
  "userName"    TEXT    NOT NULL,
  "rating"      INTEGER NOT NULL,
  "text"        TEXT    NOT NULL,
  "vehicleName" TEXT,
  "plan"        TEXT    NOT NULL DEFAULT 'free',
  "lifetime"    BOOLEAN NOT NULL DEFAULT false,
  "approved"    BOOLEAN NOT NULL DEFAULT false,
  "createdAt"   TEXT    NOT NULL,
  "updatedAt"   TEXT    NOT NULL,
  CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Review_userId_key"  ON "Review"("userId");
CREATE INDEX        IF NOT EXISTS "Review_approved_idx" ON "Review"("approved");
`;

try {
  await pool.query(sql);
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM "Review"`);
  console.log(`✅ Review table ready. Existing rows: ${rows[0].n}`);
} catch (e) {
  console.error('❌ Failed:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
