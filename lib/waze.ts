/**
 * Waze deep-link utilities for GasCap™
 *
 * Builds waze.com/ul? deep links that open Waze directly on mobile or
 * fall back to the Waze web UI on desktop.  No API key needed.
 *
 * Usage:
 *   buildWazeDeepLink({ latitude: 28.5, longitude: -81.3 })
 *   // → "https://waze.com/ul?ll=28.5%2C-81.3&q=gas+station&utm_source=gascap"
 */

export interface WazeDeepLinkOptions {
  /** User's current latitude (from the GasPriceLookup geolocation) */
  latitude?: number | null;
  /** User's current longitude (from the GasPriceLookup geolocation) */
  longitude?: number | null;
  /** Search query shown inside Waze (default: "gas station") */
  query?: string;
  /**
   * If true AND coords are present, adds navigate=yes which starts turn-by-turn
   * immediately.  We leave this false so the user picks the station themselves.
   */
  navigate?: boolean;
  /** UTM source tag appended to the URL (default: "gascap") */
  utmSource?: string;
}

/**
 * Returns a fully-formed Waze deep link URL.
 * Always produces a valid URL; coords are optional.
 */
export function buildWazeDeepLink({
  latitude,
  longitude,
  query = 'gas station',
  navigate = false,
  utmSource = 'gascap',
}: WazeDeepLinkOptions = {}): string {
  const params = new URLSearchParams();

  const hasCoords =
    latitude != null &&
    longitude != null &&
    !isNaN(Number(latitude)) &&
    !isNaN(Number(longitude));

  if (hasCoords) {
    params.set('ll', `${Number(latitude)},${Number(longitude)}`);
  }

  if (query) {
    params.set('q', query);
  }

  if (navigate && hasCoords) {
    params.set('navigate', 'yes');
  }

  params.set('utm_source', utmSource);

  return `https://waze.com/ul?${params.toString()}`;
}
