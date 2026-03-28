/**
 * GET /api/fillups/avg-mpg
 * Returns average MPG per vehicle for the signed-in user based on odometer-tracked fillups.
 * { avgMpgByVehicleId: Record<string, number> }
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { getFillups, computeMpg } from '@/lib/fillups';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId  = (session.user as { id?: string }).id ?? session.user?.email ?? '';
  const fillups = getFillups(userId);
  const mpgMap  = computeMpg(fillups);

  // Group MPG values by vehicleId (fall back to vehicleName as key)
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
    if (vals.length === 0) continue;
    avgMpgByVehicleId[key] = Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10;
  }

  return NextResponse.json({ avgMpgByVehicleId });
}
