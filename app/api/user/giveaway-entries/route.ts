/**
 * GET /api/user/giveaway-entries
 * Returns the current user's entry breakdown for the current month's drawing.
 * Includes base entries (active days) + streak bonus entries.
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  entryCountForMonth,
  currentMonth,
  streakBonusEntries,
  streakTierForStreak,
  nextStreakTier,
} from '@/lib/giveaway';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as { id?: string })?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { activeDays: true, plan: true, streak: true },
  });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const month       = currentMonth();
  const baseEntries = entryCountForMonth(user.activeDays ?? [], month);
  const streak      = user.streak ?? 0;
  const streakBonus = streakBonusEntries(streak);
  const entryCount  = baseEntries + streakBonus;
  const eligible    = user.plan === 'pro' || user.plan === 'fleet';

  return NextResponse.json({
    month,
    entryCount,
    baseEntries,
    streakBonus,
    streak,
    streakTier:     streakTierForStreak(streak),
    nextStreakTier: nextStreakTier(streak),
    eligible,
  });
}
