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
    // Deliberately NOT plan-gated.
    //
    // This used to require Pro/Fleet, which excluded 220 of 274 users — the
    // people who most need a reason to come back. A retention nudge isn't a
    // paid feature; it's what builds the habit that makes Pro worth buying.
    // The real-money rewards (dining/hotel vouchers) stay Pro-gated where
    // they're granted, in /api/activity.
    const streak = user.streak ?? 0;

    // Floor of 2, not 3. The old floor made the target audience unreachable:
    // 62 users peaked at exactly two consecutive days and, sitting below the
    // threshold, were never nudged. A milestone at 3 rewards whoever already
    // got there; this is the message that creates them.
    if (streak < 2) { skipped++; continue; }

    // Skip anyone who has already been active today. Reads activeDays — the
    // same field the streak itself is computed from — not lastLoginAt, which
    // only moves on an actual sign-in and so stayed stale for every user with
    // a live session. See isStreakAtRisk.
    if (!isStreakAtRisk(user.activeDays, user.lastLoginAt, todayUTC)) { skipped++; continue; }

    // Skip test accounts
    if ((user as { isTestAccount?: boolean }).isTestAccount) { skipped++; continue; }

    const firstName = (user.displayName || user.name || 'there').split(' ')[0];

    // Two distinct messages. At streak 2 there is no achievement to protect
    // yet, so "your 2-day streak is at risk" asks someone to defend something
    // they don't feel they have. Point at the thing one day away instead.
    const buildingHabit = streak === 2;
    const title = buildingHabit
      ? 'One more day 📅'
      : `${streak}-day streak at risk ⏰`;
    const body  = buildingHabit
      ? `Hey ${firstName} — open GasCap™ today and you've got a 3-day streak.`
      : `Hey ${firstName} — open GasCap™ before midnight to keep your ${streak}-day streak alive.`;
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
