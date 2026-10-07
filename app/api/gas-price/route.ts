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
 *
 * Phase 0.5B — every response says where the number came from and how old it is:
 *   priceSource 'eia_live'     fresh in-memory EIA observation (asOf = EIA survey date)
 *   priceSource 'eia_snapshot' newest stored FuelPriceSnapshot (asOf = EIA survey date).
 *                              Used on a cold process instead of the old committed seed.
 *   priceSource 'seed'         committed seed file (asOf = when the FILE was generated,
 *                              NOT an EIA survey date). Last resort.
 *   stale                      asOf is past the freshness threshold.
 * `asOf` is never the retrieval time.
 */

import { NextResponse } from 'next/server';
import { usStateFromCoords } from '@/lib/usStateFromCoords';
import { getStatePrice } from '@/lib/gasPrices';
import { latestSnapshotForChain } from '@/lib/fuelPriceSnapshots';
import { duoareaChainForState } from '@/lib/eiaAreas';
import { isStaleObservation } from '@/lib/eiaFreshness';

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

  let { price, live, source: priceSource, asOf, stale } = getStatePrice(state) as {
    price: number; live: boolean; source: 'eia_live' | 'eia_snapshot' | 'seed'; asOf: string; stale: boolean;
  };

  // Cold process (no fresh in-memory EIA value): prefer the newest stored EIA
  // observation over the committed seed, which can be months old. Any failure
  // (table not migrated yet, DB hiccup) falls through to the seed unchanged.
  if (!live) {
    try {
      const snap = await latestSnapshotForChain(duoareaChainForState(state), 'regular');
      if (snap && !isStaleObservation(snap.observedOn)) {
        price = snap.price;
        priceSource = 'eia_snapshot';
        asOf = snap.observedOn;
        stale = false;
      }
    } catch { /* keep seed/in-memory result */ }
  }

  return NextResponse.json({
    price:      Math.round(price * 1000) / 1000,
    state,
    isState:    state !== 'US',
    isNational: state === 'US',
    source:     'eia',
    live,
    priceSource,
    asOf,
    stale,
    locMethod,
  });
}
