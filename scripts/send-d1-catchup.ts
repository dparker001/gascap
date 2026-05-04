/**
 * One-time script: send trial-d1 welcome email (with delay apology note) to
 * all enrolled trial users who never received it.
 *
 * Safe to re-run — idempotency is enforced by checking EmailLog before sending.
 *
 * Run with:
 *   DATABASE_URL="..." npx tsx scripts/send-d1-catchup.ts
 *
 * Env vars read automatically from .env.local if present (tsx does this).
 * You may also pass RESEND_API_KEY and RESEND_FROM as env overrides.
 */
import 'dotenv/config';
import { Pool }             from 'pg';
import { randomUUID }       from 'crypto';
import { sendMail }         from '../lib/email';
import {
  welcomeEmailHtml,
  welcomeEmailText,
} from '../lib/emailCampaign';

// Rate limit: 4 sends/sec to stay inside Resend's 5 req/sec burst limit
const DELAY_MS = 250;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Explicit skip list ────────────────────────────────────────────────────────
// jamiedenise74@gmsil.com  — typo address, will hard-bounce
// allisonmullens@gmail.com — opted out of marketing
const SKIP_EMAILS = new Set([
  'jamiedenise74@gmsil.com',
  'allisonmullens@gmail.com',
]);

async function main() {
  console.log('=== GasCap™ D1 Catchup Script ===\n');

  // 1. Find all enrolled trial users (emailCampaignStep >= 1)
  //    who have NOT opted out and are NOT on a paid Stripe plan.
  const { rows: candidates } = await pool.query<{
    id: string; name: string; email: string;
    email_campaign_step: number; enrolled_at: string;
  }>(`
    SELECT
      id,
      name,
      email,
      "emailCampaignStep"       AS email_campaign_step,
      "emailCampaignEnrolledAt" AS enrolled_at
    FROM "User"
    WHERE "emailCampaignStep"       >= 1
      AND "emailOptOut"              = false
      AND "isTestAccount"            = false
      AND "stripeSubscriptionId"     IS NULL
      AND "emailCampaignEnrolledAt"  IS NOT NULL
    ORDER BY "emailCampaignEnrolledAt" ASC
  `);

  console.log(`Total enrolled trial users: ${candidates.length}`);

  // 2. For each candidate, check EmailLog for a sent trial-d1
  let skippedAlreadySent = 0;
  let skippedExplicit    = 0;
  let sent               = 0;
  let errors             = 0;

  for (const user of candidates) {
    if (SKIP_EMAILS.has(user.email)) {
      console.log(`  SKIP (explicit list): ${user.email}`);
      skippedExplicit++;
      continue;
    }

    // Check EmailLog
    const { rows: logRows } = await pool.query<{ id: string }>(`
      SELECT id FROM "EmailLog"
      WHERE "userId" = $1
        AND type     = 'trial-d1'
        AND status   = 'sent'
      LIMIT 1
    `, [user.id]);

    if (logRows.length > 0) {
      console.log(`  SKIP (already sent): ${user.email} (step=${user.email_campaign_step})`);
      skippedAlreadySent++;
      continue;
    }

    // Send D1 with delay apology note
    const subject = 'Welcome to GasCap™ — your free Pro trial is live 🎉';
    try {
      await sendMail({
        to:      user.email,
        subject,
        html:    welcomeEmailHtml(user.name, user.id, undefined, true /* isDelayed */),
        text:    welcomeEmailText(user.name),
      });

      // Write EmailLog row via raw SQL (avoids Prisma in script context)
      await pool.query(`
        INSERT INTO "EmailLog"
          (id, "userId", "userEmail", "userName", type, subject, "sentAt", status)
        VALUES ($1, $2, $3, $4, 'trial-d1', $5, $6, 'sent')
      `, [randomUUID(), user.id, user.email, user.name, subject, new Date().toISOString()]);

      console.log(`  ✓ SENT:  ${user.email} (step=${user.email_campaign_step}, enrolled=${user.enrolled_at?.slice(0, 10)})`);
      sent++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ERROR: ${user.email} — ${errMsg}`);

      // Log failure row so admin can see it
      await pool.query(`
        INSERT INTO "EmailLog"
          (id, "userId", "userEmail", "userName", type, subject, "sentAt", status, error)
        VALUES ($1, $2, $3, $4, 'trial-d1', $5, $6, 'failed', $7)
      `, [randomUUID(), user.id, user.email, user.name, subject, new Date().toISOString(), errMsg.slice(0, 1000)]);

      errors++;
    }

    // Rate limit
    await new Promise((res) => setTimeout(res, DELAY_MS));
  }

  await pool.end();

  console.log('\n=== Summary ===');
  console.log(`  Sent:              ${sent}`);
  console.log(`  Already had D1:    ${skippedAlreadySent}`);
  console.log(`  Explicit skip:     ${skippedExplicit}`);
  console.log(`  Errors:            ${errors}`);
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  pool.end();
  process.exit(1);
});
