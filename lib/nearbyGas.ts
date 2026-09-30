/**
 * Google Places API (New) — nearby gas station prices.
 *
 * Server-only. Accepts lat/lng, returns the closest stations with fuelOptions
 * prices normalised into simple dollar amounts. Results are cached 30 min in
 * memory so repeated "Find Gas" opens don't burn through the Places budget.
 *
 * fetchStationPrices() resolves current prices for specific saved stations
 * by placeId (Place Details) — see the section at the bottom of this file.
 *
 * Requires: GOOGLE_PLACES_API_KEY env var (Places API (New) enabled in GCP).
 */

import { freshestPriceTime } from '@/lib/fuelPriceFreshness';

export { freshestPriceTime };

export interface FuelPrice {
  type:      'REGULAR' | 'MIDGRADE' | 'PREMIUM' | 'DIESEL';
  label:     string;         // "Regular", "Midgrade", "Premium", "Diesel"
  price:     number;         // dollars, e.g. 3.89
  updatedAt: string | null;  // ISO string from Google, or null
}

export interface NearbyStation {
  placeId:     string;
  name:        string;
  address:     string;
  distanceMi:  number;
  lat:         number;
  lng:         number;
  prices:      FuelPrice[];
  isOpen:      boolean | null;
  googleMapsUrl: string;
}

// ── In-memory cache (30 min) keyed by rounded lat/lng ─────────────────────

