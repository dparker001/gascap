'use client';

import type { GaugeRendererProps } from './types';

const SEGMENT_COUNT = 8; // matches the shared ⅛-tank interaction grid
const GAP = 4;
const BAR_X = 20, BAR_Y = 60, BAR_W = 240, BAR_H = 32;
const SEG_W = (BAR_W - GAP * (SEGMENT_COUNT - 1)) / SEGMENT_COUNT;

export default function HorizontalSegments({ percent, color, dragging, label }: GaugeRendererProps) {
  const litFraction = (percent / 100) * SEGMENT_COUNT; // 0..8, fractional — precision preserved beyond the visual segment count

  return (
    <svg viewBox="0 -20 280 165" className="w-full" role="presentation" aria-hidden="true">
      {Array.from({ length: SEGMENT_COUNT }).map((_, i) => {
        const x = BAR_X + i * (SEG_W + GAP);
        const fillAmount = Math.max(0, Math.min(1, litFraction - i)); // proportional partial fill for the boundary segment
        return (
          <g key={i}>
            <rect x={x} y={BAR_Y} width={SEG_W} height={BAR_H} rx="4" fill="#e2e8f0" />
            {fillAmount > 0 && (
              <rect
                x={x} y={BAR_Y} width={SEG_W * fillAmount} height={BAR_H} rx="4" fill={color} opacity="0.85"
                style={{ transition: dragging ? 'none' : 'width 0.3s ease' }}
              />
            )}
          </g>
        );
      })}

      <text x={BAR_X - 8} y={BAR_Y + BAR_H / 2 + 5} fontSize="14" fontWeight="800" fill="#ef4444" textAnchor="end">E</text>
      <text x={BAR_X + BAR_W + 8} y={BAR_Y + BAR_H / 2 + 5} fontSize="14" fontWeight="800" fill="#22c55e" textAnchor="start">F</text>

      <text x="140" y={BAR_Y - 16} fontSize="30" fontWeight="800" fill={color} textAnchor="middle" letterSpacing="-1"
        style={{ transition: dragging ? 'none' : 'fill 0.4s ease' }}>
        {label}
      </text>
    </svg>
  );
}
