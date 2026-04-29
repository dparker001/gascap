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
      // 1. Downgrade the account
      await expireTrial(user.id);
      downgraded++;

      // 2. Send "trial ended" email
      await sendMail({
        to:      user.email,
        subject: 'Your GasCap™ Pro trial has ended',
        html:    trialEndedEmailHtml(user.name, user.id),
        text:    trialEndedEmailText(user.name),
      });
      emailsSent++;

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
