/**
 * Phase 6A.1 — Rental Car Mode lifecycle UX (upcoming/active/near_return/
 * completed). resolveRentalLifecycle() and RENTAL_LIFECYCLE_SECTION_ORDER
 * are pure and fully covered in __tests__/rentalCalculations.test.ts. This
 * file covers the structural wiring in RentalDashboard.tsx that can't be
 * asserted without a JSX render harness (vitest.config.ts has none) — same
 * source-reading pattern as __tests__/rentalTripFillCalculator.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  resolveRentalLifecycle, RENTAL_LIFECYCLE_SECTION_ORDER, RENTAL_NEAR_RETURN_HOURS,
  gallonsNeeded, estimatedFuelCost,
} from '../lib/rentalCalculations';

const dashboardSrc = readFileSync(
  join(__dirname, '../components/rental-return/RentalDashboard.tsx'),
  'utf8',
);

describe('Section ordering — hides trip calculator before pickup, promotes it during active, promotes return prep near return', () => {
  it('8. upcoming: the trip calculator card is entirely absent (gated on !isUpcoming, unrelated to ordering)', () => {
    expect(dashboardSrc).toMatch(/\{!isUpcoming && tankCapacity > 0 && \(/);
  });

  it('9. active: Fill Up During Rental + Fuel Log are ordered BEFORE Calculate Fill/Return Preparation', () => {
    const o = RENTAL_LIFECYCLE_SECTION_ORDER.active;
    expect(o.tripCalc).toBeLessThan(o.calculateFill);
    expect(o.fuelLog).toBeLessThan(o.calculateFill);
    expect(o.tripCalc).toBeLessThan(o.returnPrep);
    expect(o.fuelLog).toBeLessThan(o.returnPrep);
  });

  it('10. near_return: Calculate Fill/Return Preparation ("Prepare for Return") are ordered BEFORE the trip calculator and Fuel Log', () => {
    const o = RENTAL_LIFECYCLE_SECTION_ORDER.near_return;
    expect(o.calculateFill).toBeLessThan(o.tripCalc);
    expect(o.returnPrep).toBeLessThan(o.tripCalc);
    expect(o.calculateFill).toBeLessThan(o.fuelLog);
    expect(o.returnPrep).toBeLessThan(o.fuelLog);
  });

  it('11. near_return still renders the trip calculator card — never removed, only reordered', () => {
    // Same gate as the "hidden before pickup" test above — near_return
    // implies !isUpcoming, so this gate alone proves it isn't disabled.
    expect(dashboardSrc).toMatch(/\{!isUpcoming && tankCapacity > 0 && \(/);
    expect(dashboardSrc).not.toMatch(/isNearReturn.*tripCalc.*false/i);
  });

  it('the ordering is applied via CSS order on a flex container, not by physically duplicating any section\'s JSX', () => {
    expect(dashboardSrc).toMatch(/flex flex-col gap-4/);
    expect(dashboardSrc).toMatch(/style=\{\{ order: sectionOrder\.tripCalc \}\}/);
    expect(dashboardSrc).toMatch(/style=\{\{ order: sectionOrder\.calculateFill \}\}/);
    expect(dashboardSrc).toMatch(/style=\{\{ order: sectionOrder\.fuelLog \}\}/);
    expect(dashboardSrc).toMatch(/style=\{\{ order: sectionOrder\.returnPrep \}\}/);
  });
});

describe('Prepare for Return promotion (near_return)', () => {
  it('renders a distinct "Prepare for Return" heading only while isNearReturn', () => {
    expect(dashboardSrc).toMatch(/\{isNearReturn && calculateFillState !== 'upcoming' && \(/);
    expect(dashboardSrc).toMatch(/prepareForReturnTitle/);
  });

  it('reuses the existing gallonsNeeded/estimatedFuelCost primitives — no second calculator, no new fuel math', () => {
    // Both are still imported and used exactly as before this phase.
    expect(dashboardSrc).toMatch(/const needed\s*=\s*gallonsNeeded\(session\.requiredReturnFuelGallons \?\? 0, session\.currentFuelGallons \?\? 0\)/);
    expect(dashboardSrc).toMatch(/estimatedFuelCost\(needed, Number\(calcPricePerGal\)\)/);
    // Sanity: these are literally the same functions used elsewhere in the
    // suite, not a lifecycle-specific reimplementation.
    expect(gallonsNeeded(10, 4)).toBe(6);
    expect(estimatedFuelCost(6, 3)).toBe(18);
  });

  it('estimated savings only renders when both a rental-company rate AND an entered price exist, never a fabricated gas price', () => {
    expect(dashboardSrc).toMatch(/const estimatedSavingsAmount = rentalCharge != null && Number\(calcPricePerGal\) > 0/);
    expect(dashboardSrc).toMatch(/estimatedSavingsAmount != null && \(/);
  });
});

describe('Completed/Cancelled lifecycle — read-only, no mutation controls, retains Fuel History', () => {
  const completedBlockStart = dashboardSrc.indexOf('if (isCompleted || isCancelled) {');
  const completedBlock = dashboardSrc.slice(completedBlockStart, dashboardSrc.indexOf('\n  // Is there a fuel figure at all'));

  it('12. hides every mutation control: no Update Current Fuel, no Trip Fill-Up, no Calculate Fill, no logging, no completion action', () => {
    expect(completedBlockStart).toBeGreaterThan(-1);
    expect(completedBlock).not.toMatch(/setShowUpdateFuel/);
    expect(completedBlock).not.toMatch(/tripCalcTitle/);
    expect(completedBlock).not.toMatch(/calculateFillTitle/);
    expect(completedBlock).not.toMatch(/setShowRefuel/);
    expect(completedBlock).not.toMatch(/setShowComplete/);
    expect(completedBlock).not.toMatch(/FuelLevelInput/);
  });

  it('13. retains Fuel History (fillups list + Total Gallons Purchased / Total Fuel Spent), computed from stored actual values', () => {
    expect(completedBlock).toMatch(/fillups\.map/);
    expect(completedBlock).toMatch(/fuelHistoryTotalGallons/);
    expect(completedBlock).toMatch(/fuelHistoryTotalCost/);
    expect(completedBlock).toMatch(/roundGallons\(fillups\.reduce/);
  });

  it('shows historical identity/dates/fuel-level facts requested for the summary', () => {
    expect(completedBlock).toMatch(/rentalSummaryTitle/);
    expect(completedBlock).toMatch(/finalFuelLevelLabel/);
    expect(completedBlock).toMatch(/requiredReturnLevelLabel/);
    expect(completedBlock).toMatch(/completedPickupLabel/);
    expect(completedBlock).toMatch(/completedReturnLabel/);
    expect(completedBlock).toMatch(/rentalAgreementNumber/);
    expect(completedBlock).toMatch(/rentalConfirmationNumber/);
  });

  it('11. completed still renders completed-specific copy (rentalCompleteTitle), not cancelled copy', () => {
    expect(completedBlock).toMatch(/isCancelled \? t\.rentalReturn\.rentalCancelledTitle : t\.rentalReturn\.rentalCompleteTitle/);
  });

  it('10. cancelled does NOT render "Your Rental Is Complete" — a distinct rentalCancelledTitle is used', () => {
    expect(completedBlock).toMatch(/rentalCancelledTitle/);
    // The ternary picks cancelled copy specifically when isCancelled is true.
    const ternaryIdx = completedBlock.indexOf('isCancelled ? t.rentalReturn.rentalCancelledTitle');
    expect(ternaryIdx).toBeGreaterThan(-1);
  });

  it('9. cancelled is read-only just like completed — reaches the SAME shared render path, no separate mutation-capable branch', () => {
    expect(dashboardSrc).toMatch(/if \(isCompleted \|\| isCancelled\) \{/);
  });

  it('8/9. resolveRentalLifecycle: completed and cancelled are distinct, both handled by this dashboard branch', () => {
    expect(dashboardSrc).toMatch(/const isCompleted = lifecycle === 'completed';/);
    expect(dashboardSrc).toMatch(/const isCancelled = lifecycle === 'cancelled';/);
    expect(resolveRentalLifecycle({ status: 'completed', pickupDateTime: null, returnDateTime: null })).toBe('completed');
    expect(resolveRentalLifecycle({ status: 'cancelled', pickupDateTime: null, returnDateTime: null })).toBe('cancelled');
  });
});

describe('Upcoming lifecycle — Actions row hidden entirely', () => {
  it('the "I Just Refueled" / "Complete Rental" action row is gated on !isUpcoming', () => {
    expect(dashboardSrc).toMatch(/\{!isUpcoming && \(\s*<div className="flex gap-2" style=\{\{ order: sectionOrder\.actions \}\}>/);
  });
});

describe('No MPG logic introduced (Phase 6A.1 explicit exclusion)', () => {
  it('16. no MPG/fuel-economy/gallons-consumed/mileage-derived-consumption concepts appear in the dashboard or lifecycle helper', () => {
    const lifecycleSrc = readFileSync(join(__dirname, '../lib/rentalCalculations.ts'), 'utf8');
    for (const src of [dashboardSrc, lifecycleSrc]) {
      expect(src).not.toMatch(/\bmpg\b/i);
      expect(src).not.toMatch(/fuelEconomy/i);
      expect(src).not.toMatch(/gallonsConsumed/i);
      expect(src).not.toMatch(/milesPerGallon/i);
    }
  });
});

describe('Analytics — lifecycle events guarded, not render-time', () => {
  it('rental_near_return_viewed fires from a useEffect guarded by a ref, not inline during render', () => {
    expect(dashboardSrc).toMatch(/nearReturnTrackedRef\.current/);
    expect(dashboardSrc).toMatch(/trackClientEvent\('rental_near_return_viewed'\)/);
    const effectStart = dashboardSrc.indexOf('rental_near_return_viewed, fired once');
    const effectBlock = dashboardSrc.slice(effectStart, dashboardSrc.indexOf('if (loading || !session)'));
    expect(effectBlock).toMatch(/useEffect\(/);
  });

  it('rental_prepare_return_cta_used fires only when isNearReturn, from the Final Return Fill-Up and Find Gas CTAs', () => {
    const occurrences = dashboardSrc.match(/if \(isNearReturn\) trackClientEvent\('rental_prepare_return_cta_used'\);/g) ?? [];
    expect(occurrences.length).toBe(2);
  });
});
