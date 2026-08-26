/**
 * GasCap™ — canonical fuel-gauge VISUAL style definitions (Phase 4, 2026-08-25).
 *
 * Core invariant: gauge style is presentation only. Nothing in this file (or
 * anything that imports it) may compute, store, or mutate a fuel percentage
 * or gallons value — that stays entirely in FuelGauge's interaction shell
 * and the calculators/rental session that own the actual fuel data.
 *
 * This is the single source of truth for which styles exist, the default,
 * and safe fallback for a null/invalid/removed value — every API route,
 * component, and stored-value resolver must import from here rather than
 * re-validating the string list independently.
 */

export const GAUGE_STYLES = [
  'analog_needle',
  'horizontal_segments',
  'vertical_segments',
  'quarter_marks',
] as const;

export type GaugeStyle = typeof GAUGE_STYLES[number];

/** Preserves the app's original, only-ever gauge appearance — existing
 *  vehicles/rentals with no stored preference (null) must render exactly as
 *  they did before Phase 4 shipped. */
export const DEFAULT_GAUGE_STYLE: GaugeStyle = 'analog_needle';

export function isGaugeStyle(value: unknown): value is GaugeStyle {
  return typeof value === 'string' && (GAUGE_STYLES as readonly string[]).includes(value);
}

/**
 * Safely resolve any stored/incoming value to a valid GaugeStyle. Null,
 * undefined, an unrecognized string (e.g. a style removed in a future
 * release), or any other type all fall back to DEFAULT_GAUGE_STYLE — never
 * throws, never renders nothing.
 */
export function resolveGaugeStyle(value: unknown): GaugeStyle {
  return isGaugeStyle(value) ? value : DEFAULT_GAUGE_STYLE;
}

/**
 * Resolve the effective gauge style for a rental session per the required
 * precedence: an explicit session-level override wins; otherwise fall back
 * to the linked saved Vehicle's preference (if any); otherwise the app
 * default. Pure function — callers pass in the two raw stored values.
 */
export function resolveRentalGaugeStyle(
  rentalSessionStyle: unknown,
  linkedVehicleStyle: unknown,
): GaugeStyle {
  if (isGaugeStyle(rentalSessionStyle)) return rentalSessionStyle;
  if (isGaugeStyle(linkedVehicleStyle)) return linkedVehicleStyle;
  return DEFAULT_GAUGE_STYLE;
}

/**
 * Snap a raw 0–100 percent to the nearest ⅛-tank step (0, 12.5, 25 … 100).
 * The SAME snap grid is used by the interaction shell for every gauge style
 * — no style may substitute a different resolution model. Exported here
 * (rather than kept private inside FuelGauge.tsx) so this invariant is
 * independently testable and so any future gauge-adjacent surface reuses
 * the identical grid instead of re-deriving it.
 */
export function snapToEighth(pct: number): number {
  return Math.max(0, Math.min(100, Math.round(pct / 12.5) * 12.5));
}

/** ± nudge step: 1/64 of the full tank — identical for every style. */
export const GAUGE_NUDGE_STEP = 100 / 64; // ≈ 1.5625 %

export const GAUGE_STYLE_LABELS: Record<GaugeStyle, string> = {
  analog_needle:        'Analog Needle',
  horizontal_segments:  'Horizontal Bars',
  vertical_segments:    'Vertical Bars',
  quarter_marks:        'Quarter Marks',
};

/**
 * Interaction-layer geometry ONLY — how a raw pointer position (as a
 * fraction 0–1 of the gauge's bounding box, in both axes) maps to a raw 0–100
 * percent for that style's physical shape. This is intentionally NOT part of
 * a renderer component: the shell (FuelGauge.tsx) owns all pointer/drag
 * handling and calls this to get the shape-appropriate raw value, then
 * applies the SAME snap/clamp logic for every style. No style-specific
 * snapping exists — only the shape of "where is the pointer relative to
 * empty/full" differs between a circular dial and a linear bar.
 */
export const GAUGE_POINTER_MAP: Record<GaugeStyle, (relX: number, relY: number) => number> = {
  // Circular dial: same 195°→345° sweep FuelGauge has always used. relX/relY
  // are fractions of the SVG viewBox (0 -20 280 165); convert back to
  // viewBox-space coordinates before computing the angle.
  analog_needle: (relX, relY) => {
    const CX = 140, CY = 135;
    const svgX = relX * 280;
    const svgY = -20 + relY * 165;
    let deg = (Math.atan2(svgY - CY, svgX - CX) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    const START_ANGLE = 195, END_ANGLE = 345, SWEEP = END_ANGLE - START_ANGLE;
    if (deg >= START_ANGLE && deg <= END_ANGLE) return ((deg - START_ANGLE) / SWEEP) * 100;
    if (deg < 90 || deg > END_ANGLE) return 100;
    return 0;
  },
  // Horizontal bar: left = empty, right = full.
  horizontal_segments: (relX) => relX * 100,
  // Vertical bar: bottom = empty, top = full.
  vertical_segments: (_relX, relY) => (1 - relY) * 100,
  // Quarter-mark linear scale: left = empty, right = full (same as horizontal).
  quarter_marks: (relX) => relX * 100,
};
