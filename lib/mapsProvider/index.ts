/**
 * GasCap™ — Maps Provider factory
 *
 * Returns the appropriate IMapsProvider for the current environment.
 * Currently returns the Google stub, which throws feature-disabled errors
 * until GOOGLE_MAPS_API_KEY and GOOGLE_MAPS_TRIP_PLANNER_ENABLED are set.
 *
 * ⚠️  SERVER-SIDE ONLY — import only in API routes and server components.
 *
 * To enable live API calls:
 *   1. Set GOOGLE_MAPS_API_KEY=your_server_side_key on Railway
 *   2. Set GOOGLE_MAPS_TRIP_PLANNER_ENABLED=true on Railway
 *   3. Implement the TODO blocks in googleMapsProvider.ts
 *   4. The /api/maps/route and /api/maps/search-fuel-stops endpoints will activate
 */

import type { IMapsProvider } from './types';
import { googleMapsProvider } from './googleMapsProvider';

export { googleMapsProvider };
export type { IMapsProvider };
export * from './types';

/** Returns the active maps provider */
export function getMapsProvider(): IMapsProvider {
  return googleMapsProvider;
}

/**
 * Whether route-based trip planning is enabled in this environment.
 * Requires both API key and explicit opt-in flag.
 * SERVER-SIDE ONLY — reads process.env directly.
 */
export function isRoutePlannerEnabled(): boolean {
  return !!(
    process.env.GOOGLE_MAPS_API_KEY &&
    process.env.GOOGLE_MAPS_TRIP_PLANNER_ENABLED === 'true'
  );
}
