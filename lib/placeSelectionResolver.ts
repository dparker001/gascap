/**
 * GasCap™ — staleness-protected place-selection resolution.
 *
 * Wraps "fetch coordinates for the place the user just selected" with a
 * LatestWinsGuard so a late-resolving lookup from an abandoned selection
 * can never apply its result OR touch the "still resolving" loading state.
 * Extracted from components/TripCostEstimator.tsx's selectOriginSuggestion/
 * selectDestSuggestion so the exact async-ordering fix (not just the
 * underlying primitive) is directly unit-testable with controllable
 * promise resolution order — see __tests__/placeSelectionResolver.test.ts.
 *
 * ChatGPT review correction (2026-10-12, PR #84): the original version drove
 * the loading indicator from an in-flight COUNT that only reached zero once
 * every historical request — including already-obsolete ones — had settled.
 * That could leave Calculate disabled after the user's current selection had
 * already resolved successfully, solely because an abandoned earlier
 * request (possibly one that never resolves at all) was still outstanding.
 * The fix below ties the loading state to the CURRENT generation only: an
 * obsolete request's completion returns immediately, before touching either
 * the applied coordinates or the loading flag, so it can never clear a
 * newer request's "resolving" state (and a never-resolving obsolete request
 * can never keep it stuck on, either — see invalidateSelection()).
 */
import type { LatestWinsGuard } from './latestWinsGuard';

type Coords = { latitude: number; longitude: number };

/**
 * Begins a new selection: invalidates any prior pending selection on this
 * guard, sets the loading flag, awaits `fetchCoords`, and — ONLY if no
 * newer `begin()`/`invalidateAll()` has happened on the guard since (i.e.
 * this is still the current selection) — clears the loading flag and
 * applies the result if one was found.
 *
 * An obsolete (no-longer-current) completion returns immediately without
 * calling `setResolving` or `apply` at all. This is deliberate: it must
 * never clear a NEWER request's loading state, and a failed/null lookup
 * has nothing to "restore" regardless of staleness.
 */
export async function resolveSelectedPlace(
  guard: LatestWinsGuard,
  fetchCoords: () => Promise<Coords | null>,
  apply: (coords: Coords) => void,
  setResolving: (resolving: boolean) => void,
): Promise<void> {
  const token = guard.begin();
  setResolving(true);
  const coords = await fetchCoords().catch(() => null);
  if (!guard.isCurrent(token)) return; // obsolete — never touch coords or loading state
  setResolving(false);
  if (coords) apply(coords);
}

/**
 * Invalidates any pending selection on this guard AND immediately retires
 * the loading state — used by manual text edits, clearing the field, and
 * every mode-switch handler (Current Location, favorite, back-to-manual).
 * This must act synchronously and unconditionally rather than waiting on
 * the abandoned request's own completion, because that request may never
 * resolve at all (a hung/dropped fetch must not strand Calculate disabled
 * forever).
 */
export function invalidateSelection(
  guard: LatestWinsGuard,
  setResolving: (resolving: boolean) => void,
): void {
  guard.invalidateAll();
  setResolving(false);
}
