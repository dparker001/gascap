/**
 * POST /api/activity   — record a user action, evaluate badges, return new ones
 * GET  /api/activity   — return the current user's badge + streak summary
 */
import { NextResponse }    from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }     from '@/lib/auth';
import { findById, recordActivity, type ActivityEvent } from '@/lib/users';
import { BADGES, evaluateEarned } from '@/lib/badges';
import { getVehiclesForUser }     from '@/lib/savedVehicles';

// ── GET — current badge state ─────────────────────────────────────────────
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';
  const user   = findById(userId);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const vehicleCount = getVehiclesForUser(userId).length;
  const earned = user.badges ?? [];

  return NextResponse.json({
    badges:  earned,
    streak:  user.streak ?? 0,
    stats: {
      calcCount:       user.calcCount       ?? 0,
      budgetCalcCount: user.budgetCalcCount ?? 0,
      locationLookups: user.locationLookups ?? 0,
      daysActive:      (user.activeDays ?? []).length,
      vehicleCount,
    },
    // Full catalogue with earned flag, so the client can render all badges
    catalogue: BADGES.map((b) => ({ ...b, earned: earned.includes(b.id) })),
  });
}

// ── POST — record an event ────────────────────────────────────────────────
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  // Silently succeed for guests — no badges for unauthenticated users
  if (!session?.user) return NextResponse.json({ newBadges: [], badges: [], streak: 0 });

  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';

  let event: ActivityEvent = 'visit';
  try {
    const body = await req.json() as { event?: string };
    if (['calc', 'budget_calc', 'location_lookup', 'visit'].includes(body.event ?? '')) {
      event = body.event as ActivityEvent;
    }
  } catch { /* empty body is fine */ }

  const result = recordActivity(userId, event);

  // Resolve full badge objects for any newly earned badges
  const newBadgeDefs = result.newBadges.map((id) => BADGES.find((b) => b.id === id)).filter(Boolean);

  return NextResponse.json({
    newBadges: newBadgeDefs,
    badges:    result.badges,
    streak:    result.streak,
  });
}
