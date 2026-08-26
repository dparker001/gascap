import { describe, it, expect } from 'vitest';
import {
  gallonsNeeded,
  estimatedFuelCost,
  estimatedRentalCompanyCharge,
  estimatedSavings,
  returnReadyStatus,
  resolveRequiredReturnFuel,
  formatGallons,
  roundCurrency,
  roundGallons,
  refuelTotals,
  reconcileFuelForNewTank,
  isUpcomingRental,
  rentalRecap,
  resolveCalculateFillState,
} from '../lib/rentalCalculations';
import { gallonsFromGaugeFraction, gallonsFromPercent } from '../lib/rentalProvider';

// ── Pilot spec scenarios (section 39) ───────────────────────────────────────

describe('gallonsNeeded()', () => {
  it('Scenario 1: pickup 14.1, return target 14.1, current 12.6 → 1.5', () => {
    expect(gallonsNeeded(14.1, 12.6)).toBe(1.5);
  });

  it('Scenario 2: target 14.1, current 14.3 (over) → 0', () => {
    expect(gallonsNeeded(14.1, 14.3)).toBe(0);
  });

  it('never goes negative', () => {
    expect(gallonsNeeded(10, 20)).toBe(0);
  });

  it('treats invalid/negative inputs as 0', () => {
    expect(gallonsNeeded(-5, 10)).toBe(0);
    expect(gallonsNeeded(10, -5)).toBe(0);
  });
});

describe('gallonsFromGaugeFraction() — Scenario 3', () => {
  it('3/4 tank of a 15-gallon tank → 11.25 internally, displays ~11.3', () => {
    const gallons = gallonsFromGaugeFraction('3/4', 15);
    expect(gallons).toBeCloseTo(11.25, 5);
    expect(formatGallons(gallons, 'MANUAL_GAUGE')).toBe('~11.3 gal');
  });

  it('handles all documented fractions', () => {
    expect(gallonsFromGaugeFraction('full', 15)).toBe(15);
    expect(gallonsFromGaugeFraction('7/8', 16)).toBeCloseTo(14, 5);
    expect(gallonsFromGaugeFraction('1/2', 15)).toBe(7.5);
    expect(gallonsFromGaugeFraction('1/8', 16)).toBe(2);
    expect(gallonsFromGaugeFraction('empty', 15)).toBe(0);
  });

  it('returns null for unknown fraction or missing tank capacity', () => {
    expect(gallonsFromGaugeFraction('nonsense', 15)).toBeNull();
    expect(gallonsFromGaugeFraction('3/4', 0)).toBeNull();
    // The unset gauge. Setup and the shared FuelLevelInput both start with no
    // selection, and that has to stay null all the way through — a default of
    // 'Full' previously wrote a full tank for rentals nobody had picked up,
    // which then became the return target under same-as-pickup.
    expect(gallonsFromGaugeFraction('', 15)).toBeNull();
    expect(gallonsFromGaugeFraction('   ', 15)).toBeNull();
  });
});

describe('gallonsFromPercent()', () => {
  it('95% of a 15-gal tank → 14.25 (unrounded — display rounding is a separate step)', () => {
    expect(gallonsFromPercent(95, 15)).toBeCloseTo(14.25, 5);
  });

  it('rejects out-of-range percentages', () => {
    expect(gallonsFromPercent(-1, 15)).toBeNull();
    expect(gallonsFromPercent(101, 15)).toBeNull();      // over 100
    expect(gallonsFromPercent(150, 15)).toBeNull();
  });

  it('0% is valid (empty tank)', () => {
    expect(gallonsFromPercent(0, 15)).toBe(0);
  });
});

