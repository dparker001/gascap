'use client';

import { useState, useRef } from 'react';
import { useSession } from 'next-auth/react';
import FuelGauge     from './FuelGauge';
import TankPresets   from './TankPresets';
import SavedVehicles from './SavedVehicles';
import GasPriceLookup from './GasPriceLookup';
import { TargetResultCard } from './ResultCard';
import {
  calcTargetFill,
  validateTargetFill,
  type TargetFillResult,
  type ValidationErrors,
} from '@/lib/calculations';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import type { CalcTab } from './CalculatorTabs';

// ── Types ──────────────────────────────────────────────────────────────

type FuelMode = 'percent' | 'gallons';

interface FormState {
  tankCapacity:    string;
  fuelMode:        FuelMode;
  currentFuel:     string;
  targetPreset:    number | null;
  customTarget:    string;
  pricePerGallon:  string;
  vehicleName:     string;
  vehicleId:       string;
  vehicleOdometer: number | undefined;
}

const DEFAULTS: FormState = {
  tankCapacity:    '',
  fuelMode:        'percent',
  currentFuel:     '25',
  targetPreset:    100,
  customTarget:    '',
  pricePerGallon:  '',
  vehicleName:     '',
  vehicleId:       '',
  vehicleOdometer: undefined,
};

const TARGET_PRESETS = [
  { label: '¼',    value: 25  },
  { label: '½',    value: 50  },
  { label: '¾',    value: 75  },
  { label: 'Full', value: 100 },
];

const GOAL_TABS: { id: CalcTab; emoji: string; label: string; sub: string }[] = [
  { id: 'target', emoji: '⛽', label: 'Target Fill', sub: 'Fill to a level'   },
  { id: 'budget', emoji: '💵', label: 'By Budget',   sub: 'Spend a set amount' },
];

interface Props {
  activeTab:    CalcTab;
  setActiveTab: (tab: CalcTab) => void;
}

// ── Component ──────────────────────────────────────────────────────────

