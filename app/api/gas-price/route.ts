/**
 * GET /api/gas-price?lat=xx&lng=yy
 *
 * Returns the average regular unleaded gas price for the U.S. state
 * corresponding to the supplied lat/lng, using:
 *   1. Nominatim (OpenStreetMap) reverse-geocode to resolve state
 *   2. EIA Open Data API for state-level weekly gas prices
 *
 * EIA API key: set EIA_API_KEY in .env.local (free at https://www.eia.gov/opendata/)
 * If no key is set, falls back to the national average from EIA.
 *
 * Rate limits: Nominatim asks for max 1 req/s — fine for user-triggered lookups.
 */

import { NextResponse } from 'next/server';

// EIA series IDs for state-level weekly retail gas prices (regular grade)
// Full list: https://www.eia.gov/opendata/v1/qb.php?category=240692
const STATE_SERIES: Record<string, string> = {
  CA: 'EMM_EPMRU_PTE_SCA_DPG',
  NY: 'EMM_EPMRU_PTE_SNY_DPG',
  TX: 'EMM_EPMRU_PTE_STX_DPG',
  FL: 'EMM_EPMRU_PTE_SFL_DPG',
  WA: 'EMM_EPMRU_PTE_SWA_DPG',
  // National average (fallback)
  US: 'EMM_EPMRU_PTE_NUS_DPG',
};

const EIA_KEY = process.env.EIA_API_KEY ?? '';

async function getStateFromCoords(lat: number, lng: number): Promise<string> {
  const url =
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'GasCap-MVP/1.0 (contact@example.com)' },
    next:    { revalidate: 3600 }, // cache 1 hour
  });
  if (!res.ok) return 'US';
  const data = await res.json() as { address?: { state_code?: string } };
  return data.address?.state_code?.toUpperCase() ?? 'US';
}

async function getPriceForSeries(series: string): Promise<number | null> {
  if (!EIA_KEY) return null;
  // EIA v2 API
  const url =
    `https://api.eia.gov/v2/petroleum/pri/gnd/data/?api_key=${EIA_KEY}` +
    `&frequency=weekly&data[0]=value&sort[0][column]=period&sort[0][direction]=desc&length=1` +
    `&facets[series][]=${series}`;
  const res = await fetch(url, { next: { revalidate: 3600 * 6 } }); // cache 6 hours
  if (!res.ok) return null;
  const json = await res.json() as { response?: { data?: { value?: number }[] } };
  const value = json.response?.data?.[0]?.value;
  return typeof value === 'number' ? value : null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get('lat') ?? '');
  const lng = parseFloat(searchParams.get('lng') ?? '');

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: 'Missing lat/lng' }, { status: 400 });
  }

  try {
    // 1. Resolve state
    const stateCode = await getStateFromCoords(lat, lng);

    // 2. Look up gas price
    const series = STATE_SERIES[stateCode] ?? STATE_SERIES['US'];
    const statePrice = await getPriceForSeries(series);

    // 3. Fallback: if no EIA key or series missing, try national average
    const nationalPrice = statePrice === null
      ? await getPriceForSeries(STATE_SERIES['US'])
      : null;

    const price = statePrice ?? nationalPrice;

    if (!price) {
      // No key configured — return helpful metadata so client knows what to show
      return NextResponse.json({
        price:     null,
        state:     stateCode,
        noApiKey:  !EIA_KEY,
        source:    'eia',
      });
    }

    return NextResponse.json({
      price:      Math.round(price * 100) / 100,
      state:      stateCode,
      isState:    stateCode !== 'US',
      isNational: stateCode === 'US' || statePrice === null,
      source:     'eia',
      updatedAt:  new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
}
