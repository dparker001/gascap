/**
 * GET /api/gas-price/national[?grade=regular|midgrade|premium|diesel]
 *
 * Returns the latest US national average retail price from EIA for one fuel
 * grade (default regular), WITH its real observation date.
 *
 *   period     EIA survey date (YYYY-MM-DD) — when the price was observed.
 *   fetchedAt  when this server retrieved it (cache time). Not the price date.
 *   updatedAt  DEPRECATED alias of `period`, kept so existing clients keep
 *              working. It used to be the retrieval time; presenting that as
 *              the price's date was wrong (Phase 0.5B).
 *
 * Cached for 6 hours — safe for frequent client polling. No location needed
 * (NUS duoarea). Grade-specific so callers never compare a premium fill-up
 * against the regular-grade average.
 */

import { NextResponse } from 'next/server';
import { EIA_PRODUCT_BY_GRADE, normalizeGrade } from '@/lib/eiaAreas';
import { isStaleObservation } from '@/lib/eiaFreshness';

const EIA_KEY = process.env.EIA_API_KEY ?? '';

async function getNationalAverage(product: string): Promise<{ price: number; period: string } | null> {
  if (!EIA_KEY) return null;
  try {
    const url =
      `https://api.eia.gov/v2/petroleum/pri/gnd/data/` +
      `?api_key=${EIA_KEY}` +
      `&frequency=weekly` +
      `&data[0]=value` +
      `&sort[0][column]=period&sort[0][direction]=desc` +
      `&length=1` +
      `&facets[duoarea][]=NUS` +
      `&facets[product][]=${product}`;
    const res  = await fetch(url, { next: { revalidate: 3600 * 6 } });
    if (!res.ok) return null;
    const json  = await res.json() as { response?: { data?: { value?: string | number; period?: string }[] } };
    const row   = json.response?.data?.[0];
    const price = parseFloat(String(row?.value ?? ''));
    const period = String(row?.period ?? '');
    if (isNaN(price) || !/^\d{4}-\d{2}-\d{2}$/.test(period)) return null;
    return { price, period };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rawGrade = searchParams.get('grade');
  const grade = rawGrade === null ? 'regular' : normalizeGrade(rawGrade);
  if (!grade) {
    return NextResponse.json({ price: null, error: 'unsupported_grade' }, { status: 400 });
  }

  const hit = await getNationalAverage(EIA_PRODUCT_BY_GRADE[grade]);
  if (hit === null) {
    return NextResponse.json({ price: null, noApiKey: !EIA_KEY });
  }
  return NextResponse.json({
    price:     Math.round(hit.price * 1000) / 1000,
    grade,
    source:    'eia',
    period:    hit.period,
    stale:     isStaleObservation(hit.period),
    fetchedAt: new Date().toISOString(),
    updatedAt: hit.period, // deprecated alias — see header
  });
}