export default function TargetFillForm({ activeTab, setActiveTab }: Props) {
  const { data: session }   = useSession();
  const isPro      = ['pro', 'fleet'].includes((session?.user as { plan?: string })?.plan ?? '');
  const isLoggedIn = !!session;

  const [form, setForm]   = useLocalStorage<FormState>('gc_target_v2', DEFAULTS);
  const [errors, setErrors]         = useState<ValidationErrors>({});
  const [result, setResult]         = useState<TargetFillResult | null>(null);
  const [calculated, setCalculated] = useState(false);
  const [calcKey, setCalcKey]       = useState(0);
  const [showLiveNudge, setShowLiveNudge] = useState(false);
  const [gaugeScanning, setGaugeScanning] = useState(false);
  const [gaugeScanMsg,  setGaugeScanMsg]  = useState('');
  const gaugeCamRef     = useRef<HTMLInputElement>(null);
  const gaugeGalleryRef = useRef<HTMLInputElement>(null);

  // Standard patch — clears result (free/guest behaviour)
  function patch(p: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...p }));
    if (calculated) {
      setResult(null);
      setCalculated(false);
      // Show upgrade nudge for logged-in free users
      if (isLoggedIn && !isPro) setShowLiveNudge(true);
    }
  }

  // Live recalc — Pro only. Merges update and immediately recalculates.
  function liveRecalc(p: Partial<FormState>) {
    if (!isPro || !calculated) { patch(p); return; }

    const merged = { ...form, ...p };
    setForm(merged);

    const targetPercent = merged.targetPreset !== null
      ? merged.targetPreset
      : Number(merged.customTarget);

    const input = {
      tankCapacity:       Number(merged.tankCapacity),
      fuelInputMode:      merged.fuelMode,
      currentFuelPercent: merged.fuelMode === 'percent' ? Number(merged.currentFuel) : undefined,
      currentFuelGallons: merged.fuelMode === 'gallons' ? Number(merged.currentFuel) : undefined,
      targetPercent,
      pricePerGallon:     Number(merged.pricePerGallon),
    };

    const errs = validateTargetFill(input);
    if (Object.keys(errs).length === 0) {
      setResult(calcTargetFill(input));
      setErrors({});
    }
  }

  const gaugePercent = form.fuelMode === 'percent'
    ? (isNaN(Number(form.currentFuel)) ? 0 : Number(form.currentFuel))
    : 0;

  async function handleGaugeScan(file: File) {
    setGaugeScanning(true);
    setGaugeScanMsg('');
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res  = await fetch('/api/gauge/scan', { method: 'POST', body: fd });
      const data = await res.json() as { percent?: number | null; error?: string };
      if (!res.ok) { setGaugeScanMsg(data.error ?? 'Scan failed — try again.'); return; }
      if (data.percent === null || data.percent === undefined) {
        setGaugeScanMsg('Couldn\'t read the gauge — try a clearer photo of just the fuel gauge.');
        return;
      }
      liveRecalc({ currentFuel: String(data.percent), fuelMode: 'percent' });
      setGaugeScanMsg(`✓ Detected ~${data.percent}% — drag the gauge to fine-tune.`);
    } catch {
      setGaugeScanMsg('Network error — try again.');
    } finally {
      setGaugeScanning(false);
    }
  }

  function handleCalculate() {
    const targetPercent = form.targetPreset !== null
      ? form.targetPreset
      : Number(form.customTarget);

    const input = {
      tankCapacity:       Number(form.tankCapacity),
      fuelInputMode:      form.fuelMode,
      currentFuelPercent: form.fuelMode === 'percent' ? Number(form.currentFuel) : undefined,
      currentFuelGallons: form.fuelMode === 'gallons' ? Number(form.currentFuel) : undefined,
      targetPercent,
      pricePerGallon:     Number(form.pricePerGallon),
    };

    const errs = validateTargetFill(input);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setResult(calcTargetFill(input));
    setCalculated(true);
    setShowLiveNudge(false);
    setCalcKey((k) => k + 1);
    fetch('/api/activity', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ event: 'calc' }),
    }).catch(() => {});
    setTimeout(() => {
      document.getElementById('tf-result')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
  }

  function handleReset() {
    setForm(DEFAULTS);
    setErrors({});
    setResult(null);
    setCalculated(false);
    setShowLiveNudge(false);
  }

  const isCustom = form.targetPreset === null;
  const tankNum  = Number(form.tankCapacity) || undefined;
  const isLive   = isPro && calculated;

  return (
    <div className="pb-2">

      {/* ── "How to use" eyebrow ──────────────────────────────────── */}
      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-500 mb-1 mt-2">
        How to use
      </p>

      {/* ══════════════════════════════════════════════════════════════
          STEP 1 — Pick a vehicle
      ══════════════════════════════════════════════════════════════ */}
      <StepLabel n={1} title="Pick a vehicle" />
      <div className="card">
        <TankPresets
          value={form.tankCapacity}
          onChange={(v) => patch({ tankCapacity: v })}
        />
        {errors.tankCapacity && <FieldError msg={errors.tankCapacity} />}
        <SavedVehicles
          currentGallons={form.tankCapacity}
          onSelect={(g, v) => patch({ tankCapacity: g, vehicleName: v?.name ?? '', vehicleId: v?.id ?? '', vehicleOdometer: v?.currentOdometer })}
          selectedVehicleId={form.vehicleId}
          calcKey={calcKey}
        />
      </div>

      {/* ══════════════════════════════════════════════════════════════
          STEP 2 — Set fuel level
      ══════════════════════════════════════════════════════════════ */}
      <StepLabel n={2} title="Set fuel level" />
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <p className="field-label mb-0">Current Fuel Level</p>
            {/* ⚡ Live badge — Pro only, shown once calculated */}
            {isLive && (
              <span className="text-[9px] font-black bg-amber-500 text-white px-1.5 py-0.5 rounded-full leading-none">
                ⚡ LIVE
              </span>
            )}
          </div>
          <div className="flex gap-1.5">
            <ModeBtn label="%" active={form.fuelMode === 'percent'}
              onClick={() => patch({ fuelMode: 'percent', currentFuel: '25' })} />
            <ModeBtn label="Gal" active={form.fuelMode === 'gallons'}
              onClick={() => patch({ fuelMode: 'gallons', currentFuel: '' })} />
          </div>
        </div>

        {form.fuelMode === 'percent' ? (
          <>
            <FuelGauge
              percent={gaugePercent}
              onChange={(pct) => liveRecalc({ currentFuel: String(pct) })}
              tankCapacity={tankNum}
            />

            {/* ── Gauge scan inputs (hidden) ── */}
            <input type="file" accept="image/*" capture="environment"
              ref={gaugeCamRef} className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleGaugeScan(f); e.target.value = ''; }}
            />
            <input type="file" accept="image/*"
              ref={gaugeGalleryRef} className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleGaugeScan(f); e.target.value = ''; }}
            />

            {/* ── Scan gauge buttons ── */}
            <div className="mt-2 space-y-1.5">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => { setGaugeScanMsg(''); gaugeCamRef.current?.click(); }}
                  disabled={gaugeScanning}
                  className="flex items-center gap-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2 hover:border-amber-300 hover:text-amber-700 transition-colors disabled:opacity-50"
                >
                  <span>{gaugeScanning ? '🔄' : '📷'}</span>
                  <span>{gaugeScanning ? 'Reading gauge…' : 'Scan Gauge'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setGaugeScanMsg(''); gaugeGalleryRef.current?.click(); }}
                  disabled={gaugeScanning}
                  className="flex items-center gap-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2 hover:border-amber-300 hover:text-amber-700 transition-colors disabled:opacity-50"
                >
                  <span>🖼️</span>
                  <span>Upload Photo</span>
                </button>
              </div>
              {gaugeScanMsg && (
                <p className={`text-[11px] font-medium leading-snug ${gaugeScanMsg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>
                  {gaugeScanMsg}
                </p>
              )}
              <p className="text-[10px] text-slate-400 leading-relaxed">
                📸 Point your camera at the fuel gauge on your dashboard — AI will read the needle and set your level automatically.
              </p>
            </div>
          </>
        ) : (
          <div className="relative">
            <input
              type="number" inputMode="decimal"
              className={errors.currentFuel ? 'input-field-error' : 'input-field'}
              placeholder="e.g. 4.5"
              value={form.currentFuel}
              min="0" step="0.1"
              onChange={(e) => patch({ currentFuel: e.target.value })}
              onBlur={(e)  => liveRecalc({ currentFuel: e.target.value })}
              aria-label="Current fuel in gallons"
            />
            <Unit>gal</Unit>
          </div>
        )}
        {errors.currentFuel && <FieldError msg={errors.currentFuel} />}

        {/* Free user upgrade nudge */}
        {showLiveNudge && !isPro && isLoggedIn && (
          <a href="/upgrade"
             className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-amber-600 hover:text-amber-500 transition-colors">
            <span className="text-xs bg-amber-100 rounded-full px-1.5 py-0.5">⚡</span>
            Live recalculation is a Pro feature — Upgrade to Pro
          </a>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════
          STEP 3 — Choose a goal
      ══════════════════════════════════════════════════════════════ */}
      <StepLabel n={3} title="Choose a goal" />

      {/* Goal type tab switcher */}
      <div className="flex gap-2 mb-4">
        {GOAL_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              aria-selected={isActive}
              className={[
                'flex-1 flex flex-col items-center py-3 px-3 rounded-2xl border-2',
                'transition-all duration-200 focus:outline-none focus-visible:ring-2',
                'focus-visible:ring-amber-400 focus-visible:ring-offset-2',
                isActive
                  ? 'bg-white border-amber-500 shadow-card'
                  : 'bg-white/60 border-transparent hover:bg-white hover:border-slate-200',
              ].join(' ')}
            >
              <span className="text-xl mb-0.5" aria-hidden="true">{tab.emoji}</span>
              <span className={`text-sm font-bold leading-none ${isActive ? 'text-amber-600' : 'text-slate-500'}`}>
                {tab.label}
              </span>
              <span className="text-[10px] text-slate-400 mt-1 leading-none">{tab.sub}</span>
              {isActive && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5" aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      {/* Target fill level selector */}
      <div className="card">
        <p className="field-label">Fill Up To</p>
        <div className="flex gap-2 mb-3">
          {TARGET_PRESETS.map((p) => (
            <button
              key={p.value}
              className={form.targetPreset === p.value ? 'btn-preset-active' : 'btn-preset-inactive'}
              onClick={() => liveRecalc({ targetPreset: p.value, customTarget: '' })}
              aria-pressed={form.targetPreset === p.value}
            >
              {p.label}
            </button>
          ))}
          <button
            className={isCustom ? 'btn-preset-active' : 'btn-preset-inactive'}
            onClick={() => patch({ targetPreset: null })}
            aria-pressed={isCustom}
          >
            Custom
          </button>
        </div>

        {isCustom && (
          <div className="relative">
            <input
              type="number" inputMode="decimal"
              className={errors.targetPercent ? 'input-field-error' : 'input-field'}
              placeholder="e.g. 60"
              value={form.customTarget}
              min="1" max="100" step="1"
              autoFocus
              onChange={(e) => patch({ customTarget: e.target.value })}
              onBlur={(e)  => liveRecalc({ customTarget: e.target.value })}
              aria-label="Custom target fill percentage"
            />
            <Unit>%</Unit>
          </div>
        )}
        {errors.targetPercent && <FieldError msg={errors.targetPercent} />}
        {/* Smart hint: target is already met */}
        {!errors.targetPercent && (() => {
          const curr   = form.fuelMode === 'percent' ? Number(form.currentFuel) : 0;
          const target = form.targetPreset !== null ? form.targetPreset : Number(form.customTarget);
          if (target > 0 && curr >= target) {
            return (
              <p className="mt-2 text-xs text-green-700 bg-green-50 border border-green-200
                            rounded-xl px-3 py-2 flex items-center gap-1.5">
                <span>✅</span>
                Your tank is already at or above {target}% — no fill-up needed!
              </p>
            );
          }
          return null;
        })()}
      </div>

      {/* ══════════════════════════════════════════════════════════════
          STEP 4 — Get the answer
      ══════════════════════════════════════════════════════════════ */}
      <StepLabel n={4} title="Get the answer" />

      {/* Gas price */}
      <div className="card mb-4">
        <p className="field-label">Gas Price per Gallon</p>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-semibold pointer-events-none">$</span>
          <input
            type="number" inputMode="decimal"
            className={`${errors.pricePerGallon ? 'input-field-error' : 'input-field'} pl-8`}
            placeholder="e.g. 3.49"
            value={form.pricePerGallon}
            min="0.01" step="0.01"
            onChange={(e) => patch({ pricePerGallon: e.target.value })}
            onBlur={(e)  => liveRecalc({ pricePerGallon: e.target.value })}
            aria-label="Gas price per gallon"
          />
        </div>
        {errors.pricePerGallon && <FieldError msg={errors.pricePerGallon} />}
        <GasPriceLookup onApply={(p) => liveRecalc({ pricePerGallon: p })} />
      </div>

      <button className="btn-amber" onClick={handleCalculate}>Calculate ⚡</button>
      <button className="btn-secondary" onClick={handleReset}>Clear all</button>

      <div id="tf-result">
        {result && (
          <TargetResultCard
            result={result}
            vehicleName={form.vehicleName || undefined}
            vehicleId={form.vehicleId   || undefined}
            vehicleOdometer={form.vehicleOdometer}
            fuelLevelBefore={
              form.fuelMode === 'percent' ? Number(form.currentFuel) : undefined
            }
          />
        )}
      </div>
    </div>
  );
}

// ── Shared sub-components ──────────────────────────────────────────────

function StepLabel({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2.5 mt-5 mb-2">
      <span className="w-6 h-6 rounded-full bg-navy-700 text-white text-[11px] font-black
                       flex items-center justify-center flex-shrink-0 shadow-sm">
        {n}
      </span>
      <span className="text-sm font-bold text-slate-600">{title}</span>
    </div>
  );
}

function FieldError({ msg }: { msg: string }) {
  return (
    <p className="mt-2 text-sm text-red-500 flex items-center gap-1.5" role="alert">
      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
      </svg>
      {msg}
    </p>
  );
}

function ModeBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={active ? 'btn-mode-active' : 'btn-mode-inactive'} aria-pressed={active}>
      {label}
    </button>
  );
}

function Unit({ children }: { children: string }) {
  return (
    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">
      {children}
    </span>
  );
}
