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

      // Temporary: log raw price objects so we can verify Google's Money encoding
      if (rawPrices.length > 0) {
        console.log(`[nearbyGas] raw fuelPrices for "${name}":`, JSON.stringify(rawPrices.slice(0, 2)));
      }

      if (hasFuelOptions && rawPrices.length === 0) {
        console.log(`[nearbyGas] "${name}" has fuelOptions but fuelPrices is empty — station may not report prices.`);
      } else if (!hasFuelOptions) {
        console.log(`[nearbyGas] "${name}" has no fuelOptions field — not in Google's price coverage area, or field mask rejected (check billing/Enterprise tier).`);
      }

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
