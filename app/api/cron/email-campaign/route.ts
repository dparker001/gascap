/**
 * GET /api/cron/email-campaign
 *
 * Drip campaign runner — call this daily via a cron job.
 * Secured with CRON_SECRET env var.
 *
 * Railway cron setup:
 *   Command:  curl -s -o /dev/null "$APP_URL/api/cron/email-campaign?secret=$CRON_SECRET"
 *   Schedule: 0 14 * * *   (2 PM UTC / 10 AM ET daily)
 *
 * Campaign schedule (days since sign-up):
 *   Step 2 → day 3   Feature tips
 *   Step 3 → day 7   Pro upsell
 *   Step 4 → day 14  Annual deal + Fleet mention
 *   Step 5 → day 30  Last-call offer
 */
import { NextResponse }                           from 'next/server';
import { getUsersPendingCampaignStep, advanceEmailCampaignStep } from '@/lib/users';
import { sendCampaignEmail }                      from '@/lib/emailCampaign';

const STEPS: { step: number; minDays: number; label: string }[] = [
  { step: 2, minDays: 3,  label: 'feature tips'   },
  { step: 3, minDays: 7,  label: 'Pro upsell'      },
  { step: 4, minDays: 14, label: 'annual deal'     },
  { step: 5, minDays: 30, label: 'last-call offer' },
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
