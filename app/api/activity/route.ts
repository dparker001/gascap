/**
 * POST /api/activity   — record a user action, evaluate badges, return new ones
 * GET  /api/activity   — return the current user's badge + streak summary
 */
import { NextResponse }    from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }     from '@/lib/auth';
import { findById, recordActivity, calcStreak, STREAK_MILESTONES, type ActivityEvent } from '@/lib/users';
import { BADGES, evaluateEarned, type BadgeDef } from '@/lib/badges';
import { getVehiclesForUser }     from '@/lib/savedVehicles';

// ── GET — current badge state ─────────────────────────────────────────────
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';
  const [user, vehicles] = await Promise.all([findById(userId), getVehiclesForUser(userId)]);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Accept ?localDate=YYYY-MM-DD so calcStreak uses the viewer's local day boundary
  const { searchParams } = new URL(req.url);
  const localDate = searchParams.get('localDate') ?? undefined;

  const vehicleCount = vehicles.length;
  const earned = user.badges ?? [];
  const now    = new Date();

  // Active (non-expired, non-redeemed) streak credits
  const activeStreakCredits = (user.streakCredits ?? []).filter(
    (c) => !c.redeemedAt && new Date(c.expiresAt) > now,
  );

  return NextResponse.json({
    badges:  earned,
    streak:  calcStreak(user.activeDays ?? [], localDate),
    stats: {
      calcCount:       user.calcCount       ?? 0,
      budgetCalcCount: user.budgetCalcCount ?? 0,
      locationLookups: user.locationLookups ?? 0,
      daysActive:      (user.activeDays ?? []).length,
      vehicleCount,
    },
    // Full catalogue with earned flag, so the client can render all badges
    catalogue: BADGES.map((b) => ({ ...b, earned: earned.includes(b.id) })),
    // Streak reward data
    streakMilestonesHit: user.streakMilestonesHit ?? [],
    streakCredits:       activeStreakCredits,
    streakMilestones:    STREAK_MILESTONES,
  });
}

// ── POST — record an event ────────────────────────────────────────────────
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  // Silently succeed for guests — no badges for unauthenticated users
  if (!session?.user) return NextResponse.json({ newBadges: [], badges: [], streak: 0 });

  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';

  let event: ActivityEvent = 'visit';
  let localDate: string | undefined;
  try {
    const body = await req.json() as { event?: string; localDate?: string };
    if (['calc', 'budget_calc', 'location_lookup', 'visit'].includes(body.event ?? '')) {
      event = body.event as ActivityEvent;
    }
    if (typeof body.localDate === 'string') localDate = body.localDate;
  } catch { /* empty body is fine */ }

  const result = await recordActivity(userId, event, localDate);

  // Resolve full badge objects for any newly earned badges
  const newBadgeDefs = result.newBadges.map((id) => BADGES.find((b) => b.id === id)).filter((b): b is BadgeDef => b !== undefined);

  return NextResponse.json({
    newBadges:        newBadgeDefs,
    badges:           result.badges,
    streak:           result.streak,
    newMilestonesHit: result.newMilestonesHit,
  });
}
