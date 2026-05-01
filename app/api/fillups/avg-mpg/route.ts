/**
 * GET /api/fillups/avg-mpg
 *
 * Returns average MPG per vehicle for the signed-in user, computed from
 * consecutive odometer-tracked fill-up pairs.
 *
 * Reliability gate: a vehicle's average is only included when it has at least
 * THREE valid MPG readings (i.e. four or more consecutive fill-ups that all
 * have odometer readings). Fewer readings are too susceptible to noise — a
 * single bad odometer entry or a long gap between fill-ups can produce wildly
 * incorrect values.  Below the threshold the trip planner falls back to EPA
 * data instead.
 *
 * { avgMpgByVehicleId: Record<string, number> }
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { getFillups, computeMpg } from '@/lib/fillups';

const MIN_MPG_READINGS = 3;   // minimum valid pairs before we trust the average

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId  = (session.user as { id?: string }).id ?? session.user?.email ?? '';
  const fillups = getFillups(userId);
  const mpgMap  = computeMpg(fillups);

  // Bucket valid MPG values by vehicleId
  const buckets: Record<string, number[]> = {};
  for (const fillup of fillups) {
    const mpg = mpgMap[fillup.id];
    if (mpg == null) continue;
    const key = fillup.vehicleId ?? fillup.vehicleName;
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(mpg);
  }

  const avgMpgByVehicleId: Record<string, number> = {};
  for (const [key, vals] of Object.entries(buckets)) {
    // Require MIN_MPG_READINGS valid pairs — below this the signal is too noisy
    if (vals.length < MIN_MPG_READINGS) continue;
    avgMpgByVehicleId[key] =
      Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10;
  }

  return NextResponse.json({ avgMpgByVehicleId });
}
