/**
 * GET /api/stats/aggregate
 *
 * Anonymized, aggregate community activity stats — no user names or
 * per-user data, just counts. Used to show light social-proof toasts in
 * the app ("1,240 fill-ups logged this week") without naming real users,
 * which at our current user volume would either repeat the same few
 * names constantly or require fabricating activity — both a trust risk.
 *
 * Cheap counting queries (indexed date/createdAt columns); no auth required
 * since nothing here is user-specific or sensitive.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// This route has no request-based API (headers/cookies/searchParams) to
// signal dynamic rendering, so Next.js tries to prerender it at build time —
// where DATABASE_URL isn't available (Railway only injects it at runtime),
// causing the Prisma calls to fail and the whole build to exit non-zero.
export const dynamic = 'force-dynamic';

function daysAgoStr(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function GET() {
  const weekAgoDate = daysAgoStr(7);
  const monthStart  = new Date();
  monthStart.setUTCDate(1);
  const monthStartIso = monthStart.toISOString().slice(0, 10);

  const [fillupsThisWeek, priceReportsThisWeek, fillupsThisMonthAgg] = await Promise.all([
    prisma.fillup.count({ where: { date: { gte: weekAgoDate } } }),
    prisma.priceReport.count({ where: { createdAt: { gte: weekAgoDate } } }),
    prisma.fillup.aggregate({
      where: { date: { gte: monthStartIso } },
      _sum:  { totalCost: true },
    }),
  ]);

  const dollarsTrackedThisMonth = Math.round(fillupsThisMonthAgg._sum.totalCost ?? 0);

  return NextResponse.json({
    fillupsThisWeek,
    priceReportsThisWeek,
    dollarsTrackedThisMonth,
  });
}
