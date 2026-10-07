/**
 * GET /api/fillups/savings
 *
 * Phase 0.5B — the user's fuel savings, computed server-side with a
 * defensible baseline (see lib/savingsBaseline.ts for the rules):
 *
 *   - each fill-up is compared against the EIA price of ITS OWN fuel grade
 *     for the EIA week on/before ITS OWN fill date — never today's price,
 *     never a different grade, never a hardcoded fallback;
 *   - a baseline frozen onto the fill-up at log time wins over a lookup;
 *   - a fill-up with no reliable baseline is excluded with a reason, and the
 *     response says how many were excluded so the UI can be honest about
 *     coverage instead of showing a number that looks like the whole story.
 *
 * READ-ONLY. Auth: signed-in user, own data only.
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getFillups } from '@/lib/fillups';
import { loadNationalSnapshots } from '@/lib/fuelPriceSnapshots';
import { summarizeSavings, MAX_BASELINE_AGE_DAYS, BASELINE_SOURCE, type NationalSnapshots } from '@/lib/savingsBaseline';

function shiftDate(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const uid = (session.user as { id?: string }).id ?? session.user.email ?? '';
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const fillups = await getFillups(uid);

  let national: NationalSnapshots = {};
  let historyAvailable = true;
  if (fillups.length > 0) {
    const earliest = fillups.map((f) => f.date).sort()[0];
    try {
      national = await loadNationalSnapshots(shiftDate(earliest, -MAX_BASELINE_AGE_DAYS));
    } catch (err) {
      // Snapshot table missing/unreachable: degrade to "no baseline" for
      // fill-ups that don't already carry a stored one. Never invent one.
      historyAvailable = false;
      console.error('[fillups/savings] snapshot read failed:', err instanceof Error ? err.message : err);
    }
  }

  const summary = summarizeSavings(
    fillups.map((f) => ({
      id: f.id,
      date: f.date,
      gallonsPumped: f.gallonsPumped,
      pricePerGallon: f.pricePerGallon,
      totalCost: f.totalCost,
      fuelGrade: f.fuelGrade ?? null,
      baselinePrice: f.baselinePrice ?? null,
      baselineSource: f.baselineSource ?? null,
      baselineArea: f.baselineArea ?? null,
      baselinePeriod: f.baselinePeriod ?? null,
    })),
    national,
  );

  return NextResponse.json({
    summary,
    historyAvailable,
    method: {
      source: BASELINE_SOURCE,
      maxBaselineAgeDays: MAX_BASELINE_AGE_DAYS,
    },
  });
}
