/**
 * GasCap™ — shared SVG arc geometry.
 *
 * Phase 4 extraction (2026-08-25): FuelGauge.tsx's own local `pt()`/`arcPath()`
 * helpers generalized here so any circular-arc renderer (currently only the
 * analog-needle gauge style) draws from one implementation instead of a
 * hand-copied one. Deliberately minimal — this is NOT a general charting
 * library, just the two functions FuelGauge actually needs. Other arc-drawing
 * code in this app (FuelBudgetWidget's budget-usage ring, OnboardingModal's
 * static illustration) is a different domain/geometry and is intentionally
 * left alone — extracting those too was explicitly out of scope for Phase 4.
 */

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Cartesian point on a circle of radius `r` centered at (cx, cy), at `deg` degrees. */
export function polarToCartesian(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  return {
    x: cx + r * Math.cos(toRad(deg)),
    y: cy + r * Math.sin(toRad(deg)),
  };
}

/** SVG arc path string — clockwise from `startDeg` to `endDeg` on a circle of radius `r`. */
export function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const s = polarToCartesian(cx, cy, r, startDeg);
  const e = polarToCartesian(cx, cy, r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M${s.x.toFixed(2)} ${s.y.toFixed(2)} A${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}
