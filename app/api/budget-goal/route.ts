import { NextResponse }   from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }    from '@/lib/auth';
import { getBudgetGoal, setBudgetGoal, deleteBudgetGoal } from '@/lib/budgetGoals';
import { getFillups }     from '@/lib/fillups';

function userId(session: Awaited<ReturnType<typeof getServerSession>>): string {
  return (session?.user as { id?: string })?.id ?? session?.user?.email ?? '';
}

/** GET — returns current goal + this month's spending */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const uid   = userId(session);
  const goal  = getBudgetGoal(uid);

  // Calculate this month's spending from fillups
  const now   = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const fillups = getFillups(uid);
  const spent = fillups
    .filter((f) => f.date.startsWith(month))
    .reduce((s, f) => s + f.totalCost, 0);

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft    = daysInMonth - now.getDate();

  return NextResponse.json({
    limit:    goal?.monthlyLimit ?? null,
    spent:    Math.round(spent * 100) / 100,
    month,
    daysLeft,
    daysInMonth,
    pct:      goal ? Math.min(100, Math.round((spent / goal.monthlyLimit) * 100)) : null,
  });
}

/** POST — set or update monthly limit */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as { monthlyLimit?: number };
  if (!body.monthlyLimit || body.monthlyLimit <= 0) {
    return NextResponse.json({ error: 'Invalid limit' }, { status: 400 });
  }

  const goal = setBudgetGoal(userId(session), body.monthlyLimit);
  return NextResponse.json(goal);
}

/** DELETE — remove budget goal */
export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  deleteBudgetGoal(userId(session));
  return NextResponse.json({ ok: true });
}
