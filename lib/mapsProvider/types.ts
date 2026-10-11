/**
 * GasCap™ — Maps Provider shared types
 *
 * Provider-agnostic types used by the trip fuel planner and any future
 * map integration (Google Routes API, Places API, etc.)
 *
 * These types are safe to import on both server and client.
 * The actual provider implementations (googleMapsProvider.ts) are
 * SERVER-SIDE ONLY and must never be imported in client components.
 */

// ── Primitives ────────────────────────────────────────────────────────────────

export interface LatLng {
  latitude:  number;
  longitude: number;
}

export function isLatLng(v: unknown): v is LatLng {
  return (
    !!v && typeof v === 'object' &&
    typeof (v as LatLng).latitude  === 'number' && Number.isFinite((v as LatLng).latitude)  && Math.abs((v as LatLng).latitude)  <= 90 &&
    typeof (v as LatLng).longitude === 'number' && Number.isFinite((v as LatLng).longitude) && Math.abs((v as LatLng).longitude) <= 180
  );
}

/** A valid /api/maps/route origin/destination: a non-empty address string, or coordinates within range. */
export function isValidWaypoint(v: unknown): v is string | LatLng {
  return (typeof v === 'string' && !!v.trim()) || isLatLng(v);
}

// ── Route types ───────────────────────────────────────────────────────────────

export interface RouteRequest {
  origin:          string | LatLng;
  destination:     string | LatLng;
  travelMode:      'DRIVE';
  avoidTolls?:     boolean;
  avoidHighways?:  boolean;
}

export interface RouteLeg {
  distanceMeters:  number;
  durationSeconds: number;
  startLocation:   LatLng;
  endLocation:     LatLng;
}

export interface RouteResult {
  distanceMeters:  number;
  durationSeconds: number;
  /** Encoded polyline string (Google format) */
  polyline?:       string;
  legs?:           RouteLeg[];
  /** Which provider calculated this route */
  provider:        string;
}

// ── Fuel stop types ───────────────────────────────────────────────────────────

export interface FuelStopSearchRequest {
  /** Encoded polyline — reserved for future Search Along Route use */
  routePolyline?:     string;
  /** Search query — defaults to "gas station" */
  searchQuery?:       string;
  /** A point along the route near which to bias results (e.g. refuel window midpoint) */
  searchOrigin?:      LatLng;
  maxResultCount?:    number;
  preferredFuelType?: string;
}

export interface FuelStop {
  name:                     string;
  latitude:                 number;
  longitude:                number;
  address?:                 string;
  placeId?:                 string;
  rating?:                  number;
  /** 0–4 price level (Google convention) */
  priceLevel?:              number;
  distanceFromRouteMeters?: number;
  provider:                 string;
}

// ── Provider interface ────────────────────────────────────────────────────────

export interface IMapsProvider {
  name: string;
  /** True if this provider is configured and can make live API calls */
  isAvailable: () => boolean;
  /** Calculate a driving route between two points */
  getRoute:         (req: RouteRequest)         => Promise<RouteResult>;
  /** Search for fuel stops along a given route polyline */
  searchFuelStops:  (req: FuelStopSearchRequest) => Promise<FuelStop[]>;
}

// ── API request / response types (used by /api/maps/* routes) ─────────────────

export interface RouteApiRequest {
  /**
   * A plain address string, OR coordinates ({latitude, longitude}) for
   * Current Location and a resolved 'google_place' favorite — passing
   * coordinates directly avoids an unnecessary reverse-geocode call.
   */
  origin:       string | LatLng;
  destination:  string | LatLng;
  avoidTolls?:  boolean;
}

export interface RouteApiResponse {
  ok:               boolean;
  route?:           RouteResult;
  error?:           string;
  featureDisabled?: boolean;
}

export interface FuelStopsApiRequest {
  /** Encoded polyline — reserved for future Search Along Route use */
  routePolyline?:     string;
  /** Latitude near which to search for stations (e.g. refuel window midpoint) */
  nearLat?:           number;
  /** Longitude near which to search for stations */
  nearLng?:           number;
  refuelAtMile?:      number;
  preferredFuelType?: string;
}

export interface FuelStopsApiResponse {
  ok:               boolean;
  stops?:           FuelStop[];
  error?:           string;
  featureDisabled?: boolean;
}
