'use client';

/**
 * Gauge / percent / gallons fuel-level entry. Shared by the setup flow, the
 * dashboard's "update current fuel", and the edit modal's pickup-fuel
 * correction, so all three agree on how a level is entered and which
 * FuelDataSource gets recorded.
 */

import { useState } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';
import { gallonsFromGaugeFraction, gallonsFromPercent } from '@/lib/rentalProvider';
import type { FuelDataSource } from '@/lib/rentalProvider';

const GAUGE_OPTIONS = ['Full', '7/8', '3/4', '5/8', '1/2', '3/8', '1/4', '1/8', 'Empty'];

export type FuelInputMethod = 'gauge' | 'percent' | 'gallons';

export function resolveFuelLevel(
  method: FuelInputMethod,
  gauge: string,
  percent: string,
  gallons: string,
  tankCapacity: number,
): { gallons: number; source: FuelDataSource } | null {
  if (method === 'gauge') {
    const g = gallonsFromGaugeFraction(gauge, tankCapacity);
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
}: {
  tankCapacity: number;
  onResolved: (result: { gallons: number; source: FuelDataSource } | null) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [method, setMethod]   = useState<FuelInputMethod>('gauge');
  // No pre-selected reading. Defaulting to 'Full' meant the control always
  // resolved to a real number, so simply opening this form produced a fuel
  // level the user never entered.
  const [gauge, setGauge]     = useState('');
  const [percent, setPercent] = useState('');
  const [gallons, setGallons] = useState('');

  function emit(m: FuelInputMethod, g: string, p: string, gal: string) {
    onResolved(resolveFuelLevel(m, g, p, gal, tankCapacity));
  }

  const btn = compact ? 'py-1.5 text-[11px]' : 'py-2 text-xs';

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        {(['gauge', 'percent', 'gallons'] as FuelInputMethod[]).map((m) => (
          <button
            key={m} type="button"
            onClick={() => { setMethod(m); emit(m, gauge, percent, gallons); }}
            className={`flex-1 rounded-lg font-bold border ${btn} ${
              method === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-200 text-slate-600'
            }`}
          >
            {m === 'gauge' ? t.rentalReturn.methodGauge : m === 'percent' ? t.rentalReturn.methodPercent : t.rentalReturn.methodGallons}
          </button>
        ))}
      </div>

      {method === 'gauge' && (
        <div className="grid grid-cols-3 gap-1.5">
          {GAUGE_OPTIONS.map((g) => (
            <button
              key={g} type="button"
              onClick={() => { setGauge(g); emit('gauge', g, percent, gallons); }}
              className={`rounded-lg font-bold border ${btn} ${
                gauge === g ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-200 text-slate-700'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      )}
      {method === 'percent' && (
        <input
          type="number" inputMode="decimal" min="0" max="100" placeholder="95"
          value={percent}
          onChange={(e) => { setPercent(e.target.value); emit('percent', gauge, e.target.value, gallons); }}
          className="input-field"
        />
      )}
      {method === 'gallons' && (
        <input
          type="number" inputMode="decimal" min="0" step="0.1" placeholder="14.1"
          value={gallons}
          onChange={(e) => { setGallons(e.target.value); emit('gallons', gauge, percent, e.target.value); }}
          className="input-field"
        />
      )}
    </div>
  );
}
