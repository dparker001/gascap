'use client';

import { useRef, useCallback, useEffect, useState } from 'react';

// ─── Gauge geometry ────────────────────────────────────────────────────────
// viewBox: 0 0 280 145   |  center: (140, 135)  |  radius: 115
// Arc spans 195° → 345° clockwise (150° sweep) — wider than a semicircle
// E (empty) = 195°   F (full) = 345°   ½ = 270° (12-o'clock)

const CX = 140;
const CY = 135;
const R  = 115;
const TRACK_W = 20;

const START_ANGLE = 195; // E
const END_ANGLE   = 345; // F
const SWEEP       = END_ANGLE - START_ANGLE; // 150°

const toRad = (d: number) => (d * Math.PI) / 180;

/** Cartesian point on the arc for a given degree angle */
function pt(deg: number) {
  return {
    x: CX + R * Math.cos(toRad(deg)),
    y: CY + R * Math.sin(toRad(deg)),
  };
}

/** SVG arc path string — clockwise from angle a° to b° */
function arcPath(a: number, b: number) {
  const s = pt(a);
  const e = pt(b);
  const large = b - a > 180 ? 1 : 0;
  return `M${s.x.toFixed(2)} ${s.y.toFixed(2)} A${R} ${R} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

/** Map 0–100 percent to arc angle */
function pctToAngle(pct: number) {
  return START_ANGLE + SWEEP * Math.max(0, Math.min(100, pct)) / 100;
}

/** Convert an SVG-space angle (degrees) to a 0–100 percent */
function angleToPct(deg: number): number {
  // Valid band: 195° – 345°
  if (deg >= START_ANGLE && deg <= END_ANGLE) return ((deg - START_ANGLE) / SWEEP) * 100;
  // Dead zone at the bottom — snap based on which side of 90° we're on
  if (deg < 90 || deg > END_ANGLE) return 100; // closer to F
  return 0; // closer to E
}

/** Pick a colour based on fill level */
function levelColor(p: number): string {
  if (p < 0.25) return '#ef4444'; // red
  if (p < 0.55) return '#f59e0b'; // amber
  return '#22c55e'; // green
}

// Tick positions (percent values to draw cross-hatch marks at)
const TICKS = [0.25, 0.5, 0.75];

// ─── Component ────────────────────────────────────────────────────────────

interface FuelGaugeProps {
  /** Current fill level, 0–100 */
  percent: number;
  /** Called with a rounded integer 0–100 */
  onChange: (pct: number) => void;
  /** Optional tank size in gallons — shows secondary readout when set */
  tankCapacity?: number;
}

export default function FuelGauge({ percent, onChange, tankCapacity }: FuelGaugeProps) {
  const svgRef  = useRef<SVGSVGElement>(null);
  const active  = useRef(false);
  const [dragging, setDragging] = useState(false);

  const clampedPct = Math.max(0, Math.min(100, isNaN(percent) ? 0 : percent));
  const p          = clampedPct / 100;
  const needleAng  = pctToAngle(clampedPct);
  const tip        = pt(needleAng);
  const color      = levelColor(p);

  // ── Pointer → percent conversion ─────────────────────────────────────
  const processPointer = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      // Scale screen coords → SVG viewBox coords
      const svgX = ((clientX - rect.left) / rect.width) * 280;
      const svgY = ((clientY - rect.top) / rect.height) * 145;
      const dx = svgX - CX;
      const dy = svgY - CY;
      let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (deg < 0) deg += 360;
      onChange(Math.round(angleToPct(deg)));
    },
    [onChange],
  );

  // ── Global pointer/touch listeners during drag ─────────────────────
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!active.current) return;
      processPointer(e.clientX, e.clientY);
    };
    const onUp = () => {
      if (!active.current) return;
      active.current = false;
      setDragging(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [processPointer]);

  // ── Keyboard (↑/↓ on the hidden range input) ──────────────────────
  const handleRangeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(Number(e.target.value));
  };

  // Derived display values
  const gallons = tankCapacity ? (tankCapacity * p).toFixed(1) : null;

  // Fill arc — never draw a zero-length arc
  const fillEnd = pctToAngle(Math.max(1, clampedPct));

  return (
    <div className="relative select-none w-full">
      {/* ── SVG gauge ──────────────────────────────────────────────── */}
      <svg
        ref={svgRef}
        viewBox="0 -20 280 165"
        className="w-full"
        style={{ touchAction: 'none', cursor: dragging ? 'grabbing' : 'grab' }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          active.current = true;
          setDragging(true);
          processPointer(e.clientX, e.clientY);
        }}
        role="presentation"
        aria-hidden="true"
      >
        <defs>
          {/* Radial glow under the drag handle */}
          <filter id="gc-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Clip arc-shaped fill with strokeLinecap */}
          <linearGradient id="gc-track" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f1f5f9" />
            <stop offset="100%" stopColor="#e2e8f0" />
          </linearGradient>
        </defs>

        {/* ── Background track ───────────────────────────────────── */}
        <path
          d={arcPath(START_ANGLE, END_ANGLE)}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={TRACK_W}
          strokeLinecap="round"
        />

        {/* ── Colored fill arc ───────────────────────────────────── */}
        {clampedPct > 0.5 && (
          <path
            d={arcPath(START_ANGLE, fillEnd)}
            fill="none"
            stroke={color}
            strokeWidth={TRACK_W}
            strokeLinecap="round"
            opacity="0.95"
            style={{ transition: dragging ? 'none' : 'stroke 0.4s ease' }}
          />
        )}

        {/* ── Tick cross-marks at ¼, ½, ¾ ─────────────────────── */}
        {TICKS.map((t) => {
          const ta  = pctToAngle(t * 100);
          const cos = Math.cos(toRad(ta));
          const sin = Math.sin(toRad(ta));
          const i1x = CX + (R - 15) * cos; const i1y = CY + (R - 15) * sin;
          const o1x = CX + (R + 15) * cos; const o1y = CY + (R + 15) * sin;
          const filled = t <= p;
          return (
            <line
              key={t}
              x1={i1x.toFixed(2)} y1={i1y.toFixed(2)}
              x2={o1x.toFixed(2)} y2={o1y.toFixed(2)}
              stroke={filled ? color : '#94a3b8'}
              strokeWidth="4"
              strokeLinecap="round"
              style={{ transition: 'stroke 0.3s' }}
            />
          );
        })}

        {/* ── E / F end labels ───────────────────────────────────── */}
        <text x="14" y="115" fontSize="14" fontWeight="800" fill="#ef4444" textAnchor="middle">E</text>
        <text x="266" y="115" fontSize="14" fontWeight="800" fill="#22c55e" textAnchor="middle">F</text>

        {/* ── ¼ · ½ · ¾ labels — positioned outside the arc track ── */}
        <text x="42" y="34" fontSize="13" fontWeight="800" fill="#64748b" textAnchor="middle">¼</text>
        <text x="140" y="-8" fontSize="13" fontWeight="800" fill="#64748b" textAnchor="middle">½</text>
        <text x="238" y="34" fontSize="13" fontWeight="800" fill="#64748b" textAnchor="middle">¾</text>

        {/* ── Needle ─────────────────────────────────────────────── */}
        <line
          x1={CX}
          y1={CY}
          x2={(CX + R * 0.82 * Math.cos(toRad(needleAng))).toFixed(2)}
          y2={(CY + R * 0.82 * Math.sin(toRad(needleAng))).toFixed(2)}
          stroke="#1e3a5f"
          strokeWidth="2.5"
          strokeLinecap="round"
        />

        {/* ── Center hub ─────────────────────────────────────────── */}
        <circle cx={CX} cy={CY} r="10" fill="#1e3a5f" />
        <circle cx={CX} cy={CY} r="5"  fill="white" />

        {/* ── Drag handle (on the arc track) ─────────────────────── */}
        <circle
          cx={tip.x.toFixed(2)}
          cy={tip.y.toFixed(2)}
          r="13"
          fill={color}
          stroke="white"
          strokeWidth="3"
          filter={dragging ? 'url(#gc-glow)' : undefined}
          style={{ transition: dragging ? 'none' : 'fill 0.3s ease' }}
        />
        {/* Inner dot on handle */}
        <circle
          cx={tip.x.toFixed(2)}
          cy={tip.y.toFixed(2)}
          r="4"
          fill="white"
          opacity="0.7"
        />

        {/* ── Central readout — color matches current level ──────── */}
        <text
          x={CX}
          y={CY - 26}
          fontSize="38"
          fontWeight="800"
          fill={color}
          stroke="white"
          strokeWidth="6"
          paintOrder="stroke"
          textAnchor="middle"
          dominantBaseline="auto"
          letterSpacing="-1"
          style={{ transition: dragging ? 'none' : 'fill 0.4s ease' }}
        >
          {Math.round(clampedPct)}%
        </text>
      </svg>

      {/* ── Accessible hidden range input ──────────────────────────── */}
      <label className="sr-only">
        Current fuel level: {Math.round(clampedPct)}%
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(clampedPct)}
          onChange={handleRangeChange}
          className="sr-only"
        />
      </label>

      {/* ── Gallons readout — below SVG, color matches level ──────── */}
      {gallons && (
        <p
          className="text-center text-sm font-bold -mt-1 mb-0.5 transition-colors duration-300"
          style={{ color }}
        >
          ≈ {gallons} gal
        </p>
      )}

      {/* ── Drag hint ──────────────────────────────────────────────── */}
      <p
        className="text-center text-xs mt-1 transition-colors duration-200"
        style={{ color: dragging ? color : '#94a3b8' }}
      >
        {dragging ? 'Release to set level' : 'Drag the handle · or tap anywhere on the arc'}
      </p>
    </div>
  );
}
