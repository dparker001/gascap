'use client';

import { describeArc } from '@/lib/svgArc';
import type { GaugeRendererProps } from './types';

/**
 * Phase 4B — a vertically-oriented automotive gauge: the needle pivots from
 * a fixed point on the right edge and sweeps through a 90° arc that bulges
 * to the left, from pointing down-left (E, empty) through pointing
 * straight-left (½) up to pointing up-left (F, full) — the same "arc +
 * pivoted needle" language as AnalogNeedle, just rotated so the scale reads
 * vertically (E low, F high) instead of horizontally.
 *
 * 2026-08-28 — this style's viewBox is slightly taller than the other gauge
 * styles' shared "0 -20 280 165" (see VIEWBOX_* below): E needs more room
 * below the ¼ label to read as a true endpoint designator rather than an
 * extra scale mark (reported after PR #35/#36), and both E/F got a little
 * extra breathing room top and bottom in a later pass. F, after live
 * on-device testing of several positions, landed back close to its
 * original height and is no longer symmetric with E — see the
 * E_LABEL/F_LABEL comments below for why. CX/CY/R/the arc/needle geometry
 * are unchanged; only the SVG canvas grew so E/F have room without
 * clipping. Because `<svg className="w-full">` has no explicit height,
 * this DOES make this style render very slightly taller than its siblings
 * at the same width (184/280 vs 165/280 aspect ratio) — an intentional,
 * visible tradeoff of this fix, not an oversight.
 */
const CX = 232;
const CY = 62;
const R = 92;
const TRACK_W = 16;
// 135°(down-left, E) -> 225°(up-left, F), a 90° sweep bulging toward the
// left — E, ¼, ½, ¾, F all read top-to-bottom-free of overlap inside the
// viewBox below.
const START_ANGLE = 135;
const END_ANGLE = 225;
// Expanded from the shared "0 -20 280 165" — see the header comment.
// 2026-08-28: nudged 4px further at both top and bottom for slightly more
// breathing room around E/F (was -20/156) — smallest reasonable increase,
// not a re-derivation of the geometry strategy.
const VIEWBOX_X_MIN = 0;
const VIEWBOX_X_MAX = 280;
const VIEWBOX_Y_MIN = -24;
const VIEWBOX_Y_MAX = 160;

const toRad = (d: number) => (d * Math.PI) / 180;
const pctToAngle = (pct: number) => START_ANGLE + (END_ANGLE - START_ANGLE) * Math.max(0, Math.min(100, pct)) / 100;

const MAJOR_TICKS = [0.25, 0.5, 0.75];
const MINOR_TICKS = [0.125, 0.375, 0.625, 0.875];
// Fixed regardless of fuel percent — see the render-time comment below for why.
const MAJOR_TICK_COLOR = '#94a3b8';
const MINOR_TICK_COLOR = '#cbd5e1';

// Endpoint label typography — shared by BOTH E and F so they read as the
// same visual weight/size. 2026-08-28: live on-device testing showed F
// looking larger than E even though both already used the same literal
// fontSize/fontWeight — named constants make that invariant explicit and
// impossible to accidentally diverge going forward.
const ENDPOINT_LABEL_FONT_SIZE = 14;
const ENDPOINT_LABEL_FONT_WEIGHT = 800;

