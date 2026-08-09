/**
 * EV rental return policies — U.S. majors.
 *
 * Gasoline rentals price refuelling per gallon, so the gas calculator asks for
 * a $/gal rate and compares it against pump cost. EV rentals do NOT work that
 * way: there is no industry per-kWh rate. Instead you must return the car at a
 * required STATE OF CHARGE, and you're billed a recharge/service fee if you
 * come back under it. So the useful question isn't "what do they charge per
 * kWh" — it's "what percent do I need, and what will it cost me to get there."
 *
 * Two models in the market:
 *   1. Same-as-received, usually capped   — Hertz, Dollar, Thrifty, SIXT
 *   2. Flat minimum percentage            — Avis, Budget
 *
 * Enterprise/National/Alamo are location- and contract-specific, so they're
 * listed but resolve to "check your agreement" rather than a number we'd be
 * guessing at.
 *
 * Policies change. `requiredReturnPct` is deliberately a pure function of the
 * pickup level so this file stays the single place to update.
 */

export type EvRentalPolicyId =
  | 'hertz' | 'avis' | 'budget' | 'sixt' | 'dollar' | 'thrifty' | 'enterprise' | 'other';

export interface EvRentalPolicy {
  id:    EvRentalPolicyId;
  label: string;
  /** Short plain-English description of the return rule, shown under the picker. */
  rule:  string;
  /**
   * Required return charge given the pickup charge, or null when the policy
   * can't be resolved without the rental agreement.
   */
  requiredReturnPct: (pickupPct: number) => number | null;
}

export const EV_RENTAL_POLICIES: EvRentalPolicy[] = [
  {
    id: 'hertz',
    label: 'Hertz',
    rule: 'Return at about the pickup level — never more than 75%.',
    requiredReturnPct: (p) => Math.min(p, 75),
  },
  {
    id: 'avis',
    label: 'Avis',
    rule: 'Return with at least 70% charge. It does not need to be full.',
    requiredReturnPct: () => 70,
  },
  {
    id: 'budget',
    label: 'Budget',
    rule: 'Return with at least 70% charge. It does not need to be full.',
    requiredReturnPct: () => 70,
  },
  {
    id: 'sixt',
    label: 'SIXT',
    rule: 'Return at the pickup level, capped at 80%.',
    requiredReturnPct: (p) => Math.min(p, 80),
  },
  {
    id: 'dollar',
    label: 'Dollar',
    rule: 'Return within 5% of the pickup level.',
    // Within 5% below pickup is acceptable, so that's the real target.
    requiredReturnPct: (p) => Math.max(0, p - 5),
  },
  {
    id: 'thrifty',
    label: 'Thrifty',
    rule: 'Return within 5% of the pickup level.',
    requiredReturnPct: (p) => Math.max(0, p - 5),
  },
  {
    id: 'enterprise',
    label: 'Enterprise / National / Alamo',
    rule: 'Varies by location — check your rental agreement. Usually the level you received.',
    requiredReturnPct: () => null,
  },
  {
    id: 'other',
    label: 'Other / not sure',
    rule: 'Returning at the level you picked it up at is the safest default.',
    requiredReturnPct: (p) => p,
  },
];

export function getEvRentalPolicy(id: EvRentalPolicyId): EvRentalPolicy {
  return EV_RENTAL_POLICIES.find((p) => p.id === id) ?? EV_RENTAL_POLICIES[EV_RENTAL_POLICIES.length - 1];
}

export interface EvRentalNeed {
  /** Charge the company requires back, as a percentage. */
  requiredPct:  number | null;
  /** Percentage points that must be added. 0 when already at or above target. */
  deficitPct:   number;
  kWhNeeded:    number;
  estimatedCost: number;
  /** Hours on a 7.2 kW Level 2 charger — the practical constraint before drop-off. */
  level2Hours:  number;
  /** True when the car already meets the requirement. */
  alreadyMet:   boolean;
}

/**
 * What it takes to hand the car back compliant.
 *
 * Level 2 is the only rate worth showing here: Level 1 is too slow to matter
 * before a drop-off, and DC fast charging is priced by the network rather than
 * the home rate this estimate is based on.
 */
export function calcEvRentalNeed(opts: {
  policyId:    EvRentalPolicyId;
  pickupPct:   number;
  currentPct:  number;
  batteryKwh:  number;
  pricePerKwh: number;
}): EvRentalNeed {
  const { policyId, pickupPct, currentPct, batteryKwh, pricePerKwh } = opts;
  const requiredPct = getEvRentalPolicy(policyId).requiredReturnPct(pickupPct);

  if (requiredPct == null) {
    return { requiredPct: null, deficitPct: 0, kWhNeeded: 0, estimatedCost: 0, level2Hours: 0, alreadyMet: false };
  }

  const deficitPct = Math.max(0, requiredPct - currentPct);
  const kWhNeeded  = Math.round(batteryKwh * (deficitPct / 100) * 100) / 100;

  return {
    requiredPct,
    deficitPct,
    kWhNeeded,
    estimatedCost: Math.round(kWhNeeded * pricePerKwh * 100) / 100,
    level2Hours:   Math.round((kWhNeeded / 7.2) * 10) / 10,
    alreadyMet:    deficitPct === 0,
  };
}
