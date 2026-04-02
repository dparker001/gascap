/**
 * POST /api/cron/digest
 *
 * Sends a personalized weekly fuel digest push notification to every
 * subscriber. Protected by x-cron-secret header — only callable by
 * the internal node-cron scheduler (instrumentation.ts) or an admin.
 *
 * Schedule: every Sunday at 8:00 AM ET (set in instrumentation.ts)
 */

import { NextResponse }                    from 'next/server';
import { getAllSubs }                       from '@/lib/pushSubscriptions';
import { getFillups }                      from '@/lib/fillups';
import { getBudgetGoal }                   from '@/lib/budgetGoals';
import { findById }                        from '@/lib/users';
import webpush                             from 'web-push';

const CRON_SECRET = process.env.CRON_SECRET ?? '';

function initVapid(): boolean {
  const pub  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? 'mailto:hello@gascap.app',
    pub,
    priv,
  );
  return true;
}

export async function POST(req: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const secret = req.headers.get('x-cron-secret') ?? '';
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!initVapid()) {
    return NextResponse.json({ error: 'Push not configured — check VAPID env vars.' }, { status: 503 });
  }

  const allSubs = getAllSubs();
  if (allSubs.length === 0) {
    return NextResponse.json({ sent: 0, users: 0, message: 'No subscribers.' });
  }

  // Deduplicate by userId so each person gets exactly one digest
  const userIds = Array.from(new Set(allSubs.map((s) => s.userId)));

  const now   = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  let sent = 0;

  for (const userId of userIds) {
    const user = findById(userId);
    if (!user) continue;

    // Build personalized stats
    const fillups   = getFillups(userId);
    const thisMonth = fillups.filter((f) => f.date.startsWith(month));
    const spent     = thisMonth.reduce((s, f) => s + f.totalCost, 0);
    const goal      = getBudgetGoal(userId);

    const name = user.displayName ?? user.name.split(' ')[0];

    let body = `This month: $${spent.toFixed(2)} spent`;
    if (goal) {
      const pct = Math.round((spent / goal.monthlyLimit) * 100);
      body += ` · ${pct}% of $${goal.monthlyLimit} budget`;
    }
    body += ` · ${fillups.length} fill-up${fillups.length !== 1 ? 's' : ''} total`;

    const payload = JSON.stringify({
      title: `⛽ GasCap Weekly Digest${name ? `, ${name}` : ''}`,
      body,
      icon:  '/icon-192.png',
      badge: '/icon-192.png',
      url:   '/',
    });

    // Send to all push subscriptions for this user
    const userSubs = allSubs.filter((s) => s.userId === userId);
    for (const sub of userSubs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          payload,
        );
        sent++;
      } catch {
        // Subscription expired or invalid — skip silently
      }
    }
  }

  console.log(`[Cron/Digest] Sent ${sent} notification(s) to ${userIds.length} user(s)`);
  return NextResponse.json({ sent, users: userIds.length });
}
