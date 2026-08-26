'use client';

import { describeArc } from '@/lib/svgArc';
import type { GaugeRendererProps } from './types';

/**
 * Phase 4B — the same curved vertical track as VerticalCurvedNeedle (arc
 * bulging left, E at the low/bottom end, F at the high/top end), but fuel
 * level is shown as a stack of lit arc segments rather than a needle —
 * visually distinct from the straight bars of VerticalSegments while
 * sharing its "how many of N segments are lit" mental model. 8 segments
 * matches the shared ⅛-tank interaction grid.
 */
const CX = 210;
const CY = 62;
const R = 92;
const SEG_W = 15;
const START_ANGLE = 135;
const END_ANGLE = 225;
const SEGMENT_COUNT = 8;
const GAP_DEG = 1.5;
const SPAN = END_ANGLE - START_ANGLE;
const SEG_SPAN = SPAN / SEGMENT_COUNT;

/** Exported for structural bounds testing without a JSX render harness. */
export const VERTICAL_CURVED_SEGMENTS_LAYOUT = {
  cx: CX, cy: CY, r: R, segmentWidth: SEG_W,
  startAngle: START_ANGLE, endAngle: END_ANGLE, segmentCount: SEGMENT_COUNT,
  eLabel: { x: 128, y: 128 },
  fLabel: { x: 128, y: -4 },
};

export default function VerticalCurvedSegments({ percent, color, dragging, label }: GaugeRendererProps) {
  const litFraction = (percent / 100) * SEGMENT_COUNT; // 0..8, fractional

  return (
    <svg viewBox="0 -20 280 165" className="w-full" role="presentation" aria-hidden="true">
      {Array.from({ length: SEGMENT_COUNT }).map((_, i) => {
        // i=0 is the LOW end of the arc (E, empty) — same bottom-up fill order as VerticalSegments.
        const segStart = START_ANGLE + i * SEG_SPAN + GAP_DEG / 2;
        const segEnd = START_ANGLE + (i + 1) * SEG_SPAN - GAP_DEG / 2;
        const lit = Math.max(0, Math.min(1, litFraction - i)) > 0.001;
        return (
          <path
            key={i}
            d={describeArc(CX, CY, R, segStart, segEnd)}
            fill="none"
            stroke={lit ? color : '#e2e8f0'}
            strokeWidth={SEG_W}
            strokeLinecap="round"
            opacity={lit ? 0.85 : 1}
            style={{ transition: dragging ? 'none' : 'stroke 0.3s ease' }}
          />
        );
      })}

      <text x="128" y="128" fontSize="14" fontWeight="800" fill="#ef4444" textAnchor="middle">E</text>
      <text x="128" y="-4" fontSize="14" fontWeight="800" fill="#22c55e" textAnchor="middle">F</text>

      <text x="60" y="66" fontSize={label.length > 2 ? '24' : '30'} fontWeight="800" fill={color} textAnchor="middle" letterSpacing="-1"
        style={{ transition: dragging ? 'none' : 'fill 0.4s ease' }}>
        {label}
      </text>
    </svg>
  );
}
