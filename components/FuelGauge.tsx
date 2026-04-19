'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';

// ─── Gauge geometry ────────────────────────────────────────────────────────
// viewBox: 0 0 280 145   |  center: (140, 135)  |  radius: 115
// Arc spans 195° → 345° clockwise (150° sweep)
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
  if (deg >= START_ANGLE && deg <= END_ANGLE) return ((deg - START_ANGLE) / SWEEP) * 100;
  if (deg < 90 || deg > END_ANGLE) return 100;
  return 0;
}

/** Snap a raw percent to the nearest ⅛ step (0, 12.5, 25 … 100) — used for drag */
function snapToEighth(pct: number): number {
  return Math.max(0, Math.min(100, Math.round(pct / 12.5) * 12.5));
}

/** Step size for the ± nudge buttons: 1/64 of the full tank */
const NUDGE_STEP = 100 / 64; // ≈ 1.5625 %

/** Pick a colour based on fill level */
function levelColor(p: number): string {
  if (p < 0.25) return '#ef4444'; // red
  if (p < 0.55) return '#f59e0b'; // amber
  return '#22c55e'; // green
}

// ─── Tick definitions ─────────────────────────────────────────────────────
// Major ticks (¼ ½ ¾) — same inner/outer reach as before
const MAJOR_TICKS = [
  { frac: 0.25, label: '¼' },
  { frac: 0.50, label: '½' },
  { frac: 0.75, label: '¾' },
];
// Minor ticks (⅛ ⅜ ⅝ ⅞) — shorter reach
const MINOR_TICKS = [0.125, 0.375, 0.625, 0.875];

