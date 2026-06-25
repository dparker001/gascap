/**
 * Google Places API (New) — nearby gas station prices.
 *
 * Server-only. Accepts lat/lng, returns the closest stations with fuelOptions
 * prices normalised into simple dollar amounts. Results are cached 30 min in
 * memory so repeated "Find Gas" opens don't burn through the Places budget.
 *
 * Requires: GOOGLE_PLACES_API_KEY env var (Places API (New) enabled in GCP).
 */

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
  // Round to ~1 decimal (~11 km grid) so nearby searches share cache entries.
  return `${Math.round(lat * 10) / 10},${Math.round(lng * 10) / 10}`;
}

/** Google returns price as { units: 3, nanos: 890000000 } → 3.89 */
function nanosToPrice(money: { units?: number; nanos?: number } | undefined): number | null {
  if (!money) return null;
  const units = money.units ?? 0;
  const nanos = money.nanos ?? 0;
  return units + nanos / 1_000_000_000;
}

const FUEL_META: Record<string, { type: FuelPrice['type']; label: string } | undefined> = {
  REGULAR_UNLEADED: { type: 'REGULAR',  label: 'Regular'  },
  MIDGRADE:         { type: 'MIDGRADE', label: 'Midgrade' },
  PREMIUM:          { type: 'PREMIUM',  label: 'Premium'  },
  DIESEL:           { type: 'DIESEL',   label: 'Diesel'   },
};

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
  if (hit && hit.expiresAt > Date.now()) return hit.stations;

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return [];

  const body = {
    includedTypes:       ['gas_station'],
    maxResultCount:      10,
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
    console.error('[nearbyGas] Places API error', res.status, await res.text());
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json() as { places?: any[] };
  const places = data.places ?? [];

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
      const rawPrices: any[] = p.fuelOptions?.fuelPrices ?? [];
      const prices: FuelPrice[] = rawPrices
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
    .filter((s) => s.prices.length > 0)  // skip stations with no price data
    .sort((a, b) => a.distanceMi - b.distanceMi);

  cache.set(key, { stations, expiresAt: Date.now() + CACHE_TTL_MS });
  return stations;
}
