/**
 * Phase 6A — Trip Fill-Up calculator in RentalDashboard.tsx. This repo has
 * no JSX render harness (vitest.config.ts has no @vitejs/plugin-react), so
 * these read the component/modal source directly and assert the structural
 * invariants the product spec requires, the same pattern used by
 * __tests__/dateTimeSplitInputLayout.test.ts and
 * __tests__/gaugeCurvedStylesLayout.test.ts. The underlying math is tested
 * directly (and more thoroughly) in __tests__/rentalCalculations.test.ts's
 * tripFillEstimate() suite — these are structural/wiring checks only.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const dashboardSrc = readFileSync(
  join(__dirname, '../components/rental-return/RentalDashboard.tsx'),
  'utf8',
);
const modalSrc = readFileSync(
  join(__dirname, '../components/rental-return/RefuelLogModal.tsx'),
  'utf8',
);

function extractBlock(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

const tripCalcBlock = extractBlock(
  dashboardSrc,
  'ADD FUEL DURING RENTAL',
  'PREPARE FOR RETURN — Phase 6A.2',
);

describe('Trip Fill-Up calculator — never persists automatically', () => {
  it('the calculator block never calls fetch() itself — only "Log This Fill-Up" opens the modal that does', () => {
    expect(tripCalcBlock).not.toMatch(/fetch\(/);
  });

  it('"Log This Fill-Up" only sets state to open RefuelLogModal, it does not submit anything', () => {
    const ctaBlock = tripCalcBlock.slice(tripCalcBlock.indexOf('tripCalcLogCta'));
    // The button's own onClick, read backwards from the label usage, is the
    // preceding onClick handler — assert the surrounding handler sets
    // setShowRefuel(true) and contains no fetch/await.
    const handlerStart = tripCalcBlock.lastIndexOf('onClick', tripCalcBlock.indexOf('tripCalcLogCta'));
    const handler = tripCalcBlock.slice(handlerStart, tripCalcBlock.indexOf('tripCalcLogCta'));
    expect(handler).toMatch(/setShowRefuel\(true\)/);
    expect(handler).not.toMatch(/fetch\(/);
    expect(ctaBlock.length).toBeGreaterThan(0); // sanity: marker actually found
  });
});

describe('Trip Fill-Up calculator — hands off to RefuelLogModal correctly', () => {
  it("'Log This Fill-Up' sets defaultFillupType to 'trip', never final_return", () => {
    const handlerStart = tripCalcBlock.lastIndexOf('onClick', tripCalcBlock.indexOf('tripCalcLogCta'));
    const handler = tripCalcBlock.slice(handlerStart, tripCalcBlock.indexOf('tripCalcLogCta'));
    expect(handler).toMatch(/setRefuelDefaultType\('trip'\)/);
  });

  it("hands off the calculated gallons and price via a single refuelSuggestion object consumed by RefuelLogModal's suggestedGallons/suggestedPricePerGallon props", () => {
    const handlerStart = tripCalcBlock.lastIndexOf('onClick', tripCalcBlock.indexOf('tripCalcLogCta'));
    const handler = tripCalcBlock.slice(handlerStart, tripCalcBlock.indexOf('tripCalcLogCta'));
    expect(handler).toMatch(/setRefuelSuggestion\(\{\s*gallons:\s*tripGallonsToAdd/);
    expect(dashboardSrc).toMatch(/suggestedGallons=\{refuelSuggestion\.gallons\}/);
    expect(dashboardSrc).toMatch(/suggestedPricePerGallon=\{refuelSuggestion\.price\}/);
  });

  it('RefuelLogModal still accepts defaultFillupType, suggestedGallons, and suggestedPricePerGallon as independently overridable props (existing contract, unchanged)', () => {
    expect(modalSrc).toMatch(/defaultFillupType\?:\s*'trip'\s*\|\s*'final_return'/);
    expect(modalSrc).toMatch(/suggestedGallons\?:\s*number/);
    expect(modalSrc).toMatch(/suggestedPricePerGallon\?:\s*number/);
    // The modal's fields stay editable after prefill — it seeds state, it
    // doesn't lock the inputs.
    expect(modalSrc).toMatch(/onChange=\{\(e\) => setGallons/);
    expect(modalSrc).toMatch(/onChange=\{\(e\) => setPricePerGal/);
  });
});

describe('Trip Fill-Up calculator — analytics', () => {
  it('fires rental_trip_fill_calculator_opened at most once per open (guarded by a ref)', () => {
    expect(dashboardSrc).toMatch(/tripCalcOpenedRef\.current/);
    expect(dashboardSrc).toMatch(/trackClientEvent\('rental_trip_fill_calculator_opened'\)/);
  });

  it('fires rental_trip_fill_calculated at most once, guarded, only when a price is actually entered', () => {
    expect(dashboardSrc).toMatch(/tripCalcTrackedRef\.current/);
    expect(dashboardSrc).toMatch(/trackClientEvent\('rental_trip_fill_calculated'\)/);
  });

  it('fires rental_trip_fill_log_started when the user taps Log This Fill-Up', () => {
    const handlerStart = tripCalcBlock.lastIndexOf('onClick', tripCalcBlock.indexOf('tripCalcLogCta'));
    const handler = tripCalcBlock.slice(handlerStart, tripCalcBlock.indexOf('tripCalcLogCta'));
    expect(handler).toMatch(/trackClientEvent\('rental_trip_fill_log_started'\)/);
  });

  it('all three new event types are present in the server-side client-emittable allowlist', () => {
    const routeSrc = readFileSync(
      join(__dirname, '../app/api/analytics/event/route.ts'),
      'utf8',
    );
    for (const ev of ['rental_trip_fill_calculator_opened', 'rental_trip_fill_calculated', 'rental_trip_fill_log_started']) {
      expect(routeSrc).toContain(`'${ev}'`);
    }
  });
});

describe('Fuel History — totals and row display use canonical Fillup fields, not calculator estimates', () => {
  it('totals are computed from the fillups array (actual stored values), not from any trip-calculator state', () => {
    // 2026-08-28 (Phase 6A.1) — the completed-lifecycle read-only view also
    // renders a fuelHistoryTotalGallons/Cost pair (from pre-computed
    // totalGallons/totalCost consts, still fillups-derived, just hoisted
    // above the JSX rather than inlined) BEFORE the live dashboard's own
    // totals block. Search from the live "Fuel History" section's start
    // so this test targets the ACTIVE dashboard's totals, not the
    // completed view's.
    const liveFuelLogStart = dashboardSrc.indexOf('FUEL HISTORY — Phase 6A.2');
    const totalsBlock = dashboardSrc.slice(
      dashboardSrc.indexOf('fuelHistoryTotalGallons', liveFuelLogStart),
      dashboardSrc.indexOf('fuelHistoryTotalCost', liveFuelLogStart) + 'fuelHistoryTotalCost'.length + 200,
    );
    expect(totalsBlock).toMatch(/fillups\.reduce/);
    expect(totalsBlock).not.toMatch(/tripGallonsToAdd|tripEstCost/);
  });

  it('each row shows type classification (trip vs final_return), price/gallon when present, and a receipt indicator when a receiptThumb exists', () => {
    expect(dashboardSrc).toMatch(/f\.fillupType === 'final_return' \? t\.rentalReturn\.finalReturnFillUp : t\.rentalReturn\.tripFillUp/);
    expect(dashboardSrc).toMatch(/f\.pricePerGallon > 0 \? ` · \$\$\{f\.pricePerGallon\.toFixed\(2\)\}\/gal` : ''/);
    expect(dashboardSrc).toMatch(/f\.receiptThumb && <span/);
  });

  it('missing optional fields (price, station, receipt) degrade gracefully — all three are conditionally rendered, not required', () => {
    expect(dashboardSrc).toMatch(/f\.stationName \? ` · \$\{f\.stationName\}` : ''/);
    expect(dashboardSrc).toMatch(/f\.pricePerGallon > 0 \?/);
    expect(dashboardSrc).toMatch(/f\.receiptThumb &&/);
  });
});

describe('Existing final-return calculation is untouched by this change', () => {
  it('the top-level `needed` figure still derives from gallonsNeeded(requiredReturnFuelGallons, currentFuelGallons) — the return target, not the trip calculator', () => {
    expect(dashboardSrc).toMatch(/const needed\s*=\s*gallonsNeeded\(session\.requiredReturnFuelGallons \?\? 0, session\.currentFuelGallons \?\? 0\)/);
  });

  it('the Calculate Fill (return-target) section still uses its own state (calcPricePerGal), independent of the trip calculator\'s tripPricePerGal', () => {
    expect(dashboardSrc).toMatch(/calcPricePerGal/);
    expect(dashboardSrc).toMatch(/tripPricePerGal/);
    // Two distinct state variables — never the same input driving both flows.
    expect(dashboardSrc.match(/const \[calcPricePerGal, setCalcPricePerGal\] = useState/)).toBeTruthy();
    expect(dashboardSrc.match(/const \[tripPricePerGal, setTripPricePerGal\] = useState/)).toBeTruthy();
  });
});

describe('Add Fuel During Rental collapses when the rental has not started, has no known tank size, or the workflow isn\'t the active one', () => {
  it('is gated on !isUpcoming, tankCapacity > 0, and activeWorkflow === \'add_fuel\' (single-workflow-open-at-a-time)', () => {
    const gateLine = dashboardSrc.match(/\{!isUpcoming && tankCapacity > 0 && activeWorkflow === 'add_fuel' && \(/);
    expect(gateLine).toBeTruthy();
  });
});

// 2026-08-28 correction — a local-only calculator "current level" could
// promise a gallons-to-add figure computed from a number that
// createRentalFillup()'s atomic currentFuelGallons bump never actually
// used (see lib/rentalFillups.ts's header invariant), leaving the
// calculator's promised result and the real post-fillup tank state
// disagreeing. These lock in the fix: current level is ALWAYS the
// authoritative session.currentFuelGallons, never a second editable state.
describe('Trip Fill-Up calculator — current level is authoritative, never independently editable', () => {
  it('uses session.currentFuelGallons as the current source for tripFillEstimate()', () => {
    const currentLineIdx = tripCalcBlock.indexOf('const currentGallons = session.currentFuelGallons');
    expect(currentLineIdx).toBeGreaterThan(-1);
    const estimateCall = tripCalcBlock.slice(tripCalcBlock.indexOf('tripFillEstimate('));
    expect(estimateCall).toMatch(/tripFillEstimate\(\s*currentGallons,/);
  });

  it('there is no independent tripCurrentFuel state, and no FuelLevelInput bound to a calculator-only current value', () => {
    expect(dashboardSrc).not.toMatch(/tripCurrentFuel/);
    expect(dashboardSrc).not.toMatch(/setTripCurrentFuel/);
    // Exactly one FuelLevelInput inside the trip-calc block — the desired
    // level. A second one bound to "current" is exactly the bug being fixed.
    const fuelLevelInputCount = (tripCalcBlock.match(/<FuelLevelInput/g) ?? []).length;
    expect(fuelLevelInputCount).toBe(1);
    expect(tripCalcBlock).toMatch(/onResolved=\{setTripDesiredFuel\}/);
  });

  it('unknown current fuel (session.currentFuelGallons == null) does not calculate from 0 — hasCurrentFuel gates the estimate', () => {
    expect(tripCalcBlock).toMatch(/const hasCurrentFuel = currentGallons != null/);
    expect(tripCalcBlock).toMatch(/const estimate = hasCurrentFuel && tripDesiredGallonsRaw != null/);
    // No `?? 0` fallback feeding the estimate the way the return-target
    // section fell back to 0 for `needed` before its own fix.
    const estimateBlock = tripCalcBlock.slice(tripCalcBlock.indexOf('const estimate ='), tripCalcBlock.indexOf('const estimate =') + 200);
    expect(estimateBlock).not.toMatch(/currentGallons \?\? 0/);
  });

  it('unknown current fuel shows a prompt and the EXISTING Update Current Fuel action, not a second fuel-entry form', () => {
    const unknownBlock = tripCalcBlock.slice(tripCalcBlock.indexOf('if (!hasCurrentFuel)'), tripCalcBlock.indexOf('return (\n              <>'));
    expect(unknownBlock).toMatch(/tripCalcSetCurrentFuelFirst/);
    expect(unknownBlock).toMatch(/setShowUpdateFuel\(true\)/);
    expect(unknownBlock).toMatch(/updateCurrentFuel/);
    expect(unknownBlock).not.toMatch(/<FuelLevelInput/);
  });

  it('the known-current-fuel branch reuses the same setShowUpdateFuel action to correct current level, not a duplicate PATCH', () => {
    const knownBlock = tripCalcBlock.slice(tripCalcBlock.indexOf('const currentGallons'), tripCalcBlock.indexOf('tripDesiredTooLow ?'));
    expect(knownBlock).toMatch(/setShowUpdateFuel\(true\)/);
    expect(knownBlock).not.toMatch(/fetch\(/);
  });

  it('desired level remains independently adjustable and drives the estimate together with the authoritative current level', () => {
    expect(tripCalcBlock).toMatch(/const tripDesiredGallonsRaw = tripDesiredFuel\?\.gallons \?\? null/);
    expect(tripCalcBlock).toMatch(/tripFillEstimate\(\s*currentGallons,\s*tripDesiredGallonsRaw,\s*tankCapacity/);
  });

  it('createRentalFillup\'s canonical current-fuel-bump behavior is untouched (single atomic update path, not duplicated)', () => {
    const fillupsLibSrc = readFileSync(join(__dirname, '../lib/rentalFillups.ts'), 'utf8');
    expect(fillupsLibSrc).toMatch(/bumpCurrentFuelGallonsOnCreateSql/);
    expect(fillupsLibSrc).toMatch(/CREATE — MAY update currentFuelGallons/);
    // The dashboard's trip-calc block never calls a fillup-creation or
    // current-fuel PATCH endpoint itself — already asserted above (no
    // fetch() in tripCalcBlock at all), so the only write path remains
    // createRentalFillup() via RefuelLogModal's POST /refuel.
  });
});
