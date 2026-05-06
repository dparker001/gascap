import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function main() {
  const { rows } = await pool.query(`
    SELECT plan, "stripeInterval",
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE "engagementStep" IS NOT NULL) as enrolled,
      COUNT(*) FILTER (WHERE "engagementStep" IS NULL) as not_enrolled
    FROM "User"
    WHERE plan IN ('pro','fleet') AND "isTestAccount" = false AND "emailOptOut" = false
    GROUP BY plan, "stripeInterval"
    ORDER BY plan
  `);
  console.log(JSON.stringify(rows, null, 2));
  await pool.end();
}
main().catch(console.error);
