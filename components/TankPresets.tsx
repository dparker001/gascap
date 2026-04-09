'use client';

import { VEHICLE_PRESETS } from '@/lib/calculations';
import { useTranslation } from '@/contexts/LanguageContext';

// Typical rental fleet tank sizes by class
const RENTAL_PRESETS = [
  { label: 'Economy rental (e.g. Nissan Versa)',      gallons: 10.8 },
  { label: 'Compact rental (e.g. Toyota Corolla)',    gallons: 13.2 },
  { label: 'Midsize rental (e.g. Toyota Camry)',      gallons: 15.9 },
  { label: 'Full-size rental (e.g. Chevy Malibu)',    gallons: 15.5 },
  { label: 'Small SUV rental (e.g. Toyota RAV4)',     gallons: 14.5 },
  { label: 'Midsize SUV rental (e.g. Ford Explorer)', gallons: 18.0 },
  { label: 'Minivan rental (e.g. Chrysler Pacifica)', gallons: 19.8 },
  { label: 'Pickup rental (e.g. Ford F-150)',         gallons: 26.0 },
];

interface TankPresetsProps {
  value:         string;
  onChange:      (gallons: string) => void;
  rentalMode?:   boolean;
}

export default function TankPresets({ value, onChange, rentalMode }: TankPresetsProps) {
  const { t } = useTranslation();
  return (
    <div>
      <label className="field-label">
        {t.tankPresets.label}
        <span className="font-normal text-slate-400 ml-1">{t.tankPresets.unit}</span>
      </label>

      {/* Vehicle quick-select */}
      <select
        className="input-field text-sm text-slate-600 mb-2"
        defaultValue=""
        onChange={(e) => { if (e.target.value) onChange(e.target.value); }}
        aria-label="Select a common vehicle to auto-fill tank size"
      >
        <option value="" disabled>{t.tankPresets.selectPlaceholder}</option>

        {/* Rental car class group — shown first when in rental mode */}
        {rentalMode && (
          <optgroup label={t.tankPresets.rentalClasses}>
            {RENTAL_PRESETS.map((p) => (
              <option key={p.label} value={String(p.gallons)}>
                {p.label} — {p.gallons} gal
              </option>
            ))}
          </optgroup>
        )}

        <optgroup label={t.tankPresets.myVehicles}>
          {VEHICLE_PRESETS.map((p) => (
            <option key={p.label} value={String(p.gallons)}>
              {p.label} — {p.gallons} gal
            </option>
          ))}
        </optgroup>

        {/* Rental car group also visible in normal mode, at bottom */}
        {!rentalMode && (
          <optgroup label={t.tankPresets.rentalClasses}>
            {RENTAL_PRESETS.map((p) => (
              <option key={p.label} value={String(p.gallons)}>
                {p.label} — {p.gallons} gal
              </option>
            ))}
          </optgroup>
        )}
      </select>

      <input
        type="number"
        inputMode="decimal"
        className="input-field"
        placeholder={t.tankPresets.typePlaceholder}
        value={value}
        min="1" max="200" step="0.1"
        onChange={(e) => onChange(e.target.value)}
        aria-label="Tank capacity in gallons"
      />
    </div>
  );
}
