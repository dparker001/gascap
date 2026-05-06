import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function main() {
  const { rows } = await pool.query(`
    SELECT plan, "isProTrial", "stripeSubscriptionId" IS NOT NULL as has_stripe,
      COUNT(*) as total
    FROM "User"
    WHERE plan IN ('pro','fleet') AND "isTestAccount" = false
    GROUP BY plan, "isProTrial", has_stripe
    ORDER BY plan, "isProTrial"
  `);
  console.log(JSON.stringify(rows, null, 2));
  await pool.end();
}
main().catch(console.error);
