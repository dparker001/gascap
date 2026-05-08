/**
 * GET /api/cron/fillup-reminder
 *
 * Runs once daily (18:00 UTC / 2 PM Eastern).
 *
 * For each Pro/Fleet user who has a fillupReminderDays interval set:
 *   - Check if today is at or past their next scheduled reminder
 *     (based on lastFillupReminderSentAt + fillupReminderDays)
 *   - If so, send a push notification via OneSignal
 *   - Stamp lastFillupReminderSentAt = now
 *
 * Users without push subscriptions are silently skipped by OneSignal.
 * Secured with CRON_SECRET env var (?secret=<value>).
 */

import { NextResponse }        from 'next/server';
import { getAllUsers }          from '@/lib/users';
import { sendPushNotification } from '@/lib/oneSignal';
import { prisma }              from '@/lib/prisma';

export async function GET(req: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const { searchParams } = new URL(req.url);
  if (!process.env.CRON_SECRET || searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const allUsers = await getAllUsers();
  const now      = Date.now();

  let sent    = 0;
  let skipped = 0;
  let errors  = 0;

  for (const user of allUsers) {
    // Only Pro / Fleet users with a reminder interval configured
    if (user.plan !== 'pro' && user.plan !== 'fleet') { skipped++; continue; }
    const intervalDays = user.fillupReminderDays ?? 0;
    if (intervalDays <= 0) { skipped++; continue; }

    // Determine when the next reminder is due
    const lastSent     = (user as { lastFillupReminderSentAt?: string | null }).lastFillupReminderSentAt;
    const lastSentMs   = lastSent ? new Date(lastSent).getTime() : 0;
    const nextDueMs    = lastSentMs + intervalDays * 86_400_000;

    if (now < nextDueMs) { skipped++; continue; }

    // ── Send push notification ──────────────────────────────────────────────
    const firstName = (user.displayName || user.name || 'there').split(' ')[0];
    try {
      await sendPushNotification({
        title:       '⛽ Time to fill up?',
        body:        `Hey ${firstName} — it's been ${intervalDays} day${intervalDays === 1 ? '' : 's'}. Open GasCap™ to plan your fill-up.`,
        url:         '/',
        externalIds: [user.id],
      });

      // Stamp sent time in Prisma
      await prisma.user.update({
        where: { id: user.id },
        data:  { lastFillupReminderSentAt: new Date().toISOString() },
      });

      sent++;
      console.log(`[FillupReminder] Sent to ${user.email} (interval ${intervalDays}d)`);
    } catch (err) {
      errors++;
      console.error(`[FillupReminder] Failed for ${user.email}:`, err);
    }
  }

  return NextResponse.json({
    ok:        true,
    sent,
    skipped,
    errors,
    ranAt:     new Date().toISOString(),
  });
}
