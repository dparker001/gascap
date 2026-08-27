'use client';

import { describeArc } from '@/lib/svgArc';
import type { GaugeRendererProps } from './types';

/**
 * Phase 4B — a vertically-oriented automotive gauge: the needle pivots from
 * a fixed point on the right edge and sweeps through a 90° arc that bulges
 * to the left, from pointing down-left (E, empty) through pointing
 * straight-left (½) up to pointing up-left (F, full) — the same "arc +
 * pivoted needle" language as AnalogNeedle, just rotated so the scale reads
 * vertically (E low, F high) instead of horizontally. Shares the common
 * "0 -20 280 165" viewBox so the FuelGauge shell's bounding box is
 * identical across every style.
 */
const CX = 232;
const CY = 62;
const R = 92;
const TRACK_W = 16;
// 135°(down-left, E) -> 225°(up-left, F), a 90° sweep bulging toward the
// left — E, ¼, ½, ¾, F all read top-to-bottom-free of overlap inside the
// shared viewBox (y from -20 to 145).
const START_ANGLE = 135;
const END_ANGLE = 225;

const toRad = (d: number) => (d * Math.PI) / 180;
const pctToAngle = (pct: number) => START_ANGLE + (END_ANGLE - START_ANGLE) * Math.max(0, Math.min(100, pct)) / 100;

const MAJOR_TICKS = [0.25, 0.5, 0.75];
const MINOR_TICKS = [0.125, 0.375, 0.625, 0.875];
// Fixed regardless of fuel percent — see the render-time comment below for why.
const MAJOR_TICK_COLOR = '#94a3b8';
const MINOR_TICK_COLOR = '#cbd5e1';

// 2026-08-27 fix — E/F were hardcoded eyeballed coordinates (150,128)/
// (150,-4) that landed INSIDE the track's outer radius instead of beyond
// it, so both labels visually overlapped the gauge ring instead of sitting
// outside it as scale endpoints should (reported after shipping — this
// repo's structural tests only assert "inside the viewBox," which a label
// sitting inside the ring still satisfies, so they didn't catch this).
// Fixed by deriving the label position from the SAME arc geometry as every
// tick mark, at a radius comfortably beyond the track's outer edge, rather
// than a separate guessed (x, y) pair.
const LABEL_MARGIN = 6;
const LABEL_R = R + TRACK_W / 2 + LABEL_MARGIN;
function labelPoint(angleDeg: number) {
  const rad = toRad(angleDeg);
  return {
    x: Math.round((CX + LABEL_R * Math.cos(rad)) * 100) / 100,
    y: Math.round((CY + LABEL_R * Math.sin(rad)) * 100) / 100,
  };
}
const E_LABEL = labelPoint(START_ANGLE);
const F_LABEL = labelPoint(END_ANGLE);
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
};

export default function VerticalCurvedNeedle({ percent, color, dragging, label }: GaugeRendererProps) {
  const needleAng = pctToAngle(percent);
  const fillEnd = pctToAngle(Math.max(1, percent));
  const tipX = (CX + R * Math.cos(toRad(needleAng))).toFixed(2);
  const tipY = (CY + R * Math.sin(toRad(needleAng))).toFixed(2);

  return (
    <svg viewBox="0 -20 280 165" className="w-full" role="presentation" aria-hidden="true">
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

      {/* E at the low (bottom) end of the arc, F at the high (top) end — positioned beyond the track's outer edge (LABEL_R), not merely inside the shared viewBox. */}
      <text x={E_LABEL.x} y={E_LABEL.y} fontSize="14" fontWeight="800" fill="#ef4444" textAnchor="middle">E</text>
      <text x={F_LABEL.x} y={F_LABEL.y} fontSize="14" fontWeight="800" fill="#22c55e" textAnchor="middle">F</text>
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
