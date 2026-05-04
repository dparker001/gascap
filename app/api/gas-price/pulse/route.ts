/**
 * GET /api/gas-price/pulse
 *
 * Returns the current and prior-week US national average gas prices,
 * a computed trend, and today's rotating fuel tip.
 *
 * Cached for 6 hours — same cadence as /api/gas-price/national.
 * No auth required — used by the DailyFuelPulse home-screen widget.
 */

import { NextResponse } from 'next/server';

const EIA_KEY = process.env.EIA_API_KEY ?? '';

/** Day-indexed rotating fuel tips (0 = Sunday … 6 = Saturday) */
const DAILY_TIPS: string[] = [
  'Prices often drop overnight. Monday morning fill-ups are typically the cheapest of the week.',
  'Tuesday is historically one of the cheapest days to fill up — prices tend to climb mid-week.',
  'Mid-week is your sweet spot. Prices typically start rising Thursday, so fill up today if you can.',
  'Wednesday is usually the last low-price day before the weekend surge.',
  'Prices tend to rise today through the weekend. Fill up before 5 PM if your tank is getting low.',
  'Weekend pricing is at its peak. Fill up only if necessary — Monday will likely be cheaper.',
  'Saturday is typically the most expensive day. If you can wait until Monday, you will save.',
];

async function fetchNationalPrices(): Promise<{
  current:  number | null;
  previous: number | null;
  currentPeriod: string | null;
}> {
  if (!EIA_KEY) return { current: null, previous: null, currentPeriod: null };

  try {
    const url =
      `https://api.eia.gov/v2/petroleum/pri/gnd/data/` +
      `?api_key=${EIA_KEY}` +
      `&frequency=weekly` +
      `&data[0]=value` +
      `&sort[0][column]=period&sort[0][direction]=desc` +
      `&length=2` +
      `&facets[duoarea][]=NUS` +
      `&facets[product][]=EPMR`;

    const res  = await fetch(url, { next: { revalidate: 3600 * 6 } });
    if (!res.ok) return { current: null, previous: null, currentPeriod: null };

    const json = await res.json() as {
      response?: {
        data?: { value?: string | number; period?: string }[];
      };
    };

    const rows    = json.response?.data ?? [];
    const current = rows[0]?.value !== undefined ? parseFloat(String(rows[0].value)) : NaN;
    const prev    = rows[1]?.value !== undefined ? parseFloat(String(rows[1].value)) : NaN;

    return {
      current:       isNaN(current) ? null : current,
      previous:      isNaN(prev)    ? null : prev,
      currentPeriod: rows[0]?.period ?? null,
    };
  } catch {
    return { current: null, previous: null, currentPeriod: null };
  }
}

export async function GET() {
  const { current, previous, currentPeriod } = await fetchNationalPrices();

  if (current === null) {
    return NextResponse.json({ available: false, noApiKey: !EIA_KEY });
  }

  // Compute week-over-week delta and trend
  const delta  = previous !== null ? Math.round((current - previous) * 100) / 100 : null;
  const trend: 'up' | 'down' | 'flat' | 'unknown' =
    delta === null          ? 'unknown'
    : Math.abs(delta) < 0.005 ? 'flat'
    : delta < 0             ? 'down'
    : 'up';

  // Today's rotating tip (server-side day is fine — tip is generic)
  const dayIndex = new Date().getDay();  // 0 = Sunday
  const tip = DAILY_TIPS[dayIndex];

  return NextResponse.json({
    available:     true,
    current:       Math.round(current * 1000) / 1000,
    previous:      previous !== null ? Math.round(previous * 1000) / 1000 : null,
    delta,
    trend,
    tip,
    period:        currentPeriod,
    source:        'eia',
    updatedAt:     new Date().toISOString(),
  });
}
