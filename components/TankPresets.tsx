'use client';

import { useState } from 'react';
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
  value:             string;
  onChange:          (gallons: string) => void;
  /** Fired when the user picks from the dropdown (not when typing or garage-selecting). */
  onPresetSelect?:   (gallons: string, label: string) => void;
  rentalMode?:       boolean;
  /**
   * Badge shown below the tank-size field to clarify where the value came from.
   * Pass the garage vehicle name or the preset label — the component chooses the icon.
   * Pass '' or undefined to hide the badge.
   */
  vehicleSourceLabel?: string;
  /** When 'garage', uses a green badge; when 'preset', uses a slate badge. */
  vehicleSourceType?:  'garage' | 'preset';
}

export default function TankPresets({
  value,
  onChange,
  onPresetSelect,
  rentalMode,
  vehicleSourceLabel,
  vehicleSourceType,
}: TankPresetsProps) {
  const { t } = useTranslation();

  // Track which preset option is currently selected so the dropdown shows it
  const [selectedPreset, setSelectedPreset] = useState('');

  // When a garage vehicle is loaded externally, reset the dropdown selection
  // (the parent clears vehicleSourceType to 'garage' at that point)

  function handleDropdownChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    if (!val) return;

    // Find the full label text
    const allPresets = [...VEHICLE_PRESETS, ...RENTAL_PRESETS];
    const found = allPresets.find((p) => String(p.gallons) === val);
    const label = found ? found.label : val;

    setSelectedPreset(val);
    onChange(val);
    onPresetSelect?.(val, label);
  }

  return (
    <div>
      <label className="field-label">
        {t.tankPresets.label}
        <span className="font-normal text-slate-400 ml-1">{t.tankPresets.unit}</span>
      </label>

      {/* Vehicle quick-select — controlled so the selected option stays visible */}
      <select
        className="input-field text-sm text-slate-600 mb-2"
        value={vehicleSourceType === 'garage' ? '' : selectedPreset}
        onChange={handleDropdownChange}
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
        onChange={(e) => {
          setSelectedPreset(''); // typing clears the dropdown selection
          onChange(e.target.value);
        }}
        aria-label="Tank capacity in gallons"
      />

      {/* Source badge — clarifies whether the tank size came from the garage or a preset */}
      {vehicleSourceLabel && (
        <p className={[
          'mt-1.5 text-[10px] font-semibold leading-snug px-2.5 py-1 rounded-lg inline-flex items-center gap-1.5',
          vehicleSourceType === 'garage'
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            : 'bg-slate-100 text-slate-500 border border-slate-200',
        ].join(' ')}>
          <span aria-hidden="true">{vehicleSourceType === 'garage' ? '🚗' : '📋'}</span>
          {vehicleSourceType === 'garage' ? 'From garage: ' : 'From list: '}
          <span className="font-bold truncate max-w-[200px]">{vehicleSourceLabel}</span>
        </p>
      )}
    </div>
  );
}
