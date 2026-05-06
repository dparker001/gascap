import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function main() {
  // Check how many trial users exist and if any got the bonus already
  const { rows } = await pool.query(`
    SELECT 
      COUNT(*) FILTER (WHERE "isProTrial" = true AND "isTestAccount" = false AND "betaProExpiry" > NOW()) as active_trials,
      COUNT(*) FILTER (WHERE "earlyUpgradeBonusEntries" > 0) as has_bonus,
      COUNT(*) FILTER (WHERE "earlyUpgradeBonusEntries" IS NULL OR "earlyUpgradeBonusEntries" = 0) as no_bonus
    FROM "User"
    WHERE "isTestAccount" = false
  `);
  console.log('Trial/bonus status:', JSON.stringify(rows[0], null, 2));
  await pool.end();
}
main().catch(console.error);
