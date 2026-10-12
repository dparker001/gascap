/**
 * GasCap™ — "only the latest async operation wins" guard.
 *
 * The same generation-counter pattern components/NearbyStations.tsx already
 * uses inline (fetchGenRef/geoGenRef) to discard a stale completion, extracted
 * here so it can be shared and directly unit-tested instead of re-implemented
 * ad hoc per call site. Added after a Trip Planner routing-integrity audit
 * (2026-10-12) found components/TripCostEstimator.tsx's selectOriginSuggestion/
 * selectDestSuggestion had no such guard: selecting one autocomplete
 * suggestion, then changing the selection before its Place Details lookup
 * resolved, could let the stale lookup overwrite the current coordinates
 * after the fact — the displayed address text would be correct while the
 * route silently calculated against a different, invisible location.
 */
export interface LatestWinsGuard {
  /** Starts a new operation, invalidating every previously-issued token. Returns a token to check later. */
  begin(): number;
  /** True only if `token` is still the most recent one issued — i.e. no newer begin()/invalidateAll() has happened since. */
  isCurrent(token: number): boolean;
  /** Invalidates every outstanding token without starting a new operation — e.g. a manual edit, a mode switch, or component unmount. */
  invalidateAll(): void;
}

export function createLatestWinsGuard(): LatestWinsGuard {
  let generation = 0;
  return {
    begin() {
      generation += 1;
      return generation;
    },
    isCurrent(token: number) {
      return token === generation;
    },
    invalidateAll() {
      generation += 1;
    },
  };
}
