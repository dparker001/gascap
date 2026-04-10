/**
 * GET /api/cron/email-campaign
 *
 * Drip campaign runner for the 30-day GasCap™ Pro trial — call this daily
 * via cron. Secured with CRON_SECRET env var.
 *
 * Railway cron setup:
 *   Command:  curl -s -o /dev/null "$APP_URL/api/cron/email-campaign?secret=$CRON_SECRET"
 *   Schedule: 0 14 * * *   (2 PM UTC / 10 AM ET daily)
 *
 * Campaign schedule (days since sign-up). Each step assumes the prior step
 * was sent — getUsersPendingCampaignStep enforces that ordering.
 *
 *   Step 1 → day 0   Welcome + Pro activated (sent directly from register route)
 *   Step 2 → day 3   Feature deep-dive       (27 days of Pro left)
 *   Step 3 → day 10  Mid-trial check-in      (20 days of Pro left)
 *   Step 4 → day 21  Annual deal, 9 days left
 *   Step 5 → day 28  Final 48 hours
 */
import { NextResponse }                           from 'next/server';
import { getUsersPendingCampaignStep, advanceEmailCampaignStep } from '@/lib/users';
import { sendCampaignEmail }                      from '@/lib/emailCampaign';

const STEPS: { step: number; minDays: number; label: string }[] = [
  { step: 2, minDays: 3,  label: 'feature deep-dive'      },
  { step: 3, minDays: 10, label: 'mid-trial check-in'     },
  { step: 4, minDays: 21, label: '9 days left + annual'   },
  { step: 5, minDays: 28, label: 'final 48 hours'         },
];

export async function GET(req: Request) {
  // Verify cron secret
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Record<string, { sent: number; errors: number }> = {};

  for (const { step, minDays, label } of STEPS) {
    const users  = getUsersPendingCampaignStep(step, minDays);
    let sent = 0, errors = 0;

    for (const user of users) {
      try {
        await sendCampaignEmail(step, { id: user.id, name: user.name, email: user.email });
        advanceEmailCampaignStep(user.id, step);
        sent++;
      } catch (err) {
        console.error(`[Campaign] Step ${step} failed for ${user.email}:`, err);
        errors++;
      }
    }

    results[label] = { sent, errors };
    console.log(`[Campaign] Step ${step} (${label}): sent=${sent} errors=${errors}`);
  }

  return NextResponse.json({ ok: true, ran: new Date().toISOString(), results });
}
