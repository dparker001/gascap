/**
 * GasCap™ — Google Maps Provider (server-side only)
 *
 * Implements IMapsProvider using Google Routes API and Places API (New).
 *
 * ⚠️  SERVER-SIDE ONLY. Never import this file in client components.
 *      The API key must never appear in the client-side bundle.
 *
 * Requires (set on Railway):
 *   GOOGLE_MAPS_API_KEY=your_server_restricted_key
 *   GOOGLE_MAPS_TRIP_PLANNER_ENABLED=true
 */

import type {
  IMapsProvider,
  RouteRequest,
  RouteResult,
  FuelStopSearchRequest,
  FuelStop,
  LatLng,
} from './types';

const FEATURE_DISABLED =
  'Route-based trip planning is not yet configured. ' +
  'Set GOOGLE_MAPS_API_KEY and GOOGLE_MAPS_TRIP_PLANNER_ENABLED=true to activate.';

// Maps Google's string price level → numeric (0–4 convention)
const PRICE_LEVEL: Record<string, number> = {
  PRICE_LEVEL_FREE:           0,
  PRICE_LEVEL_INEXPENSIVE:    1,
  PRICE_LEVEL_MODERATE:       2,
  PRICE_LEVEL_EXPENSIVE:      3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

// ── Internal Google API types ─────────────────────────────────────────────────

interface GoogleLeg {
  distanceMeters: number;
  duration:       string;            // e.g. "3600s"
  startLocation?: { latLng?: { latitude: number; longitude: number } };
  endLocation?:   { latLng?: { latitude: number; longitude: number } };
}

interface GoogleRoute {
  distanceMeters: number;
  duration:       string;
  legs?:          GoogleLeg[];
}

interface GooglePlace {
  id?:               string;
  displayName?:      { text?: string };
  location?:         { latitude?: number; longitude?: number };
  formattedAddress?: string;
  rating?:           number;
  priceLevel?:       string;
}

// ── Helper ────────────────────────────────────────────────────────────────────

function toWaypoint(loc: string | LatLng) {
  return typeof loc === 'string'
    ? { address: loc }
    : { location: { latLng: { latitude: loc.latitude, longitude: loc.longitude } } };
}

function parseDuration(d: string): number {
  return parseInt(d.replace('s', ''), 10) || 0;
}

// ── Place Details (coordinate resolution by placeId) ──────────────────────────

/**
 * Resolves a Google Places `placeId` to coordinates via Place Details (New).
 * Shared by /api/maps/place-location (the Rental Return return-location
 * picker) and lib/favoriteAddresses.ts's resolve-on-use lookup for
 * 'google_place' favorites — neither persists the result; both call this
 * fresh every time, per the Places API caching limits on returned lat/lng.
 *
 * `sessionToken` closes the Autocomplete (New) session that selected this
 * placeId, so Google bills the search+selection as one session instead of
 * per-request — see lib/placesSessionToken.ts for token lifecycle.
 */
export async function resolvePlaceCoordinates(
  placeId: string,
  sessionToken?: string,
): Promise<{ latitude: number; longitude: number } | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || process.env.GOOGLE_MAPS_TRIP_PLANNER_ENABLED !== 'true') return null;
  if (!placeId) return null;

  const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`);
  if (sessionToken) url.searchParams.set('sessionToken', sessionToken);

  try {
    const res = await fetch(url, {
      headers: {
        'X-Goog-Api-Key':   apiKey,
        'X-Goog-FieldMask': 'location',
      },
    });
    if (!res.ok) return null;

    const data = await res.json() as { location?: { latitude?: number; longitude?: number } };
    const lat = data.location?.latitude;
    const lng = data.location?.longitude;
    if (lat == null || lng == null) return null;

    return { latitude: lat, longitude: lng };
  } catch {
    return null;
  }
}

// ── Provider ──────────────────────────────────────────────────────────────────

export const googleMapsProvider: IMapsProvider = {
  name: 'google',

  isAvailable(): boolean {
    return !!(
      process.env.GOOGLE_MAPS_API_KEY &&
      process.env.GOOGLE_MAPS_TRIP_PLANNER_ENABLED === 'true'
    );
  },

  // ── Route calculation ───────────────────────────────────────────────────────

  async getRoute(req: RouteRequest): Promise<RouteResult> {
    if (!this.isAvailable()) throw new Error(FEATURE_DISABLED);

    const apiKey = process.env.GOOGLE_MAPS_API_KEY!;

    const res = await fetch(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',
        headers: {
          'Content-Type':    'application/json',
          'X-Goog-Api-Key':  apiKey,
          // Request only the fields we use — minimises cost & response size
          'X-Goog-FieldMask':
            'routes.distanceMeters,routes.duration,' +
            'routes.legs.distanceMeters,routes.legs.duration,' +
            'routes.legs.startLocation,routes.legs.endLocation',
        },
        body: JSON.stringify({
          origin:            toWaypoint(req.origin),
          destination:       toWaypoint(req.destination),
          travelMode:        'DRIVE',
          routingPreference: 'TRAFFIC_AWARE',
          ...(req.avoidTolls ? { routeModifiers: { avoidTolls: true } } : {}),
        }),
      },
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}) as { error?: { message?: string } });
      const msg = (err as { error?: { message?: string } }).error?.message;
      throw new Error(msg ?? `Google Routes API returned ${res.status}`);
    }

    const data = await res.json() as { routes?: GoogleRoute[] };
    const route = data.routes?.[0];

    if (!route) {
      throw new Error(
        'No route found. Please check that both the starting point and destination are valid addresses.',
      );
    }

    return {
      distanceMeters:  route.distanceMeters,
      durationSeconds: parseDuration(route.duration),
      legs: route.legs?.map((leg) => ({
        distanceMeters:  leg.distanceMeters,
        durationSeconds: parseDuration(leg.duration),
        startLocation: {
          latitude:  leg.startLocation?.latLng?.latitude  ?? 0,
          longitude: leg.startLocation?.latLng?.longitude ?? 0,
        },
        endLocation: {
          latitude:  leg.endLocation?.latLng?.latitude  ?? 0,
          longitude: leg.endLocation?.latLng?.longitude ?? 0,
        },
      })),
      provider: 'google',
    };
  },

  // ── Fuel stop search ────────────────────────────────────────────────────────

  async searchFuelStops(req: FuelStopSearchRequest): Promise<FuelStop[]> {
    if (!this.isAvailable()) throw new Error(FEATURE_DISABLED);

    // We need a search origin to bias the results
    if (!req.searchOrigin) return [];

    const apiKey = process.env.GOOGLE_MAPS_API_KEY!;

    const res = await fetch(
      'https://places.googleapis.com/v1/places:searchText',
      {
        method: 'POST',
        headers: {
          'Content-Type':    'application/json',
          'X-Goog-Api-Key':  apiKey,
          'X-Goog-FieldMask':
            'places.id,places.displayName,places.location,' +
            'places.formattedAddress,places.rating,places.priceLevel',
        },
        body: JSON.stringify({
          textQuery:      req.searchQuery ?? 'gas station',
          maxResultCount: req.maxResultCount ?? 5,
          locationBias: {
            circle: {
              center: {
                latitude:  req.searchOrigin.latitude,
                longitude: req.searchOrigin.longitude,
              },
              radius: 8047, // ~5 miles in meters
            },
          },
        }),
      },
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}) as { error?: { message?: string } });
      const msg = (err as { error?: { message?: string } }).error?.message;
      throw new Error(msg ?? `Google Places API returned ${res.status}`);
    }

    const data = await res.json() as { places?: GooglePlace[] };

    return (data.places ?? []).map((p) => ({
      name:      p.displayName?.text ?? 'Gas Station',
      latitude:  p.location?.latitude  ?? 0,
      longitude: p.location?.longitude ?? 0,
      address:   p.formattedAddress,
      placeId:   p.id,
      rating:    p.rating,
      priceLevel: p.priceLevel ? PRICE_LEVEL[p.priceLevel] : undefined,
      provider:  'google',
    }));
  },
};