describe('estimatedFuelCost() — Scenario 4', () => {
  it('1.5 gal @ $3.09/gal → $4.64', () => {
    expect(estimatedFuelCost(1.5, 3.09)).toBe(4.64);
  });

  it('zero gallons needed → $0', () => {
    expect(estimatedFuelCost(0, 3.09)).toBe(0);
  });

  it('invalid price → $0, never invents a number', () => {
    expect(estimatedFuelCost(1.5, 0)).toBe(0);
    expect(estimatedFuelCost(1.5, -1)).toBe(0);
  });
});

describe('estimatedRentalCompanyCharge() — Scenario 5', () => {
  it('1.5 gal @ $5.11/gal → $7.67', () => {
    expect(estimatedRentalCompanyCharge(1.5, 5.11)).toBe(7.67);
  });

  it('unknown rate → null, never guessed', () => {
    expect(estimatedRentalCompanyCharge(1.5, null)).toBeNull();
    expect(estimatedRentalCompanyCharge(1.5, undefined)).toBeNull();
    expect(estimatedRentalCompanyCharge(1.5, 0)).toBeNull();
  });

  it('zero gallons needed with a known rate → $0, not null', () => {
    expect(estimatedRentalCompanyCharge(0, 5.11)).toBe(0);
  });
});

describe('estimatedSavings() — Scenario 6', () => {
  it('$7.67 rental charge vs $4.64 self cost → $3.03 savings', () => {
    expect(estimatedSavings(7.67, 4.64)).toBe(3.03);
  });

  it('null rental charge (unknown rate) → null savings, not zero', () => {
    expect(estimatedSavings(null, 4.64)).toBeNull();
  });

  it('can be negative if self-refuel somehow costs more (station price spike)', () => {
    expect(estimatedSavings(4.64, 7.67)).toBe(-3.03);
  });
});

// ── returnReadyStatus ────────────────────────────────────────────────────

describe('returnReadyStatus()', () => {
  it('at or above target → return_ready', () => {
    expect(returnReadyStatus(14.1, 14.1)).toBe('return_ready');
    expect(returnReadyStatus(14.3, 14.1)).toBe('return_ready');
  });

  it('within tolerance but under target → nearly_ready', () => {
    expect(returnReadyStatus(13.9, 14.1, 0.3)).toBe('nearly_ready');
  });

  it('meaningfully under target → needs_fuel', () => {
    expect(returnReadyStatus(12.6, 14.1)).toBe('needs_fuel');
  });

  it('missing data defaults to needs_fuel, never a false "ready"', () => {
    expect(returnReadyStatus(null, 14.1)).toBe('needs_fuel');
    expect(returnReadyStatus(12.6, null)).toBe('needs_fuel');
  });

  it('respects a custom tolerance', () => {
    expect(returnReadyStatus(13.0, 14.1, 1.5)).toBe('nearly_ready');
    expect(returnReadyStatus(13.0, 14.1, 1.0)).toBe('needs_fuel');
  });
});

// ── resolveRequiredReturnFuel ────────────────────────────────────────────

describe('resolveRequiredReturnFuel()', () => {
  it('same_as_pickup (default) mirrors pickup level, not a full tank', () => {
    expect(resolveRequiredReturnFuel('same_as_pickup', 14.1, 18)).toBe(14.1);
  });

  it('full uses tank capacity', () => {
    expect(resolveRequiredReturnFuel('full', 14.1, 18)).toBe(18);
  });

  it('exact uses the provided value, not pickup or capacity', () => {
    expect(resolveRequiredReturnFuel('exact', 14.1, 18, 16)).toBe(16);
  });

  it('missing pickup data under same_as_pickup → null, not a guess', () => {
    expect(resolveRequiredReturnFuel('same_as_pickup', null, 18)).toBeNull();
  });
});

// ── formatGallons — false-precision guard (section 32) ──────────────────

