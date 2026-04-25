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
import { useTranslation } from '@/contexts/LanguageContext';

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
  currentFuel:     '0',
  targetPreset:    100,
  customTarget:    '',
  pricePerGallon:  '',
  vehicleName:     '',
  vehicleId:       '',
  vehicleOdometer: undefined,
};

// Note: "Full" label is localized inside the component via t.calc.presetFull
const TARGET_PRESET_VALUES: { label: string; value: number }[] = [
  { label: '¼', value: 25  },
  { label: '½', value: 50  },
  { label: '¾', value: 75  },
];


interface Props {
  activeTab:    CalcTab;
  setActiveTab: (tab: CalcTab) => void;
}

// ── Component ──────────────────────────────────────────────────────────

export default function TargetFillForm({ activeTab, setActiveTab }: Props) {
  const { data: session }   = useSession();
  const { t }               = useTranslation();
  const isPro      = ['pro', 'fleet'].includes((session?.user as { plan?: string })?.plan ?? '');
  const isLoggedIn = !!session;

  const GOAL_TABS: { id: CalcTab; emoji: string; label: string; sub: string }[] = [
    { id: 'target', emoji: '⛽', label: t.calc.targetFillLabel, sub: t.calc.targetFillSub },
    { id: 'budget', emoji: '💵', label: t.calc.byBudgetLabel,   sub: t.calc.byBudgetSub  },
  ];

  const TARGET_PRESETS = [
    ...TARGET_PRESET_VALUES,
    { label: t.calc.presetFull, value: 100 },
  ];

  const [form, setForm]   = useLocalStorage<FormState>('gc_target_v2', DEFAULTS);
  const [errors, setErrors]         = useState<ValidationErrors>({});
  const [result, setResult]         = useState<TargetFillResult | null>(null);
  const [calculated, setCalculated] = useState(false);
  const [calcKey, setCalcKey]       = useState(0);
  const [showLiveNudge, setShowLiveNudge] = useState(false);
  const [gaugeScanning, setGaugeScanning] = useState(false);
  const [gaugeScanMsg,  setGaugeScanMsg]  = useState('');
  const [rentalMode,    setRentalMode]    = useState(false);
  const [rentalRate,    setRentalRate]    = useState('');
  const gaugeCamRef     = useRef<HTMLInputElement>(null);
  const gaugeGalleryRef = useRef<HTMLInputElement>(null);
  const calcStartFired  = useRef(false);

  // Standard patch — clears result (free/guest behaviour)
  function patch(p: Partial<FormState>) {
    // QR placard pilot — fire calc_start the first time the user touches the form
    if (!calcStartFired.current && typeof window !== 'undefined' && typeof window.gcTrack === 'function') {
      calcStartFired.current = true;
      window.gcTrack('calc_start', { mode: 'target_fill' });
    }
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
      const res  = await fetch('/api/gauge/scan', { method: 'POST', body: fd, credentials: 'include' });
      const data = await res.json() as { percent?: number | null; error?: string };
      if (!res.ok) { setGaugeScanMsg(data.error ?? t.calc.scanFailed); return; }
      if (data.percent === null || data.percent === undefined) {
        setGaugeScanMsg(t.calc.scanNotReadable);
        return;
      }
      liveRecalc({ currentFuel: String(data.percent), fuelMode: 'percent' });
      setGaugeScanMsg(t.calc.scanDetected(data.percent));
    } catch {
      setGaugeScanMsg(t.calc.scanNetworkError);
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
    // QR placard pilot — credit calc completion to attribution placement (no-op if not attributed)
    if (typeof window !== 'undefined' && typeof window.gcTrack === 'function') {
      window.gcTrack('calc_complete', { mode: 'target_fill' });
    }
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
        {t.calc.howToUse}
      </p>

      {/* ── Rental car mode toggle ───────────────────────────────── */}
      <button
        type="button"
        onClick={() => {
          const next = !rentalMode;
          setRentalMode(next);
          // Auto-set target to Full when entering rental mode
          if (next) liveRecalc({ targetPreset: 100, customTarget: '' });
        }}
        className={[
          'w-full flex items-center gap-3 rounded-2xl px-4 py-3 mb-3 border-2 transition-all',
          rentalMode
            ? 'bg-blue-50 border-blue-400 text-blue-800'
            : 'bg-white border-slate-200 hover:border-blue-300 text-slate-600',
        ].join(' ')}
        aria-pressed={rentalMode}
      >
        <span className="text-xl flex-shrink-0" aria-hidden="true">🚗</span>
        <div className="flex-1 text-left">
          <p className={`text-sm font-black leading-none ${rentalMode ? 'text-blue-800' : 'text-slate-700'}`}>
            {t.calc.rentalModeTitle}
          </p>
          <p className={`text-[10px] mt-0.5 leading-snug ${rentalMode ? 'text-blue-600' : 'text-slate-400'}`}>
            {rentalMode ? t.calc.rentalModeActive : t.calc.rentalModeInactive}
          </p>
        </div>
        <div className={[
          'w-9 h-5 rounded-full flex-shrink-0 relative transition-colors',
          rentalMode ? 'bg-blue-500' : 'bg-slate-200',
        ].join(' ')}>
          <div className={[
            'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
            rentalMode ? 'translate-x-4' : 'translate-x-0.5',
          ].join(' ')} />
        </div>
      </button>

      {/* Rental rate input — only when rental mode is on */}
      {rentalMode && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3 mb-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-base" aria-hidden="true">🏢</span>
            <p className="text-xs font-black text-blue-800">{t.calc.rentalRateLabel}</p>
            <span className="text-[10px] text-blue-500 font-medium">{t.calc.rentalRateOptional}</span>
          </div>
          <p className="text-[11px] text-blue-600 leading-snug">
            {t.calc.rentalRateHint}
          </p>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-blue-400 font-bold text-sm pointer-events-none">$</span>
            <input
              type="number"
              inputMode="decimal"
              className="input-field pl-7 border-blue-200 bg-white text-sm"
              placeholder={t.calc.placeholderRentalRate}
              value={rentalRate}
              min="0.01"
              step="0.01"
              onChange={(e) => setRentalRate(e.target.value)}
              aria-label={t.calc.ariaRentalRate}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">/gal</span>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          STEP 1 — Pick a vehicle
      ══════════════════════════════════════════════════════════════ */}
      <StepLabel n={1} title={t.calc.step1} />
      <div className="card">
        <TankPresets
          value={form.tankCapacity}
          onChange={(v) => patch({ tankCapacity: v })}
          rentalMode={rentalMode}
        />
        {errors.tankCapacity && <FieldError msg={errors.tankCapacity} />}
        {rentalMode ? (
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5 mt-1">
            <span className="text-base flex-shrink-0" aria-hidden="true">🚪</span>
            <p className="text-[11px] text-blue-600 leading-snug">
              <span className="font-black">{t.calc.garageClosedTitle}</span>{t.calc.garageClosedHint}
            </p>
          </div>
        ) : (
          <SavedVehicles
            currentGallons={form.tankCapacity}
            onSelect={(g, v) => patch({ tankCapacity: g, vehicleName: v?.name ?? '', vehicleId: v?.id ?? '', vehicleOdometer: v?.currentOdometer })}
            selectedVehicleId={form.vehicleId}
            calcKey={calcKey}
          />
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════
          STEP 2 — Set fuel level
      ══════════════════════════════════════════════════════════════ */}
      <StepLabel n={2} title={t.calc.step2} />
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <p className="field-label mb-0">{t.calc.currentFuelLevel}</p>
            {/* ⚡ Live badge — Pro only, shown once calculated */}
            {isLive && (
              <span className="text-[9px] font-black bg-amber-500 text-white px-1.5 py-0.5 rounded-full leading-none">
                {t.calc.liveBadge}
              </span>
            )}
          </div>
          <div className="flex gap-1.5">
            <ModeBtn label="%" active={form.fuelMode === 'percent'}
              onClick={() => patch({ fuelMode: 'percent', currentFuel: '25' })} />
            <ModeBtn label={t.calc.fuelModeGal} active={form.fuelMode === 'gallons'}
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
              {isLoggedIn ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => { setGaugeScanMsg(''); gaugeCamRef.current?.click(); }}
                      disabled={gaugeScanning}
                      className="flex items-center gap-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2 hover:border-amber-300 hover:text-amber-700 transition-colors disabled:opacity-50"
                    >
                      <span>{gaugeScanning ? '🔄' : '📷'}</span>
                      <span>{gaugeScanning ? t.calc.readingGauge : t.calc.scanGauge}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setGaugeScanMsg(''); gaugeGalleryRef.current?.click(); }}
                      disabled={gaugeScanning}
                      className="flex items-center gap-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2 hover:border-amber-300 hover:text-amber-700 transition-colors disabled:opacity-50"
                    >
                      <span>🖼️</span>
                      <span>{t.calc.uploadPhoto}</span>
                    </button>
                  </div>
                  {gaugeScanMsg && (
                    <p className={`text-[11px] font-medium leading-snug ${gaugeScanMsg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>
                      {gaugeScanMsg}
                    </p>
                  )}
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    {t.calc.scanHint}
                  </p>
                </>
              ) : (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  <span className="text-amber-500 text-sm">📷</span>
                  <p className="text-[11px] text-amber-700 leading-snug">
                    <a href="/signin" className="font-bold underline underline-offset-2">{t.nav.signIn}</a>
                    {' '}{t.calc.signInToScan}
                  </p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="relative">
            <input
              type="number" inputMode="decimal"
              className={errors.currentFuel ? 'input-field-error' : 'input-field'}
              placeholder={t.calc.placeholderGallons}
              value={form.currentFuel}
              min="0" step="0.1"
              onChange={(e) => patch({ currentFuel: e.target.value })}
              onBlur={(e)  => liveRecalc({ currentFuel: e.target.value })}
              aria-label={t.calc.ariaCurrentFuelGallons}
            />
            <Unit>{t.calc.unitGal}</Unit>
          </div>
        )}
        {errors.currentFuel && <FieldError msg={errors.currentFuel} />}

        {/* Free user upgrade nudge */}
        {showLiveNudge && !isPro && isLoggedIn && (
          <a href="/upgrade"
             className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-amber-600 hover:text-amber-500 transition-colors">
            <span className="text-xs bg-amber-100 rounded-full px-1.5 py-0.5">⚡</span>
            {t.calc.liveUpgradeNudge}
          </a>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════
          STEP 3 — Choose a goal
      ══════════════════════════════════════════════════════════════ */}
      <StepLabel n={3} title={t.calc.step3} />

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
        <p className="field-label">{t.calc.fillUpTo}</p>
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
            {t.calc.custom}
          </button>
        </div>

        {isCustom && (
          <div className="relative">
            <input
              type="number" inputMode="decimal"
              className={errors.targetPercent ? 'input-field-error' : 'input-field'}
              placeholder={t.calc.placeholderPercent}
              value={form.customTarget}
              min="1" max="100" step="1"
              autoFocus
              onChange={(e) => patch({ customTarget: e.target.value })}
              onBlur={(e)  => liveRecalc({ customTarget: e.target.value })}
              aria-label={t.calc.ariaCustomTarget}
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
                {t.calc.alreadyFull(target)}
              </p>
            );
          }
          return null;
        })()}
      </div>

      {/* ══════════════════════════════════════════════════════════════
          STEP 4 — Get the answer
      ══════════════════════════════════════════════════════════════ */}
      <StepLabel n={4} title={t.calc.step4} />

      {/* Gas price */}
      <div className="card mb-4">
        <p className="field-label">{t.calc.gasPriceLabel}</p>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-semibold pointer-events-none">$</span>
          <input
            type="number" inputMode="decimal"
            className={`${errors.pricePerGallon ? 'input-field-error' : 'input-field'} pl-8`}
            placeholder={t.calc.placeholderPrice}
            value={form.pricePerGallon}
            min="0.01" step="0.01"
            onChange={(e) => patch({ pricePerGallon: e.target.value })}
            onBlur={(e)  => liveRecalc({ pricePerGallon: e.target.value })}
            aria-label={t.calc.ariaGasPrice}
          />
        </div>
        {errors.pricePerGallon && <FieldError msg={errors.pricePerGallon} />}
        <GasPriceLookup onApply={(p) => liveRecalc({ pricePerGallon: p })} />
      </div>

      {/* Rental mode active reminder — shown just above the calculate button */}
      {rentalMode && (
        <div className="flex items-center gap-2 bg-blue-700 rounded-xl px-3 py-2 mb-2">
          <span className="text-base flex-shrink-0" aria-hidden="true">🚗</span>
          <p className="text-xs font-black text-white flex-1">{t.calc.rentalModeActiveReminder}</p>
          <button
            type="button"
            onClick={() => setRentalMode(false)}
            className="text-blue-200 hover:text-white text-[11px] font-bold underline whitespace-nowrap transition-colors"
          >
            {t.calc.rentalModeExit}
          </button>
        </div>
      )}

      <button className="btn-amber" onClick={handleCalculate}>
        {rentalMode ? t.calc.calculateRental : t.calc.calculate}
      </button>
      <button className="btn-secondary mt-3" onClick={handleReset}>{t.calc.clearAll}</button>

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
            isRental={rentalMode}
            rentalRate={rentalMode && rentalRate ? Number(rentalRate) : undefined}
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
      <span className="text-sm font-bold text-slate-600 dark:text-slate-100">{title}</span>
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
