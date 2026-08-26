'use client';

import { describeArc } from '@/lib/svgArc';
import type { GaugeRendererProps } from './types';

// Same geometry FuelGauge has always used — viewBox "0 -20 280 165",
// 195°→345° sweep (150°), center (140,135), radius 115. Preserved exactly so
// the default style is visually identical to the pre-Phase-4 gauge.
const CX = 140;
const CY = 135;
const R = 115;
const TRACK_W = 20;
const START_ANGLE = 195;
const END_ANGLE = 345;

const toRad = (d: number) => (d * Math.PI) / 180;
const pctToAngle = (pct: number) => START_ANGLE + (END_ANGLE - START_ANGLE) * Math.max(0, Math.min(100, pct)) / 100;

const MAJOR_TICKS = [0.25, 0.5, 0.75];
const MINOR_TICKS = [0.125, 0.375, 0.625, 0.875];

export default function AnalogNeedle({ percent, color, dragging, label }: GaugeRendererProps) {
  const p = percent / 100;
  const needleAng = pctToAngle(percent);
  const fillEnd = pctToAngle(Math.max(1, percent));
  const tipX = (CX + R * Math.cos(toRad(needleAng))).toFixed(2);
  const tipY = (CY + R * Math.sin(toRad(needleAng))).toFixed(2);

  return (
    <svg viewBox="0 -20 280 165" className="w-full" role="presentation" aria-hidden="true">
      <defs>
        <filter id="gc-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

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
            x1={(CX + (R - 8) * cos).toFixed(2)} y1={(CY + (R - 8) * sin).toFixed(2)}
            x2={(CX + (R + 8) * cos).toFixed(2)} y2={(CY + (R + 8) * sin).toFixed(2)}
            stroke={filled ? 'rgba(255,255,255,0.72)' : '#cbd5e1'} strokeWidth="2.5" strokeLinecap="round"
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
            x1={(CX + (R - 15) * cos).toFixed(2)} y1={(CY + (R - 15) * sin).toFixed(2)}
            x2={(CX + (R + 15) * cos).toFixed(2)} y2={(CY + (R + 15) * sin).toFixed(2)}
            stroke={filled ? 'rgba(255,255,255,0.88)' : '#94a3b8'} strokeWidth="4" strokeLinecap="round"
            style={{ transition: 'stroke 0.3s' }}
          />
        );
      })}

      <text x="14" y="115" fontSize="14" fontWeight="800" fill="#ef4444" textAnchor="middle">E</text>
      <text x="266" y="115" fontSize="14" fontWeight="800" fill="#22c55e" textAnchor="middle">F</text>
      <text x="42" y="34" fontSize="13" fontWeight="800" fill="#64748b" textAnchor="middle">¼</text>
      <text x="140" y="-8" fontSize="13" fontWeight="800" fill="#64748b" textAnchor="middle">½</text>
      <text x="238" y="34" fontSize="13" fontWeight="800" fill="#64748b" textAnchor="middle">¾</text>

      <line x1={CX} y1={CY}
        x2={(CX + R * 0.82 * Math.cos(toRad(needleAng))).toFixed(2)}
        y2={(CY + R * 0.82 * Math.sin(toRad(needleAng))).toFixed(2)}
        stroke="#1e3a5f" strokeWidth="2.5" strokeLinecap="round" />

      <circle cx={CX} cy={CY} r="10" fill="#1e3a5f" />
      <circle cx={CX} cy={CY} r="5" fill="white" />

      <line
        x1={(CX + (R - 19) * Math.cos(toRad(needleAng))).toFixed(2)} y1={(CY + (R - 19) * Math.sin(toRad(needleAng))).toFixed(2)}
        x2={(CX + (R + 10) * Math.cos(toRad(needleAng))).toFixed(2)} y2={(CY + (R + 10) * Math.sin(toRad(needleAng))).toFixed(2)}
        stroke="white" strokeWidth="7" strokeLinecap="butt" />
      <line
        x1={(CX + (R - 19) * Math.cos(toRad(needleAng))).toFixed(2)} y1={(CY + (R - 19) * Math.sin(toRad(needleAng))).toFixed(2)}
        x2={(CX + (R + 10) * Math.cos(toRad(needleAng))).toFixed(2)} y2={(CY + (R + 10) * Math.sin(toRad(needleAng))).toFixed(2)}
        stroke={color} strokeWidth="4" strokeLinecap="butt"
        filter={dragging ? 'url(#gc-glow)' : undefined}
        style={{ transition: dragging ? 'none' : 'stroke 0.3s ease' }} />
      <circle cx={tipX} cy={tipY} r="18" fill="transparent" />

      <text x={CX} y={CY - 26}
        fontSize={label.length > 2 ? '30' : '38'} fontWeight="800" fill={color}
        stroke="white" strokeWidth="6" paintOrder="stroke" textAnchor="middle" letterSpacing="-1"
        style={{ transition: dragging ? 'none' : 'fill 0.4s ease' }}
      >
        {label}
      </text>
    </svg>
  );
}
