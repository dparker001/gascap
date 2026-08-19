import { NextRequest, NextResponse } from 'next/server';
import { fetchAnalyticsSummary }     from '@/lib/ga4-data';
import { sessionHasAdminRole, legacyAdminPasswordOk } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Sprint 2: was `?pw=` in the query string — the one admin route that
  // didn't use the x-admin-password header like every other endpoint. A
  // query-string secret lands in server access logs, browser history, and
  // the Referer header of any outbound request the page makes; moved to the
  // header to match everything else and stop that leakage.
  const days = parseInt(req.nextUrl.searchParams.get('days') ?? '30', 10);
  const legacyOk = legacyAdminPasswordOk(req, process.env.ADMIN_PASSWORD);
  if (!legacyOk && !(await sessionHasAdminRole())) {
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
