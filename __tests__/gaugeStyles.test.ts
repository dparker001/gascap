/**
 * lib/gaugeStyles.ts — Phase 4 canonical fuel-gauge VISUAL style definitions
 * (2026-08-25). Covers fallback safety (null/invalid/unknown → default),
 * the rental resolution precedence, and the pointer→percent geometry
 * mapping every renderer shares.
 */
import { describe, it, expect } from 'vitest';
import {
  GAUGE_STYLES, DEFAULT_GAUGE_STYLE, isGaugeStyle, resolveGaugeStyle,
  resolveRentalGaugeStyle, GAUGE_POINTER_MAP,
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
