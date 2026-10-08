/**
 * GET /api/gaspoints[?grade=regular|midgrade|premium|diesel]
 *
 * Read-only status for the signed-in user: GasPoints balance, level, today's
 * Daily Fuel Check status, the Mon–Sun weekly 3-day mission progress, the
 * existing visit streak (read-only) and the fuel pulse for the display grade.
 * Never awards anything. Identity comes from the session only.
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getStatus } from '@/lib/gasPoints';
import { PULSE_GRADES, defaultPulseGrade, loadFuelPulse } from '@/lib/fuelPulse';
import type { FuelGrade } from '@/lib/eiaAreas';

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const raw = new URL(req.url).searchParams.get('grade');
  if (raw !== null && !PULSE_GRADES.includes(raw as FuelGrade)) {
    return NextResponse.json({ error: 'Invalid grade' }, { status: 400 });
  }

  try {
    const status = await getStatus(userId);
    if (!status.eligible) return NextResponse.json({ eligible: false }, { headers: { 'Cache-Control': 'no-store' } });
    const grade = (raw as FuelGrade | null) ?? await defaultPulseGrade(userId);
    const pulse = await loadFuelPulse(grade);
    return NextResponse.json({ ...status, pulse }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[gaspoints] status failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to load GasPoints' }, { status: 500 });
  }
}
