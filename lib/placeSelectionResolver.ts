/**
 * GasCap™ — staleness-protected place-selection resolution.
 *
 * Wraps "fetch coordinates for the place the user just selected" with a
 * LatestWinsGuard so a late-resolving lookup from an abandoned selection
 * can never apply its result. Extracted from
 * components/TripCostEstimator.tsx's selectOriginSuggestion/
 * selectDestSuggestion so the exact async-ordering fix (not just the
 * underlying primitive) is directly unit-testable with controllable
 * promise resolution order — see __tests__/placeSelectionResolver.test.ts.
 */
import type { LatestWinsGuard } from './latestWinsGuard';

/**
 * Begins a new selection: invalidates any prior pending selection on this
 * guard, awaits `fetchCoords`, and calls `apply` with the result ONLY if no
 * newer `begin()`/`invalidateAll()` has happened on the guard since —
 * i.e. only if this is still the current selection. A failed/null lookup
 * never calls `apply` — there is nothing to "restore" on failure.
 */
export async function resolveSelectedPlace(
  guard: LatestWinsGuard,
  fetchCoords: () => Promise<{ latitude: number; longitude: number } | null>,
  apply: (coords: { latitude: number; longitude: number }) => void,
): Promise<void> {
  const token = guard.begin();
  const coords = await fetchCoords().catch(() => null);
  if (guard.isCurrent(token) && coords) apply(coords);
}
