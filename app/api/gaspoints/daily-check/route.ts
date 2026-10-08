/**
 * POST /api/gaspoints/daily-check
 *
 * The explicit Daily Fuel Check. The server owns every rule: the body may carry
 * ONLY an optional display `grade`. Any other field (points, action, idempotency
 * key, user id, …) is rejected with 400. Identity comes from the session; admin
 * accounts get 403 and earn nothing.
 *
 * Atomically (idempotent inserts) evaluates the daily +5, the one-time +25
 * welcome bonus and the weekly 3-day +25 mission, then — best effort, never
 * failing the check — the G2 Weekend Check challenge when it is this user's
 * selected challenge. Returns the awards THIS call created (each listed
 * separately) plus the updated status and the fuel pulse. A repeat the same
 * GasCap day awards zero.
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { completeDailyCheckWithChallenges } from '@/lib/gasChallengeAwards';
import { PULSE_GRADES, defaultPulseGrade, loadFuelPulse } from '@/lib/fuelPulse';
import { checkRateLimitDb, hashRateLimitIdentifier } from '@/lib/rateLimitDb';
import type { FuelGrade } from '@/lib/eiaAreas';

const ALLOWED_KEYS = new Set(['grade']);

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown = {};
  const text = await req.text();
  if (text.trim()) {
    try { body = JSON.parse(text); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  for (const k of Object.keys(input)) {
    if (!ALLOWED_KEYS.has(k)) return NextResponse.json({ error: `Unknown field: ${k}` }, { status: 400 });
  }
  if (input.grade !== undefined && !PULSE_GRADES.includes(input.grade as FuelGrade)) {
    return NextResponse.json({ error: 'Invalid grade' }, { status: 400 });
  }

  const rl = await checkRateLimitDb(`gaspoints-daily:user:${hashRateLimitIdentifier(userId)}`, 20, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  try {
    const result = await completeDailyCheckWithChallenges(userId);
    if ('ineligible' in result) return NextResponse.json({ error: 'Not eligible' }, { status: 403 });
    const grade = (input.grade as FuelGrade | undefined) ?? await defaultPulseGrade(userId);
    const pulse = await loadFuelPulse(grade);
    return NextResponse.json({ ...result, pulse }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[gaspoints] daily check failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to complete the Daily Fuel Check' }, { status: 500 });
  }
}