describe('formatGallons()', () => {
  it('manual sources always show ~ prefix', () => {
    expect(formatGallons(11.25, 'MANUAL_GAUGE')).toBe('~11.3 gal');
    expect(formatGallons(11.25, 'MANUAL_PERCENT')).toBe('~11.3 gal');
    expect(formatGallons(11.25, 'MANUAL_GALLONS')).toBe('~11.3 gal');
  });

  it('authoritative Level 2 sources show no ~ prefix', () => {
    expect(formatGallons(12.6, 'RENTAL_COMPANY_API')).toBe('12.6 gal');
    expect(formatGallons(12.6, 'VEHICLE_TELEMATICS')).toBe('12.6 gal');
  });

  it('missing value renders an em dash, not 0 or NaN', () => {
    expect(formatGallons(null, 'MANUAL_GAUGE')).toBe('—');
    expect(formatGallons(undefined, 'MANUAL_GAUGE')).toBe('—');
  });

  it('missing source defaults to estimated (safer than claiming authority)', () => {
    expect(formatGallons(12.6, null)).toBe('~12.6 gal');
  });
});

// ── rounding helpers ─────────────────────────────────────────────────────

describe('roundCurrency() / roundGallons()', () => {
  it('rounds currency to cents', () => {
    expect(roundCurrency(4.634999999999999)).toBe(4.63);
    expect(roundCurrency(4.635)).toBe(4.64);
  });

  it('rounds gallons to tenths', () => {
    expect(roundGallons(11.249999)).toBe(11.2);
    expect(roundGallons(11.25)).toBe(11.3);
  });
});

// ── refuel totals + end-of-rental recap ──────────────────────────────────

describe('refuelTotals()', () => {
  it('sums gallons and cost across multiple refuels (long rental)', () => {
    const totals = refuelTotals([
      { gallons: 8.2,  totalPaid: 25.34 },
      { gallons: 11.5, totalPaid: 35.19 },
      { gallons: 6.1,  totalPaid: 18.91 },
    ]);
    expect(totals.count).toBe(3);
    expect(totals.totalGallons).toBe(25.8);
    expect(totals.totalPaid).toBe(79.44);
  });

  it('falls back to gallons × pricePerGallon when no total was recorded', () => {
    const totals = refuelTotals([{ gallons: 10, pricePerGallon: 3.10 }]);
    expect(totals.totalPaid).toBe(31);
  });

  it('prefers the recorded total over the unit-price fallback', () => {
    // Pump rounded up / different actual charge — trust what was actually paid.
    const totals = refuelTotals([{ gallons: 10, pricePerGallon: 3.10, totalPaid: 31.50 }]);
    expect(totals.totalPaid).toBe(31.5);
  });

  it('counts gallons even when cost is missing entirely', () => {
    const totals = refuelTotals([{ gallons: 9.4 }]);
    expect(totals.totalGallons).toBe(9.4);
    expect(totals.totalPaid).toBe(0);
  });

  it('empty log is all zeroes, not NaN', () => {
    const totals = refuelTotals([]);
    expect(totals).toEqual({ count: 0, totalGallons: 0, totalPaid: 0 });
  });
});

describe('rentalRecap()', () => {
  it('compares real spend against what the rental company would have charged', () => {
    const recap = rentalRecap(
      [{ gallons: 10, totalPaid: 30.90 }, { gallons: 5, totalPaid: 15.45 }],
      5.11,
    );
    expect(recap.totalGallons).toBe(15);
    expect(recap.totalPaid).toBe(46.35);
    expect(recap.rentalWouldHaveCharged).toBe(76.65); // 15 × 5.11
    expect(recap.savings).toBe(30.3);
  });

  it('unknown rental rate → null comparison, never an invented number', () => {
    const recap = rentalRecap([{ gallons: 10, totalPaid: 30.90 }], null);
    expect(recap.totalPaid).toBe(30.9);
    expect(recap.rentalWouldHaveCharged).toBeNull();
    expect(recap.savings).toBeNull();
  });

  it('no refuels logged → no comparison to make', () => {
    const recap = rentalRecap([], 5.11);
    expect(recap.totalGallons).toBe(0);
    expect(recap.rentalWouldHaveCharged).toBeNull();
    expect(recap.savings).toBeNull();
  });

  it('savings can be negative if the renter paid more than the rental rate', () => {
    const recap = rentalRecap([{ gallons: 10, totalPaid: 60 }], 5.11);
    expect(recap.savings).toBe(-8.9); // 51.10 − 60
  });
});

