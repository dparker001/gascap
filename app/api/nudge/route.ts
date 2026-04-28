/**
 * GET /api/nudge
 *
 * Returns the minimum data the EngagementNudge component needs to decide
 * which (if any) in-app nudge to show the current user.
 *
 * Keeps logic server-side so the client gets a simple JSON payload with no
 * raw PII or business logic duplication.
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import type { Session }     from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { findById }         from '@/lib/users';
import { getFillups, computeMpg } from '@/lib/fillups';

function userId(session: Session | null) {
  return session?.user?.id ?? session?.user?.email ?? '';
}

const TRIAL_DAYS = 30;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const uid  = userId(session);
  const user = await findById(uid);
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // ── Trial window ──────────────────────────────────────────────────────────
  const createdAt          = new Date(user.createdAt);
  const daysSinceCreation  = (Date.now() - createdAt.getTime()) / 86_400_000;
  const trialDaysLeft      = Math.max(0, Math.ceil(TRIAL_DAYS - daysSinceCreation));
  const isTrialUser        = user.isProTrial === true || user.plan === 'free';

  // ── Fill-up engagement ────────────────────────────────────────────────────
  const fillups    = getFillups(uid);
  const fillupCount = fillups.length;

  let daysSinceLastFillup: number | null = null;
  if (fillupCount > 0) {
    const sorted   = [...fillups].sort((a, b) => b.date.localeCompare(a.date));
    const lastDate = new Date(sorted[0].date + 'T12:00:00');
    daysSinceLastFillup = Math.floor((Date.now() - lastDate.getTime()) / 86_400_000);
  }

  // ── MPG readiness ─────────────────────────────────────────────────────────
  const hasOdometer = fillups.some((f) => f.odometerReading != null);
  const mpgMap      = computeMpg(fillups);
  const hasMpgData  = Object.values(mpgMap).some((v) => v != null);

  return NextResponse.json({
    plan:               user.plan,
    isTrialUser,
    trialDaysLeft,
    daysSinceCreation:  Math.floor(daysSinceCreation),
    fillupCount,
    daysSinceLastFillup,
    hasOdometer,
    hasMpgData,
  });
}
