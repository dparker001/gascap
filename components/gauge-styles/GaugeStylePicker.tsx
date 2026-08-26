'use client';

import { GAUGE_STYLES, type GaugeStyle } from '@/lib/gaugeStyles';
import { useTranslation } from '@/contexts/LanguageContext';
import GaugeStylePreview from './GaugeStylePreview';

/**
 * Shared compact picker row — a horizontally-scrollable set of live-preview
 * cards, one per canonical GaugeStyle, used by the vehicle edit form
 * (components/SavedVehicles.tsx), Rental Return Mode's gauge shortcut, and
 * (Phase 4B) Settings → Preferences, so all three surfaces present
 * identical options with identical previews and localized labels.
 *
 * Phase 4B — `value` is nullable and an optional "Use Global Default" card
 * is shown first when `allowInherit` is set (vehicle/rental pickers only;
 * Settings itself has no further level to inherit from, so it omits this).
 * Selecting a card is purely a local callback — this component never makes
 * an API call itself; the caller owns persistence.
 */
export default function GaugeStylePicker({
  value, onSelect, allowInherit = false,
}: {
  value: GaugeStyle | null;
  onSelect: (style: GaugeStyle | null) => void;
  allowInherit?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {allowInherit && (
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={[
            'flex-shrink-0 w-20 rounded-lg border-2 px-1.5 py-1.5 text-center transition-colors flex flex-col items-center justify-center',
            value === null ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-white',
          ].join(' ')}
        >
          <span className="text-2xl leading-none" aria-hidden="true">↩︎</span>
          <p className="text-[9px] font-bold text-slate-500 mt-1 leading-tight">
            {t.gaugeStyles.useGlobalDefault}
          </p>
        </button>
      )}
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
            {t.gaugeStyles[s]}
          </p>
        </button>
      ))}
    </div>
  );
}
