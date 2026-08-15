/**
 * GET /api/cron/streak-reminder
 *
 * Runs once daily at 23:00 UTC (7 PM ET) — late enough to catch users who
 * haven't opened the app yet today, early enough that they still have an
 * hour before midnight to tap in and save their streak.
 *
 * Eligibility: Pro/Fleet users with streak >= 3 who haven't logged in today.
 * We only push for meaningful streaks worth protecting, and only when the
 * streak is actually at risk (no activity today).
 *
 * Secured with CRON_SECRET env var (?secret=<value>).
 */
import { NextResponse }          from 'next/server';
import { getAllUsers }            from '@/lib/users';
import { isStreakAtRisk }        from '@/lib/streakRisk';
import { sendPushNotification }  from '@/lib/oneSignal';
import { sendApns, apnsConfigured } from '@/lib/apns';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (!process.env.CRON_SECRET || searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const allUsers = await getAllUsers();
  const todayUTC = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

  let sent    = 0;
  let skipped = 0;
  let errors  = 0;

  for (const user of allUsers) {
    // Only Pro / Fleet users
    if (user.plan !== 'pro' && user.plan !== 'fleet') { skipped++; continue; }

    // Only streaks worth saving
    const streak = user.streak ?? 0;
    if (streak < 3) { skipped++; continue; }

    // Skip anyone who has already been active today. Reads activeDays — the
    // same field the streak itself is computed from — not lastLoginAt, which
    // only moves on an actual sign-in and so stayed stale for every user with
    // a live session. See isStreakAtRisk.
    if (!isStreakAtRisk(user.activeDays, user.lastLoginAt, todayUTC)) { skipped++; continue; }

    // Skip test accounts
    if ((user as { isTestAccount?: boolean }).isTestAccount) { skipped++; continue; }

    const firstName = (user.displayName || user.name || 'there').split(' ')[0];
    const title = `${streak}-day streak at risk ⏰`;
    const body  = `Hey ${firstName} — open GasCap™ before midnight to keep your ${streak}-day streak alive.`;
    const iosToken = (user as { iosPushToken?: string | null }).iosPushToken;

    try {
      let delivered = false;

      const result = await sendPushNotification({
        title,
        body,
        url:         '/',
        externalIds: [user.id],
      });
      if (!result.errors) delivered = true;
      else console.warn(`[StreakReminder] OneSignal skipped for ${user.email}:`, result.errors);

      if (iosToken && apnsConfigured()) {
        const r = await sendApns(iosToken, title, body).catch(() => ({ ok: false } as { ok: boolean }));
        if (r.ok) delivered = true;
      }

      if (!delivered) { skipped++; continue; }

      sent++;
      console.log(`[StreakReminder] Sent to ${user.email} (streak ${streak})`);
    } catch (err) {
      errors++;
      console.error(`[StreakReminder] Failed for ${user.email}:`, err);
    }
  }

  return NextResponse.json({ ok: true, sent, skipped, errors, ranAt: new Date().toISOString() });
}
