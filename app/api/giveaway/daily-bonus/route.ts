/**
 * Daily Gift Box — bonus giveaway entries
 *
 * GET  — returns { available: boolean, claimedToday: boolean, entriesEarned?: number }
 * POST — claims today's bonus (idempotent); awards 3–15 random entries
 *
 * Available to all signed-in users. Entries count toward the drawing for
 * Pro/Fleet users only (draw eligibility is enforced at draw time, not here).
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import type { Session }     from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { prisma }           from '@/lib/prisma';

function userId(session: Session | null) {
  return (session?.user as { id?: string })?.id ?? session?.user?.email ?? '';
}

/** Today in UTC (YYYY-MM-DD) */
function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Random integer in [min, max] inclusive */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const uid  = userId(session);
  const user = await prisma.user.findUnique({
    where:  { id: uid },
    select: { dailyBonusDays: true, dailyBonusEntries: true },
  });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const today        = todayUTC();
  const claimedToday = (user.dailyBonusDays ?? []).includes(today);

  return NextResponse.json({
    available:      !claimedToday,
    claimedToday,
    totalEarned:    user.dailyBonusEntries ?? 0,
  });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const uid  = userId(session);
  const user = await prisma.user.findUnique({
    where:  { id: uid },
    select: { dailyBonusDays: true, dailyBonusEntries: true },
  });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const today = todayUTC();

  // Idempotency — already claimed today
  if ((user.dailyBonusDays ?? []).includes(today)) {
    return NextResponse.json({
      awarded:     false,
      entriesWon:  0,
      totalEarned: user.dailyBonusEntries ?? 0,
      message:     'Already claimed today.',
    });
  }

  // Award 3–15 random entries
  const entriesWon     = randInt(3, 15);
  const updatedDays    = [...(user.dailyBonusDays ?? []), today];
  const updatedTotal   = (user.dailyBonusEntries ?? 0) + entriesWon;

  await prisma.user.update({
    where: { id: uid },
    data:  {
      dailyBonusDays:    updatedDays,
      dailyBonusEntries: updatedTotal,
    },
  });

  return NextResponse.json({
    awarded:     true,
    entriesWon,
    totalEarned: updatedTotal,
  });
}
