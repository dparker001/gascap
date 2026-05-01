/**
 * GasCap™ — Google Maps Provider (server-side only)
 *
 * Implements IMapsProvider using Google Routes API and Places API (New).
 * Returns feature-disabled errors until the required env vars are set.
 *
 * ⚠️  SERVER-SIDE ONLY. Never import this file in client components.
 *      The API key must never appear in the client-side bundle.
 *
 * To activate:
 *   1. Enable Google Maps Platform at console.cloud.google.com
 *   2. Enable "Routes API" and "Places API (New)"
 *   3. Create a server-restricted API key (restrict by IP or HTTP referrer)
 *   4. Set GOOGLE_MAPS_API_KEY=your_key on Railway
 *   5. Set GOOGLE_MAPS_TRIP_PLANNER_ENABLED=true on Railway
 *   6. Implement the TODO sections below for getRoute() and searchFuelStops()
 */

import type {
  IMapsProvider,
  RouteRequest,
  RouteResult,
  FuelStopSearchRequest,
  FuelStop,
} from './types';

const FEATURE_DISABLED =
  'Route-based trip planning is not yet configured. ' +
  'Set GOOGLE_MAPS_API_KEY and GOOGLE_MAPS_TRIP_PLANNER_ENABLED=true to activate.';

export const googleMapsProvider: IMapsProvider = {
  name: 'google',

  isAvailable(): boolean {
    return !!(
      process.env.GOOGLE_MAPS_API_KEY &&
      process.env.GOOGLE_MAPS_TRIP_PLANNER_ENABLED === 'true'
    );
  },

  async getRoute(_req: RouteRequest): Promise<RouteResult> {
    if (!this.isAvailable()) throw new Error(FEATURE_DISABLED);

    /**
     * TODO: Implement Google Routes API call.
     *
     * Endpoint:
     *   POST https://routes.googleapis.com/directions/v2:computeRoutes
     *
     * Headers:
     *   X-Goog-Api-Key: process.env.GOOGLE_MAPS_API_KEY
     *   X-Goog-FieldMask: routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline
     *
     * Body example:
     * {
     *   origin: { address: _req.origin }          // or { location: { latLng: {...} } }
     *   destination: { address: _req.destination }
     *   travelMode: "DRIVE",
     *   routingPreference: "TRAFFIC_AWARE",
     *   extraComputations: ["TOLLS"]               // if avoidTolls is requested
     * }
     *
     * Docs: https://developers.google.com/maps/documentation/routes/compute_route_directions
     *
     * Return shape (RouteResult):
     * {
     *   distanceMeters:  response.routes[0].distanceMeters,
     *   durationSeconds: parseInt(response.routes[0].duration, 10),
     *   polyline:        response.routes[0].polyline.encodedPolyline,
     *   legs:            response.routes[0].legs.map(...),
     *   provider:        'google',
     * }
     */

    throw new Error(FEATURE_DISABLED);
  },

  async searchFuelStops(_req: FuelStopSearchRequest): Promise<FuelStop[]> {
    if (!this.isAvailable()) throw new Error(FEATURE_DISABLED);

    /**
     * TODO: Implement Places API (New) Search Along Route.
     *
     * Endpoint:
     *   POST https://places.googleapis.com/v1/places:searchText
     *   (or /places:searchAlongRoute once that endpoint is GA)
     *
     * Headers:
     *   X-Goog-Api-Key: process.env.GOOGLE_MAPS_API_KEY
     *   X-Goog-FieldMask: places.displayName,places.location,places.formattedAddress,places.rating,places.priceLevel,places.id
     *
     * Body example:
     * {
     *   textQuery: _req.searchQuery ?? "gas station",
     *   maxResultCount: _req.maxResultCount ?? 10,
     *   locationRestriction: { ... },  // bias toward route polyline
     * }
     *
     * Docs: https://developers.google.com/maps/documentation/places/web-service/search-along-route
     *
     * Return shape (FuelStop[]):
     * places.map(p => ({
     *   name:      p.displayName.text,
     *   latitude:  p.location.latitude,
     *   longitude: p.location.longitude,
     *   address:   p.formattedAddress,
     *   placeId:   p.id,
     *   rating:    p.rating,
     *   priceLevel: p.priceLevel,
     *   provider:  'google',
     * }))
     */

    throw new Error(FEATURE_DISABLED);
  },
};