// 2026-08-27/28 — E/F pushed further out along the track's true endpoint
// angles (START_ANGLE/END_ANGLE — NOT the ⅛/⅞ tick angles) than the ¼/½/¾
// labels sit, so they read as endpoint designators rather than extra scale
// marks. ENDPOINT_MARGIN is deliberately larger than the ¼/½/¾ labels' own
// margin (MID_LABEL_R below) — previously E/F sat at a SMALLER radius than
// the ¼/½/¾ labels despite being at more extreme angles, which visually
// clustered them with the scale instead of setting them apart.
//
// E stays on this formula (angle 135, this radius) — live-approved as-is.
// F does NOT: the same formula at angle 225 puts F at (145.73, -24.27),
// which read as too high on-device and was pulled back down to (145.73,
// -12) after live testing. Because cos/sin have equal magnitude at both
// 135° and 225°, no single radius on this formula can hit F's approved
// (x, y) independently of E's — so F is a live-approved explicit override,
// not formula-derived. It still sits beyond the track's outer edge (same
// invariant the formula enforces for E) and on the same left side.
const ENDPOINT_MARGIN = 22;
const ENDPOINT_LABEL_R = R + TRACK_W / 2 + ENDPOINT_MARGIN;
function labelPoint(angleDeg: number) {
  const rad = toRad(angleDeg);
  return {
    x: Math.round((CX + ENDPOINT_LABEL_R * Math.cos(rad)) * 100) / 100,
    y: Math.round((CY + ENDPOINT_LABEL_R * Math.sin(rad)) * 100) / 100,
  };
}
// 2026-08-28: both nudged 8px right (x only, vertical positions unchanged)
// — approved as still reading squarely on the left side, well clear of the
// pivot (CX 232).
const ENDPOINT_X_NUDGE = 8;
const E_LABEL_RAW = labelPoint(START_ANGLE);
const E_LABEL = { x: E_LABEL_RAW.x + ENDPOINT_X_NUDGE, y: E_LABEL_RAW.y };
const F_LABEL = { x: 145.73 + ENDPOINT_X_NUDGE, y: -12 };
// ¼/½/¾ sit just beyond the major ticks' own outer end (R+12), same
// same-root-cause fix as E/F above — these were separately hardcoded and
// had the identical inward-of-the-ring problem.
const MID_LABEL_R = R + 12 + 8;
function midLabelPoint(frac: number) {
  const rad = toRad(pctToAngle(frac * 100));
  return {
    x: Math.round((CX + MID_LABEL_R * Math.cos(rad)) * 100) / 100,
    y: Math.round((CY + MID_LABEL_R * Math.sin(rad)) * 100) / 100,
  };
}
const QUARTER_LABEL = midLabelPoint(0.25);
const HALF_LABEL = midLabelPoint(0.5);
const THREE_QUARTER_LABEL = midLabelPoint(0.75);

/** Exported for structural bounds testing without a JSX render harness (none exists in this repo) — mirrors VERTICAL_SEGMENTS_LAYOUT's pattern. */
export const VERTICAL_CURVED_NEEDLE_LAYOUT = {
  cx: CX, cy: CY, r: R, trackWidth: TRACK_W,
  startAngle: START_ANGLE, endAngle: END_ANGLE,
  majorTicks: MAJOR_TICKS, minorTicks: MINOR_TICKS,
  majorTickColor: MAJOR_TICK_COLOR, minorTickColor: MINOR_TICK_COLOR,
  eLabel: E_LABEL,
  fLabel: F_LABEL,
  endpointLabelFontSize: ENDPOINT_LABEL_FONT_SIZE,
  endpointLabelFontWeight: ENDPOINT_LABEL_FONT_WEIGHT,
  quarterLabel: QUARTER_LABEL,
  threeQuarterLabel: THREE_QUARTER_LABEL,
  viewBox: { xMin: VIEWBOX_X_MIN, xMax: VIEWBOX_X_MAX, yMin: VIEWBOX_Y_MIN, yMax: VIEWBOX_Y_MAX },
};

