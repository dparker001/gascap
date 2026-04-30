/**
 * One-time script: send early upgrade bonus offer to all active trial users.
 *
 * Run with:
 *   DATABASE_URL="..." SMTP_HOST=... SMTP_USER=... SMTP_PASS=... npx tsx scripts/send-early-upgrade-offer.ts
 */
import { Pool } from 'pg';
import { sendMail } from '../lib/email';
import { earlyUpgradeOfferEmailHtml, earlyUpgradeOfferEmailText } from '../lib/emailCampaign';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Already sent in the first partial run — skip to avoid duplicates
  const alreadySent = [
    'fplummer81@gmail.com',
    'notoriousking_24@yahoo.com',
    'allisonmullens@gmail.com',
    'gonzalez7838@yahoo.com',
    'ambrosiecarnella1@gmail.com',
  ];

  const { rows } = await pool.query(`
    SELECT id, name, email FROM "User"
    WHERE "isProTrial" = true
      AND "emailOptOut" = false
      AND "isTestAccount" = false
      AND "betaProExpiry"::timestamptz > NOW()
      AND email != ALL($1)
    ORDER BY "betaProExpiry" ASC
  `, [alreadySent]);

  console.log(`Sending to ${rows.length} trial users...`);
  for (const user of rows) {
    await sendMail({
      to: user.email,
      subject: '🎰 Upgrade before your trial ends → +10 bonus draw entries/month',
      html: earlyUpgradeOfferEmailHtml(user.name, user.id),
      text: earlyUpgradeOfferEmailText(user.name),
    });
    console.log(`✓ Sent to ${user.email}`);
    // Respect Resend's 5 req/sec limit
    await new Promise((res) => setTimeout(res, 250));
  }
  await pool.end();
  console.log('Done.');
}
main().catch(console.error);
