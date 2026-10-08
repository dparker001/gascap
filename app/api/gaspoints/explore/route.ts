/**
 * POST /api/gaspoints/explore   { "grade": "regular" | "midgrade" | "premium" | "diesel" }
 *
 * Gamification G2-B — the server-authoritative Fuel Explorer interaction. It
 * represents an intentional "compare another fuel grade" action, not merely
 * loading price data (the price GET stays read-only and never completes it).
 *
 * The body may carry ONLY `grade`. Any other field — userId, points, action,
 * challengeId, idempotencyKey, completed, … — is rejected with 400. Identity comes
 * from the session only; admin accounts earn nothing.
 *
 * +15 GasPoints (`challenge_fuel_explorer`) is awarded only if ALL hold, each derived
 * on the server: the GasCap week is >= G2_REWARDS_START_WEEK; Fuel Explorer is in the
 * user's authoritative weekly set (slot 2); the user completed a Daily Fuel Check this
 * week; the grade is supported; the grade differs from the server-derived default pulse
 * grade (latest priceable grade from the last valid fill-up, else Regular); and it has
 * not been awarded this week (unique ledger key — repeats and concurrent calls award 0).
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { awardFuelExplorerIfEligible } from '@/lib/gasChallengeAwards';
import { PULSE_GRADES } from '@/lib/fuelPulse';
import { checkRateLimitDb, hashRateLimitIdentifier } from '@/lib/rateLimitDb';

const ALLOWED_KEYS = new Set(['grade']);

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = JSON.parse(await req.text()); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  const input = body as Record<string, unknown>;
  for (const k of Object.keys(input)) {
    if (!ALLOWED_KEYS.has(k)) return NextResponse.json({ error: `Unknown field: ${k}` }, { status: 400 });
  }
  if (typeof input.grade !== 'string' || !(PULSE_GRADES as string[]).includes(input.grade)) {
    return NextResponse.json({ error: 'Invalid grade' }, { status: 400 });
  }

  const rl = await checkRateLimitDb(`gaspoints-explore:user:${hashRateLimitIdentifier(userId)}`, 30, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  const { outcome, award } = await awardFuelExplorerIfEligible(userId, input.grade);
  if (outcome === 'ineligible') return NextResponse.json({ error: 'Not eligible' }, { status: 403 });
  return NextResponse.json(
    { awards: award ? [award] : [], totalAwarded: award?.points ?? 0, outcome },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
