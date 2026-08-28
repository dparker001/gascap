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

describe('Section ordering — Fuel Actions replace "Calculate Fill", promoted/de-emphasized per lifecycle', () => {
  it('8. upcoming: Fuel Actions (and therefore Add Fuel During Rental / Prepare for Return) are entirely absent', () => {
    expect(dashboardSrc).toMatch(/\{!isUpcoming && \(\s*<div className="space-y-2" style=\{\{ order: sectionOrder\.calculateFill \}\}>/);
  });

  it('9. active: Add Fuel During Rental + Fuel Log are ordered BEFORE the return-target group (Fuel Actions/Prepare for Return)', () => {
    const o = RENTAL_LIFECYCLE_SECTION_ORDER.active;
    expect(o.tripCalc).toBeLessThan(o.calculateFill);
    expect(o.fuelLog).toBeLessThan(o.calculateFill);
    expect(o.tripCalc).toBeLessThan(o.returnPrep);
    expect(o.fuelLog).toBeLessThan(o.returnPrep);
  });

  it('10. near_return: Fuel Actions/Prepare for Return are ordered BEFORE Add Fuel During Rental and Fuel Log', () => {
    const o = RENTAL_LIFECYCLE_SECTION_ORDER.near_return;
    expect(o.calculateFill).toBeLessThan(o.tripCalc);
    expect(o.returnPrep).toBeLessThan(o.tripCalc);
    expect(o.calculateFill).toBeLessThan(o.fuelLog);
    expect(o.returnPrep).toBeLessThan(o.fuelLog);
  });

  it('11. near_return still renders the Add Fuel During Rental button/workflow — never removed, only de-emphasized (secondary ordering within Fuel Actions)', () => {
    // The Fuel Actions block (rendered whenever !isUpcoming, both active and
    // near_return) always includes the Add Fuel button — only its `order-1`
    // vs `order-2` class swaps based on isNearReturn, it's never dropped.
    expect(dashboardSrc).toMatch(/\{t\.rentalReturn\.tripCalcTitle\}/);
    expect(dashboardSrc).toMatch(/\$\{isNearReturn \? 'order-2' : 'order-1'\}/);
  });

  it('the ordering is applied via CSS order on a flex container, not by physically duplicating any section\'s JSX', () => {
    expect(dashboardSrc).toMatch(/flex flex-col gap-4/);
    expect(dashboardSrc).toMatch(/style=\{\{ order: sectionOrder\.tripCalc \}\}/);
    expect(dashboardSrc).toMatch(/style=\{\{ order: sectionOrder\.calculateFill \}\}/);
    expect(dashboardSrc).toMatch(/style=\{\{ order: sectionOrder\.fuelLog \}\}/);
    expect(dashboardSrc).toMatch(/style=\{\{ order: sectionOrder\.returnPrep \}\}/);
  });
});

describe('Prepare for Return promotion (near_return) — Phase 6A.2', () => {
  it('the generic "Calculate Fill" user-facing heading is removed', () => {
    expect(dashboardSrc).not.toMatch(/calculateFillTitle/);
    expect(dashboardSrc).not.toMatch(/calculateFillCta/);
  });

  it('near_return auto-opens the Prepare for Return workflow once, without re-forcing it open after the renter closes it', () => {
    expect(dashboardSrc).toMatch(/workflowAutoOpenedRef\.current/);
    expect(dashboardSrc).toMatch(/setActiveWorkflow\('prepare_return'\)/);
  });

  it('Prepare for Return is its own panel, gated on activeWorkflow, and reuses prepareForReturnTitle both as the Fuel Actions button label and the panel heading', () => {
    expect(dashboardSrc).toMatch(/\{!isUpcoming && activeWorkflow === 'prepare_return' && \(/);
    const occurrences = dashboardSrc.match(/prepareForReturnTitle/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it('the return workflow does not offer a Trip Fill-Up CTA — that job belongs entirely to Add Fuel During Rental', () => {
    const start = dashboardSrc.indexOf("{!isUpcoming && activeWorkflow === 'prepare_return' && (");
    const end = dashboardSrc.indexOf('(showFindGas || activeWorkflow', start);
    const prepareReturnBlock = dashboardSrc.slice(start, end);
    expect(prepareReturnBlock).not.toMatch(/tripFillUp/);
    expect(prepareReturnBlock).not.toMatch(/setRefuelDefaultType\('trip'\)/);
    expect(prepareReturnBlock).toMatch(/setRefuelDefaultType\('final_return'\)/);
    expect(prepareReturnBlock).toMatch(/logFinalFillUpCta/);
  });

  it('the Add Fuel During Rental workflow does not masquerade as return calculation — no requiredReturnFuelGallons/gallonsNeeded usage inside it', () => {
    const start = dashboardSrc.indexOf('ADD FUEL DURING RENTAL');
    const end = dashboardSrc.indexOf('PREPARE FOR RETURN — Phase 6A.2', start);
    const addFuelBlock = dashboardSrc.slice(start, end);
    expect(addFuelBlock).not.toMatch(/requiredReturnFuelGallons/);
    expect(addFuelBlock).not.toMatch(/gallonsNeeded\(/);
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

describe('Fuel History — secondary/collapsed by default', () => {
  it('11. active default does not render the full Fuel History list expanded — gated on showFuelHistory (defaults false)', () => {
    expect(dashboardSrc).toMatch(/const \[showFuelHistory, setShowFuelHistory\] = useState\(false\)/);
    expect(dashboardSrc).toMatch(/\{showFuelHistory && \(/);
  });

  it('12. the collapsed summary line uses canonical stored fillups (count/gallons/cost), not calculator estimates', () => {
    expect(dashboardSrc).toMatch(/fuelHistorySummaryLine\(fillups\.length, roundGallons\(fillups\.reduce/);
  });

  it('13. Fuel History can expand via a toggle button', () => {
    expect(dashboardSrc).toMatch(/onClick=\{\(\) => setShowFuelHistory\(\(v\) => !v\)\}/);
    expect(dashboardSrc).toMatch(/viewHistoryLabel/);
    expect(dashboardSrc).toMatch(/hideHistoryLabel/);
  });
});

describe('Rental Details — collapsed low-priority identity/logistics facts', () => {
  it('agreement/confirmation numbers moved out of the hero into a collapsed Rental Details section', () => {
    expect(dashboardSrc).toMatch(/rentalDetailsTitle/);
    expect(dashboardSrc).toMatch(/const \[showRentalDetails, setShowRentalDetails\] = useState\(false\)/);
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

describe('Upcoming lifecycle — mutation actions hidden entirely', () => {
  it('16. upcoming hides live fuel actions: Fuel Actions (Add Fuel/Prepare for Return) and Complete Rental are both gated on !isUpcoming', () => {
    expect(dashboardSrc).toMatch(/\{!isUpcoming && \(\s*<div className="space-y-2" style=\{\{ order: sectionOrder\.calculateFill \}\}>/);
    expect(dashboardSrc).toMatch(/\{!isUpcoming && \(\s*<button onClick=\{\(\) => setShowComplete\(true\)\}/);
  });

  it('the bare "I Just Refueled" shortcut was removed — Add Fuel During Rental is now the sole entry point for a trip fillup', () => {
    expect(dashboardSrc).not.toMatch(/iJustRefueled/);
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
