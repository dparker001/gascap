import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function main() {
  const { rows } = await pool.query(`
    SELECT 
      COUNT(*) FILTER (WHERE "isProTrial" = true AND "isTestAccount" = false) as active_trials,
      COUNT(*) FILTER (WHERE "earlyUpgradeBonusEntries" > 0) as has_bonus
    FROM "User"
    WHERE "isTestAccount" = false
  `);
  console.log(JSON.stringify(rows[0], null, 2));
  await pool.end();
}
main().catch(console.error);
