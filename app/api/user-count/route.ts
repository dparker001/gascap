/**
 * GET /api/user-count
 * Public endpoint — returns total registered user count.
 * Used by the landing page TrustStrip to show community size.
 * No PII exposed — count only.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const count = await prisma.user.count();
    return NextResponse.json(
      { count },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
    );
  } catch {
    // Graceful fallback — don't expose DB errors publicly
    return NextResponse.json({ count: 0 });
  }
}
