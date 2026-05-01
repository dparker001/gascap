/**
 * GasCap™ — Google Maps URL builder
 *
 * Produces google.com/maps deep links that open Google Maps natively on
 * Android/iOS or fall back to Google Maps web on desktop.
 * No API key required — these are public URL-scheme patterns.
 *
 * PRIVACY: Never add private user data (email, user ID, VIN, vehicle name,
 * odometer readings, etc.) to any URL produced here.
 *
 * URL patterns used:
 *   Search:     https://www.google.com/maps/search/?api=1&query=gas+station
 *   Directions: https://www.google.com/maps/dir/?api=1&destination=...&travelmode=driving
 */

export type GoogleMapsMode = 'search' | 'directions';

export interface GoogleMapsUrlOptions {
  /** User's current latitude (from GasPriceLookup geolocation — not embedded in search URLs) */
  latitude?: number | null;
  /** User's current longitude */
  longitude?: number | null;
  /** Latitude of the navigation destination (selected fuel stop) */
  destinationLat?: number | null;
  /** Longitude of the navigation destination */
  destinationLng?: number | null;
  /**
   * Free-text destination — used when destinationLat/Lng are absent.
   * Example: "Shell Gas Station" or "BP on Main St"
   */
  destination?: string | null;
  /** Search query (default: "gas station") */
  query?: string;
  /**
   * 'search'     → open a nearby gas station search (default)
   * 'directions' → open turn-by-turn navigation to a selected destination
   */
  mode?: GoogleMapsMode;
}

/**
 * Returns a fully-formed Google Maps URL.
 * Always produces a valid, openable URL — coordinates are optional.
 *
 * For search mode: user coords are intentionally NOT included in the URL.
 * Google Maps uses the device's own GPS for "near me" bias, which is more
 * accurate and avoids embedding location data in outbound links.
 *
 * For directions mode: destination coordinates (or name) are included
 * so Maps opens directly to that specific station.
 */
export function buildGoogleMapsUrl({
  latitude,
  longitude,
  destinationLat,
  destinationLng,
  destination,
  query = 'gas station',
  mode = 'search',
}: GoogleMapsUrlOptions = {}): string {
  const hasOriginCoords =
    latitude != null && longitude != null &&
    !isNaN(Number(latitude)) && !isNaN(Number(longitude));

  const hasDestCoords =
    destinationLat != null && destinationLng != null &&
    !isNaN(Number(destinationLat)) && !isNaN(Number(destinationLng));

  // ── Directions mode ────────────────────────────────────────────────────────
  if (mode === 'directions') {
    const params = new URLSearchParams({ api: '1', travelmode: 'driving' });

    if (hasDestCoords) {
      // Exact lat/lng — opens directly to the station
      params.set('destination', `${Number(destinationLat)},${Number(destinationLng)}`);
    } else if (destination) {
      // Station name — Google Maps resolves to best match
      params.set('destination', destination);
    } else {
      // No destination provided — fall back to a nearby search
      return buildGoogleMapsUrl({ latitude, longitude, query, mode: 'search' });
    }

    // Include origin if we have the user's GPS position
    if (hasOriginCoords) {
      params.set('origin', `${Number(latitude)},${Number(longitude)}`);
    }

    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }

  // ── Search mode (default) ──────────────────────────────────────────────────
  // We intentionally omit user coords here — Google Maps uses device GPS,
  // which is more accurate and avoids location data in the URL.
  const params = new URLSearchParams({ api: '1', query });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}
