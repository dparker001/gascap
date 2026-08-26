'use client';

/**
 * Gauge / percent / gallons fuel-level entry. Shared by the setup flow, the
 * dashboard's "update current fuel", and the edit modal's pickup-fuel
 * correction, so all three agree on how a level is entered and which
 * FuelDataSource gets recorded.
 *
 * Phase 4 (2026-08-25): "gauge" mode now renders the canonical FuelGauge
 * shell (the same interactive dial/bars/marks used everywhere else in the
 * app) instead of a fixed 9-button eighth-fraction grid. Percent and
 * gallons modes are unchanged — both remain available as fallback entry
 * methods, per the explicit requirement that a rental gauge-style choice
 * never reduces or removes them.
 */

import { useState } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';
import { gallonsFromPercent } from '@/lib/rentalProvider';
import type { FuelDataSource } from '@/lib/rentalProvider';
import { DEFAULT_GAUGE_STYLE, type GaugeStyle } from '@/lib/gaugeStyles';
import FuelGauge from '../FuelGauge';
import GaugeStylePicker from '../gauge-styles/GaugeStylePicker';

export type FuelInputMethod = 'gauge' | 'percent' | 'gallons';

export function resolveFuelLevel(
  method: FuelInputMethod,
  gaugePercent: number | null,
  percent: string,
  gallons: string,
  tankCapacity: number,
): { gallons: number; source: FuelDataSource } | null {
  if (method === 'gauge') {
    if (gaugePercent == null) return null;
    const g = gallonsFromPercent(gaugePercent, tankCapacity);
    return g != null ? { gallons: g, source: 'MANUAL_GAUGE' } : null;
  }
  if (method === 'percent') {
    const g = gallonsFromPercent(Number(percent), tankCapacity);
    return g != null ? { gallons: g, source: 'MANUAL_PERCENT' } : null;
  }
  const g = Number(gallons);
  return g > 0 ? { gallons: g, source: 'MANUAL_GALLONS' } : null;
}

export default function FuelLevelInput({
  tankCapacity,
  onResolved,
  compact = false,
  gaugeStyle = DEFAULT_GAUGE_STYLE,
  /** Provided only by callers that already have a RentalSession to persist
   *  a style change to (the dashboard, the edit modal). Omitted during
   *  initial setup, when no session id exists yet — the shortcut simply
   *  doesn't render in that case. */
  onChangeGaugeStyle,
}: {
  tankCapacity: number;
  onResolved: (result: { gallons: number; source: FuelDataSource } | null) => void;
  compact?: boolean;
  gaugeStyle?: GaugeStyle;
  onChangeGaugeStyle?: (style: GaugeStyle) => void;
}) {
  const { t } = useTranslation();
  const [method, setMethod]   = useState<FuelInputMethod>('gauge');
  // No pre-selected reading. Defaulting to a nonzero value meant the control
  // always resolved to a real number, so simply opening this form produced a
  // fuel level the user never entered.
  const [gaugePercent, setGaugePercent] = useState<number | null>(null);
  const [percent, setPercent] = useState('');
  const [gallons, setGallons] = useState('');
  const [showStylePicker, setShowStylePicker] = useState(false);

  function emit(m: FuelInputMethod, gp: number | null, p: string, gal: string) {
    onResolved(resolveFuelLevel(m, gp, p, gal, tankCapacity));
  }

  const btn = compact ? 'py-1.5 text-[11px]' : 'py-2 text-xs';

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        {(['gauge', 'percent', 'gallons'] as FuelInputMethod[]).map((m) => (
          <button
            key={m} type="button"
            onClick={() => { setMethod(m); emit(m, gaugePercent, percent, gallons); }}
            className={`flex-1 rounded-lg font-bold border ${btn} ${
              method === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-200 text-slate-600'
            }`}
          >
            {m === 'gauge' ? t.rentalReturn.methodGauge : m === 'percent' ? t.rentalReturn.methodPercent : t.rentalReturn.methodGallons}
          </button>
        ))}
      </div>

      {method === 'gauge' && (
        <div>
          <FuelGauge
            percent={gaugePercent ?? 0}
            onChange={(pct) => { setGaugePercent(pct); emit('gauge', pct, percent, gallons); }}
            tankCapacity={tankCapacity}
            style={gaugeStyle}
          />
          {onChangeGaugeStyle && (
            <button
              type="button"
              onClick={() => setShowStylePicker((v) => !v)}
              className="w-full text-center text-[11px] font-bold text-blue-600 hover:text-blue-800 mt-1"
            >
              {t.rentalReturn.changeGaugeStyle}
            </button>
          )}
          {showStylePicker && onChangeGaugeStyle && (
            <div className="mt-2">
              <GaugeStylePicker
                value={gaugeStyle}
                onSelect={(s) => { onChangeGaugeStyle(s); setShowStylePicker(false); }}
              />
            </div>
          )}
        </div>
      )}
      {method === 'percent' && (
        <input
          type="number" inputMode="decimal" min="0" max="100" placeholder="95"
          value={percent}
          onChange={(e) => { setPercent(e.target.value); emit('percent', gaugePercent, e.target.value, gallons); }}
          className="input-field"
        />
      )}
      {method === 'gallons' && (
        <input
          type="number" inputMode="decimal" min="0" step="0.1" placeholder="14.1"
          value={gallons}
          onChange={(e) => { setGallons(e.target.value); emit('gallons', gaugePercent, percent, e.target.value); }}
          className="input-field"
        />
      )}
    </div>
  );
}