export default function VerticalCurvedNeedle({ percent, color, dragging, label }: GaugeRendererProps) {
  const needleAng = pctToAngle(percent);
  const fillEnd = pctToAngle(Math.max(1, percent));
  const tipX = (CX + R * Math.cos(toRad(needleAng))).toFixed(2);
  const tipY = (CY + R * Math.sin(toRad(needleAng))).toFixed(2);

  return (
    <svg
      viewBox={`${VIEWBOX_X_MIN} ${VIEWBOX_Y_MIN} ${VIEWBOX_X_MAX - VIEWBOX_X_MIN} ${VIEWBOX_Y_MAX - VIEWBOX_Y_MIN}`}
      className="w-full" role="presentation" aria-hidden="true"
    >
      <path d={describeArc(CX, CY, R, START_ANGLE, END_ANGLE)} fill="none" stroke="#e2e8f0" strokeWidth={TRACK_W} strokeLinecap="butt" />

      {percent > 0.5 && (
        <path
          d={describeArc(CX, CY, R, START_ANGLE, fillEnd)}
          fill="none" stroke={color} strokeWidth={TRACK_W} strokeLinecap="butt" opacity="0.72"
          style={{ transition: dragging ? 'none' : 'stroke 0.4s ease' }}
        />
      )}

      {/* 2026-08-27 fix — ticks previously recolored to near-white once the
          fuel arc passed them (near-white once the tick's fraction reached
          the current level, slate otherwise), which made the
          ¼/½/¾ scale landmarks visually disappear against the same-color
          filled arc. The scale communicates position only; fuel state is
          the arc/needle's job. Ticks now render a fixed color regardless of
          percent — MINOR_TICK_COLOR/MAJOR_TICK_COLOR are what "unfilled"
          already was, since that pairing (light/thin minor, dark/thick
          major) was already the correct always-visible hierarchy. */}
      {MINOR_TICKS.map((frac) => {
        const ta = pctToAngle(frac * 100);
        const cos = Math.cos(toRad(ta)); const sin = Math.sin(toRad(ta));
        return (
          <line key={frac}
            x1={(CX + (R - 7) * cos).toFixed(2)} y1={(CY + (R - 7) * sin).toFixed(2)}
            x2={(CX + (R + 7) * cos).toFixed(2)} y2={(CY + (R + 7) * sin).toFixed(2)}
            stroke={MINOR_TICK_COLOR} strokeWidth="2" strokeLinecap="round"
          />
        );
      })}

      {MAJOR_TICKS.map((frac) => {
        const ta = pctToAngle(frac * 100);
        const cos = Math.cos(toRad(ta)); const sin = Math.sin(toRad(ta));
        return (
          <line key={frac}
            x1={(CX + (R - 12) * cos).toFixed(2)} y1={(CY + (R - 12) * sin).toFixed(2)}
            x2={(CX + (R + 12) * cos).toFixed(2)} y2={(CY + (R + 12) * sin).toFixed(2)}
            stroke={MAJOR_TICK_COLOR} strokeWidth="3.5" strokeLinecap="round"
          />
        );
      })}

      {/* E at the low (bottom) end of the arc, F at the high (top) end — both further from center than the ¼/½/¾ labels (E via ENDPOINT_LABEL_R, F via its live-approved override — see the constant declarations above), so they read as scale endpoints rather than extra fractional marks. */}
      <text x={E_LABEL.x} y={E_LABEL.y} fontSize={ENDPOINT_LABEL_FONT_SIZE} fontWeight={ENDPOINT_LABEL_FONT_WEIGHT} fill="#ef4444" textAnchor="middle">E</text>
      <text x={F_LABEL.x} y={F_LABEL.y} fontSize={ENDPOINT_LABEL_FONT_SIZE} fontWeight={ENDPOINT_LABEL_FONT_WEIGHT} fill="#22c55e" textAnchor="middle">F</text>
      <text x={QUARTER_LABEL.x} y={QUARTER_LABEL.y} fontSize="11" fontWeight="800" fill="#64748b" textAnchor="middle">¼</text>
      <text x={HALF_LABEL.x} y={HALF_LABEL.y} fontSize="11" fontWeight="800" fill="#64748b" textAnchor="middle">½</text>
      <text x={THREE_QUARTER_LABEL.x} y={THREE_QUARTER_LABEL.y} fontSize="11" fontWeight="800" fill="#64748b" textAnchor="middle">¾</text>

      <line x1={CX} y1={CY}
        x2={(CX + R * 0.82 * Math.cos(toRad(needleAng))).toFixed(2)}
        y2={(CY + R * 0.82 * Math.sin(toRad(needleAng))).toFixed(2)}
        stroke="#1e3a5f" strokeWidth="2.5" strokeLinecap="round" />

      <circle cx={CX} cy={CY} r="9" fill="#1e3a5f" />
      <circle cx={CX} cy={CY} r="4.5" fill="white" />

      <line
        x1={(CX + (R - 15) * Math.cos(toRad(needleAng))).toFixed(2)} y1={(CY + (R - 15) * Math.sin(toRad(needleAng))).toFixed(2)}
        x2={(CX + (R + 8) * Math.cos(toRad(needleAng))).toFixed(2)} y2={(CY + (R + 8) * Math.sin(toRad(needleAng))).toFixed(2)}
        stroke="white" strokeWidth="6" strokeLinecap="butt" />
      <line
        x1={(CX + (R - 15) * Math.cos(toRad(needleAng))).toFixed(2)} y1={(CY + (R - 15) * Math.sin(toRad(needleAng))).toFixed(2)}
        x2={(CX + (R + 8) * Math.cos(toRad(needleAng))).toFixed(2)} y2={(CY + (R + 8) * Math.sin(toRad(needleAng))).toFixed(2)}
        stroke={color} strokeWidth="3.5" strokeLinecap="butt"
        style={{ transition: dragging ? 'none' : 'stroke 0.3s ease' }} />
      <circle cx={tipX} cy={tipY} r="14" fill="transparent" />

      <text x="48" y="66" fontSize={label.length > 2 ? '24' : '30'} fontWeight="800" fill={color}
        stroke="white" strokeWidth="6" paintOrder="stroke" textAnchor="middle" letterSpacing="-1"
        style={{ transition: dragging ? 'none' : 'fill 0.4s ease' }}
      >
        {label}
      </text>
    </svg>
  );
}
