/**
 * Phase 6A.4 — accordion correction: Find Gas is no longer a top-level
 * dashboard action/workflow. It's now a subordinate action INSIDE each
 * owning accordion (Add Fuel During Rental -> "Find Gas Nearby",
 * Prepare for Return -> "Find Gas Near Return"), both rendering the SAME
 * shared FindGasNearReturn component — never a second gas-search
 * implementation. Same source-reading pattern as
 * __tests__/rentalTripFillCalculator.test.ts (no JSX render harness in
 * this repo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const dashboardSrc = readFileSync(
  join(__dirname, '../components/rental-return/RentalDashboard.tsx'),
  'utf8',
);

describe('activeWorkflow — simplified back to two workflows, find_gas is not a third top-level state', () => {
  it('4. standalone top-level Find Gas action/card is removed — activeWorkflow only has none/add_fuel/prepare_return', () => {
    expect(dashboardSrc).toMatch(/useState<'none' \| 'add_fuel' \| 'prepare_return'>\('none'\)/);
    expect(dashboardSrc).not.toMatch(/'find_gas'/);
  });

  it('3. only one major workflow is open at a time — activeWorkflow is a single enum, never independent booleans for add_fuel/prepare_return', () => {
    expect(dashboardSrc).toMatch(/activeWorkflow === 'add_fuel'/);
    expect(dashboardSrc).toMatch(/activeWorkflow === 'prepare_return'/);
    expect(dashboardSrc).not.toMatch(/const \[showAddFuel/);
    expect(dashboardSrc).not.toMatch(/const \[showPrepareReturn/);
  });
});

describe('Find Gas is nested inside each owning accordion, sharing one implementation', () => {
  it('5. Add Fuel During Rental contains a "Find Gas Nearby" action', () => {
    expect(dashboardSrc).toMatch(/findGasNearbyLabel/);
    const addFuelStart = dashboardSrc.indexOf('const addFuelContent =');
    const addFuelEnd = dashboardSrc.indexOf('const prepareReturnCard = (', addFuelStart);
    const addFuelBlock = dashboardSrc.slice(addFuelStart, addFuelEnd);
    expect(addFuelBlock).toMatch(/setShowFindGasTrip/);
    expect(addFuelBlock).toMatch(/<FindGasNearReturn/);
  });

  it('6. Prepare for Return contains a "Find Gas Near Return" action', () => {
    const prepareStart = dashboardSrc.indexOf("const prepareReturnContent = activeWorkflow === 'prepare_return' && (");
    const prepareEnd = dashboardSrc.indexOf('// Near Return: Prepare for Return reads first', prepareStart);
    const prepareBlock = dashboardSrc.slice(prepareStart, prepareEnd);
    expect(prepareBlock).toMatch(/setShowFindGasReturn/);
    expect(prepareBlock).toMatch(/findGasNearReturn/);
    expect(prepareBlock).toMatch(/<FindGasNearReturn/);
  });

  it('9. no duplicated FindGasNearReturn implementation exists — exactly TWO render sites (one per accordion), one shared component/import', () => {
    const renderSites = dashboardSrc.match(/<FindGasNearReturn/g) ?? [];
    expect(renderSites.length).toBe(2);
    const importOccurrences = dashboardSrc.match(/import FindGasNearReturn from/g) ?? [];
    expect(importOccurrences.length).toBe(1);
  });

  it('each accordion has its OWN independent reveal state (showFindGasTrip / showFindGasReturn), never a shared top-level boolean', () => {
    expect(dashboardSrc).toMatch(/const \[showFindGasTrip, setShowFindGasTrip\] = useState\(false\)/);
    expect(dashboardSrc).toMatch(/const \[showFindGasReturn, setShowFindGasReturn\] = useState\(false\)/);
  });
});

describe('Analytics — Find Gas inside Add Fuel never counts as return-preparation activity', () => {
  it('8. Find Gas Nearby (inside Add Fuel) does not fire rental_prepare_return_cta_used', () => {
    const addFuelStart = dashboardSrc.indexOf('const addFuelContent =');
    const addFuelEnd = dashboardSrc.indexOf('const prepareReturnCard = (', addFuelStart);
    const addFuelBlock = dashboardSrc.slice(addFuelStart, addFuelEnd);
    expect(addFuelBlock).not.toMatch(/rental_prepare_return_cta_used/);
  });

  it('rental_prepare_return_cta_used still fires exactly twice, both inside Prepare for Return (Find Gas Near Return + Log Final Fill-Up CTAs)', () => {
    const occurrences = dashboardSrc.match(/if \(isNearReturn\) trackClientEvent\('rental_prepare_return_cta_used'\);/g) ?? [];
    expect(occurrences.length).toBe(2);
  });

  it('no new gas-search-specific analytics event was introduced', () => {
    expect(dashboardSrc).not.toMatch(/rental_find_gas/);
    expect(dashboardSrc).not.toMatch(/rental_gas_finder/);
  });
});
