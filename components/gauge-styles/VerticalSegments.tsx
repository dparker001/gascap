'use client';

import type { GaugeRendererProps } from './types';

const SEGMENT_COUNT = 8; // matches the shared ⅛-tank interaction grid
const GAP = 4;
const BAR_X = 125, BAR_Y = -10, BAR_W = 30, BAR_H = 140;
const SEG_H = (BAR_H - GAP * (SEGMENT_COUNT - 1)) / SEGMENT_COUNT;

export default function VerticalSegments({ percent, color, dragging, label }: GaugeRendererProps) {
  const litFraction = (percent / 100) * SEGMENT_COUNT; // 0..8, fractional — precision preserved beyond the visual segment count

  return (
    <svg viewBox="0 -20 280 165" className="w-full" role="presentation" aria-hidden="true">
      {Array.from({ length: SEGMENT_COUNT }).map((_, i) => {
        // i=0 is the BOTTOM segment (empty end) — draw from the bottom up.
        const y = BAR_Y + BAR_H - (i + 1) * SEG_H - i * GAP;
        const fillAmount = Math.max(0, Math.min(1, litFraction - i));
        return (
          <g key={i}>
            <rect x={BAR_X} y={y} width={BAR_W} height={SEG_H} rx="4" fill="#e2e8f0" />
            {fillAmount > 0 && (
              <rect
                x={BAR_X} y={y + SEG_H * (1 - fillAmount)} width={BAR_W} height={SEG_H * fillAmount} rx="4"
                fill={color} opacity="0.85"
                style={{ transition: dragging ? 'none' : 'height 0.3s ease, y 0.3s ease' }}
              />
            )}
          </g>
        );
      })}

      <text x={BAR_X + BAR_W / 2} y={BAR_Y + BAR_H + 18} fontSize="14" fontWeight="800" fill="#ef4444" textAnchor="middle">E</text>
      <text x={BAR_X + BAR_W / 2} y={BAR_Y - 6} fontSize="14" fontWeight="800" fill="#22c55e" textAnchor="middle">F</text>

      <text x="210" y={BAR_Y + BAR_H / 2 + 10} fontSize="30" fontWeight="800" fill={color} textAnchor="middle" letterSpacing="-1"
        style={{ transition: dragging ? 'none' : 'fill 0.4s ease' }}>
        {label}
      </text>
    </svg>
  );
}
