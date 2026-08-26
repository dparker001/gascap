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

/** Exported for structural bounds testing without a JSX render harness (none exists in this repo) — mirrors VERTICAL_SEGMENTS_LAYOUT's pattern. */
export const VERTICAL_CURVED_NEEDLE_LAYOUT = {
  cx: CX, cy: CY, r: R, trackWidth: TRACK_W,
  startAngle: START_ANGLE, endAngle: END_ANGLE,
  majorTicks: MAJOR_TICKS, minorTicks: MINOR_TICKS,
  eLabel: { x: 150, y: 128 },
  fLabel: { x: 150, y: -4 },
};

export default function VerticalCurvedNeedle({ percent, color, dragging, label }: GaugeRendererProps) {
  const p = percent / 100;
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

      {MINOR_TICKS.map((frac) => {
        const ta = pctToAngle(frac * 100);
        const cos = Math.cos(toRad(ta)); const sin = Math.sin(toRad(ta));
        const filled = frac <= p;
        return (
          <line key={frac}
            x1={(CX + (R - 7) * cos).toFixed(2)} y1={(CY + (R - 7) * sin).toFixed(2)}
            x2={(CX + (R + 7) * cos).toFixed(2)} y2={(CY + (R + 7) * sin).toFixed(2)}
            stroke={filled ? 'rgba(255,255,255,0.72)' : '#cbd5e1'} strokeWidth="2" strokeLinecap="round"
            style={{ transition: 'stroke 0.3s' }}
          />
        );
      })}

      {MAJOR_TICKS.map((frac) => {
        const ta = pctToAngle(frac * 100);
        const cos = Math.cos(toRad(ta)); const sin = Math.sin(toRad(ta));
        const filled = frac <= p;
        return (
          <line key={frac}
            x1={(CX + (R - 12) * cos).toFixed(2)} y1={(CY + (R - 12) * sin).toFixed(2)}
            x2={(CX + (R + 12) * cos).toFixed(2)} y2={(CY + (R + 12) * sin).toFixed(2)}
            stroke={filled ? 'rgba(255,255,255,0.88)' : '#94a3b8'} strokeWidth="3.5" strokeLinecap="round"
            style={{ transition: 'stroke 0.3s' }}
          />
        );
      })}

      {/* E at the low (bottom) end of the arc, F at the high (top) end — both well inside the shared viewBox. */}
      <text x="150" y="128" fontSize="14" fontWeight="800" fill="#ef4444" textAnchor="middle">E</text>
      <text x="150" y="-4" fontSize="14" fontWeight="800" fill="#22c55e" textAnchor="middle">F</text>
      <text x="112" y="100" fontSize="11" fontWeight="800" fill="#64748b" textAnchor="middle">¼</text>
      <text x="100" y="66" fontSize="11" fontWeight="800" fill="#64748b" textAnchor="middle">½</text>
      <text x="112" y="30" fontSize="11" fontWeight="800" fill="#64748b" textAnchor="middle">¾</text>

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
