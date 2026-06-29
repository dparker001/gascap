import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { prisma }                    from '@/lib/prisma';
import { randomUUID }                from 'crypto';

const VALID_GRADES  = ['REGULAR', 'MIDGRADE', 'PREMIUM', 'DIESEL'] as const;
const ENTRIES       = 5;
const MAX_DISTANCE_MI = 0.5;
const DAILY_CAP     = 5; // max reports/day across all stations

function haversineMi(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R  = 3958.8;
  const dL = ((lat2 - lat1) * Math.PI) / 180;
  const dN = ((lng2 - lng1) * Math.PI) / 180;
  const a  =
    Math.sin(dL / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dN / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id?: string })?.id;
  if (!userId)        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const { placeId, stationName, stationLat, stationLng, userLat, userLng, grade, price } = body;

  if (
    typeof placeId      !== 'string' || !placeId ||
    typeof stationName  !== 'string' || !stationName ||
    typeof stationLat   !== 'number' ||
    typeof stationLng   !== 'number' ||
    typeof userLat      !== 'number' ||
    typeof userLng      !== 'number' ||
    !VALID_GRADES.includes(grade) ||
    typeof price        !== 'number' || price < 0.50 || price > 10.00
  ) {
    return NextResponse.json({ error: 'Invalid fields' }, { status: 400 });
  }

  // Proximity check — user must be within 0.5 mi of the station
  const dist = haversineMi(userLat, userLng, stationLat, stationLng);
  if (dist > MAX_DISTANCE_MI) {
    return NextResponse.json(
      { error: `You must be within ${MAX_DISTANCE_MI} mi of the station to report a price (you are ${dist.toFixed(2)} mi away).` },
      { status: 403 },
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  // Rate limit: 1 report per station+grade per day per user
  const existingToday = await prisma.priceReport.findFirst({
    where: {
      userId,
      placeId,
      grade,
      createdAt: { startsWith: today },
    },
    select: { id: true },
  });
  if (existingToday) {
    return NextResponse.json(
      { error: 'You already reported a price for this grade at this station today.' },
      { status: 409 },
    );
  }

  // Daily cap: max DAILY_CAP reports across all stations
  const todayCount = await prisma.priceReport.count({
    where: { userId, createdAt: { startsWith: today } },
  });
  if (todayCount >= DAILY_CAP) {
    return NextResponse.json(
      { error: `You've reached the ${DAILY_CAP} price reports/day limit. Come back tomorrow!` },
      { status: 429 },
    );
  }

  // Save report + award entries atomically
  const [report] = await prisma.$transaction([
    prisma.priceReport.create({
      data: {
        id:          randomUUID(),
        userId,
        placeId,
        stationName,
        lat:         stationLat,
        lng:         stationLng,
        grade,
        price,
        createdAt:   new Date().toISOString(),
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data:  { priceReportEntries: { increment: ENTRIES } },
    }),
  ]);

  return NextResponse.json({ success: true, reportId: report.id, entriesAwarded: ENTRIES });
}
