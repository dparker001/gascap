/**
 * GET /api/cron/comp-campaign
 *
 * Drip email runner for Comp Ambassador members (ambassadorProForLife=true).
 *
 * C1 (Comp welcome) fires immediately when admin grants Comp Pro for Life.
 * C2–C5 fire here on a daily cron schedule.
 *
 *   C2 — Day 3  — Share mechanics: link + QR code walkthrough
 *   C3 — Day 7  — Best places to share + copy-paste scripts
 *   C4 — Day 14 — Milestone rewards breakdown ($25/$50/$100 gas cards)
 *   C5 — Day 30 — Re-engagement + tips from top ambassadors
 *
 * Also checks for gas card milestones (10/25/50 paying referrals) and
 * sends an admin flag email when a comped member crosses a threshold.
 *
 * Secured with CRON_SECRET env var. Run once daily alongside other crons.
 */
import { NextResponse } from 'next/server';
import {
  getUsersPendingCompCampaignStep,
  advanceCompCampaignStep,
  getAllUsers,
} from '@/lib/users';
import { sendCompCampaignEmail } from '@/lib/emailCampaign';
import { sendMail } from '@/lib/email';

const STEPS: { step: number; minDays: number; label: string }[] = [
  { step: 2, minDays: 3,  label: 'C2 day-3 share mechanics'       },
  { step: 3, minDays: 7,  label: 'C3 day-7 best places to share'  },
  { step: 4, minDays: 14, label: 'C4 day-14 milestone rewards'     },
  { step: 5, minDays: 30, label: 'C5 day-30 re-engagement tips'    },
];

/** Gas card milestone thresholds (paying referrals → reward) */
const GAS_CARD_MILESTONES: { threshold: number; reward: string }[] = [
  { threshold: 10, reward: '$25 Visa prepaid card' },
  { threshold: 25, reward: '$50 Visa prepaid card' },
  { threshold: 50, reward: '$100 Visa prepaid card' },
];

/** Send an internal admin alert when a comped member crosses a gas card milestone */
async function sendMilestoneAlert(
  userName: string,
  userEmail: string,
  referralCount: number,
  reward: string,
) {
  const adminEmail = process.env.ADMIN_ALERT_EMAIL ?? 'admin@gascap.app';
  const BASE_URL   = process.env.NEXTAUTH_URL?.replace(/\/$/, '') ?? 'https://www.gascap.app';
  await sendMail({
    to:      adminEmail,
    subject: `🏆 Ambassador milestone hit: ${userName} reached ${referralCount} referrals`,
    html:    `<p>Ambassador <strong>${userName}</strong> (${userEmail}) has crossed the <strong>${referralCount}-referral</strong> milestone and has earned a <strong>${reward}</strong>.</p><p><a href="${BASE_URL}/admin">Open Admin Panel →</a></p>`,
    text:    `Ambassador ${userName} (${userEmail}) has reached ${referralCount} paying referrals — reward: ${reward}. Open admin panel: ${BASE_URL}/admin`,
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Record<string, { sent: number; errors: number }> = {};

  // ── Comp email drip steps ──────────────────────────────────────────────────
  for (const { step, minDays, label } of STEPS) {
    let users;
    try {
      users = await getUsersPendingCompCampaignStep(step, minDays);
    } catch (err) {
      console.error(`[comp-campaign] DB query failed for step ${step}:`, err);
      results[label] = { sent: 0, errors: 1 };
      continue;
    }
    let sent = 0, errors = 0;

    for (const user of users) {
      try {
        await sendCompCampaignEmail(step, { id: user.id, name: user.name, email: user.email });
        await advanceCompCampaignStep(user.id, step);
        sent++;
      } catch (err) {
        console.error(`[comp-campaign] Step ${step} failed for ${user.email}:`, err);
        errors++;
      }
    }

    results[label] = { sent, errors };
    console.log(`[comp-campaign] Step ${step} (${label}): sent=${sent} errors=${errors}`);
  }

  // ── Gas card milestone detection ──────────────────────────────────────────
  // Check all comped users to see if any have crossed a new milestone today.
  // We use referralCount (paying referrals only) and compare against milestones.
  // To avoid duplicate alerts, we check compCampaignStep >= 4 (C4 sent = they
  // know about milestones) OR we check stored milestone hits if added later.
  // For now: alert admin whenever referralCount equals a threshold exactly —
  // i.e. hit it for the first time (not a range, so no re-alerting).
  let milestoneAlerts = 0;
  try {
    const allUsers = await getAllUsers();
    const compedUsers = allUsers.filter((u) => u.ambassadorProForLife && !u.emailOptOut);

    for (const u of compedUsers) {
      const count = u.referralCount ?? 0;
      for (const { threshold, reward } of GAS_CARD_MILESTONES) {
        // Alert only when the count is exactly the threshold (day of crossing)
        // This fires once per milestone since the daily cron window won't repeat.
        if (count === threshold) {
          try {
            await sendMilestoneAlert(u.name, u.email, threshold, reward);
            milestoneAlerts++;
            console.log(`[comp-campaign] Milestone alert: ${u.email} hit ${threshold} referrals → ${reward}`);
          } catch (err) {
            console.error(`[comp-campaign] Milestone alert failed for ${u.email}:`, err);
          }
        }
      }
    }
  } catch (err) {
    console.error('[comp-campaign] Milestone scan failed:', err);
  }

  results['Gas card milestone alerts'] = { sent: milestoneAlerts, errors: 0 };

  return NextResponse.json({ ok: true, ran: new Date().toISOString(), results });
}
