/**
 * GET /api/cron/email-campaign
 *
 * Free-trial drip campaign runner.
 *
 * Step 1 (Welcome + Pro activated) fires immediately from /api/auth/register.
 * Steps 2–5 fire here on a daily cron schedule.
 *
 * Also fires a day-7 referral push notification (OneSignal) to users who are
 * exactly 7 days into their trial — timed to arrive before Email 3 (day 10),
 * giving them an early push to share before the email reminds them.
 *
 * Secured with CRON_SECRET env var.
 */
import { NextResponse } from 'next/server';
import { getUsersPendingCampaignStep, advanceEmailCampaignStep, getAllUsers } from '@/lib/users';
import { sendCampaignEmail }  from '@/lib/emailCampaign';
import { sendPushNotification } from '@/lib/oneSignal';

const STEPS: { step: number; minDays: number; label: string }[] = [
  { step: 2, minDays: 3,  label: 'Day-3 feature deep-dive'    },
  { step: 3, minDays: 10, label: 'Day-10 power user check-in' },
  { step: 4, minDays: 21, label: 'Day-21 annual deal offer'   },
  { step: 5, minDays: 28, label: 'Day-28 final 48 hours'      },
];

export async function GET(req: Request) {
  // Verify cron secret
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Record<string, { sent: number; errors: number }> = {};

  // ── Email drip steps ──────────────────────────────────────────────────────
  for (const { step, minDays, label } of STEPS) {
    let users;
    try {
      users = await getUsersPendingCampaignStep(step, minDays);
    } catch (err) {
      console.error(`[Campaign] DB query failed for step ${step}:`, err);
      results[label] = { sent: 0, errors: 1 };
      continue;
    }
    let sent = 0, errors = 0;

    for (const user of users) {
      try {
        await sendCampaignEmail(step, { id: user.id, name: user.name, email: user.email });
        await advanceEmailCampaignStep(user.id, step);
        sent++;
      } catch (err) {
        console.error(`[Campaign] Step ${step} failed for ${user.email}:`, err);
        errors++;
      }
    }

    results[label] = { sent, errors };
    console.log(`[Campaign] Step ${step} (${label}): sent=${sent} errors=${errors}`);
  }

  // ── Day-7 referral push notification ─────────────────────────────────────
  // Target users who enrolled exactly 7–8 days ago (the daily cron window).
  // OneSignal is targeted by external user ID so only enrolled push subscribers
  // receive it — users who haven't opted in to notifications are skipped silently.
  try {
    const now     = Date.now();
    const allUsers = await getAllUsers();
    const day7Users = allUsers.filter((u) => {
      if (!u.emailCampaignEnrolledAt || u.emailOptOut) return false;
      const daysIn = (now - new Date(u.emailCampaignEnrolledAt).getTime()) / 86_400_000;
      return daysIn >= 7 && daysIn < 8;
    });

    let pushSent = 0;
    for (const user of day7Users) {
      try {
        await sendPushNotification({
          title:       '🔗 Earn a free Pro month',
          body:        'Share GasCap™ with one friend. The moment they sign up, we bank a free month for you — no purchase needed.',
          url:         '/#share',
          externalIds: [user.id],
        });
        pushSent++;
      } catch (err) {
        console.error(`[Campaign] Day-7 push failed for ${user.email}:`, err);
      }
    }

    results['Day-7 referral push'] = { sent: pushSent, errors: day7Users.length - pushSent };
    console.log(`[Campaign] Day-7 referral push: sent=${pushSent} of ${day7Users.length} eligible`);
  } catch (err) {
    console.error('[Campaign] Day-7 push batch failed:', err);
    results['Day-7 referral push'] = { sent: 0, errors: 1 };
  }

  return NextResponse.json({ ok: true, ran: new Date().toISOString(), results });
}
