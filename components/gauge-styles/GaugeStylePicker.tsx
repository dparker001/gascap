'use client';

import { GAUGE_STYLES, GAUGE_STYLE_LABELS, type GaugeStyle } from '@/lib/gaugeStyles';
import GaugeStylePreview from './GaugeStylePreview';

/**
 * Shared compact picker row — a horizontally-scrollable set of live-preview
 * cards, one per canonical GaugeStyle. Used by both the vehicle edit form
 * (components/SavedVehicles.tsx) and the Rental Return Mode gauge shortcut,
 * so both surfaces present identical options with identical previews.
 * Selecting a card is purely a local callback — this component never makes
 * an API call itself; the caller owns persistence (Vehicle vs. RentalSession).
 */
export default function GaugeStylePicker({ value, onSelect }: { value: GaugeStyle; onSelect: (style: GaugeStyle) => void }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {GAUGE_STYLES.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onSelect(s)}
          className={[
            'flex-shrink-0 w-20 rounded-lg border-2 px-1.5 py-1.5 text-center transition-colors',
            value === s ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-white',
          ].join(' ')}
        >
          <GaugeStylePreview style={s} percent={62} />
          <p className="text-[9px] font-bold text-slate-500 mt-0.5 leading-tight">
            {GAUGE_STYLE_LABELS[s]}
          </p>
        </button>
      ))}
    </div>
  );
}