// ── Unknown-fuel guards (regression) ────────────────────────────────────────
// A rental can legitimately have no fuel figure yet: entered ahead of pickup,
// or created with the optional pickup level left blank. These document why
// RentalDashboard gates its gauge and its "✓ No fuel needed" block on
// `fuelKnown` instead of trusting the numbers these helpers return.
describe('unknown fuel is not zero fuel', () => {
  it('gallonsNeeded returns 0 when nothing is known — which must NOT be shown as "no fuel needed"', () => {
    // This is the trap: the dashboard used `??  0` on both sides and rendered
    // a green ✓ for a car the renter had not collected.
    expect(gallonsNeeded(0, 0)).toBe(0);
  });

  it('returnReadyStatus reports needs_fuel when either side is unknown', () => {
    expect(returnReadyStatus(null, null)).toBe('needs_fuel');
    expect(returnReadyStatus(null, 12)).toBe('needs_fuel');
    expect(returnReadyStatus(12, null)).toBe('needs_fuel');
  });

  it('formatGallons renders unknown as an em dash, never 0 gal', () => {
    expect(formatGallons(null, 'MANUAL_GAUGE')).toBe('—');
    expect(formatGallons(undefined, null)).toBe('—');
    expect(formatGallons(0, 'MANUAL_GAUGE')).toBe('~0 gal');
  });
});

// ── Tank capacity changes (regression) ──────────────────────────────────────
// Reported from the app: "~24.5 gal" shown on a 14 gal tank. The rental was
// created against a ~28 gal vehicle at 7/8, then the vehicle was corrected to
// a 14 gal one — the capacity changed and the gallons didn't, so the gauge
// rendered over-full and the return target read as already satisfied.
describe('reconcileFuelForNewTank', () => {
  it('reproduces and fixes the reported 24.5-on-a-14 case', () => {
    expect(reconcileFuelForNewTank(24.5, 'MANUAL_GAUGE', 28, 14)).toBe(12.25); // 7/8 of 14
  });

  it('preserves the observed FRACTION for gauge and percent entries', () => {
    expect(reconcileFuelForNewTank(7.5, 'MANUAL_GAUGE', 15, 20)).toBe(10);     // 1/2 stays 1/2
    expect(reconcileFuelForNewTank(5, 'MANUAL_PERCENT', 20, 10)).toBe(2.5);    // 25% stays 25%
  });

  it('leaves absolute entries alone when they still fit', () => {
    // A typed figure or a receipt is a real quantity, not a fraction — the
    // number the user stated is still the number they put in.
    expect(reconcileFuelForNewTank(9, 'MANUAL_GALLONS', 28, 14)).toBe(9);
    expect(reconcileFuelForNewTank(9, 'RECEIPT', 28, 14)).toBe(9);
  });

  it('clamps anything that exceeds the new capacity, whatever the source', () => {
    expect(reconcileFuelForNewTank(26, 'MANUAL_GALLONS', 28, 14)).toBe(14);
    expect(reconcileFuelForNewTank(26, 'RECEIPT', 28, 14)).toBe(14);
    expect(reconcileFuelForNewTank(27, 'MANUAL_GAUGE', 28, 14)).toBeLessThanOrEqual(14);
  });

  it('never invents a level where there was none', () => {
    expect(reconcileFuelForNewTank(null, 'MANUAL_GAUGE', 28, 14)).toBeNull();
  });

  it('is a no-op when the new capacity is unusable', () => {
    expect(reconcileFuelForNewTank(12, 'MANUAL_GAUGE', 28, null)).toBe(12);
    expect(reconcileFuelForNewTank(12, 'MANUAL_GAUGE', 28, 0)).toBe(12);
  });

  it('clamps rather than dividing by zero when the old capacity is missing', () => {
    expect(reconcileFuelForNewTank(20, 'MANUAL_GAUGE', null, 14)).toBe(14);
    expect(reconcileFuelForNewTank(20, 'MANUAL_GAUGE', 0, 14)).toBe(14);
  });

  it('result never exceeds the new tank — the invariant the bug violated', () => {
    for (const g of [0, 1, 13.9, 14, 24.5, 100]) {
      for (const src of ['MANUAL_GAUGE', 'MANUAL_PERCENT', 'MANUAL_GALLONS', 'RECEIPT'] as const) {
        expect(reconcileFuelForNewTank(g, src, 28, 14)!).toBeLessThanOrEqual(14);
      }
    }
  });
});

