/**
 * GET /api/gas-price?lat=xx&lng=yy
 *
 * Returns the regular-unleaded gas price for the U.S. state at the given lat/lng.
 * If lat/lng are omitted (e.g. geolocation denied/unavailable), falls back to
 * IP-based state resolution via ipapi.co — no client permission required.
 *
 * Phase A: resolves state LOCALLY (lib/usStateFromCoords — no Nominatim) and the
 * price from a seed/in-memory cache that refreshes from EIA in the background.
 * The request never blocks on a live external call, so it responds in ~1ms for
 * GPS-based lookups and ~100-200ms for IP-based fallback.
 */

import { NextResponse } from 'next/server';
import { usStateFromCoords } from '@/lib/usStateFromCoords';
import { getStatePrice } from '@/lib/gasPrices';

const EIA_KEY = process.env.EIA_API_KEY ?? '';

async function stateFromIp(req: Request): Promise<string> {
  // Extract the real client IP from Railway / standard proxy headers.
  const headers = new Headers((req as Request & { headers: Headers }).headers);
  const ip =
    headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    headers.get('x-real-ip') ||
    '';

  if (!ip || ip === '::1' || ip === '127.0.0.1') return 'US';

  try {
    const res = await fetch(
      `https://ipapi.co/${encodeURIComponent(ip)}/json/?fields=region_code`,
      { signal: AbortSignal.timeout(4000) },
    );
    if (!res.ok) return 'US';
    const data = await res.json() as { region_code?: string };
    const code = data.region_code?.toUpperCase() ?? '';
    // Only accept 2-letter US state codes.
    return /^[A-Z]{2}$/.test(code) ? code : 'US';
  } catch {
    return 'US';
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get('lat') ?? '');
  const lng = parseFloat(searchParams.get('lng') ?? '');

  if (!EIA_KEY) {
    return NextResponse.json({ price: null, state: 'US', noApiKey: true });
  }

  let state: string;
  let locMethod: 'gps' | 'ip';

  if (!isNaN(lat) && !isNaN(lng)) {
    state = usStateFromCoords(lat, lng);
    locMethod = 'gps';
  } else {
    state = await stateFromIp(req);
    locMethod = 'ip';
  }

  const { price, live } = getStatePrice(state);

  return NextResponse.json({
    price:      Math.round(price * 1000) / 1000,
    state,
    isState:    state !== 'US',
    isNational: state === 'US',
    source:     'eia',
    live,
    locMethod,
  });
}
