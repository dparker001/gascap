/**
 * GET /api/cron/engagement-campaign
 *
 * Daily cron that fires engagement emails for paying Pro and Fleet subscribers.
 *
 * Pro track:   S1 day 45 · S2 day 75 · S3 day 105 · S4 day 165 · S5 day 335 (annual only)
 * Fleet track: F1 day 14 · F2 day 45 · F3 day 105 · F4 day 180
 *
 * Secured with CRON_SECRET. Run once daily.
 */
import { NextResponse } from 'next/server';
import {
  getUsersPendingEngagementStep,
  advanceEngagementStep,
} from '@/lib/users';
import { sendEngagementEmail } from '@/lib/emailEngagement';

const PRO_STEPS = [
  { step: 1, minDays: 45,  annualOnly: false, label: 'S1 day-45 data check-in'      },
  { step: 2, minDays: 75,  annualOnly: false, label: 'S2 day-75 habit reinforcement' },
  { step: 3, minDays: 105, annualOnly: false, label: 'S3 day-105 referral nudge'     },
  { step: 4, minDays: 165, annualOnly: false, label: 'S4 day-165 loyalty milestone'  },
  { step: 5, minDays: 335, annualOnly: true,  label: 'S5 day-335 annual renewal prep'},
];

const FLEET_STEPS = [
  { step: 1, minDays: 14,  label: 'F1 day-14 quick-start checklist' },
  { step: 2, minDays: 45,  label: 'F2 day-45 tax report walkthrough' },
  { step: 3, minDays: 105, label: 'F3 day-105 referral nudge'        },
  { step: 4, minDays: 180, label: 'F4 day-180 ROI summary'           },
];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Record<string, { sent: number; errors: number }> = {};

  // ── Pro track ──────────────────────────────────────────────────────────────
  for (const { step, minDays, annualOnly, label } of PRO_STEPS) {
    let users;
    try {
      users = await getUsersPendingEngagementStep(step, minDays, 'pro', annualOnly);
    } catch (err) {
      console.error(`[engagement] DB query failed for ${label}:`, err);
      results[label] = { sent: 0, errors: 1 };
      continue;
    }

    let sent = 0, errors = 0;
    for (const user of users) {
      try {
        await sendEngagementEmail(step, 'pro', {
          id:             user.id,
          name:           user.name,
          email:          user.email,
          plan:           user.plan,
          stripeInterval: user.stripeInterval,
          referralCode:   user.referralCode,
        });
        await advanceEngagementStep(user.id, step);
        sent++;
      } catch (err) {
        console.error(`[engagement] ${label} failed for ${user.email}:`, err);
        errors++;
      }
    }
    results[label] = { sent, errors };
    console.log(`[engagement] ${label}: sent=${sent} errors=${errors}`);
  }

  // ── Fleet track ────────────────────────────────────────────────────────────
  for (const { step, minDays, label } of FLEET_STEPS) {
    let users;
    try {
      users = await getUsersPendingEngagementStep(step, minDays, 'fleet', false);
    } catch (err) {
      console.error(`[engagement] DB query failed for ${label}:`, err);
      results[label] = { sent: 0, errors: 1 };
      continue;
    }

    let sent = 0, errors = 0;
    for (const user of users) {
      try {
        await sendEngagementEmail(step, 'fleet', {
          id:             user.id,
          name:           user.name,
          email:          user.email,
          plan:           user.plan,
          stripeInterval: user.stripeInterval,
          referralCode:   user.referralCode,
        });
        await advanceEngagementStep(user.id, step);
        sent++;
      } catch (err) {
        console.error(`[engagement] ${label} failed for ${user.email}:`, err);
        errors++;
      }
    }
    results[label] = { sent, errors };
    console.log(`[engagement] ${label}: sent=${sent} errors=${errors}`);
  }

  return NextResponse.json({ ok: true, ran: new Date().toISOString(), results });
}
