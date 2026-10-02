/**
 * Part A (2026-10-02) — A2/A3/A5 decisions: setup order, unknown-not-zero,
 * no gauge/percent without a tank, pickup-vs-current after a refuel.
 * Pure helpers + source guards on the dashboard/gauge wiring.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  rentalSetupSteps, setupIncomplete, fuelInputMethodsFor, pickupSaveAlsoSetsCurrent, returnTargetKnown, type SetupStateInput,
} from '@/lib/rentalSetupState';

const quickSaved: SetupStateInput = {
  status: 'active', vehicleMake: null, vehicleModel: null, fuelTankCapacityGallons: null,
  pickupFuelGallons: null, currentFuelGallons: null, requiredReturnFuelGallons: null,
};
const complete: SetupStateInput = {
  status: 'active', vehicleMake: 'Toyota', vehicleModel: 'Camry', fuelTankCapacityGallons: 14,
  pickupFuelGallons: 7, pickupFuelSource: 'MANUAL_GAUGE', currentFuelGallons: 7, currentFuelSource: 'MANUAL_GAUGE', requiredReturnFuelGallons: 7,
};
const src = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');

describe('setup steps — vehicle → tank → pickup fuel', () => {
  it('a quick-saved rental: nothing done, pickup fuel locked until a tank exists', () => {
    expect(rentalSetupSteps(quickSaved)).toEqual([
      { key: 'vehicle', done: false, locked: false },
      { key: 'tank', done: false, locked: false },
      { key: 'pickupFuel', done: false, locked: true },
    ]);
    expect(setupIncomplete(quickSaved)).toBe(true);
  });
  it('once a tank exists, pickup fuel unlocks', () => {
    expect(rentalSetupSteps({ ...quickSaved, vehicleMake: 'Kia', vehicleModel: 'K5', fuelTankCapacityGallons: 15 })[2])
      .toEqual({ key: 'pickupFuel', done: false, locked: false });
  });
  it('a fully set up rental, and any completed one, shows no Finish setup card', () => {
    expect(setupIncomplete(complete)).toBe(false);
    expect(setupIncomplete({ ...quickSaved, status: 'completed' })).toBe(false);
  });
});

describe('no gauge/percent without a tank', () => {
  it.each([null, undefined, 0, -1])('tank %s → exact gallons only', (cap) => {
    expect(fuelInputMethodsFor(cap as number | null)).toEqual(['gallons']);
  });
  it('a real tank offers all three', () => {
    expect(fuelInputMethodsFor(14)).toEqual(['gauge', 'percent', 'gallons']);
  });
});

describe('pickup save vs current reading', () => {
  it('seeds current when nothing has happened since pickup', () => {
    expect(pickupSaveAlsoSetsCurrent(quickSaved, 0)).toBe(true);
    expect(pickupSaveAlsoSetsCurrent(complete, 0)).toBe(true); // current is still exactly the old pickup reading
  });
  it('never after a refuel was logged, and never over an independent current reading', () => {
    expect(pickupSaveAlsoSetsCurrent(quickSaved, 1)).toBe(false);
    expect(pickupSaveAlsoSetsCurrent({ ...complete, currentFuelGallons: 11, currentFuelSource: 'MANUAL_GAUGE' }, 0)).toBe(false);
  });
});

describe('unknown is never zero', () => {
  it('an unknown return target is reported as unknown', () => {
    expect(returnTargetKnown({ requiredReturnFuelGallons: null })).toBe(false);
    expect(returnTargetKnown({ requiredReturnFuelGallons: 0 })).toBe(true);
  });
  it('Prepare for Return never computes "needed" against a 0 stand-in target', () => {
    expect(src('components/rental-return/RentalDashboard.tsx')).not.toMatch(/gallonsNeeded\(session\.requiredReturnFuelGallons \?\? 0/);
  });
  it('the tank bar is only drawn for a real current reading', () => {
    const d = src('components/rental-return/RentalDashboard.tsx');
    expect(d).not.toMatch(/\(session\.currentFuelGallons \?\? 0\) \/ tankCapacity/);
    expect(d).toMatch(/tankCapacity > 0 && showLiveFuel && session\.currentFuelGallons != null/);
  });
  it('an untouched gauge shows "not set", never an E reading with ≈ 0.0 gal', () => {
    const f = src('components/rental-return/FuelLevelInput.tsx');
    expect(f).toMatch(/unset=\{gaugePercent == null\}/);
    const g = src('components/FuelGauge.tsx');
    expect(g).toMatch(/unset\?: boolean/);
    expect(g).toMatch(/const gallons = !unset && tankCapacity/);
  });
  it('the dashboard uses the setup helpers (Finish setup card, pickup lock, pickup-vs-current rule)', () => {
    const d = src('components/rental-return/RentalDashboard.tsx');
    expect(d).toContain('<FinishSetupCard');
    expect(d).toContain('pickupSaveAlsoSetsCurrent(session');
    expect(d).toContain('returnTargetKnown(session)');
  });
});
