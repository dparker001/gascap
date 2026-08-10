import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { prisma }                    from '@/lib/prisma';

// Returns recent community price reports, grouped by placeId.
// Only Pro users can see community prices (same gate as Find Gas).

/**
 * How long a community report stays visible.
 *
 * Was 2 hours, which made the whole feature invisible in practice: pump prices
 * change roughly daily (usually overnight), not hourly, so the odds of another
 * user opening Find Gas for the same station inside a 2-hour window are close
 * to zero. Reports were being paid for with +5 giveaway entries and then never
 * shown to anyone.
 *
 * 24 hours matches the real price cycle while still expiring anything that
 * crossed an overnight change. The card labels each report's age (see
 * NearbyStations' justNow/minutesAgo/hoursAgo/daysAgo) so users can judge
 * staleness themselves — those labels were already written for reports far
 * older than two hours.
 */
const REPORT_MAX_AGE_HOURS = 24;
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({}, { status: 401 });

  const { searchParams } = new URL(req.url);
  const raw = searchParams.get('placeIds') ?? '';
  const placeIds = raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
  if (placeIds.length === 0) return NextResponse.json({});

  const cutoff = new Date(Date.now() - REPORT_MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();

  const reports = await prisma.priceReport.findMany({
    where: {
      placeId:   { in: placeIds },
      createdAt: { gte: cutoff },
    },
    select: { placeId: true, grade: true, price: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  const grouped: Record<string, { grade: string; price: number; reportedAt: string }[]> = {};
  for (const r of reports) {
    if (!grouped[r.placeId]) grouped[r.placeId] = [];
    grouped[r.placeId].push({ grade: r.grade, price: r.price, reportedAt: r.createdAt });
  }

  return NextResponse.json(grouped, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