interface CacheEntry {
  stations:  NearbyStation[];
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 60 * 1000;
const RADIUS_METERS = 8046; // 5 miles

// ── Helpers ────────────────────────────────────────────────────────────────

function cacheKey(lat: number, lng: number): string {
  // Round to 2 decimals (~1.1 km grid) so repeat searches from roughly the
  // same spot share a cache entry. Was 1 decimal (~11 km): a second search
  // up to ~5 miles away got the first searcher's 5-mile circle, so nearby
  // stations could be missing entirely. Distances are recomputed per request
  // regardless (see withDistancesFrom).
  return `${Math.round(lat * 100) / 100},${Math.round(lng * 100) / 100}`;
}

/**
 * Distance is a property of the REQUEST, not of the cached station list —
 * a cache hit must never return distances measured from whoever populated
 * the entry, nor stations outside THIS request's search radius.
 *
 * Known residual (accepted, 2026-09-30 review): the cached set came from the
 * first searcher's circle, so a station just inside the edge of this
 * request's circle on the far side may be missing if Google never returned
 * it. The 0.01° key bounds that offset to ~0.5 mi.
 */
function withDistancesFrom(stations: NearbyStation[], lat: number, lng: number): NearbyStation[] {
  const radiusKm = RADIUS_METERS / 1000;
  return stations
    .map((s) => ({ s, km: haversineKm(lat, lng, s.lat, s.lng) }))
    .filter(({ km }) => km <= radiusKm)
    .sort((a, b) => a.km - b.km)
    .map(({ s, km }) => ({ ...s, distanceMi: Math.round(km * 0.621371 * 10) / 10 }));
}

/**
 * Google returns price as { units: "3", nanos: 890000000 } → 3.89
 * units is int64 serialised as a string in JSON; nanos is a regular number.
 */
function nanosToPrice(money: { units?: number | string; nanos?: number | string } | undefined): number | null {
  if (!money) return null;
  const units = Number(money.units ?? 0);
  const nanos = Number(money.nanos ?? 0);
  if (isNaN(units) || isNaN(nanos)) return null;
  return units + nanos / 1_000_000_000;
}

const FUEL_META: Record<string, { type: FuelPrice['type']; label: string } | undefined> = {
  REGULAR_UNLEADED: { type: 'REGULAR',  label: 'Regular'  },
  MIDGRADE:         { type: 'MIDGRADE', label: 'Midgrade' },
  PREMIUM:          { type: 'PREMIUM',  label: 'Premium'  },
  DIESEL:           { type: 'DIESEL',   label: 'Diesel'   },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseFuelPrices(rawPrices: any[]): FuelPrice[] {
  return rawPrices
    .map((fp) => {
      const meta = FUEL_META[fp.type as string];
      if (!meta) return null;
      const price = nanosToPrice(fp.price);
      if (price === null) return null;
      return {
        type:      meta.type,
        label:     meta.label,
        price:     Math.round(price * 1000) / 1000,
        updatedAt: (fp.updateTime as string | null) ?? null,
      } satisfies FuelPrice;
    })
    .filter((x): x is FuelPrice => x !== null)
    // Sort: Regular → Midgrade → Premium → Diesel
    .sort((a, b) => {
      const ORDER = { REGULAR: 0, MIDGRADE: 1, PREMIUM: 2, DIESEL: 3 };
      return ORDER[a.type] - ORDER[b.type];
    });
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R  = 6371;
  const dL = ((lat2 - lat1) * Math.PI) / 180;
  const dG = ((lng2 - lng1) * Math.PI) / 180;
  const a  =
    Math.sin(dL / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dG / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Main fetch ─────────────────────────────────────────────────────────────

export async function fetchNearbyStations(
  lat: number,
  lng: number,
): Promise<NearbyStation[]> {
  const key = cacheKey(lat, lng);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return withDistancesFrom(hit.stations, lat, lng);

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return [];

  const body = {
    includedTypes:       ['gas_station'],
    maxResultCount:      10,
    // Without this, searchNearby defaults to ranking by POPULARITY, not
    // distance — a closer but less-reviewed station (e.g. a 7-Eleven) can get
    // pushed out of the top-10 cap by busier stations further away, even
    // within the radius. DISTANCE ranking is the correct default for "find
    // gas near me."
    rankPreference:      'DISTANCE',
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: RADIUS_METERS,
      },
    },
  };

  const fieldMask = [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.location',
    'places.regularOpeningHours',
    'places.fuelOptions',
  ].join(',');

  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method:  'POST',
    headers: {
      'Content-Type':    'application/json',
      'X-Goog-Api-Key':  apiKey,
      'X-Goog-FieldMask': fieldMask,
    },
    body:   JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error('[nearbyGas] Places API error — status:', res.status, errBody);
    // Surface billing/key issues clearly
    if (res.status === 403) {
      console.error('[nearbyGas] 403: API key invalid, billing not enabled, or Places API (New) not activated in GCP.');
    } else if (res.status === 400) {
      console.error('[nearbyGas] 400: Bad request — field mask or request body may be malformed.');
    }
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json() as { places?: any[] };
  const places = data.places ?? [];

  console.log(`[nearbyGas] Google returned ${places.length} place(s) for (${lat},${lng})`);

  let countWithFuelOptions = 0;
  let countWithPrices = 0;

  const stations: NearbyStation[] = places
    .map((p) => {
      const placeId = p.id as string;
      const name    = (p.displayName?.text ?? 'Gas Station') as string;
      const address = (p.formattedAddress ?? '') as string;
      const pLat    = (p.location?.latitude  ?? lat) as number;
      const pLng    = (p.location?.longitude ?? lng) as number;
      const distKm  = haversineKm(lat, lng, pLat, pLng);
      const distMi  = distKm * 0.621371;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hasFuelOptions = 'fuelOptions' in p && p.fuelOptions != null;
      if (hasFuelOptions) countWithFuelOptions++;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawPrices: any[] = p.fuelOptions?.fuelPrices ?? [];


      if (hasFuelOptions && rawPrices.length === 0) {
        console.log(`[nearbyGas] "${name}" has fuelOptions but fuelPrices is empty — station may not report prices.`);
      } else if (!hasFuelOptions) {
        console.log(`[nearbyGas] "${name}" has no fuelOptions field — not in Google's price coverage area, or field mask rejected (check billing/Enterprise tier).`);
      }

      const prices = parseFuelPrices(rawPrices);

      if (prices.length > 0) countWithPrices++;

      const isOpen: boolean | null =
        p.regularOpeningHours?.openNow != null
          ? (p.regularOpeningHours.openNow as boolean)
          : null;

      const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}&query_place_id=${placeId}`;

      return {
        placeId,
        name,
        address,
        distanceMi: Math.round(distMi * 10) / 10,
        lat:        pLat,
        lng:        pLng,
        prices,
        isOpen,
        googleMapsUrl,
      } satisfies NearbyStation;
    })
    // Include ALL stations — ones without prices show a manual-entry prompt
    .sort((a, b) => a.distanceMi - b.distanceMi);

  console.log(`[nearbyGas] ${countWithFuelOptions}/${places.length} had fuelOptions; ${countWithPrices}/${places.length} had parseable prices`);

  cache.set(key, { stations, expiresAt: Date.now() + CACHE_TTL_MS });
  return stations;
}

// ── Per-station prices (Place Details) ─────────────────────────────────────
//
// Saved/favorite stations can be anywhere — nowhere near the user's current
// search circle — so their current prices come from Place Details by placeId
// rather than from searchNearby. Same 30-min TTL as the search cache.
//
// Result per placeId:
//   FuelPrice[]  — Google answered (possibly [] = station reports no prices)
//   null         — unknown (no key, HTTP error, timeout). Callers must NOT
//                  treat null as "no prices" or substitute an old price as
//                  if it were current.

const detailsCache = new Map<string, { prices: FuelPrice[]; expiresAt: number }>();

async function fetchOneStationPrices(placeId: string, apiKey: string): Promise<FuelPrice[] | null> {
  const hit = detailsCache.get(placeId);
  if (hit && hit.expiresAt > Date.now()) return hit.prices;

  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      method:  'GET',
      headers: {
        'X-Goog-Api-Key':   apiKey,
        // Place Details field masks are NOT prefixed with "places." (that
        // prefix is only for searchNearby's wrapped response).
        'X-Goog-FieldMask': 'id,fuelOptions',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error('[nearbyGas] Place Details error — status:', res.status, 'placeId:', placeId);
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const place = await res.json() as { fuelOptions?: { fuelPrices?: any[] } };
    const prices = parseFuelPrices(place.fuelOptions?.fuelPrices ?? []);
    detailsCache.set(placeId, { prices, expiresAt: Date.now() + CACHE_TTL_MS });
    return prices;
  } catch (err) {
    console.error('[nearbyGas] Place Details lookup failed for', placeId, err);
    return null;
  }
}

export async function fetchStationPrices(placeIds: string[]): Promise<Map<string, FuelPrice[] | null>> {
  const out = new Map<string, FuelPrice[] | null>();
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    for (const id of placeIds) out.set(id, null);
    return out;
  }
  const results = await Promise.all(placeIds.map((id) => fetchOneStationPrices(id, apiKey)));
  placeIds.forEach((id, i) => out.set(id, results[i]));
  return out;
}
