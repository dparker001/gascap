'use client';

import { VEHICLE_PRESETS } from '@/lib/calculations';

interface TankPresetsProps {
  value:    string;
  onChange: (gallons: string) => void;
}

export default function TankPresets({ value, onChange }: TankPresetsProps) {
  return (
    <div>
      <label className="field-label">
        Tank Size
        <span className="font-normal text-slate-400 ml-1">(gallons)</span>
      </label>

      {/* Vehicle quick-select */}
      <select
        className="input-field text-sm text-slate-600 mb-2"
        defaultValue=""
        onChange={(e) => { if (e.target.value) onChange(e.target.value); }}
        aria-label="Select a common vehicle to auto-fill tank size"
      >
        <option value="" disabled>Common vehicles — tap to auto-fill ▾</option>
        {VEHICLE_PRESETS.map((p) => (
          <option key={p.label} value={String(p.gallons)}>
            {p.label} — {p.gallons} gal
          </option>
        ))}
      </select>

      <input
        type="number"
        inputMode="decimal"
        className="input-field"
        placeholder="Or type exact size: e.g. 14.5"
        value={value}
        min="1" max="200" step="0.1"
        onChange={(e) => onChange(e.target.value)}
        aria-label="Tank capacity in gallons"
      />
    </div>
  );
}
