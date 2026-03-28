// ─────────────────────────────────────────────
//  Gas Cap™ — Calculation Engine
//  Pure functions; no side effects; easy to test.
// ─────────────────────────────────────────────

/** Round to n decimal places */
export function round(value: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

// ── Target Fill ──────────────────────────────

export interface TargetFillInput {
  tankCapacity: number;     // gallons
  currentFuelPercent?: number;  // 0–100
  currentFuelGallons?: number;  // gallons (takes precedence if both provided)
  targetPercent: number;    // 0–100
  pricePerGallon: number;   // USD
}

export interface TargetFillResult {
  currentGallons: number;
  currentPercent: number;
  targetGallons: number;
  targetPercent: number;
  gallonsNeeded: number;
  estimatedCost: number;
  summary: string;
}

export function calcTargetFill(input: TargetFillInput): TargetFillResult {
  const { tankCapacity, targetPercent, pricePerGallon } = input;

  // Resolve current fuel
  const currentGallons =
    input.currentFuelGallons !== undefined
      ? Math.min(input.currentFuelGallons, tankCapacity)
      : tankCapacity * ((input.currentFuelPercent ?? 0) / 100);

  const currentPercent = round((currentGallons / tankCapacity) * 100, 1);

  const targetGallons = round(tankCapacity * (targetPercent / 100), 2);
  const gallonsNeeded = round(Math.max(0, targetGallons - currentGallons), 2);
  const estimatedCost = round(gallonsNeeded * pricePerGallon, 2);

  const targetLabel = targetPercent === 100 ? 'a full tank' : `${targetPercent}%`;
  const summary =
    gallonsNeeded === 0
      ? `You're already at or above ${targetLabel}. No fuel needed!`
      : `Add ${gallonsNeeded} gal to reach ${targetLabel} — about $${estimatedCost.toFixed(2)} at $${pricePerGallon.toFixed(2)}/gal.`;

  return {
    currentGallons: round(currentGallons, 2),
    currentPercent,
    targetGallons,
    targetPercent,
    gallonsNeeded,
    estimatedCost,
    summary,
  };
}

// ── Budget Calculator ─────────────────────────

export interface BudgetInput {
  tankCapacity: number;
  currentFuelPercent?: number;
  currentFuelGallons?: number;
  pricePerGallon: number;
  budget: number;           // USD
}

export interface BudgetResult {
  currentGallons: number;
  currentPercent: number;
  gallonsAffordable: number;
  gallonsAffordableUncapped: number;  // before tank-full cap
  resultingGallons: number;
  resultingPercent: number;
  actualCost: number;
  wouldOverfill: boolean;
  summary: string;
}

export function calcBudget(input: BudgetInput): BudgetResult {
  const { tankCapacity, pricePerGallon, budget } = input;

  // Resolve current fuel
  const currentGallons =
    input.currentFuelGallons !== undefined
      ? Math.min(input.currentFuelGallons, tankCapacity)
      : tankCapacity * ((input.currentFuelPercent ?? 0) / 100);

  const currentPercent = round((currentGallons / tankCapacity) * 100, 1);

  const gallonsAffordableUncapped = round(budget / pricePerGallon, 2);
  const resultingGallonsRaw = currentGallons + gallonsAffordableUncapped;
  const wouldOverfill = resultingGallonsRaw > tankCapacity;

  const resultingGallons = round(Math.min(tankCapacity, resultingGallonsRaw), 2);
  const gallonsAffordable = round(resultingGallons - currentGallons, 2);
  const actualCost = round(gallonsAffordable * pricePerGallon, 2);
  const resultingPercent = round((resultingGallons / tankCapacity) * 100, 1);

  let summary: string;
  if (wouldOverfill) {
    summary = `$${budget.toFixed(2)} would more than fill your tank. You only need ${gallonsAffordable} gal ($${actualCost.toFixed(2)}) to top off.`;
  } else if (gallonsAffordable <= 0) {
    summary = `That budget doesn't cover even a partial gallon at $${pricePerGallon.toFixed(2)}/gal.`;
  } else {
    summary = `$${budget.toFixed(2)} buys about ${gallonsAffordable} gal, bringing your tank to ${resultingPercent}% (${resultingGallons} gal).`;
  }

  return {
    currentGallons: round(currentGallons, 2),
    currentPercent,
    gallonsAffordable,
    gallonsAffordableUncapped,
    resultingGallons,
    resultingPercent,
    actualCost,
    wouldOverfill,
    summary,
  };
}

// ── Validation helpers ────────────────────────

export interface ValidationErrors {
  [field: string]: string;
}

export function validateTargetFill(
  values: Partial<TargetFillInput> & { fuelInputMode: 'percent' | 'gallons' }
): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!values.tankCapacity || values.tankCapacity <= 0)
    errors.tankCapacity = 'Enter a valid tank size (gallons).';
  else if (values.tankCapacity > 200)
    errors.tankCapacity = 'Tank size seems too large. Check your entry.';

  if (values.fuelInputMode === 'percent') {
    const p = values.currentFuelPercent;
    if (p === undefined || p < 0 || p > 100)
      errors.currentFuel = 'Enter a percentage between 0 and 100.';
  } else {
    const g = values.currentFuelGallons;
    if (g === undefined || g < 0)
      errors.currentFuel = 'Enter a valid gallons amount (0 or more).';
    else if (values.tankCapacity && g > values.tankCapacity)
      errors.currentFuel = "Current fuel can't exceed tank capacity.";
  }

  if (!values.pricePerGallon || values.pricePerGallon <= 0)
    errors.pricePerGallon = 'Enter a valid gas price per gallon.';
  else if (values.pricePerGallon > 20)
    errors.pricePerGallon = 'Price per gallon seems high. Double-check.';

  if (!values.targetPercent && values.targetPercent !== 0)
    errors.targetPercent = 'Select or enter a target fill level.';

  return errors;
}

