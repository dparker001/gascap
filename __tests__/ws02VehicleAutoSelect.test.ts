/**
 * WS02 Phase 1B — auto-select a lone saved vehicle.
 *
 * Two old behaviours this regresses against, both reproduced below:
 *  - SavedVehicles.tsx: `data.vehicles.find((v) => v.isDefault)` — a user
 *    with exactly one car and no star got nothing.
 *  - TripCostEstimator.tsx: `vehicles[0]` — and getVehiclesForUser orders
 *    by createdAt ASC (lib/savedVehicles.ts), so an explicitly starred
 *    second car lost to the first one created.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  pickAutoSelectVehicle, isAutoSelectableVehicle, type AutoSelectableVehicle,
} from '@/lib/vehicleAutoSelect';

const read = (p: string) => readFileSync(path.resolve(__dirname, '..', p), 'utf8');

const legacyGarage = (vs: AutoSelectableVehicle[]) => vs.find((v) => v.isDefault) ?? null;
const legacyTrip   = (vs: AutoSelectableVehicle[]) => vs[0] ?? null;

const SOLE    = [{ id: 'a', gallons: 14 }];
// createdAt-ascending order, as the API returns them.
const STARRED_SECOND = [
  { id: 'first',  gallons: 12 },
  { id: 'second', gallons: 19, isDefault: true },
];

describe('WS02 1B — the gaps being closed', () => {
  it('old garage behaviour: a sole unstarred vehicle was never auto-applied', () => {
    expect(legacyGarage(SOLE)).toBeNull();
    expect(pickAutoSelectVehicle(SOLE)).toEqual({ vehicle: SOLE[0], reason: 'sole-vehicle' });
  });

  it('old Trip Planner behaviour: vehicles[0] beat the explicit default', () => {
    expect(legacyTrip(STARRED_SECOND)!.id).toBe('first');
    expect(pickAutoSelectVehicle(STARRED_SECOND)!.vehicle.id).toBe('second');
  });

  it('both surfaces now go through the one shared rule', () => {
    for (const f of ['components/SavedVehicles.tsx', 'components/TripCostEstimator.tsx']) {
      expect(read(f), f).toMatch(/pickAutoSelectVehicle\(/);
    }
    // And neither keeps its old ad-hoc version.
    expect(read('components/TripCostEstimator.tsx')).not.toMatch(/loadVehicle\(vehicles\[0\]\)/);
    expect(read('components/SavedVehicles.tsx')).not.toMatch(/const defaultVehicle = data\?\.vehicles\.find/);
  });
});

describe('pickAutoSelectVehicle — zero, one, many', () => {
  it('zero vehicles: nothing to select', () => {
    expect(pickAutoSelectVehicle([])).toBeNull();
    expect(pickAutoSelectVehicle(null as unknown as AutoSelectableVehicle[])).toBeNull();
    expect(pickAutoSelectVehicle(undefined as unknown as AutoSelectableVehicle[])).toBeNull();
  });

  it('exactly one: auto-selected, reported as the sole vehicle', () => {
    expect(pickAutoSelectVehicle(SOLE)).toEqual({ vehicle: SOLE[0], reason: 'sole-vehicle' });
  });

  it('two or more with no default: the choice stays the user s, not a guess', () => {
    expect(pickAutoSelectVehicle([{ id: 'a', gallons: 12 }, { id: 'b', gallons: 19 }])).toBeNull();
  });

  it('an explicit default wins among many', () => {
    const vs = [
      { id: 'a', gallons: 12 },
      { id: 'b', gallons: 19, isDefault: true },
      { id: 'c', gallons: 26 },
    ];
    expect(pickAutoSelectVehicle(vs)).toEqual({ vehicle: vs[1], reason: 'explicit-default' });
  });

  it('the answer does not depend on the order rows came back in', () => {
    const vs = [{ id: 'a', gallons: 12 }, { id: 'b', gallons: 19, isDefault: true }];
    expect(pickAutoSelectVehicle(vs)!.vehicle.id).toBe('b');
    expect(pickAutoSelectVehicle([...vs].reverse())!.vehicle.id).toBe('b');
  });

  it('isDefault must be literally true — a truthy accident does not count', () => {
    expect(pickAutoSelectVehicle([
      { id: 'a', gallons: 12, isDefault: 1 as unknown as boolean },
      { id: 'b', gallons: 19 },
    ])).toBeNull();
  });
});

describe('pickAutoSelectVehicle — ineligible vehicles', () => {
  it('a vehicle with no usable tank size cannot be auto-selected', () => {
    for (const gallons of [0, -4, NaN, Infinity, undefined as unknown as number, null as unknown as number]) {
      expect(isAutoSelectableVehicle({ id: 'x', gallons }), String(gallons)).toBe(false);
    }
    expect(isAutoSelectableVehicle({ id: 'x', gallons: 14 })).toBe(true);
  });

  it('an ineligible vehicle is skipped, making its eligible sibling the sole choice', () => {
    expect(pickAutoSelectVehicle([
      { id: 'broken', gallons: 0 },
      { id: 'good',   gallons: 14 },
    ])).toEqual({ vehicle: { id: 'good', gallons: 14 }, reason: 'sole-vehicle' });
  });

  it('an ineligible vehicle is skipped even when it carries the default star', () => {
    expect(pickAutoSelectVehicle([
      { id: 'broken', gallons: 0, isDefault: true },
      { id: 'good',   gallons: 14 },
    ])).toEqual({ vehicle: { id: 'good', gallons: 14 }, reason: 'sole-vehicle' });
  });

  it('all ineligible: nothing is selected', () => {
    expect(pickAutoSelectVehicle([{ id: 'a', gallons: 0 }, { id: 'b', gallons: -1 }])).toBeNull();
  });
});

describe('callers still guard on nothing being selected', () => {
  it('SavedVehicles bails out while a vehicle is selected', () => {
    expect(read('components/SavedVehicles.tsx'))
      .toMatch(/if \(selectedVehicleId\) \{ autoAppliedRef\.current = false; return; \}/);
  });

  it('Trip Planner bails out while a vehicle is selected or in rental mode', () => {
    expect(read('components/TripCostEstimator.tsx'))
      .toMatch(/if \(selectedVehicleId \|\| vehicleMode !== 'garage'\) return;/);
  });
});