// ─── Fraction label map ───────────────────────────────────────────────────
const EIGHTH_LABELS = ['E', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞', 'F'];

/** Return "E" / "⅛" / "¼" … "F" when the value is at an ⅛ position,
 *  otherwise fall back to a rounded-percentage string. */
function fuelLabel(pct: number): string {
  const idx = Math.round(pct / 12.5);
  const snapped = idx * 12.5;
  if (Math.abs(pct - snapped) < 0.5) {
    return EIGHTH_LABELS[Math.max(0, Math.min(8, idx))];
  }
  return `${Math.round(pct)}%`;
}

// ─── Component ────────────────────────────────────────────────────────────

interface FuelGaugeProps {
  /** Current fill level, 0–100 */
  percent: number;
  /** Called with the new percent value (drag snaps to nearest ⅛; nudge moves in 1/64 steps) */
  onChange: (pct: number) => void;
  /** Optional tank size in gallons — shows secondary readout when set */
  tankCapacity?: number;
}

export default function FuelGauge({ percent, onChange, tankCapacity }: FuelGaugeProps) {
  const { t } = useTranslation();
  const svgRef  = useRef<SVGSVGElement>(null);
  const active  = useRef(false);
  const [dragging, setDragging] = useState(false);

  const clampedPct = Math.max(0, Math.min(100, isNaN(percent) ? 0 : percent));
  const p          = clampedPct / 100;
  const needleAng  = pctToAngle(clampedPct);
  const tip        = pt(needleAng);
  const color      = levelColor(p);

  // ── Pointer → snapped-to-⅛ percent ───────────────────────────────────
  const processPointer = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const svgX = ((clientX - rect.left) / rect.width)  * 280;
      const svgY = ((clientY - rect.top)  / rect.height) * 145;
      const dx = svgX - CX;
      const dy = svgY - CY;
      let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (deg < 0) deg += 360;
      onChange(snapToEighth(angleToPct(deg)));
    },
    [onChange],
  );

  // ── Global pointer listeners during drag ──────────────────────────────
  useEffect(() => {
    const onMove = (e: PointerEvent) => { if (active.current) processPointer(e.clientX, e.clientY); };
    const onUp   = () => { if (active.current) { active.current = false; setDragging(false); } };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup',   onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup',   onUp);
    };
  }, [processPointer]);

  // ── Keyboard (hidden range input) ─────────────────────────────────────
  const handleRangeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(snapToEighth(Number(e.target.value)));
  };

  // ── Nudge helpers (1/64 tank increments) ─────────────────────────────
  function nudge(dir: 1 | -1) {
    const currentStep = Math.round(clampedPct / NUDGE_STEP);
    const newStep     = Math.max(0, Math.min(64, currentStep + dir));
    onChange(parseFloat((newStep * NUDGE_STEP).toFixed(6)));
  }

  // Derived display values
  const gallons = tankCapacity ? (tankCapacity * p).toFixed(1) : null;
  const fillEnd = pctToAngle(Math.max(1, clampedPct));
  const label   = fuelLabel(clampedPct);

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
          <filter id="gc-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="gc-track" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f1f5f9" />
            <stop offset="100%" stopColor="#e2e8f0" />
          </linearGradient>
        </defs>

        {/* ── Background track ───────────────────────────────────── */}
        {/* strokeLinecap="butt" — flat ends at E and F; no rounded stub  */}
        {/* extending past either endpoint of the gauge arc.             */}
        <path
          d={arcPath(START_ANGLE, END_ANGLE)}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={TRACK_W}
          strokeLinecap="butt"
        />

        {/* ── Colored fill arc ───────────────────────────────────── */}
        {/* strokeLinecap="butt" — no colored cap leaking past E when  */}
        {/* the gauge is at or near empty.                             */}
        {clampedPct > 0.5 && (
          <path
            d={arcPath(START_ANGLE, fillEnd)}
            fill="none"
            stroke={color}
            strokeWidth={TRACK_W}
            strokeLinecap="butt"
            opacity="0.72"
            style={{ transition: dragging ? 'none' : 'stroke 0.4s ease' }}
          />
        )}

        {/* ── Minor tick marks — ⅛, ⅜, ⅝, ⅞ (shorter) ─────────── */}
        {/* When a tick falls inside the filled zone it renders white so it  */}
        {/* stays visible against the semi-transparent fill color.           */}
        {MINOR_TICKS.map((frac) => {
          const ta  = pctToAngle(frac * 100);
          const cos = Math.cos(toRad(ta));
          const sin = Math.sin(toRad(ta));
          const filled = frac <= p;
          return (
            <line
              key={frac}
              x1={(CX + (R - 8) * cos).toFixed(2)}  y1={(CY + (R - 8) * sin).toFixed(2)}
              x2={(CX + (R + 8) * cos).toFixed(2)}  y2={(CY + (R + 8) * sin).toFixed(2)}
              stroke={filled ? 'rgba(255,255,255,0.72)' : '#cbd5e1'}
              strokeWidth="2.5"
              strokeLinecap="round"
              style={{ transition: 'stroke 0.3s' }}
            />
          );
        })}

        {/* ── Major tick marks — ¼, ½, ¾ (longer, labeled) ─────── */}
        {MAJOR_TICKS.map(({ frac }) => {
          const ta  = pctToAngle(frac * 100);
          const cos = Math.cos(toRad(ta));
          const sin = Math.sin(toRad(ta));
          const filled = frac <= p;
          return (
            <line
              key={frac}
              x1={(CX + (R - 15) * cos).toFixed(2)} y1={(CY + (R - 15) * sin).toFixed(2)}
              x2={(CX + (R + 15) * cos).toFixed(2)} y2={(CY + (R + 15) * sin).toFixed(2)}
              stroke={filled ? 'rgba(255,255,255,0.88)' : '#94a3b8'}
              strokeWidth="4"
              strokeLinecap="round"
              style={{ transition: 'stroke 0.3s' }}
            />
          );
        })}

        {/* ── E / F end labels ───────────────────────────────────── */}
        <text x="14"  y="115" fontSize="14" fontWeight="800" fill="#ef4444" textAnchor="middle">E</text>
        <text x="266" y="115" fontSize="14" fontWeight="800" fill="#22c55e" textAnchor="middle">F</text>

        {/* ── ¼ · ½ · ¾ labels ───────────────────────────────────── */}
        <text x="42"  y="34"  fontSize="13" fontWeight="800" fill="#64748b" textAnchor="middle">¼</text>
        <text x="140" y="-8"  fontSize="13" fontWeight="800" fill="#64748b" textAnchor="middle">½</text>
        <text x="238" y="34"  fontSize="13" fontWeight="800" fill="#64748b" textAnchor="middle">¾</text>

        {/* ── Needle ─────────────────────────────────────────────── */}
        <line
          x1={CX} y1={CY}
          x2={(CX + R * 0.82 * Math.cos(toRad(needleAng))).toFixed(2)}
          y2={(CY + R * 0.82 * Math.sin(toRad(needleAng))).toFixed(2)}
          stroke="#1e3a5f"
          strokeWidth="2.5"
          strokeLinecap="round"
        />

        {/* ── Center hub ─────────────────────────────────────────── */}
        <circle cx={CX} cy={CY} r="10" fill="#1e3a5f" />
        <circle cx={CX} cy={CY} r="5"  fill="white" />

        {/* ── Position indicator — perpendicular line at arc position ── */}
        {/* Outer end flush with track outer edge (R+10); butt cap so no */}
        {/* rounded stub protrudes past the gauge track boundary.        */}
        {/* White halo layer first (contrast against both track & fill)  */}
        <line
          x1={(CX + (R - 19) * Math.cos(toRad(needleAng))).toFixed(2)}
          y1={(CY + (R - 19) * Math.sin(toRad(needleAng))).toFixed(2)}
          x2={(CX + (R + 10) * Math.cos(toRad(needleAng))).toFixed(2)}
          y2={(CY + (R + 10) * Math.sin(toRad(needleAng))).toFixed(2)}
          stroke="white"
          strokeWidth="7"
          strokeLinecap="butt"
        />
        {/* Colored line on top */}
        <line
          x1={(CX + (R - 19) * Math.cos(toRad(needleAng))).toFixed(2)}
          y1={(CY + (R - 19) * Math.sin(toRad(needleAng))).toFixed(2)}
          x2={(CX + (R + 10) * Math.cos(toRad(needleAng))).toFixed(2)}
          y2={(CY + (R + 10) * Math.sin(toRad(needleAng))).toFixed(2)}
          stroke={color}
          strokeWidth="4"
          strokeLinecap="butt"
          filter={dragging ? 'url(#gc-glow)' : undefined}
          style={{ transition: dragging ? 'none' : 'stroke 0.3s ease' }}
        />
        {/* Transparent touch target — preserves the large drag grab area */}
        <circle
          cx={tip.x.toFixed(2)} cy={tip.y.toFixed(2)}
          r="18"
          fill="transparent"
        />

        {/* ── Central readout — fraction label (⅛ ¼ … F) or % ───── */}
        <text
          x={CX} y={CY - 26}
          fontSize={label.length > 2 ? '30' : '38'}
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
          {label}
        </text>
      </svg>

      {/* ── Accessible hidden range input ──────────────────────────── */}
      <label className="sr-only">
        Current fuel level: {label}
        <input
          type="range"
          min={0}
          max={100}
          step={12.5}
          value={clampedPct}
          onChange={handleRangeChange}
          className="sr-only"
        />
      </label>

      {/* ── ⅛-step nudge buttons ───────────────────────────────────── */}
      <div className="flex items-center justify-center gap-3 -mt-1 mb-1">
        <button
          type="button"
          onClick={() => nudge(-1)}
          disabled={clampedPct <= 0}
          aria-label="Decrease fuel level by one eighth"
          className="w-9 h-9 rounded-xl bg-navy-700 text-white text-lg font-black
                     flex items-center justify-center
                     hover:bg-navy-800 active:scale-95 transition-all
                     disabled:opacity-30 disabled:pointer-events-none"
        >
          −
        </button>

        <div className="text-center min-w-[80px]">
          <p className="text-[10px] text-slate-400 font-semibold leading-tight">1/64 tank step</p>
          {gallons && (
            <p
              className="text-sm font-black leading-tight transition-colors duration-300"
              style={{ color }}
            >
              ≈ {gallons} gal
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => nudge(1)}
          disabled={clampedPct >= 100}
          aria-label="Increase fuel level by one eighth"
          className="w-9 h-9 rounded-xl bg-navy-700 text-white text-lg font-black
                     flex items-center justify-center
                     hover:bg-navy-800 active:scale-95 transition-all
                     disabled:opacity-30 disabled:pointer-events-none"
        >
          +
        </button>
      </div>

      {/* ── Drag hint ──────────────────────────────────────────────── */}
      <p
        className="text-center text-xs mt-0.5 transition-colors duration-200"
        style={{ color: dragging ? color : '#94a3b8' }}
      >
        {dragging ? t.calc.releaseToSet : t.calc.dragHint}
      </p>
    </div>
  );
}
