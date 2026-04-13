import { NextResponse }         from 'next/server';
import { getServerSession }      from 'next-auth';
import { authOptions }           from '@/lib/auth';
import { getAllUsers }            from '@/lib/users';
import { getFillups }            from '@/lib/fillups';
import { getBudgetGoal }         from '@/lib/budgetGoals';
import { sendPushNotification }  from '@/lib/oneSignal';

function buildDigestBody(userId: string): string {
  const now       = new Date();
  const month     = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const fillups   = getFillups(userId);
  const thisMonth = fillups.filter((f) => f.date.startsWith(month));
  const spent     = thisMonth.reduce((s, f) => s + f.totalCost, 0);
  const goal      = getBudgetGoal(userId);

  let body = `This month: $${spent.toFixed(2)} spent`;
  if (goal) {
    const pct = Math.round((spent / goal.monthlyLimit) * 100);
    body += ` · ${pct}% of $${goal.monthlyLimit} budget`;
  }
  body += ` · ${fillups.length} total fillup${fillups.length !== 1 ? 's' : ''}`;
  return body;
}

/** POST /api/push/digest
 *  Sends the weekly spending digest.
 *  ?all=1 sends to every user (admin use, requires session)
 *  Without ?all, sends only to the signed-in user.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const sendAll = searchParams.get('all') === '1';
  const userId  = (session.user as { id?: string })?.id ?? session.user?.email ?? '';

  if (sendAll) {
    // Send personalized digest to every user individually
    const users = getAllUsers();
    let sent = 0;
    for (const user of users) {
      const body = buildDigestBody(user.id);
      const result = await sendPushNotification({
        title:       '⛽ GasCap Weekly Digest',
        body,
        url:         '/',
        externalIds: [user.id],
      });
      if (result.recipients && result.recipients > 0) sent++;
    }
    return NextResponse.json({ sent });
  }

  // Single user digest
  const body = buildDigestBody(userId);
  const result = await sendPushNotification({
    title:       '⛽ GasCap Weekly Digest',
    body,
    url:         '/',
    externalIds: [userId],
  });

  return NextResponse.json({ sent: result.recipients ?? 0 });
}
