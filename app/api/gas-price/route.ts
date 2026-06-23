/**
 * GET /api/gas-price?lat=xx&lng=yy
 *
 * Returns the regular-unleaded gas price for the U.S. state at the given lat/lng.
 *
 * Phase A rewrite (fixes the "spins forever" bug): resolves the state LOCALLY
 * (lib/usStateFromCoords — no Nominatim) and the price from a seed/in-memory cache
 * that refreshes from EIA in the background (lib/gasPrices). The request never
 * blocks on a live external call, so it responds in ~1ms.
 */

import { NextResponse } from 'next/server';
import { usStateFromCoords } from '@/lib/usStateFromCoords';
import { getStatePrice } from '@/lib/gasPrices';

const EIA_KEY = process.env.EIA_API_KEY ?? '';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get('lat') ?? '');
  const lng = parseFloat(searchParams.get('lng') ?? '');

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: 'Missing lat/lng' }, { status: 400 });
  }

  // Surface the EIA-key-setup hint in local dev (prod always has the key in Railway).
  if (!EIA_KEY) {
    return NextResponse.json({ price: null, state: 'US', noApiKey: true });
  }

  const state = usStateFromCoords(lat, lng);          // local, instant
  const { price, live } = getStatePrice(state);       // cache/seed, instant

  return NextResponse.json({
    price:      Math.round(price * 1000) / 1000,
    state,
    isState:    state !== 'US',
    isNational: state === 'US',
    source:     'eia',
    live,                                             // true = fresh cache hit, false = seed snapshot
  });
}
