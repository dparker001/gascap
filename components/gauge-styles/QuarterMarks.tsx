'use client';

import type { GaugeRendererProps } from './types';

const LINE_X1 = 24, LINE_X2 = 256, LINE_Y = 76;
const TICKS = [0, 0.25, 0.5, 0.75, 1];
const TICK_LABELS = ['E', '¼', '½', '¾', 'F'];

export default function QuarterMarks({ percent, color, dragging, label }: GaugeRendererProps) {
  const p = percent / 100;
  const thumbX = LINE_X1 + (LINE_X2 - LINE_X1) * p;

  return (
    <svg viewBox="0 -20 280 165" className="w-full" role="presentation" aria-hidden="true">
      <line x1={LINE_X1} y1={LINE_Y} x2={LINE_X2} y2={LINE_Y} stroke="#e2e8f0" strokeWidth="6" strokeLinecap="round" />
      <line x1={LINE_X1} y1={LINE_Y} x2={thumbX} y2={LINE_Y} stroke={color} strokeWidth="6" strokeLinecap="round" opacity="0.85"
        style={{ transition: dragging ? 'none' : 'x2 0.3s ease' }} />

      {TICKS.map((frac, i) => {
        const x = LINE_X1 + (LINE_X2 - LINE_X1) * frac;
        const filled = frac <= p;
        return (
          <g key={frac}>
            <line x1={x} y1={LINE_Y - 12} x2={x} y2={LINE_Y + 12}
              stroke={filled ? '#1e3a5f' : '#94a3b8'} strokeWidth="3" strokeLinecap="round" />
            <text x={x} y={LINE_Y + 32} fontSize="14" fontWeight="800"
              fill={i === 0 ? '#ef4444' : i === TICK_LABELS.length - 1 ? '#22c55e' : '#64748b'}
              textAnchor="middle">
              {TICK_LABELS[i]}
            </text>
          </g>
        );
      })}

      <circle cx={thumbX} cy={LINE_Y} r="9" fill="white" stroke={color} strokeWidth="4" />

      <text x="140" y={LINE_Y - 30} fontSize="30" fontWeight="800" fill={color} textAnchor="middle" letterSpacing="-1"
        style={{ transition: dragging ? 'none' : 'fill 0.4s ease' }}>
        {label}
      </text>
    </svg>
  );
}