export function validateBudget(
  values: Partial<BudgetInput> & { fuelInputMode: 'percent' | 'gallons' }
): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!values.tankCapacity || values.tankCapacity <= 0)
    errors.tankCapacity = 'Enter a valid tank size (gallons).';
  else if (values.tankCapacity > 200)
    errors.tankCapacity = 'Tank size seems too large. Check your entry.';

  if (values.fuelInputMode === 'percent') {
    const p = values.currentFuelPercent;
    if (p === undefined || p < 0 || p > 100)
      errors.currentFuel = 'Enter a percentage between 0 and 100.';
  } else {
    const g = values.currentFuelGallons;
    if (g === undefined || g < 0)
      errors.currentFuel = 'Enter a valid gallons amount (0 or more).';
    else if (values.tankCapacity && g > values.tankCapacity)
      errors.currentFuel = "Current fuel can't exceed tank capacity.";
  }

  if (!values.pricePerGallon || values.pricePerGallon <= 0)
    errors.pricePerGallon = 'Enter a valid gas price per gallon.';
  else if (values.pricePerGallon > 20)
    errors.pricePerGallon = 'Price per gallon seems high. Double-check.';

  if (!values.budget || values.budget <= 0)
    errors.budget = 'Enter a budget amount greater than $0.';

  return errors;
}

// ── Common vehicle tank presets ───────────────

export interface VehiclePreset {
  label: string;
  gallons: number;
}

export const VEHICLE_PRESETS: VehiclePreset[] = [
  { label: 'Compact (e.g. Honda Civic)', gallons: 12.4 },
  { label: 'Mid-size Sedan (e.g. Camry)', gallons: 15.9 },
  { label: 'Full-size Sedan (e.g. Charger)', gallons: 18.5 },
  { label: 'Small SUV (e.g. RAV4)', gallons: 14.5 },
  { label: 'Mid-size SUV (e.g. Highlander)', gallons: 17.9 },
  { label: 'Full-size SUV (e.g. Suburban)', gallons: 31.0 },
  { label: 'Pickup Truck (e.g. F-150)', gallons: 26.0 },
  { label: 'Minivan (e.g. Sienna)', gallons: 18.0 },
];
