/**
 * GET /api/cron/email-campaign
 *
 * Drip campaign runner — HYBRID MODEL.
 *
 * As of the 30-day Pro trial rollout, the app ONLY sends Step 1 (Welcome +
 * Pro activated), which fires directly from /api/auth/register. The four
 * follow-up drip emails (Day 3/10/21/28) now live in a GoHighLevel
 * workflow triggered by the `gascap-trial-30day` tag, so the marketing
 * team / VA can review, edit, and A/B test them without a code push.
 *
 * This endpoint is intentionally left as a no-op so the existing Railway
 * cron schedule can stay wired up without blowing up. If you ever want to
 * bring the drip back in-app, re-add entries to STEPS below.
 *
 * Secured with CRON_SECRET env var (unchanged).
 */
import { NextResponse } from 'next/server';
// NOTE: imports kept so re-enabling any step is a one-line change.
import { getUsersPendingCampaignStep, advanceEmailCampaignStep } from '@/lib/users';
import { sendCampaignEmail }                                     from '@/lib/emailCampaign';

// Intentionally empty — all drip steps (2–5) moved to GHL workflow.
// See ClickUp task "GHL workflow: GasCap 30-day Pro trial drip".
const STEPS: { step: number; minDays: number; label: string }[] = [];

// Silence unused-import warnings while STEPS is empty. These are kept
// deliberately so re-enabling any step is a one-line edit.
void getUsersPendingCampaignStep;
void advanceEmailCampaignStep;
void sendCampaignEmail;

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
