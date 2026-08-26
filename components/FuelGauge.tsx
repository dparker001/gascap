'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';
import { hapticLight, hapticMedium } from '@/lib/haptics';
import { type GaugeStyle, DEFAULT_GAUGE_STYLE, GAUGE_POINTER_MAP, snapToEighth, GAUGE_NUDGE_STEP } from '@/lib/gaugeStyles';
import { GAUGE_RENDERERS } from './gauge-styles/registry';

/**
 * GasCap™ fuel gauge — interaction/value SHELL (Phase 4 refactor, 2026-08-25).
 *
 * This component owns 100% of: pointer/drag, click/tap, snap-to-⅛,
 * ±1/64-tank nudge, keyboard (hidden range input), ARIA/accessible labeling,
 * haptics, and the percent/gallons readout text. It NEVER delegates any of
 * that to a style renderer — renderers below (components/gauge-styles/*)
 * receive only {percent, color, dragging, label} and draw pure SVG. This is
 * the enforcement point for the core invariant: gauge STYLE is presentation
 * only, and every style shares the exact same value/precision/snap/nudge
 * semantics. See __tests__/gaugeStyleParity.test.ts for the regression proof
 * that switching `style` never changes what `onChange` reports for a given
 * input.
 */

function levelColor(p: number): string {
  if (p < 0.25) return '#ef4444';
  if (p < 0.55) return '#f59e0b';
  return '#22c55e';
}

const EIGHTH_LABELS = ['E', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞', 'F'];

function fuelLabel(pct: number): string {
  const idx = Math.round(pct / 12.5);
  const snapped = idx * 12.5;
  if (Math.abs(pct - snapped) < 0.5) {
    return EIGHTH_LABELS[Math.max(0, Math.min(8, idx))];
  }
  return `${Math.round(pct)}%`;
}

interface FuelGaugeProps {
  /** Current fill level, 0–100 */
  percent: number;
  /** Called with the new percent value (drag snaps to nearest ⅛; nudge moves in 1/64 steps) */
  onChange: (pct: number) => void;
  /** Optional tank size in gallons — shows secondary readout when set */
  tankCapacity?: number;
  /** Visual style only — defaults to the original GasCap analog gauge so
   *  every existing caller (and every vehicle/rental with no stored
   *  preference) renders identically to before Phase 4. */
  style?: GaugeStyle;
}

export default function FuelGauge({ percent, onChange, tankCapacity, style = DEFAULT_GAUGE_STYLE }: FuelGaugeProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const active     = useRef(false);
  const lastSnap   = useRef<number>(-1);
  const [dragging, setDragging] = useState(false);

  const clampedPct = Math.max(0, Math.min(100, isNaN(percent) ? 0 : percent));
  const color = levelColor(clampedPct / 100);
  const label = fuelLabel(clampedPct);

  // ── Pointer → snapped-to-⅛ percent (same for every style; only the raw
  //    geometry mapping in GAUGE_POINTER_MAP differs by shape) ────────────
  const processPointer = useCallback(
    (clientX: number, clientY: number) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const relX = (clientX - rect.left) / rect.width;
      const relY = (clientY - rect.top) / rect.height;
      const raw = GAUGE_POINTER_MAP[style](relX, relY);
      const snapped = snapToEighth(raw);
      if (snapped !== lastSnap.current) {
        lastSnap.current = snapped;
        hapticLight();
      }
      onChange(snapped);
    },
    [onChange, style],
  );

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

  const handleRangeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(snapToEighth(Number(e.target.value)));
  };

  function nudge(dir: 1 | -1) {
    const currentStep = Math.round(clampedPct / GAUGE_NUDGE_STEP);
    const newStep     = Math.max(0, Math.min(64, currentStep + dir));
    hapticMedium();
    onChange(parseFloat((newStep * GAUGE_NUDGE_STEP).toFixed(6)));
  }

  const gallons = tankCapacity ? (tankCapacity * (clampedPct / 100)).toFixed(1) : null;
  const Renderer = GAUGE_RENDERERS[style];

  return (
    // data-noswipe: this is a drag control — don't let the native shell's
    // swipe-between-tabs gesture hijack a gauge drag.
    <div data-noswipe className="relative select-none w-full">
      <div
        ref={containerRef}
        aria-hidden="true"
        style={{ touchAction: 'none', cursor: dragging ? 'grabbing' : 'grab' }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          active.current = true;
          setDragging(true);
          processPointer(e.clientX, e.clientY);
        }}
      >
        <Renderer percent={clampedPct} color={color} dragging={dragging} label={label} />
      </div>

      {/* ── Accessible hidden range input — identical for every style ──── */}
      <label className="sr-only">
        {t.calc.currentFuelLevel}: {label}
        <input
          type="range"
          min={0}
          max={100}
          step={12.5}
          value={clampedPct}
          onChange={handleRangeChange}
          aria-valuenow={clampedPct}
          aria-valuetext={`${label} (${Math.round(clampedPct)}%)`}
          className="sr-only"
        />
      </label>

      {/* ── ⅛-step nudge buttons — identical for every style ───────────── */}
      <div className="flex items-center justify-center gap-3 -mt-1 mb-1">
        <button
          type="button"
          onClick={() => nudge(-1)}
          disabled={clampedPct <= 0}
          aria-label={t.calc.decreaseFuel}
          className="w-9 h-9 rounded-xl bg-navy-700 text-white text-lg font-black
                     flex items-center justify-center
                     hover:bg-navy-800 active:scale-95 transition-all
                     disabled:opacity-30 disabled:pointer-events-none"
        >
          −
        </button>

        <div className="text-center min-w-[80px]">
          <p className="text-[10px] text-slate-400 font-semibold leading-tight">{t.calc.tankStep}</p>
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
          aria-label={t.calc.increaseFuel}
          className="w-9 h-9 rounded-xl bg-navy-700 text-white text-lg font-black
                     flex items-center justify-center
                     hover:bg-navy-800 active:scale-95 transition-all
                     disabled:opacity-30 disabled:pointer-events-none"
        >
          +
        </button>
      </div>

      <p
        className="text-center text-xs mt-0.5 transition-colors duration-200"
        style={{ color: dragging ? color : '#94a3b8' }}
      >
        {dragging ? t.calc.releaseToSet : t.calc.dragHint}
      </p>
    </div>
  );
}
