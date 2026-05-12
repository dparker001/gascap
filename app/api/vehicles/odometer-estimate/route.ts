/**
 * GET /api/vehicles/odometer-estimate?vehicleId=xxx
 *
 * Returns a smart odometer estimate for a vehicle based on the user's
 * fill-up history. Uses consecutive fill-ups with odometer readings to
 * compute an average miles/day rate, then projects forward from the most
 * recent reading.
 *
 * Response:
 *   { confidence: 'none' }                        — no odometer history
 *   { confidence: 'low'|'high', estimatedOdometer, lastOdometer,
 *     daysSince, avgMilesPerDay }
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import type { Session }     from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { prisma }           from '@/lib/prisma';

function userId(session: Session | null) {
  return session?.user?.id ?? session?.user?.email ?? '';
}

/** Parse YYYY-MM-DD → UTC midnight timestamp (ms) */
function parseDate(d: string): number {
  return new Date(`${d}T00:00:00Z`).getTime();
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const uid = userId(session);
  const { searchParams } = new URL(req.url);
  const vehicleId = searchParams.get('vehicleId');
  if (!vehicleId) return NextResponse.json({ error: 'vehicleId required' }, { status: 400 });

  // Fetch all fill-ups for this vehicle that have an odometer reading,
  // oldest first, scoped to the authenticated user for security.
  const rows = await prisma.fillup.findMany({
    where: {
      userId: uid,
      vehicleId,
      odometerReading: { not: null },
    },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    select:  { date: true, odometerReading: true },
  });

  if (rows.length === 0) {
    return NextResponse.json({ confidence: 'none' });
  }

  // Need at least one reading for a baseline.
  // Need at least two to compute a rate.
  const readings = rows as { date: string; odometerReading: number }[];

  const lastReading = readings[readings.length - 1];
  const todayMs     = Date.now();
  const daysSince   = Math.max(0, (todayMs - parseDate(lastReading.date)) / 86_400_000);

  if (readings.length === 1) {
    // Only one data point — can't compute a rate, just return the reading
    // with a note so the UI can at least show the last known odometer.
    return NextResponse.json({
      confidence:        'none',
      lastOdometer:      lastReading.odometerReading,
      daysSince:         Math.round(daysSince),
    });
  }

  // Compute miles/day from every consecutive pair
  const rates: number[] = [];
  for (let i = 1; i < readings.length; i++) {
    const prev  = readings[i - 1];
    const curr  = readings[i];
    const miles = curr.odometerReading - prev.odometerReading;
    const days  = (parseDate(curr.date) - parseDate(prev.date)) / 86_400_000;

    // Sanity guards:
    //   • miles must be positive (no odometer rollbacks)
    //   • days must be at least 0.5 (same-day fill-ups skipped)
    //   • rate cap at 600 mi/day (excludes data-entry errors)
    if (miles > 0 && days >= 0.5 && miles / days <= 600) {
      rates.push(miles / days);
    }
  }

  if (rates.length === 0) {
    // All pairs were invalid (e.g. bad odometer entries). Fall back to last known.
    return NextResponse.json({
      confidence:   'none',
      lastOdometer: lastReading.odometerReading,
      daysSince:    Math.round(daysSince),
    });
  }

  const avgMilesPerDay     = rates.reduce((a, b) => a + b, 0) / rates.length;
  const estimatedOdometer  = Math.round(lastReading.odometerReading + daysSince * avgMilesPerDay);

  // 'high' = 3+ valid rate samples; 'low' = 1–2 samples
  const confidence: 'high' | 'low' = rates.length >= 3 ? 'high' : 'low';

  return NextResponse.json({
    confidence,
    estimatedOdometer,
    lastOdometer:   lastReading.odometerReading,
    daysSince:      Math.round(daysSince),
    avgMilesPerDay: Math.round(avgMilesPerDay),
  });
}
