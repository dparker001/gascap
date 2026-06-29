import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { prisma }                    from '@/lib/prisma';

// Returns community price reports < 2 hours old, grouped by placeId.
// Only Pro users can see community prices (same gate as Find Gas).
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({}, { status: 401 });

  const { searchParams } = new URL(req.url);
  const raw = searchParams.get('placeIds') ?? '';
  const placeIds = raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
  if (placeIds.length === 0) return NextResponse.json({});

  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

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