// ── Upcoming vs in-progress ─────────────────────────────────────────────────
// Reported: the calculator banner read "Active rental with Avis" when the only
// rental was an UPCOMING one with Hertz. Two faults met there — the hook took
// sessions[0] out of several, and nothing distinguished booked from collected.
// 'active' is the DB status from creation; only pickupDateTime says whether
// the renter actually has the car.
describe('isUpcomingRental', () => {
  const NOW = new Date('2026-08-15T18:00:00Z').getTime();
  const at  = (iso: string) => isUpcomingRental(iso, NOW);

  it('is upcoming when pickup is still ahead', () => {
    expect(at('2026-08-20T15:00:00Z')).toBe(true);
  });

  it('is in progress once pickup has passed', () => {
    expect(at('2026-08-14T09:00:00Z')).toBe(false);
  });

  it('treats the exact pickup moment as in progress, not upcoming', () => {
    expect(at('2026-08-15T18:00:00Z')).toBe(false);
  });

  it('treats a missing pickup time as in progress — the at-the-counter case', () => {
    // Set up while standing at the desk: no future pickup, car already in hand.
    expect(isUpcomingRental(null, NOW)).toBe(false);
    expect(isUpcomingRental(undefined, NOW)).toBe(false);
    expect(isUpcomingRental('', NOW)).toBe(false);
  });

  it('does not call garbage upcoming', () => {
    expect(isUpcomingRental('not a date', NOW)).toBe(false);
  });
});

// Post-release fix (2026-08-26) — Calculate Fill was previously hidden
// entirely whenever `needed === 0` or no fuel reading existed yet, making
// the feature effectively undiscoverable for most new rentals. These lock
// in the four required states.
describe('resolveCalculateFillState()', () => {
  it('an upcoming (not-yet-picked-up) rental hides the section entirely', () => {
    expect(resolveCalculateFillState({ isUpcoming: true, hasFuelReading: false, needed: 0 })).toBe('upcoming');
    expect(resolveCalculateFillState({ isUpcoming: true, hasFuelReading: true, needed: 5 })).toBe('upcoming');
  });

  it('a started rental with no fuel reading yet shows the prompt state, not hidden', () => {
    expect(resolveCalculateFillState({ isUpcoming: false, hasFuelReading: false, needed: 0 })).toBe('needs_fuel_reading');
  });

  it('a real reading with fuel needed shows the full calculator — the regression: this must NOT require needed > 0 to be the only visible state', () => {
    expect(resolveCalculateFillState({ isUpcoming: false, hasFuelReading: true, needed: 3.5 })).toBe('needs_fill');
  });

  it('a real reading already at or above the return level is VISIBLE (not hidden) with its own state — the exact bug being fixed', () => {
    expect(resolveCalculateFillState({ isUpcoming: false, hasFuelReading: true, needed: 0 })).toBe('at_or_above_target');
  });
});
