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
import { logEmailError, hasEmailBeenSent, CAMPAIGN_STEP_META } from '@/lib/emailLog';

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

  // ── D1 safety net ─────────────────────────────────────────────────────────
  // Catches users who enrolled >1 day ago but never received trial-d1 (e.g.
  // because the register route's non-blocking fire-and-forget silently failed).
  // Sends D1 with an explanatory apology note; does NOT advance emailCampaignStep
  // so the normal D2→D5 cadence continues from wherever the user already is.
  // We also track which users receive D1 in this run so the D2 guard below can
  // skip D2 for them in the same cron execution (avoiding a same-day D1+D2 flood).
  const sentD1ThisRun = new Set<string>();

  try {
    // getUsersPendingCampaignStep(2, 1) → step=1 users enrolled ≥1 day ago
    const d1Candidates = await getUsersPendingCampaignStep(2, 1);
    let d1Sent = 0, d1Errors = 0;

    for (const user of d1Candidates) {
      const alreadySent = await hasEmailBeenSent(user.id, 'trial-d1');
      if (alreadySent) continue;

      try {
        await sendCampaignEmail(1, {
          id:        user.id,
          name:      user.name,
          email:     user.email,
          isDelayed: true,
        });
        sentD1ThisRun.add(user.id);
        d1Sent++;
        console.log(`[Campaign] D1 safety net → sent delayed D1 to ${user.email}`);
      } catch (err) {
        console.error(`[Campaign] D1 safety net failed for ${user.email}:`, err);
        d1Errors++;
        await logEmailError(
          { userId: user.id, userEmail: user.email, userName: user.name,
            type: 'trial-d1', subject: 'Welcome to GasCap™ — your free Pro trial is live 🎉' },
          err,
        );
      }
    }

    results['D1 safety net'] = { sent: d1Sent, errors: d1Errors };
    console.log(`[Campaign] D1 safety net: sent=${d1Sent} skipped=${d1Candidates.length - d1Sent - d1Errors} errors=${d1Errors}`);
  } catch (err) {
    console.error('[Campaign] D1 safety net batch failed:', err);
    results['D1 safety net'] = { sent: 0, errors: 1 };
  }

  // ── Email drip steps (D2–D5) ──────────────────────────────────────────────
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
      // Guard: never send D2+ to someone who hasn't received D1 yet.
      // Also skip if D1 was just sent this cron run (avoid same-day D1+D2).
      if (step === 2) {
        if (sentD1ThisRun.has(user.id)) {
          console.log(`[Campaign] Skipping D2 for ${user.email} — D1 just sent this run`);
          continue;
        }
        const d1Sent = await hasEmailBeenSent(user.id, 'trial-d1');
        if (!d1Sent) {
          console.log(`[Campaign] Skipping D2 for ${user.email} — trial-d1 not logged (safety net will handle)`);
          continue;
        }
      }

      try {
        await sendCampaignEmail(step, { id: user.id, name: user.name, email: user.email });
        await advanceEmailCampaignStep(user.id, step);
        sent++;
      } catch (err) {
        console.error(`[Campaign] Step ${step} failed for ${user.email}:`, err);
        errors++;
        // Persist the failure so it appears in the admin email activity log
        const meta = CAMPAIGN_STEP_META[step];
        if (meta) {
          await logEmailError(
            { userId: user.id, userEmail: user.email, userName: user.name, type: meta.type, subject: meta.subject },
            err,
          );
        }
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
          body:        'Share GasCap™ with a friend. When they upgrade to Pro, you earn a free month — plus bonus drawing entries every day.',
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
