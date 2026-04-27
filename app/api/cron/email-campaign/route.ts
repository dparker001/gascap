/**
 * GET /api/cron/email-campaign
 *
 * Free-trial drip campaign runner.
 *
 * Step 1 (Welcome + Pro activated) fires immediately from /api/auth/register.
 * Steps 2–5 fire here on a daily cron schedule.
 *
 * Secured with CRON_SECRET env var.
 */
import { NextResponse } from 'next/server';
import { getUsersPendingCampaignStep, advanceEmailCampaignStep } from '@/lib/users';
import { sendCampaignEmail }                                     from '@/lib/emailCampaign';

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

  for (const { step, minDays, label } of STEPS) {
    const users  = await getUsersPendingCampaignStep(step, minDays);
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

  return NextResponse.json({ ok: true, ran: new Date().toISOString(), results });
}
