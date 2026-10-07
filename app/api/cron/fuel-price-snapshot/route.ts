/**
 * GET /api/cron/fuel-price-snapshot
 *
 * Phase 0.5B — accumulates EIA weekly retail fuel-price history into
 * FuelPriceSnapshot. WRITES insert-only (duplicates skipped); READS the
 * public EIA API. Idempotent: running it any number of times stores each
 * (area, grade, EIA week) once.
 *
 * Schedule: daily 22:25 UTC (6:25 PM EDT / 5:25 PM EST) — after EIA's
 * Monday release, and outside the protected 9:45–10:15 AM ET cron window.
 * EIA only publishes weekly; the daily cadence just makes a late/holiday
 * (Tuesday) release land within a day without any special-casing.
 *
 * ?weeks=N  (default 3, max 156) — how many recent weekly periods to pull.
 *           Use ?weeks=156 once for the initial backfill (real EIA history,
 *           nothing synthesized).
 *
 * Fails visibly: no CRON_SECRET -> 503 (our misconfiguration); wrong secret
 * -> 401; EIA unreachable / no data -> 502; EIA data itself stale (the
 * newest national Regular week is >14 days old, i.e. EIA stopped publishing)
 * -> 502, so the GitHub Actions run goes red. A normal run is silent.
 */
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { MAX_BACKFILL_WEEKS, syncFuelPriceSnapshots } from '@/lib/fuelPriceSnapshots';

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'Misconfigured' }, { status: 503 });
  }
  const { searchParams } = new URL(req.url);
  if (!secretMatches(searchParams.get('secret'), expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = parseInt(searchParams.get('weeks') ?? '3', 10);
  const weeks = Number.isFinite(parsed) ? Math.max(1, Math.min(MAX_BACKFILL_WEEKS, parsed)) : 3;

  try {
    const result = await syncFuelPriceSnapshots({ weeks });
    console.log(
      `[fuel-price-snapshot] weeks=${weeks} fetched=${result.fetched} inserted=${result.inserted} ` +
      `latestNationalRegular=${result.latestObservedOn} ageDays=${result.ageDays}`,
    );
    if (result.stale) {
      return NextResponse.json({ ok: false, error: 'EIA data is stale', ...result }, { status: 502 });
    }
    return NextResponse.json({ ok: true, weeks, ...result });
  } catch (err) {
    // Defense in depth: never let an API key reach the logs, even if some
    // layer ever puts a request URL into an error message.
    const msg = (err instanceof Error ? err.message : String(err)).replace(/api_key=[^&\s]+/gi, 'api_key=REDACTED');
    console.error('[fuel-price-snapshot] failed:', msg);
    return NextResponse.json({ ok: false, error: 'Snapshot sync failed' }, { status: 502 });
  }
}
