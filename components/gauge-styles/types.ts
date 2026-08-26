/**
 * Common props every gauge-style renderer receives from the FuelGauge shell.
 * Renderers are PURE presentation — display data in, SVG out. None of them
 * may call onChange, mutate percent, or perform any calculation; the shell
 * (components/FuelGauge.tsx) owns 100% of interaction, snapping, and value
 * state. See lib/gaugeStyles.ts for the pointer→percent geometry mapping
 * that lets the shell handle drag/tap for every style identically.
 */
export interface GaugeRendererProps {
  /** Clamped 0–100. */
  percent: number;
  /** Precomputed by the shell (red/amber/green threshold) — renderers never
   *  invent their own color logic, so all styles agree on what "low fuel"
   *  looks like. */
  color: string;
  /** True while the user is actively dragging — renderers may use this to
   *  suppress transition animation, same as the original analog gauge did. */
  dragging: boolean;
  /** Precomputed fraction label (E / ⅛ / ¼ … F) or "NN%" fallback. */
  label: string;
}
