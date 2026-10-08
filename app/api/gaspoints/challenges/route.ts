/**
 * GET /api/gaspoints/challenges
 *
 * Gamification G2-A — READ-ONLY. Returns the signed-in user's three weekly
 * challenges for the current GasCap week (Mon–Sun, America/New_York), with
 * authoritative progress and status. The set is selected server-side
 * (deterministic: user + week + version); the client cannot choose, declare
 * completion or pass any parameter. Makes no writes of any kind: no ledger rows,
 * no analytics, no badge/streak/giveaway/user mutation. Admin accounts get
 * `{ eligible: false }`, consistent with G1 GasPoints eligibility.
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getWeeklyChallenges } from '@/lib/gasChallenges';

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const result = await getWeeklyChallenges(userId);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[gaspoints] challenges failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to load challenges' }, { status: 500 });
  }
}
