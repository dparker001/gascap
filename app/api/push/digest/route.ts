import { NextResponse }      from 'next/server';
import { getServerSession }  from 'next-auth';
import type { Session }      from 'next-auth';
import { authOptions }       from '@/lib/auth';
import { getAllSubs, getSubs } from '@/lib/pushSubscriptions';
import { getFillups }         from '@/lib/fillups';
import { getBudgetGoal }      from '@/lib/budgetGoals';
import webpush                from 'web-push';

function initVapid() {
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

/** POST /api/push/digest?all=1  — send digest to current user (or all if admin query param set) */
export async function POST(req: Request) {
  if (!initVapid()) {
    return NextResponse.json({ error: 'Push not configured.' }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const sendAll = searchParams.get('all') === '1';

  const subs = sendAll ? getAllSubs() : getSubs(
    (session.user as { id?: string })?.id ?? session.user?.email ?? ''
  );

  if (subs.length === 0) return NextResponse.json({ sent: 0 });

  // Build payload for the requesting user
  const userId   = (session.user as { id?: string })?.id ?? session.user?.email ?? '';
  const now      = new Date();
  const month    = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const fillups  = getFillups(userId);
  const thisMonth = fillups.filter((f) => f.date.startsWith(month));
  const spent    = thisMonth.reduce((s, f) => s + f.totalCost, 0);
  const goal     = getBudgetGoal(userId);

  let body = `This month: $${spent.toFixed(2)} spent`;
  if (goal) {
    const pct = Math.round((spent / goal.monthlyLimit) * 100);
    body += ` · ${pct}% of $${goal.monthlyLimit} budget`;
  }
  body += ` · ${fillups.length} total fillup${fillups.length !== 1 ? 's' : ''}`;

  const payload = JSON.stringify({
    title: '⛽ GasCap Weekly Digest',
    body,
    icon:  '/icon-192.png',
    badge: '/icon-192.png',
    url:   '/',
  });

  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        payload,
      );
      sent++;
    } catch {
      // Subscription expired — silently skip
    }
  }

  return NextResponse.json({ sent });
}
