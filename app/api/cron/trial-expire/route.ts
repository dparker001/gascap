/**
 * GET /api/cron/trial-expire
 *
 * Daily cron that finds users whose 30-day free Pro trial has passed its
 * expiry date, downgrades them to the free plan, and sends a "trial ended"
 * email with an upgrade CTA.
 *
 * Secured with CRON_SECRET. Run once daily.
 */
import { NextResponse }                        from 'next/server';
import { getExpiredTrialUsers, expireTrial }   from '@/lib/users';
import { sendMail }                            from '@/lib/email';
import { trialEndedEmailHtml, trialEndedEmailText } from '@/lib/emailCampaign';
import { logEmail }                            from '@/lib/emailLog';
import { recordAnalyticsEvent }                from '@/lib/analyticsEvents';
import { getTrialValueSummary }                from '@/lib/trialValue';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let expired: Awaited<ReturnType<typeof getExpiredTrialUsers>>;
  try {
    expired = await getExpiredTrialUsers();
  } catch (err) {
    console.error('[trial-expire] DB query failed:', err);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  if (expired.length === 0) {
    return NextResponse.json({ ok: true, expired: 0 });
  }

  let downgraded = 0;
  let emailsSent = 0;
  const errors: string[] = [];

  for (const user of expired) {
    try {
      // Growth Sprint 1, P0C-1A — captured BEFORE expireTrial() clears it.
      const originalTrialExpiry = user.trialExpiresAt;

      // 1. Downgrade the account
      await expireTrial(user.id);
      downgraded++;

      // Growth Sprint 1, P0C-1A — trial_expired only after expireTrial()
      // has actually succeeded (a throw above skips this via the outer
      // catch, per the existing per-user error handling). Isolated in its
      // own try/catch so an analytics failure can never be mistaken for a
      // downgrade failure, and never skips the "trial ended" email below.
      try {
        await recordAnalyticsEvent({
          eventType: 'trial_expired',
          originPlatform: 'unknown',
          emitter: 'server',
          userId: user.id,
          source: 'trial_expire_cron',
          idempotencyKey: `trial_expired:${user.id}:${originalTrialExpiry}`,
        });
      } catch (e) { console.error('[GasCap analytics] trial_expired write failed:', e); }

      // 2. Send "trial ended" email — only to users who accept email.
      //    The opt-out check belongs HERE, not in the query that decides who
      //    gets downgraded. Filtering the query was letting opt-outs keep Pro
      //    for free indefinitely.
      if (!user.emailOptOut) {
        // TC-2A — fetched from the user's actual domain records (vehicles/
        // fillups/rentalSessions/calcCount), independently of trialExpiresAt,
        // which expireTrial() above has already cleared to null.
        const trialValue = await getTrialValueSummary(user.id).catch(() => null);
        const trialEndedSubject = 'Your GasCap™ Pro trial has ended';
        await sendMail({
          to:      user.email,
          subject: trialEndedSubject,
          html:    trialEndedEmailHtml(user.name, user.id, trialValue),
          text:    trialEndedEmailText(user.name, trialValue),
        });
        logEmail({ userId: user.id, userEmail: user.email, userName: user.name, type: 'trial-ended', subject: trialEndedSubject }).catch(() => {});
        emailsSent++;
      }

      console.log(`[trial-expire] Expired trial for ${user.email}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[trial-expire] Failed for ${user.email}:`, msg);
      errors.push(`${user.email}: ${msg}`);
    }
  }

  return NextResponse.json({
    ok:         errors.length === 0,
    expired:    expired.length,
    downgraded,
    emailsSent,
    errors:     errors.length > 0 ? errors : undefined,
  });
}
