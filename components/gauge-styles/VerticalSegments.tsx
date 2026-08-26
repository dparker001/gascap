'use client';

import type { GaugeRendererProps } from './types';

const SEGMENT_COUNT = 8; // matches the shared ⅛-tank interaction grid
const GAP = 4;
// All renderers share one viewBox ("0 -20 280 165", y from -20 to 145) so the
// FuelGauge shell's bounding box stays identical across styles. The bar and
// BOTH end labels must fit inside that range — the prior BAR_Y=-10/BAR_H=140
// placed the "E" label at y=148, three units past the viewBox's bottom edge
// (145), so it was silently clipped by SVG's default overflow:hidden. These
// values leave a real margin above the F label and below the E label.
const BAR_X = 125, BAR_Y = 0, BAR_W = 30, BAR_H = 118;
const SEG_H = (BAR_H - GAP * (SEGMENT_COUNT - 1)) / SEGMENT_COUNT;

/** Exported so a test can assert these against the shared viewBox bounds
 *  without needing a JSX render harness (none exists in this repo) — this
 *  is exactly what caused the original clipping bug, so it's the value
 *  worth regression-testing directly. */
export const VERTICAL_SEGMENTS_LAYOUT = {
  barTop: BAR_Y,
  barBottom: BAR_Y + BAR_H,
  eLabelY: BAR_Y + BAR_H + 20,
  fLabelY: BAR_Y - 6,
};

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

      <text x={BAR_X + BAR_W / 2} y={BAR_Y + BAR_H + 20} fontSize="14" fontWeight="800" fill="#ef4444" textAnchor="middle">E</text>
      <text x={BAR_X + BAR_W / 2} y={BAR_Y - 6} fontSize="14" fontWeight="800" fill="#22c55e" textAnchor="middle">F</text>

      <text x="210" y={BAR_Y + BAR_H / 2 + 10} fontSize="30" fontWeight="800" fill={color} textAnchor="middle" letterSpacing="-1"
        style={{ transition: dragging ? 'none' : 'fill 0.4s ease' }}>
        {label}
      </text>
    </svg>
  );
}
