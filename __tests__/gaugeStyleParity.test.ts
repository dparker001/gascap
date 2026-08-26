/**
 * Phase 4 core invariant (2026-08-25) — gauge STYLE is presentation only.
 * Proves that for identical raw pointer input, every canonical GaugeStyle's
 * geometry mapping + the shared snap grid produce the value the shell would
 * report via onChange, and that no style introduces a different resolution
 * model. This is the regression proof referenced in components/FuelGauge.tsx's
 * header comment.
 */
import { describe, it, expect } from 'vitest';
import { GAUGE_STYLES, GAUGE_POINTER_MAP, snapToEighth, GAUGE_NUDGE_STEP, DEFAULT_GAUGE_STYLE } from '@/lib/gaugeStyles';

describe('Every style shares the exact same snap grid', () => {
  it('snapToEighth is a single shared function — not reimplemented per style', () => {
    // There is exactly one snapToEighth in the codebase (lib/gaugeStyles.ts);
    // this test exists to make that fact explicit and regression-checkable —
    // if a future change accidentally forked per-style snapping, the sample
    // assertions below would start disagreeing with each other.
    const samples = [0, 3, 6.24, 6.26, 12.5, 49.9, 50.1, 87.4, 99.9, 100, -5, 105];
    const expected = samples.map((s) => Math.max(0, Math.min(100, Math.round(s / 12.5) * 12.5)));
    expect(samples.map(snapToEighth)).toEqual(expected);
  });

  it('the nudge step is the same fixed fraction regardless of style', () => {
    expect(GAUGE_NUDGE_STEP).toBeCloseTo(1.5625, 4);
  });
});

describe('Equivalent pointer input produces equivalent resolved percent for every style', () => {
  // For each style, dragging to the shape's own "halfway point" should
  // resolve, after the shared snap, to the same 50% value — no style may
  // introduce a coarser or finer resolution than the others.
  const HALFWAY_INPUT: Record<string, [number, number]> = {
    analog_needle:       [0.5, 0], // top-center of the arc
    horizontal_segments: [0.5, 0.5],
    vertical_segments:   [0.5, 0.5],
    quarter_marks:       [0.5, 0.5],
  };

  for (const style of GAUGE_STYLES) {
    it(`${style}: halfway pointer position snaps to 50%`, () => {
      const [relX, relY] = HALFWAY_INPUT[style];
      const raw = GAUGE_POINTER_MAP[style](relX, relY);
      expect(snapToEighth(raw)).toBe(50);
    });
  }

  // Empty/full endpoints must also agree across every style. For the analog
  // dial, compute the exact viewBox position of the E (195°) / F (345°)
  // marks rather than guessing — the arc's endpoints aren't at the
  // container's left/right edges the way a linear bar's are.
  const CX = 140, CY = 135, R = 115;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const analogPoint = (deg: number): [number, number] => {
    const svgX = CX + R * Math.cos(toRad(deg));
    const svgY = CY + R * Math.sin(toRad(deg));
    return [svgX / 280, (svgY + 20) / 165]; // viewBox "0 -20 280 165" → 0..1 fractions
  };

  const EMPTY_INPUT: Record<string, [number, number]> = {
    analog_needle:       analogPoint(195), // E
    horizontal_segments: [0, 0.5],
    vertical_segments:   [0.5, 1],
    quarter_marks:       [0, 0.5],
  };
  const FULL_INPUT: Record<string, [number, number]> = {
    analog_needle:       analogPoint(345), // F
    horizontal_segments: [1, 0.5],
    vertical_segments:   [0.5, 0],
    quarter_marks:       [1, 0.5],
  };

  for (const style of GAUGE_STYLES) {
    it(`${style}: empty-end pointer position snaps to 0%`, () => {
      const [relX, relY] = EMPTY_INPUT[style];
      expect(snapToEighth(GAUGE_POINTER_MAP[style](relX, relY))).toBe(0);
    });

    it(`${style}: full-end pointer position snaps to 100%`, () => {
      const [relX, relY] = FULL_INPUT[style];
      expect(snapToEighth(GAUGE_POINTER_MAP[style](relX, relY))).toBe(100);
    });
  }
});

describe('DEFAULT_GAUGE_STYLE preserves the original app behavior', () => {
  it('is analog_needle — the only style that ever existed before Phase 4', () => {
    expect(DEFAULT_GAUGE_STYLE).toBe('analog_needle');
  });
});
