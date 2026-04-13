/**
 * POST /api/push/fillup-reminder
 * Sends fill-up reminder push notifications to opted-in users who are overdue.
 * Secured with x-admin-password header — safe to call from Railway cron or manually.
 *
 * GET  /api/push/fillup-reminder  — returns the current user's reminder preference
 * PATCH /api/push/fillup-reminder — updates the current user's reminder interval
 * Body: { days: 0 | 7 | 14 }
 */
import { NextResponse }       from 'next/server';
import { getServerSession }   from 'next-auth';
import { authOptions }        from '@/lib/auth';
import {
  getAllUsers,
  setFillupReminderDays,
  setLastFillupReminderSent,
  findById,
} from '@/lib/users';
import { getFillups }            from '@/lib/fillups';
import { sendPushNotification }  from '@/lib/oneSignal';

// ── GET — return current user's reminder setting ──────────────────────────────

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';
  const user   = findById(userId);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  return NextResponse.json({ days: user.fillupReminderDays ?? 0 });
}

// ── PATCH — save current user's reminder preference ───────────────────────────

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as { days?: number };
  const days  = Number(body.days ?? 0);
  if (![0, 7, 14].includes(days)) {
    return NextResponse.json({ error: 'days must be 0, 7, or 14' }, { status: 400 });
  }

  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';
  setFillupReminderDays(userId, days);

  return NextResponse.json({ ok: true, days });
}

// ── POST — send reminders to all overdue users (admin-only) ───────────────────

export async function POST(req: Request) {
  const adminPw = req.headers.get('x-admin-password');
  if (!adminPw || adminPw !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const users  = getAllUsers();
  const now    = Date.now();
  let sent = 0, skipped = 0;

  for (const user of users) {
    const reminderDays = user.fillupReminderDays ?? 0;
    if (reminderDays === 0) { skipped++; continue; }

    // Debounce — don't remind more often than their chosen interval
    if (user.lastFillupReminderSentAt) {
      const lastSent = new Date(user.lastFillupReminderSentAt).getTime();
      if (now - lastSent < reminderDays * 24 * 60 * 60 * 1000) { skipped++; continue; }
    }

    // Check last fill-up date
    const fillups = getFillups(user.id).sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    if (fillups.length === 0) { skipped++; continue; }

    const lastFillup = new Date(fillups[0].date).getTime();
    const daysSince  = (now - lastFillup) / (24 * 60 * 60 * 1000);
    if (daysSince < reminderDays) { skipped++; continue; }

    const result = await sendPushNotification({
      title:       '⛽ Time to fill up?',
      body:        `It's been ${Math.round(daysSince)} days since your last fill-up. Tap to log it.`,
      url:         '/?tab=log',
      externalIds: [user.id],
    });

    if (result.recipients && result.recipients > 0) {
      setLastFillupReminderSent(user.id);
      sent++;
    } else {
      skipped++;
    }
  }

  return NextResponse.json({ sent, skipped });
}
