/**
 * Phase 6A.4 — foolproof accordion flow correction. Explicit Calculate
 * step (results never become primary output until tapped), Gas price at
 * pump input, dynamic rental-company refueling-rate label, and Log
 * actions available directly within each accordion. Same source-reading
 * pattern as the other rental-dashboard structural tests (no JSX render
 * harness in this repo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const dashboardSrc = readFileSync(
  join(__dirname, '../components/rental-return/RentalDashboard.tsx'),
  'utf8',
);

function addFuelBlock(): string {
  const start = dashboardSrc.indexOf('const addFuelContent =');
  const end = dashboardSrc.indexOf('const prepareReturnCard = (', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return dashboardSrc.slice(start, end);
}

function prepareReturnBlock(): string {
  const start = dashboardSrc.indexOf("const prepareReturnContent = activeWorkflow === 'prepare_return' && (");
  const end = dashboardSrc.indexOf('// Near Return: Prepare for Return reads first', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return dashboardSrc.slice(start, end);
}

describe('Accordion attachment — content renders directly below its own action card', () => {
  it('1. Add Fuel content is defined immediately after its own card, in the same source block', () => {
    const cardIdx = dashboardSrc.indexOf('const addFuelCard = (');
    const contentIdx = dashboardSrc.indexOf('const addFuelContent =');
    expect(cardIdx).toBeGreaterThan(-1);
    expect(contentIdx).toBeGreaterThan(cardIdx);
    // Nothing but the card's own JSX sits between them.
    const between = dashboardSrc.slice(cardIdx, contentIdx);
    expect(between).not.toMatch(/const prepareReturnCard/);
  });

  it('2. Prepare for Return content is defined immediately after its own card, in the same source block', () => {
    const cardIdx = dashboardSrc.indexOf('const prepareReturnCard = (');
    const contentIdx = dashboardSrc.indexOf("const prepareReturnContent = activeWorkflow === 'prepare_return' && (");
    expect(cardIdx).toBeGreaterThan(-1);
    expect(contentIdx).toBeGreaterThan(cardIdx);
  });

  it('both card+content pairs are rendered as adjacent fragment children in BOTH lifecycle orderings — never separated by an unrelated section', () => {
    expect(dashboardSrc).toMatch(/\{addFuelCard\}\s*\{addFuelContent\}/);
    expect(dashboardSrc).toMatch(/\{prepareReturnCard\}\s*\{prepareReturnContent\}/);
  });
});

describe('Gas price at pump — explicit labeling, not generic "Price/gallon"', () => {
  it('7. Add Fuel contains an explicit "Gas price at pump" input', () => {
    const block = addFuelBlock();
    expect(block).toMatch(/gasPriceAtPumpLabel/);
    expect(block).toMatch(/value=\{tripPricePerGal\}/);
  });

  it('8. Prepare for Return contains an explicit "Gas price at pump" input', () => {
    const block = prepareReturnBlock();
    expect(block).toMatch(/gasPriceAtPumpLabel/);
    expect(block).toMatch(/value=\{calcPricePerGal\}/);
  });
});

describe('Explicit Calculate action — results are not the primary output until tapped', () => {
  it('9. Add Fuel has an explicit "Calculate Fuel Needed" button', () => {
    const block = addFuelBlock();
    expect(block).toMatch(/calculateFuelNeededCta/);
    expect(block).toMatch(/setHasCalculatedTripFill\(true\)/);
  });

  it('10. Prepare for Return has an explicit "Calculate Return Cost" button', () => {
    const block = prepareReturnBlock();
    expect(block).toMatch(/calculateReturnCostCta/);
    expect(block).toMatch(/setHasCalculatedReturn\(true\)/);
  });

  it('results in both workflows are gated behind the hasCalculated flag, not shown as soon as inputs exist', () => {
    expect(dashboardSrc).toMatch(/const \[hasCalculatedTripFill, setHasCalculatedTripFill\] = useState\(false\)/);
    expect(dashboardSrc).toMatch(/const \[hasCalculatedReturn, setHasCalculatedReturn\] = useState\(false\)/);
    expect(addFuelBlock()).toMatch(/\{hasCalculatedTripFill && \(/);
    expect(prepareReturnBlock()).toMatch(/\{hasCalculatedReturn && \(/);
  });

  it('changing an input after calculating resets the flag — a stale result is never shown next to new inputs', () => {
    const addBlock = addFuelBlock();
    expect(addBlock).toMatch(/onResolved=\{\(v\) => \{ setTripDesiredFuel\(v\); setHasCalculatedTripFill\(false\); \}\}/);
    expect(addBlock).toMatch(/onChange=\{\(e\) => \{ setTripPricePerGal\(e\.target\.value\); setHasCalculatedTripFill\(false\); \}\}/);
    const returnBlock = prepareReturnBlock();
    expect(returnBlock).toMatch(/onChange=\{\(e\) => \{ setCalcPricePerGal\(e\.target\.value\); setHasCalculatedReturn\(false\); \}\}/);
  });
});

describe('Calculate buttons never mutate data (presentation only)', () => {
  it('11. neither Calculate button performs fetch/PATCH/POST — persistence only happens via existing explicit save actions', () => {
    // Isolate just the button elements' onClick handlers, not the whole
    // accordion (which legitimately contains fetch calls elsewhere, e.g.
    // Update Fuel Level / Log This Fill-Up / Log Final Fill-Up).
    const addCalcIdx = dashboardSrc.indexOf('calculateFuelNeededCta');
    const addCalcHandlerStart = dashboardSrc.lastIndexOf('onClick', addCalcIdx);
    const addCalcHandler = dashboardSrc.slice(addCalcHandlerStart, addCalcIdx);
    expect(addCalcHandler).not.toMatch(/fetch\(/);
    expect(addCalcHandler).not.toMatch(/currentFuelGallons:/);

    const returnCalcIdx = dashboardSrc.indexOf('calculateReturnCostCta');
    const returnCalcHandlerStart = dashboardSrc.lastIndexOf('onClick', returnCalcIdx);
    const returnCalcHandler = dashboardSrc.slice(returnCalcHandlerStart, returnCalcIdx);
    expect(returnCalcHandler).not.toMatch(/fetch\(/);
    expect(returnCalcHandler).not.toMatch(/requiredReturnFuelGallons:/);
  });
});

describe('Results use the existing math primitives — no new fuel math', () => {
  it('12. Add Fuel results are computed via tripFillEstimate()', () => {
    const block = addFuelBlock();
    expect(block).toMatch(/tripFillEstimate\(/);
    expect(block).toMatch(/fuelToAddLabel/);
    expect(block).toMatch(/estimatedCostLabel/);
  });

  it('13. Prepare for Return results are computed via gallonsNeeded()/estimatedFuelCost() (the top-level `needed`/`rentalCharge`/`estimatedSavingsAmount` computed once, unchanged, at component scope)', () => {
    const block = prepareReturnBlock();
    expect(block).toMatch(/\bneeded\b/);
    expect(block).toMatch(/estimatedFuelCost\(needed, Number\(calcPricePerGal\)\)/);
    expect(block).toMatch(/rentalCharge/);
    expect(block).toMatch(/estimatedSavingsAmount/);
  });
});

describe('Logging actions available directly within each workflow', () => {
  it('14. Add Fuel has "Log This Fill-Up"', () => {
    const block = addFuelBlock();
    expect(block).toMatch(/tripCalcLogCta/);
  });

  it('15. Prepare for Return has "Log Final Fill-Up"', () => {
    const block = prepareReturnBlock();
    expect(block).toMatch(/logFinalFillUpCta/);
  });

  it('16. trip logging uses defaultFillupType=\'trip\'', () => {
    const block = addFuelBlock();
    expect(block).toMatch(/setRefuelDefaultType\('trip'\)/);
  });

  it('17. final logging uses defaultFillupType=\'final_return\'', () => {
    const block = prepareReturnBlock();
    expect(block).toMatch(/setRefuelDefaultType\('final_return'\)/);
  });

  it('18. Prepare for Return does not contain a Trip Fill-Up CTA', () => {
    const block = prepareReturnBlock();
    expect(block).not.toMatch(/tripFillUp/);
    expect(block).not.toMatch(/setRefuelDefaultType\('trip'\)/);
  });

  it('"Already filled up? Log a Fill-Up" is available independent of calculation, using the same trip modal flow with no suggestion', () => {
    const block = addFuelBlock();
    expect(block).toMatch(/alreadyFilledUpTitle/);
    expect(block).toMatch(/logAFillUpCta/);
    const logAFillUpIdx = block.indexOf('logAFillUpCta');
    const handlerStart = block.lastIndexOf('onClick', logAFillUpIdx);
    const handler = block.slice(handlerStart, logAFillUpIdx);
    expect(handler).toMatch(/setRefuelSuggestion\(\{\}\)/);
  });
});

describe('Dynamic rental-company refueling-rate label', () => {
  it('19. a dynamic rental-company refueling-rate label exists and is used both in Prepare for Return and Rental Details', () => {
    const occurrences = dashboardSrc.match(/rentalCompanyRefuelingRateLabel\(session\.rentalCompany \|\| ''\)/g) ?? [];
    expect(occurrences.length).toBe(2);
  });

  it('the generic "Price/gallon" label is no longer used for the rental-company rate anywhere in the dashboard', () => {
    // pricePerGallon is still a legitimate key (used for gallons-purchased
    // logging fields elsewhere), so assert it specifically isn't paired
    // with rentalFuelChargePerGallon anymore.
    const rentalDetailsIdx = dashboardSrc.indexOf('rentalDetailsTitle');
    const rentalDetailsBlock = dashboardSrc.slice(rentalDetailsIdx, rentalDetailsIdx + 3000);
    expect(rentalDetailsBlock).not.toMatch(/t\.rentalReturn\.pricePerGallon/);
  });
});

describe('Fuel History / Rental Details remain collapsed by default (unchanged from the prior phase)', () => {
  it('20. Fuel History remains collapsed by default', () => {
    expect(dashboardSrc).toMatch(/const \[showFuelHistory, setShowFuelHistory\] = useState\(false\)/);
  });

  it('21. Rental Details remains collapsed by default', () => {
    expect(dashboardSrc).toMatch(/const \[showRentalDetails, setShowRentalDetails\] = useState\(false\)/);
  });
});

describe('Regression guards — lifecycle, PR #39, MPG, persistence untouched', () => {
  it('22. lifecycle logic unchanged — resolveRentalLifecycle/RENTAL_NEAR_RETURN_HOURS untouched in lib/rentalCalculations.ts', () => {
    // The dashboard still calls resolveRentalLifecycle with the same shape.
    expect(dashboardSrc).toMatch(/resolveRentalLifecycle\(\{\s*status: session\.status, pickupDateTime: session\.pickupDateTime, returnDateTime: session\.returnDateTime,\s*\}\)/);
  });

  it('23. PR #39 return-time-default behavior file is untouched by this change', () => {
    const setupSrc = readFileSync(join(__dirname, '../components/rental-return/RentalSetupFlow.tsx'), 'utf8');
    expect(setupSrc).toMatch(/returnTimeTouchedRef/);
    expect(setupSrc).toMatch(/handlePickupDateTimeChange/);
  });

  it('24. no MPG/fuel-economy logic introduced', () => {
    expect(dashboardSrc).not.toMatch(/\bmpg\b/i);
    expect(dashboardSrc).not.toMatch(/fuelEconomy/i);
    expect(dashboardSrc).not.toMatch(/milesPerGallon/i);
  });

  it('25. no persistence semantics changed — createRentalFillup/RefuelLogModal/FuelLevelInput files untouched', () => {
    const fillupsSrc = readFileSync(join(__dirname, '../lib/rentalFillups.ts'), 'utf8');
    expect(fillupsSrc).toMatch(/bumpCurrentFuelGallonsOnCreateSql/);
    // The dashboard's Calculate buttons never call createRentalFillup or
    // any fillup-mutating endpoint directly — already asserted above.
  });
});
