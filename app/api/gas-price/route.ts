/**
 * GET /api/gas-price?lat=xx&lng=yy
 *
 * Returns the average regular unleaded gas price for the U.S. state
 * corresponding to the supplied lat/lng, using:
 *   1. Nominatim (OpenStreetMap) reverse-geocode to resolve state
 *   2. EIA Open Data API v2 for weekly gas prices (product=EPMR, Regular Gasoline)
 *
 * EIA API key: set EIA_API_KEY in Railway environment variables (free at https://www.eia.gov/opendata/)
 * Falls back to national average if state not found or key missing.
 *
 * NOTE: EIA API v2 returns values as strings — must parseFloat(), not typeof === 'number'.
 * duoarea format: 'S' + 2-letter state code (e.g. SCA, STX) or 'NUS' for national.
 */

import { NextResponse } from 'next/server';

const EIA_KEY = process.env.EIA_API_KEY ?? '';

/** Resolve lat/lng → 2-letter US state code via Nominatim */
async function getStateFromCoords(lat: number, lng: number): Promise<string> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
    const res  = await fetch(url, {
      headers: { 'User-Agent': 'GasCap/1.0 (info@gascap.app)' },
      next:    { revalidate: 3600 },
    });
    if (!res.ok) return 'US';
    const data = await res.json() as {
      address?: {
        state_code?:       string;
        'ISO3166-2-lvl4'?: string;
      };
    };
    // Nominatim returns state_code ("CA") or ISO3166-2-lvl4 ("US-CA")
    const raw  = data.address?.state_code ?? data.address?.['ISO3166-2-lvl4'] ?? '';
    const code = raw.includes('-') ? raw.split('-')[1] : raw;
    return code?.toUpperCase() || 'US';
  } catch {
    return 'US';
  }
}

/**
 * Fetch regular gas price from EIA v2 using duoarea facet.
 * duoarea: 'S' + stateCode (e.g. 'SCA') or 'NUS' for national.
 * product: 'EPMR' = Regular Gasoline (all formulations combined).
 * Value comes back as a string from EIA — use parseFloat().
 */
async function getPriceForState(stateCode: string): Promise<number | null> {
  if (!EIA_KEY) return null;
  const duoarea = stateCode === 'US' ? 'NUS' : `S${stateCode}`;
  try {
    const url =
      `https://api.eia.gov/v2/petroleum/pri/gnd/data/` +
      `?api_key=${EIA_KEY}` +
      `&frequency=weekly` +
      `&data[0]=value` +
      `&sort[0][column]=period&sort[0][direction]=desc` +
      `&length=1` +
      `&facets[duoarea][]=${duoarea}` +
      `&facets[product][]=EPMR`;
    const res  = await fetch(url, { next: { revalidate: 3600 * 6 } });
    if (!res.ok) return null;
    const json  = await res.json() as { response?: { data?: { value?: string | number }[] } };
    const raw   = json.response?.data?.[0]?.value;
    const price = parseFloat(String(raw ?? ''));
    return isNaN(price) ? null : price;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get('lat') ?? '');
  const lng = parseFloat(searchParams.get('lng') ?? '');

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: 'Missing lat/lng' }, { status: 400 });
  }

  if (!EIA_KEY) {
    return NextResponse.json({ price: null, state: 'US', noApiKey: true });
  }

  try {
    const stateCode  = await getStateFromCoords(lat, lng);
    const statePrice = await getPriceForState(stateCode);

    // Fall back to national average if state has no data
    const price = statePrice ?? await getPriceForState('US');

    if (!price) {
      return NextResponse.json({ price: null, state: stateCode, noApiKey: false });
    }

    return NextResponse.json({
      price:      Math.round(price * 1000) / 1000,
      state:      stateCode,
      isState:    stateCode !== 'US' && statePrice !== null,
      isNational: stateCode === 'US' || statePrice === null,
      source:     'eia',
      updatedAt:  new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
}
