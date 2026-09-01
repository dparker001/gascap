/**
 * GET /api/user/trial-value
 *
 * Server-authoritative Trial Value Summary for the TrialExpiryBanner
 * (TC-2A, 2026-09-01). Returns only the four aggregate counts from
 * lib/trialValue.ts — no raw rows, no PII.
 *
 * Auth: session-only. The user id is taken exclusively from the
 * authenticated server session; the request cannot supply or influence
 * which user's data is returned (no userId is read from query/body/headers).
 * No writes, no side effects. Never cross-user-cacheable.
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { getTrialValueSummary } from '@/lib/trialValue';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id?: string }).id ?? session.user.email ?? '';
  const summary = await getTrialValueSummary(userId);

  return NextResponse.json(summary, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
