import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function main() {
  const now = new Date().toISOString();
  const { rows } = await pool.query(`
    SELECT id, name, email, "betaProExpiry", "emailCampaignStep",
      CASE WHEN "betaProExpiry" < $1 THEN 'EXPIRED' ELSE 'ACTIVE' END as status,
      ROUND(EXTRACT(EPOCH FROM ("betaProExpiry"::timestamptz - NOW())) / 86400) as days_remaining
    FROM "User"
    WHERE "isProTrial" = true AND "isTestAccount" = false
    ORDER BY "betaProExpiry" ASC
  `, [now]);
  console.log(JSON.stringify(rows, null, 2));
  await pool.end();
}
main().catch(console.error);
