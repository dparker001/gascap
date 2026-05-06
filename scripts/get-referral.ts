import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { Pool } from 'pg';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query(
    `SELECT name, email, "referralCode" FROM "User" WHERE name ILIKE '%ilen%' OR name ILIKE '%alin%' LIMIT 5`
  );
  console.log(JSON.stringify(rows, null, 2));
  await pool.end();
}
main().catch(console.error);
