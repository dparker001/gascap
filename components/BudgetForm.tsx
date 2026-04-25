'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import FuelGauge      from './FuelGauge';
import TankPresets    from './TankPresets';
import SavedVehicles  from './SavedVehicles';
import GasPriceLookup from './GasPriceLookup';
import { BudgetResultCard } from './ResultCard';
import {
  calcBudget,
  validateBudget,
  type BudgetResult,
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
  pricePerGallon:  string;
  budget:          string;
  vehicleName:     string;
  vehicleId:       string;
  vehicleOdometer: number | undefined;
}

const DEFAULTS: FormState = {
  tankCapacity:    '',
  fuelMode:        'percent',
  currentFuel:     '0',
  pricePerGallon:  '',
  budget:          '',
  vehicleName:     '',
  vehicleId:       '',
  vehicleOdometer: undefined,
};

const SHORTCUTS = [10, 20, 30, 40, 50];

interface Props {
  activeTab:    CalcTab;
  setActiveTab: (tab: CalcTab) => void;
}

// ── Component ──────────────────────────────────────────────────────────

export default function BudgetForm({ activeTab, setActiveTab }: Props) {
  const { data: session }   = useSession();
  const { t }               = useTranslation();
  const isPro      = ['pro', 'fleet'].includes((session?.user as { plan?: string })?.plan ?? '');
  const isLoggedIn = !!session;

  const GOAL_TABS: { id: CalcTab; emoji: string; label: string; sub: string }[] = [
    { id: 'target', emoji: '⛽', label: t.calc.targetFillLabel, sub: t.calc.targetFillSub },
    { id: 'budget', emoji: '💵', label: t.calc.byBudgetLabel,   sub: t.calc.byBudgetSub  },
  ];

  const [form, setForm]     = useLocalStorage<FormState>('gc_budget_v2', DEFAULTS);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [result, setResult] = useState<BudgetResult | null>(null);
  const [calculated, setCalculated]   = useState(false);
  const [showLiveNudge, setShowLiveNudge] = useState(false);

  // Standard patch — clears result (free/guest behaviour)
  function patch(p: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...p }));
    if (calculated) {
      setResult(null);
      setCalculated(false);
      if (isLoggedIn && !isPro) setShowLiveNudge(true);
    }
  }

  // Live recalc — Pro only. Merges update and immediately recalculates.
  function liveRecalc(p: Partial<FormState>) {
    if (!isPro || !calculated) { patch(p); return; }

    const merged = { ...form, ...p };
    setForm(merged);

    const input = {
      tankCapacity:       Number(merged.tankCapacity),
      fuelInputMode:      merged.fuelMode,
      currentFuelPercent: merged.fuelMode === 'percent' ? Number(merged.currentFuel) : undefined,
      currentFuelGallons: merged.fuelMode === 'gallons' ? Number(merged.currentFuel) : undefined,
      pricePerGallon:     Number(merged.pricePerGallon),
      budget:             Number(merged.budget),
    };

    const errs = validateBudget(input);
    if (Object.keys(errs).length === 0) {
      setResult(calcBudget(input));
      setErrors({});
    }
  }

  const gaugePercent = form.fuelMode === 'percent'
    ? (isNaN(Number(form.currentFuel)) ? 0 : Number(form.currentFuel))
    : 0;

  function handleCalculate() {
    const input = {
      tankCapacity:       Number(form.tankCapacity),
      fuelInputMode:      form.fuelMode,
      currentFuelPercent: form.fuelMode === 'percent' ? Number(form.currentFuel) : undefined,
      currentFuelGallons: form.fuelMode === 'gallons' ? Number(form.currentFuel) : undefined,
      pricePerGallon:     Number(form.pricePerGallon),
      budget:             Number(form.budget),
    };

    const errs = validateBudget(input);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setResult(calcBudget(input));
    setCalculated(true);
    setShowLiveNudge(false);
    setTimeout(() => {
      document.getElementById('bgt-result')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
  }

  function handleReset() {
    setForm(DEFAULTS);
    setErrors({});
    setResult(null);
    setCalculated(false);
    setShowLiveNudge(false);
  }

  const tankNum = Number(form.tankCapacity) || undefined;
  const isLive  = isPro && calculated;

  return (
    <div className="pb-2">

      {/* ── "How to use" eyebrow ──────────────────────────────────── */}
      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-500 mb-1 mt-2">
        {t.calc.howToUse}
      </p>

      {/* ══════════════════════════════════════════════════════════════
          STEP 1 — Pick a vehicle
      ══════════════════════════════════════════════════════════════ */}
      <StepLabel n={1} title={t.calc.step1} />
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
        />
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
          <FuelGauge
            percent={gaugePercent}
            onChange={(pct) => liveRecalc({ currentFuel: String(pct) })}
            tankCapacity={tankNum}
          />
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

      {/* Budget inputs */}
      <div className="card">
        <p className="field-label">{t.calc.yourBudget}</p>
        <div className="flex gap-2 mb-3 overflow-x-auto pb-0.5">
          {SHORTCUTS.map((amt) => {
            const str = String(amt);
            return (
              <button
                key={amt}
                onClick={() => liveRecalc({ budget: str })}
                aria-pressed={form.budget === str}
                className={[
                  'flex-shrink-0 px-4 py-2.5 rounded-xl text-sm font-bold border-2 transition-all',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300',
                  form.budget === str
                    ? 'border-amber-500 bg-amber-50 text-amber-700'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-amber-300',
                ].join(' ')}
              >
                ${amt}
              </button>
            );
          })}
        </div>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-semibold pointer-events-none">$</span>
          <input
            type="number" inputMode="decimal"
            className={`${errors.budget ? 'input-field-error' : 'input-field'} pl-8`}
            placeholder={t.calc.placeholderBudget}
            value={form.budget}
            min="0.01" step="0.01"
            onChange={(e) => patch({ budget: e.target.value })}
            onBlur={(e)  => liveRecalc({ budget: e.target.value })}
            aria-label={t.calc.ariaBudgetDollars}
          />
        </div>
        {errors.budget && <FieldError msg={errors.budget} />}
        {/* Smart hint: budget too small for even 1 gallon */}
        {!errors.budget && (() => {
          const budget = parseFloat(form.budget);
          const price  = parseFloat(form.pricePerGallon);
          if (budget > 0 && price > 0 && budget < price) {
            return (
              <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200
                            rounded-xl px-3 py-2 flex items-center gap-1.5">
                <span>⚠️</span>
                {t.calc.budgetTooSmall(budget.toFixed(2), price.toFixed(2))}
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

      <button className="btn-amber" onClick={handleCalculate}>{t.calc.calculate}</button>
      <button className="btn-secondary mt-3" onClick={handleReset}>{t.calc.clearAll}</button>

      <div id="bgt-result">
        {result && (
          <BudgetResultCard
            result={result}
            pricePerGallon={Number(form.pricePerGallon) || undefined}
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
