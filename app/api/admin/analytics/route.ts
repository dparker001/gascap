import { NextRequest, NextResponse } from 'next/server';
import { fetchAnalyticsSummary }     from '@/lib/ga4-data';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Reuse the same ADMIN_PASSWORD gate as other admin routes
  const pw   = req.nextUrl.searchParams.get('pw') ?? '';
  const days = parseInt(req.nextUrl.searchParams.get('days') ?? '30', 10);

  if (pw !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY || !process.env.GA4_PROPERTY_ID) {
    return NextResponse.json(
      { error: 'GA4 not configured — set GOOGLE_SERVICE_ACCOUNT_KEY and GA4_PROPERTY_ID in Railway.' },
      { status: 503 }
    );
  }

  try {
    const data = await fetchAnalyticsSummary(days);
    return NextResponse.json(data);
  } catch (err) {
    console.error('[GA4 API]', err);
    return NextResponse.json(
      { error: 'Failed to fetch GA4 data', detail: String(err) },
      { status: 500 }
    );
  }
}
