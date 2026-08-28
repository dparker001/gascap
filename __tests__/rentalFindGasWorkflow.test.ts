/**
 * Phase 6A.3 — Find Gas is a standalone top-level Fuel Actions job,
 * separate from Prepare for Return. Tapping it must not force the full
 * return calculator (gallons needed / rental-company charge / savings) to
 * expand first, and must never introduce a second gas-search
 * implementation — it reuses the same FindGasNearReturn component/data
 * flow as the Prepare for Return CTA. Same source-reading pattern as
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

describe('activeWorkflow — single enum, mutually exclusive, now includes find_gas', () => {
  it('activeWorkflow type includes none/add_fuel/prepare_return/find_gas', () => {
    expect(dashboardSrc).toMatch(/useState<'none' \| 'add_fuel' \| 'prepare_return' \| 'find_gas'>\('none'\)/);
  });

  it('3. Add Fuel During Rental sets activeWorkflow to add_fuel', () => {
    expect(dashboardSrc).toMatch(/const next = activeWorkflow === 'add_fuel' \? 'none' : 'add_fuel';\s*\n\s*setActiveWorkflow\(next\);/);
  });

  it('4. Prepare for Return sets activeWorkflow to prepare_return', () => {
    expect(dashboardSrc).toMatch(/onClick=\{\(\) => setActiveWorkflow\(\(w\) => \(w === 'prepare_return' \? 'none' : 'prepare_return'\)\)\}/);
  });

  it('5. only one major workflow is open at a time — activeWorkflow is a single enum, never independent booleans for add_fuel/prepare_return/find_gas', () => {
    // The three top-level workflow panels are each gated on a distinct
    // value of the SAME activeWorkflow variable, not three separate
    // useState booleans that could all be true simultaneously.
    expect(dashboardSrc).toMatch(/activeWorkflow === 'add_fuel'/);
    expect(dashboardSrc).toMatch(/activeWorkflow === 'prepare_return'/);
    expect(dashboardSrc).toMatch(/activeWorkflow === 'find_gas'/);
    expect(dashboardSrc).not.toMatch(/const \[showAddFuel/);
    expect(dashboardSrc).not.toMatch(/const \[showPrepareReturn/);
  });
});

describe('Top-level Find Gas — lightweight, does not force Prepare for Return open', () => {
  it('1. top-level Find Gas does NOT set activeWorkflow to prepare_return', () => {
    const buttonStart = dashboardSrc.indexOf('📍 {t.rentalReturn.findGasNearReturn}');
    const handlerStart = dashboardSrc.lastIndexOf('onClick', buttonStart);
    const handler = dashboardSrc.slice(handlerStart, buttonStart);
    expect(handler).not.toMatch(/setActiveWorkflow\('prepare_return'\)/);
  });

  it('2. top-level Find Gas opens the standalone gas-finder workflow (activeWorkflow = find_gas)', () => {
    expect(dashboardSrc).toMatch(/onClick=\{\(\) => setActiveWorkflow\(\(w\) => \(w === 'find_gas' \? 'none' : 'find_gas'\)\)\}/);
  });

  it('does not require the return calculator content (gallons needed / rental-company charge / savings) to render around the standalone gas finder', () => {
    // The standalone find_gas render path is its own conditional block —
    // find where it starts and confirm the surrounding JSX up to the
    // FindGasNearReturn invocation has none of the return-calculator copy.
    const standaloneStart = dashboardSrc.indexOf("(showFindGas || activeWorkflow === 'find_gas')");
    const componentInvoke = dashboardSrc.indexOf('<FindGasNearReturn', standaloneStart);
    const wrapperBlock = dashboardSrc.slice(standaloneStart, componentInvoke);
    expect(wrapperBlock).not.toMatch(/rentalCompanyEstimate/);
    expect(wrapperBlock).not.toMatch(/saveVsRental/);
    expect(wrapperBlock).not.toMatch(/addFuelEyebrow/);
  });
});

describe('Return-specific Find Gas — still lives inside Prepare for Return, shared implementation', () => {
  it('7. the Prepare for Return "Find Gas Near Return" CTA still renders the SAME FindGasNearReturn component (one shared render site)', () => {
    const occurrences = dashboardSrc.match(/<FindGasNearReturn/g) ?? [];
    expect(occurrences.length).toBe(1);
  });

  it('9. no duplicated FindGasNearReturn implementation exists anywhere in the component tree', () => {
    const importOccurrences = dashboardSrc.match(/import FindGasNearReturn from/g) ?? [];
    expect(importOccurrences.length).toBe(1);
  });

  it('the shared render block fires for EITHER trigger (showFindGas from inside Prepare for Return, OR activeWorkflow === find_gas standalone)', () => {
    expect(dashboardSrc).toMatch(/\{\(showFindGas \|\| activeWorkflow === 'find_gas'\) && \(/);
  });

  it('the return-specific trigger (inside Prepare for Return) never leaves the prepare_return workflow — context is preserved implicitly since the panel stays open', () => {
    const prepareReturnStart = dashboardSrc.indexOf("{!isUpcoming && activeWorkflow === 'prepare_return' && (");
    const prepareReturnEnd = dashboardSrc.indexOf('(showFindGas || activeWorkflow', prepareReturnStart);
    const prepareReturnBlock = dashboardSrc.slice(prepareReturnStart, prepareReturnEnd);
    expect(prepareReturnBlock).toMatch(/setShowFindGas\(\(v\) => !v\)/);
    expect(prepareReturnBlock).not.toMatch(/setActiveWorkflow\('find_gas'\)/);
  });
});

describe('Near Return — still auto-opens Prepare for Return, never the standalone gas finder', () => {
  it('6. near_return auto-opens prepare_return, not find_gas', () => {
    expect(dashboardSrc).toMatch(/if \(lc === 'near_return' && !workflowAutoOpenedRef\.current\)/);
    const autoOpenStart = dashboardSrc.indexOf("if (lc === 'near_return' && !workflowAutoOpenedRef.current)");
    const autoOpenBlock = dashboardSrc.slice(autoOpenStart, autoOpenStart + 200);
    expect(autoOpenBlock).toMatch(/setActiveWorkflow\('prepare_return'\)/);
    expect(autoOpenBlock).not.toMatch(/setActiveWorkflow\('find_gas'\)/);
  });
});

describe('Analytics — generic Find Gas does not fire return-preparation events', () => {
  it('8. top-level Find Gas button does not fire rental_prepare_return_cta_used', () => {
    const buttonStart = dashboardSrc.indexOf('📍 {t.rentalReturn.findGasNearReturn}');
    const handlerStart = dashboardSrc.lastIndexOf('onClick', buttonStart);
    const handler = dashboardSrc.slice(handlerStart, buttonStart);
    expect(handler).not.toMatch(/trackClientEvent\('rental_prepare_return_cta_used'\)/);
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
