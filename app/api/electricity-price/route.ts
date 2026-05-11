/**
 * GET /api/electricity-price?lat=xx&lng=yy
 *
 * Returns the average residential electricity price ($/kWh) for the U.S. state
 * corresponding to the supplied lat/lng, using:
 *   1. Nominatim (OpenStreetMap) reverse-geocode to resolve state
 *   2. EIA Open Data API v2 — electricity/retail-sales endpoint
 *
 * EIA returns prices in cents/kWh — we divide by 100 to return $/kWh.
 * Uses the same EIA_API_KEY env var as /api/gas-price (free at eia.gov/opendata).
 * Falls back to US national average if state data unavailable.
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
      address?: { state_code?: string; 'ISO3166-2-lvl4'?: string };
    };
    const raw  = data.address?.state_code ?? data.address?.['ISO3166-2-lvl4'] ?? '';
    const code = raw.includes('-') ? raw.split('-')[1] : raw;
    return code?.toUpperCase() || 'US';
  } catch {
    return 'US';
  }
}

/**
 * Fetch residential electricity price from EIA v2.
 * Returns price in $/kWh (EIA value is in cents/kWh — divide by 100).
 * stateCode: 2-letter code ('FL', 'CA') or 'US' for national average.
 */
async function getElectricityPrice(stateCode: string): Promise<number | null> {
  if (!EIA_KEY) return null;
  try {
    const params = new URLSearchParams({
      api_key:                    EIA_KEY,
      frequency:                  'monthly',
      'data[0]':                  'price',
      'facets[sectorName][]':     'residential',
      'sort[0][column]':          'period',
      'sort[0][direction]':       'desc',
      offset:                     '0',
      length:                     '1',
    });
    if (stateCode !== 'US') {
      params.set('facets[stateid][]', stateCode);
    }
    const url = `https://api.eia.gov/v2/electricity/retail-sales/data/?${params.toString()}`;
    const res  = await fetch(url, { next: { revalidate: 3600 * 24 } }); // cache 24 hrs
    if (!res.ok) return null;
    const json = await res.json() as { response?: { data?: { price?: string | number }[] } };
    const raw  = json.response?.data?.[0]?.price;
    const cents = parseFloat(String(raw ?? ''));
    if (isNaN(cents) || cents <= 0) return null;
    return Math.round((cents / 100) * 10000) / 10000; // cents → $/kWh, 4 decimal places
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
    const stateCode    = await getStateFromCoords(lat, lng);
    const statePrice   = await getElectricityPrice(stateCode);
    const nationalPrice = await getElectricityPrice('US');
    const price = statePrice ?? nationalPrice;

    return NextResponse.json({
      price,
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
