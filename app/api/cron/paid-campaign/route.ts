/**
 * GET /api/cron/paid-campaign
 *
 * Scheduled drip emails for paid subscribers.
 *
 *   P2 — 30-day check-in         (day 30, all paid)
 *   P3 — 60-day feature spotlight (day 60, all paid)
 *   P4 — Annual renewal reminder  (day 330, annual subscribers only)
 *
 * P1 (upgrade confirmation) fires immediately from the Stripe webhook.
 * P5 (cancellation win-back) fires immediately from the Stripe webhook.
 *
 * Run once daily (e.g. 10:30 AM ET) via Railway cron or external scheduler.
 * Secured with CRON_SECRET.
 */
import { NextResponse }               from 'next/server';
import { getUsersPendingPaidCampaignStep, advancePaidCampaignStep, findById } from '@/lib/users';
import { sendPaidCampaignEmail }      from '@/lib/emailCampaignPaid';

const STEPS: {
  step: 2 | 3 | 4;
  pStep: 'P2' | 'P3' | 'P4';
  minDays: number;
  label: string;
}[] = [
  { step: 2, pStep: 'P2', minDays: 30,  label: 'P2 day-30 check-in'      },
  { step: 3, pStep: 'P3', minDays: 60,  label: 'P3 day-60 spotlight'      },
  { step: 4, pStep: 'P4', minDays: 330, label: 'P4 day-330 renewal (annual)' },
];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Record<string, { sent: number; errors: number }> = {};

  for (const { step, pStep, minDays, label } of STEPS) {
    let users;
    try {
      users = await getUsersPendingPaidCampaignStep(step, minDays);
    } catch (err) {
      console.error(`[paid-campaign] DB query failed for ${pStep}:`, err);
      results[label] = { sent: 0, errors: 1 };
      continue;
    }
    let sent = 0, errors = 0;

    for (const user of users) {
      try {
        // Re-fetch to get fresh stripeInterval (guards against stale batch reads)
        const fresh = await findById(user.id);
        if (!fresh) continue;

        await sendPaidCampaignEmail(pStep, {
          id:       fresh.id,
          name:     fresh.name,
          email:    fresh.email,
          tier:     fresh.plan === 'fleet' ? 'fleet' : 'pro',
          interval: (fresh.stripeInterval ?? 'monthly') as 'monthly' | 'annual',
        });
        await advancePaidCampaignStep(fresh.id, step);
        sent++;
      } catch (err) {
        console.error(`[paid-campaign] ${pStep} failed for ${user.email}:`, err);
        errors++;
      }
    }

    results[label] = { sent, errors };
    console.log(`[paid-campaign] ${pStep} (${label}): sent=${sent} errors=${errors}`);
  }

  return NextResponse.json({ ok: true, ran: new Date().toISOString(), results });
}
