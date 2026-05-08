/**
 * GET /api/user/export
 *
 * Returns a full data export for the authenticated user as a JSON download.
 * Covers: profile, saved vehicles, fill-up history, saved trips.
 *
 * Authenticated only — users can only export their own data.
 * Excludes: hashed password, internal flags (isTestAccount, emailCampaignStep, etc.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }           from 'next-auth';
import { authOptions }                from '@/lib/auth';
import { findById }                   from '@/lib/users';
import { getVehiclesForUser }         from '@/lib/savedVehicles';
import { getFillups }                 from '@/lib/fillups';
import { getTripsForUser }            from '@/lib/savedTrips';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id?: string })?.id ?? '';
  const user   = await findById(userId);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // ── Gather data ───────────────────────────────────────────────────────────

  const vehicles = await getVehiclesForUser(userId);
  const fillups  = getFillups(userId);
  const trips    = getTripsForUser(userId);

  // ── Scrub internal-only fields from profile ───────────────────────────────

  const profile = {
    id:              user.id,
    email:           user.email,
    displayName:     user.displayName   ?? null,
    phone:           user.phone         ?? null,
    smsOptIn:        user.smsOptIn      ?? false,
    plan:            user.plan,
    isProTrial:      user.isProTrial    ?? false,
    emailOptOut:     user.emailOptOut   ?? false,
    createdAt:       user.createdAt,
    referralCode:    user.referralCode  ?? null,
    // Safe numerics
    calcCount:       user.calcCount     ?? 0,
    streak:          user.streak        ?? 0,
  };

  const payload = {
    exportedAt:  new Date().toISOString(),
    exportedBy:  user.email,
    appVersion:  'gascap-mvp',
    profile,
    vehicles,
    fillups,
    trips,
  };

  // Return as a downloadable JSON file
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type':        'application/json',
      'Content-Disposition': `attachment; filename="gascap-data-export-${new Date().toISOString().slice(0, 10)}.json"`,
      'Cache-Control':       'no-store',
    },
  });
}
