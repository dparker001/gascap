/**
 * READ-ONLY. Diagnostic for the Native IAP Verification Test Session
 * (docs/IAP_NATIVE_VERIFICATION_CHECKLIST.md, run per
 * docs/reviews/2026-08-20-iap-test-session-guide.md).
 *
 * Prints, for one test account email, in the last N minutes:
 *   - AnalyticsEvent rows: iap_checkout_started and purchase_completed
 *   - RevenueCatWebhookEvent rows (any RevenueCat webhook activity)
 *   - the account's current plan/stripeInterval/isProTrial state
 *
 * Usage: railway run npx tsx scripts/diagnostics/check_iap_test_events.ts <email> [minutes]
 * Defaults to the last 30 minutes if [minutes] is omitted.
 *
 * Writes nothing. Reads only.
 */
import { Pool } from 'pg';

const email   = process.argv[2];
const minutes = Number(process.argv[3] ?? 30);

if (!email) {
  console.error('Usage: check_iap_test_events.ts <email> [minutes]');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows: userRows } = await pool.query(
    `SELECT id, email, plan, "stripeInterval", "isProTrial", "trialExpiresAt"
     FROM "User" WHERE email = $1`,
    [email],
  );
  if (!userRows.length) {
    console.log(`No user found for ${email}`);
    await pool.end();
    return;
  }
  const user = userRows[0];
  console.log('=== Account state ===');
  console.log(JSON.stringify(user, null, 2));

  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();

  const { rows: events } = await pool.query(
    `SELECT id, "eventType", "originPlatform", emitter, provider, billing,
            "idempotencyKey", metadata, "createdAt"
     FROM "AnalyticsEvent"
     WHERE "userId" = $1
       AND "eventType" IN ('iap_checkout_started', 'purchase_completed')
       AND "createdAt" >= $2
     ORDER BY "createdAt" ASC`,
    [user.id, since],
  );
  console.log(`\n=== AnalyticsEvent rows (last ${minutes}m) ===`);
  console.log(JSON.stringify(events, null, 2));

  const { rows: webhooks } = await pool.query(
    `SELECT id, "eventType", status, "receivedAt", "processedAt", error
     FROM "RevenueCatWebhookEvent"
     WHERE "userId" = $1 AND "receivedAt" >= $2
     ORDER BY "receivedAt" ASC`,
    [user.id, since],
  );
  console.log(`\n=== RevenueCatWebhookEvent rows (last ${minutes}m) ===`);
  console.log(JSON.stringify(webhooks, null, 2));

  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
