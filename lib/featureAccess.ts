/**
 * GasCap™ — Feature access / plan-gating helper
 *
 * Centralizes tier-based access control so components don't inline plan strings.
 * Uses the existing 3-tier plan system: 'free' | 'pro' | 'fleet'
 *
 * When subscription rules change (trial overrides, ambassador Pro-for-Life,
 * beta flags, etc.), extend this helper rather than scattering checks.
 */

export type PlanTier = 'free' | 'pro' | 'fleet' | 'unknown';

export type FeatureKey =
  | 'google_maps_handoff'
  | 'waze_handoff'
  | 'manual_trip_estimate'
  | 'route_based_trip_planner'
  | 'fuel_stops_along_route'
  | 'save_trip'
  | 'fleet_trip_planning'
  | 'fleet_driver_route_planning';

// ── Access rules ──────────────────────────────────────────────────────────────
// List the plans that are ALLOWED to use each feature.
// Unauthenticated / unknown users are treated as 'free'.

const ALLOWED_PLANS: Record<FeatureKey, PlanTier[]> = {
  // Free for everyone — basic nav increases adoption without pay-walling utility
  google_maps_handoff:          ['free', 'pro', 'fleet'],
  waze_handoff:                 ['free', 'pro', 'fleet'],
  manual_trip_estimate:         ['free', 'pro', 'fleet'],

  // Pro+ — route intelligence is the paid value
  route_based_trip_planner:     ['pro', 'fleet'],
  fuel_stops_along_route:       ['pro', 'fleet'],
  save_trip:                    ['pro', 'fleet'],

  // Fleet-only
  fleet_trip_planning:          ['fleet'],
  fleet_driver_route_planning:  ['fleet'],
};

/**
 * Returns true if `plan` can access `feature`.
 * Unknown / unauthenticated plans default to free-tier access.
 */
export function canAccessFeature(
  feature: FeatureKey,
  plan: string | null | undefined,
): boolean {
  const tier = normalisePlan(plan);
  // 'unknown' falls through to free access rules
  const effectiveTier: PlanTier = tier === 'unknown' ? 'free' : tier;
  return ALLOWED_PLANS[feature].includes(effectiveTier);
}

/**
 * Normalise a raw plan string to a PlanTier.
 * Returns 'unknown' for any unrecognised value.
 */
export function normalisePlan(plan: string | null | undefined): PlanTier {
  if (plan === 'pro' || plan === 'fleet' || plan === 'free') return plan;
  return 'unknown';
}

/**
 * Convenience: extract the plan tier from a session user object.
 * Mirrors the existing isPro pattern used across the app:
 *   const isPro = ['pro','fleet'].includes((session?.user as {plan?:string})?.plan ?? '');
 */
export function getPlanTier(
  user: { plan?: string } | null | undefined,
): PlanTier {
  return normalisePlan(user?.plan);
}

// ── Upgrade copy ──────────────────────────────────────────────────────────────

export const UPGRADE_COPY = {
  routeBasedTripPlanner:
    'Route-based fuel planning is available with GasCap™ Pro.',
  fuelStopsAlongRoute:
    'Gas station suggestions along your route are available with GasCap™ Pro.',
  fleetFeature:
    'Fleet route planning is available with GasCap™ Fleet.',
  upgradeCta:      'Upgrade to Pro',
  fleetUpgradeCta: 'Upgrade to Fleet',
} as const;
