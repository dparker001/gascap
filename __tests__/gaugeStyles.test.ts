/**
 * lib/gaugeStyles.ts — Phase 4 canonical fuel-gauge VISUAL style definitions
 * (2026-08-25). Covers fallback safety (null/invalid/unknown → default),
 * the rental resolution precedence, and the pointer→percent geometry
 * mapping every renderer shares.
 */
import { describe, it, expect } from 'vitest';
import {
  GAUGE_STYLES, DEFAULT_GAUGE_STYLE, isGaugeStyle, resolveGaugeStyle,
  resolveRentalGaugeStyle, resolveVehicleGaugeStyle, GAUGE_POINTER_MAP,
} from '@/lib/gaugeStyles';

describe('isGaugeStyle / resolveGaugeStyle', () => {
  it('accepts every canonical style', () => {
    for (const s of GAUGE_STYLES) expect(isGaugeStyle(s)).toBe(true);
  });

  it('null resolves to the default style', () => {
    expect(resolveGaugeStyle(null)).toBe(DEFAULT_GAUGE_STYLE);
  });

  it('undefined resolves to the default style', () => {
    expect(resolveGaugeStyle(undefined)).toBe(DEFAULT_GAUGE_STYLE);
  });

  it('an invalid/unknown string resolves to the default style', () => {
    expect(resolveGaugeStyle('some_future_style_not_yet_added')).toBe(DEFAULT_GAUGE_STYLE);
    expect(isGaugeStyle('some_future_style_not_yet_added')).toBe(false);
  });

  it('a non-string value resolves to the default style', () => {
    expect(resolveGaugeStyle(42)).toBe(DEFAULT_GAUGE_STYLE);
    expect(resolveGaugeStyle({})).toBe(DEFAULT_GAUGE_STYLE);
  });

  it('a valid stored style resolves to itself', () => {
    expect(resolveGaugeStyle('horizontal_segments')).toBe('horizontal_segments');
    expect(resolveGaugeStyle('vertical_segments')).toBe('vertical_segments');
    expect(resolveGaugeStyle('quarter_marks')).toBe('quarter_marks');
  });
});

describe('resolveRentalGaugeStyle — precedence', () => {
  it('rental override wins over the linked Vehicle style', () => {
    expect(resolveRentalGaugeStyle('quarter_marks', 'horizontal_segments')).toBe('quarter_marks');
  });

  it('falls back to the linked Vehicle style when the rental has no override', () => {
    expect(resolveRentalGaugeStyle(null, 'vertical_segments')).toBe('vertical_segments');
    expect(resolveRentalGaugeStyle(undefined, 'vertical_segments')).toBe('vertical_segments');
  });

  it('falls back to the default when neither is set', () => {
    expect(resolveRentalGaugeStyle(null, null)).toBe(DEFAULT_GAUGE_STYLE);
    expect(resolveRentalGaugeStyle(undefined, undefined)).toBe(DEFAULT_GAUGE_STYLE);
  });

  it('an invalid rental override falls through to the linked Vehicle style', () => {
    expect(resolveRentalGaugeStyle('not_a_real_style', 'quarter_marks')).toBe('quarter_marks');
  });
});

describe('GAUGE_POINTER_MAP — every style resolves the same physical endpoints', () => {
  it('horizontal_segments: left edge is 0%, right edge is 100%', () => {
    expect(GAUGE_POINTER_MAP.horizontal_segments(0, 0.5)).toBe(0);
    expect(GAUGE_POINTER_MAP.horizontal_segments(1, 0.5)).toBe(100);
    expect(GAUGE_POINTER_MAP.horizontal_segments(0.5, 0.5)).toBe(50);
  });

  it('vertical_segments: bottom is 0%, top is 100%', () => {
    expect(GAUGE_POINTER_MAP.vertical_segments(0.5, 1)).toBe(0);
    expect(GAUGE_POINTER_MAP.vertical_segments(0.5, 0)).toBe(100);
  });

  it('quarter_marks: same linear mapping as horizontal_segments', () => {
    expect(GAUGE_POINTER_MAP.quarter_marks(0.25, 0.5)).toBe(25);
  });

  it('analog_needle: half-tank position (12 o\'clock) resolves near 50%', () => {
    // Half-tank sits at the top-center of the arc (270°) — relX=0.5,
    // relY at the very top of the viewBox (0 -20 280 165) → relY≈0.
    const pct = GAUGE_POINTER_MAP.analog_needle(0.5, 0);
    expect(pct).toBeGreaterThan(45);
    expect(pct).toBeLessThan(55);
  });
});

// Post-release fix (2026-08-26) — the exact bug: BudgetForm/TargetFillForm
// cached the resolved style in a useState set only inside SavedVehicles'
// onSelect callback, so it never reflected (a) an already-selected vehicle
// restored from persisted state on page load, or (b) an edit to that same
// vehicle's style made without re-clicking it. resolveVehicleGaugeStyle()
// replaces that cache with a live derivation from the current vehicle list
// — these tests lock in the exact regression scenarios.
describe('resolveVehicleGaugeStyle — the post-release calculator-sync fix', () => {
  const vehicles = [
    { id: 'veh-1', fuelGaugeStyle: 'quarter_marks' },
    { id: 'veh-2', fuelGaugeStyle: null },
    { id: 'veh-3', fuelGaugeStyle: 'not_a_real_style' },
  ];

  it('resolves the style of an already-selected vehicle restored from persisted state (no click/onSelect involved)', () => {
    // This is exactly the "page reload with a persisted vehicleId" scenario
    // that never worked before: no onSelect ever fires, so any cached-value
    // approach would still show the default here.
    expect(resolveVehicleGaugeStyle(vehicles, 'veh-1')).toBe('quarter_marks');
  });

  it('reflects an edited vehicle style immediately once the vehicle list is refreshed — no re-selection required', () => {
    const before = resolveVehicleGaugeStyle(vehicles, 'veh-1');
    expect(before).toBe('quarter_marks');
    // Simulate the 'vehicle-saved' refresh bringing back updated data for
    // the SAME already-selected vehicle — a fresh array, same id.
    const refreshed = [{ id: 'veh-1', fuelGaugeStyle: 'horizontal_segments' }, ...vehicles.slice(1)];
    const after = resolveVehicleGaugeStyle(refreshed, 'veh-1');
    expect(after).toBe('horizontal_segments');
  });

  it('falls back to default for a null stored style', () => {
    expect(resolveVehicleGaugeStyle(vehicles, 'veh-2')).toBe(DEFAULT_GAUGE_STYLE);
  });

  it('falls back to default for an invalid stored style', () => {
    expect(resolveVehicleGaugeStyle(vehicles, 'veh-3')).toBe(DEFAULT_GAUGE_STYLE);
  });

  it('falls back to default when no vehicle is selected (empty/null id)', () => {
    expect(resolveVehicleGaugeStyle(vehicles, '')).toBe(DEFAULT_GAUGE_STYLE);
    expect(resolveVehicleGaugeStyle(vehicles, null)).toBe(DEFAULT_GAUGE_STYLE);
    expect(resolveVehicleGaugeStyle(vehicles, undefined)).toBe(DEFAULT_GAUGE_STYLE);
  });

  it('falls back to default when the selected id is not found in the current list', () => {
    expect(resolveVehicleGaugeStyle(vehicles, 'does-not-exist')).toBe(DEFAULT_GAUGE_STYLE);
  });

  it('falls back to default for an empty vehicle list (e.g. fetch not yet resolved)', () => {
    expect(resolveVehicleGaugeStyle([], 'veh-1')).toBe(DEFAULT_GAUGE_STYLE);
  });
});
