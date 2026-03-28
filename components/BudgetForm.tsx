'use client';

import { useState } from 'react';
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
  currentFuel:     '25',
  pricePerGallon:  '',
  budget:          '',
  vehicleName:     '',
  vehicleId:       '',
  vehicleOdometer: undefined,
};

const SHORTCUTS = [10, 20, 30, 40, 50];

const GOAL_TABS: { id: CalcTab; emoji: string; label: string; sub: string }[] = [
  { id: 'target', emoji: '⛽', label: 'Target Fill', sub: 'Fill to a level'    },
  { id: 'budget', emoji: '💵', label: 'By Budget',   sub: 'Spend a set amount' },
];

interface Props {
  activeTab:    CalcTab;
  setActiveTab: (tab: CalcTab) => void;
}

// ── Component ──────────────────────────────────────────────────────────

export default function BudgetForm({ activeTab, setActiveTab }: Props) {
  const [form, setForm]     = useLocalStorage<FormState>('gc_budget_v2', DEFAULTS);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [result, setResult] = useState<BudgetResult | null>(null);
  const [calculated, setCalculated] = useState(false);

  function patch(p: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...p }));
    if (calculated) { setResult(null); setCalculated(false); }
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
    setTimeout(() => {
      document.getElementById('bgt-result')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
  }

  function handleReset() {
    setForm(DEFAULTS);
    setErrors({});
    setResult(null);
    setCalculated(false);
  }

  const tankNum = Number(form.tankCapacity) || undefined;

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
        />
      </div>

      {/* ══════════════════════════════════════════════════════════════
          STEP 2 — Set fuel level
      ══════════════════════════════════════════════════════════════ */}
      <StepLabel n={2} title="Set fuel level" />
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <p className="field-label mb-0">Current Fuel Level</p>
          <div className="flex gap-1.5">
            <ModeBtn label="%" active={form.fuelMode === 'percent'}
              onClick={() => patch({ fuelMode: 'percent', currentFuel: '25' })} />
            <ModeBtn label="Gal" active={form.fuelMode === 'gallons'}
              onClick={() => patch({ fuelMode: 'gallons', currentFuel: '' })} />
          </div>
        </div>

        {form.fuelMode === 'percent' ? (
          <FuelGauge
            percent={gaugePercent}
            onChange={(pct) => patch({ currentFuel: String(pct) })}
            tankCapacity={tankNum}
          />
        ) : (
          <div className="relative">
            <input
              type="number" inputMode="decimal"
              className={errors.currentFuel ? 'input-field-error' : 'input-field'}
              placeholder="e.g. 4.5"
              value={form.currentFuel}
              min="0" step="0.1"
              onChange={(e) => patch({ currentFuel: e.target.value })}
              aria-label="Current fuel in gallons"
            />
            <Unit>gal</Unit>
          </div>
        )}
        {errors.currentFuel && <FieldError msg={errors.currentFuel} />}
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

      {/* Budget inputs */}
      <div className="card">
        <p className="field-label">Your Budget</p>
        <div className="flex gap-2 mb-3 overflow-x-auto pb-0.5">
          {SHORTCUTS.map((amt) => {
            const str = String(amt);
            return (
              <button
                key={amt}
                onClick={() => patch({ budget: str })}
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
            placeholder="e.g. 25.00"
            value={form.budget}
            min="0.01" step="0.01"
            onChange={(e) => patch({ budget: e.target.value })}
            aria-label="Budget in dollars"
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
                Your budget (${budget.toFixed(2)}) won&apos;t cover a full gallon at ${price.toFixed(2)}/gal.
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
            aria-label="Gas price per gallon"
          />
        </div>
        {errors.pricePerGallon && <FieldError msg={errors.pricePerGallon} />}
        <GasPriceLookup onApply={(p) => patch({ pricePerGallon: p })} />
      </div>

      <button className="btn-amber" onClick={handleCalculate}>Calculate ⚡</button>
      <button className="btn-secondary" onClick={handleReset}>Clear all</button>

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
