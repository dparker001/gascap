import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function main() {
  const { rows } = await pool.query(`
    SELECT name, email, plan, "isProTrial",
      "stripeCustomerId" IS NOT NULL      as has_customer,
      "stripeSubscriptionId" IS NOT NULL  as has_subscription,
      "stripeCustomerId",
      "stripeSubscriptionId",
      "stripeInterval"
    FROM "User"
    WHERE name IN ('Tatiana Arceneaux','Cameron Shaw','Matthew Carty')
    ORDER BY name
  `);
  console.log(JSON.stringify(rows, null, 2));
  await pool.end();
}
main().catch(console.error);
