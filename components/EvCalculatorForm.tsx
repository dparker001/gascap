'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { calcEvCharge, type EvChargeResult } from '@/lib/calculations';
import { EV_PRESETS, PHEV_PRESETS } from '@/lib/evPresets';
import { useTranslation } from '@/contexts/LanguageContext';
import type { CalcTab } from './CalculatorTabs';

interface Props {
  activeTab:    CalcTab;
  setActiveTab: (tab: CalcTab) => void;
}

type RateLookupStatus = 'idle' | 'locating' | 'fetching' | 'done' | 'error';

interface RateResult {
  price: number | null;
  state: string;
  isState?: boolean;
}

const STATE_NAMES: Record<string, string> = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',
  CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',
  HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',
  KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',
  MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',
  NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',
  NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',
  OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',
  SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',
  VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',
  US:'United States (national avg)',
};

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 10) return `${h.toFixed(1)} hrs`;
  return `${Math.round(h)} hrs`;
}

export default function EvCalculatorForm({ activeTab, setActiveTab }: Props) {
  const { t } = useTranslation();
  const { data: session } = useSession();

  // Tab definitions — mirrors TargetFillForm / BudgetForm GOAL_TABS
  const GOAL_TABS: { id: CalcTab; emoji: string; label: string; sub: string }[] = [
    { id: 'target', emoji: '⛽', label: t.calc.targetFillLabel, sub: t.calc.targetFillSub },
    { id: 'budget', emoji: '💵', label: t.calc.byBudgetLabel,   sub: t.calc.byBudgetSub  },
    { id: 'ev',     emoji: '⚡', label: t.calc.evLabel,         sub: t.calc.evSub         },
  ];

  // ── Form state ──
  const [batteryKwh, setBatteryKwh]   = useState('');
  const [currentPct, setCurrentPct]   = useState(20);
  const [targetPct,  setTargetPct]    = useState(80);
  const [ratePerKwh, setRatePerKwh]   = useState('0.16'); // U.S. national avg default
  const [efficiency, setEfficiency]   = useState('');
  const [presetLabel, setPresetLabel] = useState('');
  const [isPHEV, setIsPHEV]           = useState(false);
  const [errors, setErrors]           = useState<Record<string, string>>({});
  const [result, setResult]           = useState<EvChargeResult | null>(null);
  const [calcKey, setCalcKey]         = useState(0);

  // ── Rate lookup state ──
  const [rateLookupStatus, setRateLookupStatus] = useState<RateLookupStatus>('idle');
  const [rateResult, setRateResult]             = useState<RateResult | null>(null);
  const [rateLookupErr, setRateLookupErr]       = useState('');

  // ── Preset select ──
  function handlePresetChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const raw = e.target.value;
    if (!raw) return;
    try {
      const preset = JSON.parse(raw) as {
        kwh: number; eff?: number; isPHEV: boolean; label: string;
      };
      setBatteryKwh(String(preset.kwh));
      setEfficiency(preset.eff ? String(preset.eff) : '');
      setIsPHEV(preset.isPHEV);
      setPresetLabel(preset.label);
      setResult(null);
      setErrors({});
    } catch {
      // ignore malformed values
    }
  }

  // ── Electricity rate lookup ──
  async function handleRateLookup() {
    if (!session) return; // guest gate handled below
    setRateLookupStatus('locating');
    setRateResult(null);
    setRateLookupErr('');
    let coords: GeolocationCoordinates;
    try {
      coords = await new Promise<GeolocationCoordinates>((res, rej) =>
        navigator.geolocation.getCurrentPosition((p) => res(p.coords), rej, { timeout: 10000 })
      );
    } catch {
      setRateLookupStatus('error');
      setRateLookupErr('Location access denied. Enter your rate manually.');
      return;
    }
    setRateLookupStatus('fetching');
    try {
      const r = await fetch(
        `/api/electricity-price?lat=${coords.latitude}&lng=${coords.longitude}`
      );
      const data = await r.json() as RateResult & { noApiKey?: boolean };
      if (data.noApiKey || !data.price) {
        setRateLookupStatus('error');
        setRateLookupErr('Rate lookup unavailable. Enter your rate manually.');
        return;
      }
      setRateResult(data);
      setRateLookupStatus('done');
    } catch {
      setRateLookupStatus('error');
      setRateLookupErr('Network error. Enter your rate manually.');
    }
  }

  function applyRate() {
    if (rateResult?.price) {
      setRatePerKwh(rateResult.price.toFixed(4));
      setRateLookupStatus('idle');
      setRateResult(null);
    }
  }

  // ── Slider helpers ──
  function handleCurrentPct(val: number) {
    const v = Math.min(val, targetPct - 5);
    setCurrentPct(Math.max(0, v));
    setResult(null);
  }
  function handleTargetPct(val: number) {
    const v = Math.max(val, currentPct + 5);
    setTargetPct(Math.min(100, v));
    setResult(null);
  }

  // ── Calculate ──
  function handleCalculate() {
    const errs: Record<string, string> = {};
    const kwh  = parseFloat(batteryKwh);
    const rate  = parseFloat(ratePerKwh);
    if (!kwh  || kwh  <= 0) errs.batteryKwh  = 'Enter a valid battery capacity.';
    else if (kwh > 250)     errs.batteryKwh  = 'Battery capacity seems too large.';
    if (!rate || rate <= 0) errs.ratePerKwh  = 'Enter a valid electricity rate.';
    else if (rate > 1)      errs.ratePerKwh  = 'Rate seems high — enter $/kWh (e.g. 0.15).';
    if (targetPct <= currentPct) errs.range  = 'Target must be higher than current charge.';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const eff = parseFloat(efficiency);
    const res = calcEvCharge({
      batteryKwh: kwh,
      currentPct,
      targetPct,
      pricePerKwh:    rate,
      efficiencyMiKwh: eff > 0 ? eff : undefined,
    });
    setResult(res);
    setCalcKey((k) => k + 1);
  }

  const stateName = rateResult?.state ? (STATE_NAMES[rateResult.state] ?? rateResult.state) : '';

  // Slider gradient style (WebKit + fallback)
  const currentGrad = `linear-gradient(to right, #1EB68F ${currentPct}%, #e2e8f0 ${currentPct}%)`;
  const targetGrad  = `linear-gradient(to right, #1EB68F ${targetPct}%, #e2e8f0 ${targetPct}%)`;

  return (
    <div className="w-full max-w-lg mx-auto px-4 pb-8 space-y-4">

      {/* ── Goal Tab Switcher ────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2 mt-4" role="tablist" aria-label="Calculator mode">
        {GOAL_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              aria-selected={isActive}
              className={[
                'flex flex-col items-center justify-center py-2.5 px-1 rounded-2xl border-2',
                'transition-all duration-150 focus:outline-none focus-visible:ring-2',
                isActive && tab.id === 'ev'
                  ? 'border-[#1EB68F] bg-emerald-50 focus-visible:ring-[#1EB68F]'
                  : isActive
                  ? 'border-amber-500 bg-amber-50 focus-visible:ring-amber-300'
                  : 'border-slate-200 bg-white hover:border-slate-300 focus-visible:ring-slate-300',
              ].join(' ')}
            >
              <span className="text-xl mb-0.5" aria-hidden="true">{tab.emoji}</span>
              <span className={`text-[11px] font-black leading-none ${
                isActive && tab.id === 'ev'
                  ? 'text-[#005F4A]'
                  : isActive
                  ? 'text-amber-700'
                  : 'text-slate-600'
              }`}>
                {tab.label}
              </span>
              <span className="text-[10px] text-slate-400 mt-1 leading-none">{tab.sub}</span>
            </button>
          );
        })}
      </div>

      {/* ── Card 1: Vehicle ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-card p-5 space-y-4">

        {/* Vehicle preset */}
        <div>
          <label className="field-label">{t.ev.presetLabel}</label>
          <select
            className="input-field text-sm text-slate-600"
            defaultValue=""
            onChange={handlePresetChange}
            aria-label="Select EV or PHEV vehicle"
          >
            <option value="" disabled>{t.ev.selectPlaceholder}</option>
            <optgroup label="Electric Vehicles (EV)">
              {EV_PRESETS.map((p) => (
                <option
                  key={p.label}
                  value={JSON.stringify({ kwh: p.batteryKwh, eff: p.defaultEfficiency, isPHEV: false, label: p.label })}
                >
                  {p.label} — {p.batteryKwh} kWh
                </option>
              ))}
            </optgroup>
            <optgroup label="Plug-in Hybrids (PHEV)">
              {PHEV_PRESETS.map((p) => (
                <option
                  key={p.label}
                  value={JSON.stringify({ kwh: p.batteryKwh, eff: p.defaultEfficiency, isPHEV: true, label: p.label })}
                >
                  {p.label} — {p.batteryKwh} kWh
                </option>
              ))}
            </optgroup>
          </select>

          {/* Source badge */}
          {presetLabel && (
            <p className="mt-1.5 text-[10px] font-semibold leading-snug px-2.5 py-1 rounded-lg
                          inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700
                          border border-emerald-200">
              <span aria-hidden="true">⚡</span>
              {t.ev.presetFrom}: <span className="font-bold truncate max-w-[200px]">{presetLabel}</span>
            </p>
          )}
        </div>

        {/* Battery capacity */}
        <div>
          <label className="field-label">
            {t.ev.batteryLabel}
            <span className="font-normal text-slate-400 ml-1">{t.ev.batteryUnit}</span>
          </label>
          <input
            type="number"
            inputMode="decimal"
            className={`input-field ${errors.batteryKwh ? 'border-red-400 focus:ring-red-400' : ''}`}
            placeholder="e.g. 82"
            value={batteryKwh}
            min="1" max="250" step="0.1"
            onChange={(e) => { setBatteryKwh(e.target.value); setResult(null); setErrors({}); }}
            aria-label="Battery capacity in kWh"
          />
          {errors.batteryKwh && (
            <p className="text-xs text-red-500 mt-1">{errors.batteryKwh}</p>
          )}
        </div>
      </div>

      {/* ── Card 2: Charge Range ─────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-card p-5 space-y-4">
        <p className="field-label mb-0">{t.ev.chargeRangeLabel}</p>

        {/* Current → Target display */}
        <div className="grid grid-cols-3 items-center gap-3">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
              {t.ev.currentLabel}
            </p>
            <p className="text-2xl font-black text-slate-700 leading-none mt-0.5">
              {currentPct}<span className="text-sm font-semibold text-slate-400">%</span>
            </p>
          </div>
          <div className="text-center text-[#1EB68F] text-xl font-bold">→</div>
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
            <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wide">
              {t.ev.targetLabel}
            </p>
            <p className="text-2xl font-black text-[#005F4A] leading-none mt-0.5">
              {targetPct}<span className="text-sm font-semibold text-emerald-500">%</span>
            </p>
          </div>
        </div>

        {/* Sliders */}
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-[10px] text-slate-400 mb-1">
              <span>{t.ev.currentSlider}</span>
              <span className="font-semibold text-slate-600">{currentPct}%</span>
            </div>
            <input
              type="range" min={0} max={95} step={1}
              value={currentPct}
              onChange={(e) => handleCurrentPct(Number(e.target.value))}
              style={{ background: currentGrad, accentColor: '#1EB68F' }}
              className="w-full h-1.5 rounded-full cursor-pointer appearance-none"
              aria-label="Current battery charge percentage"
            />
          </div>
          <div>
            <div className="flex justify-between text-[10px] text-slate-400 mb-1">
              <span>{t.ev.targetSlider}</span>
              <span className="font-semibold text-slate-600">{targetPct}%</span>
            </div>
            <input
              type="range" min={5} max={100} step={1}
              value={targetPct}
              onChange={(e) => handleTargetPct(Number(e.target.value))}
              style={{ background: targetGrad, accentColor: '#1EB68F' }}
              className="w-full h-1.5 rounded-full cursor-pointer appearance-none"
              aria-label="Target battery charge percentage"
            />
          </div>
        </div>

        {errors.range && (
          <p className="text-xs text-red-500">{errors.range}</p>
        )}
      </div>

      {/* ── Card 3: Rate & Efficiency ────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-card p-5 space-y-4">

        {/* Electricity rate */}
        <div>
          <label className="field-label">
            {t.ev.rateLabel}
            <span className="font-normal text-slate-400 ml-1">{t.ev.rateUnit}</span>
          </label>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm
                               font-semibold pointer-events-none">$</span>
              <input
                type="number"
                inputMode="decimal"
                className={`input-field pl-7 ${errors.ratePerKwh ? 'border-red-400 focus:ring-red-400' : ''}`}
                placeholder="0.15"
                value={ratePerKwh}
                min="0.01" max="1" step="0.001"
                onChange={(e) => { setRatePerKwh(e.target.value); setResult(null); setErrors({}); }}
                aria-label="Electricity rate in dollars per kWh"
              />
            </div>
            {/* Rate lookup button */}
            {!session ? (
              <button
                type="button"
                onClick={() => {/* guest sees tooltip */}}
                title="Create a free account to auto-detect your local rate"
                className="px-3 py-2 rounded-xl bg-blue-50 border border-blue-200 text-blue-600
                           text-xs font-bold whitespace-nowrap opacity-60 cursor-not-allowed"
                disabled
              >
                📍 {t.ev.lookupBtn.replace('📍 ', '')}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleRateLookup}
                disabled={rateLookupStatus === 'locating' || rateLookupStatus === 'fetching'}
                className="px-3 py-2 rounded-xl bg-blue-50 border border-blue-200 text-blue-700
                           text-xs font-bold whitespace-nowrap hover:bg-blue-100 transition-colors
                           disabled:opacity-60"
              >
                {rateLookupStatus === 'locating' || rateLookupStatus === 'fetching'
                  ? '⏳ Looking up…'
                  : `📍 ${t.ev.lookupBtn.replace('📍 ', '')}`}
              </button>
            )}
          </div>

          {errors.ratePerKwh && (
            <p className="text-xs text-red-500 mt-1">{errors.ratePerKwh}</p>
          )}

          {/* Rate helper — shown to guests */}
          {!session && (
            <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
              💡 Pre-filled with the U.S. national average ($0.16/kWh).{' '}
              <span className="text-slate-500">
                Find your exact rate on your electric bill, or{' '}
                <Link href="/signup" className="text-[#1EB68F] font-semibold hover:underline">
                  sign up free
                </Link>{' '}
                to auto-detect it by location.
              </span>
            </p>
          )}

          {/* Rate lookup result */}
          {rateLookupStatus === 'done' && rateResult?.price && (
            <div className="mt-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5
                            flex items-center justify-between gap-3 animate-fade-in">
              <div>
                <p className="text-xs font-bold text-blue-800">
                  {rateResult.isState ? `${stateName} avg` : 'U.S. national avg'}
                </p>
                <p className="text-base font-black text-blue-700">
                  ${rateResult.price.toFixed(4)}<span className="text-xs font-normal text-blue-500 ml-0.5">/kWh</span>
                </p>
                <p className="text-[10px] text-blue-500 mt-0.5">📊 Source: U.S. EIA · residential</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <button
                  onClick={applyRate}
                  className="px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-bold
                             hover:bg-blue-500 transition-colors whitespace-nowrap"
                >
                  Use this rate
                </button>
                <button
                  onClick={() => setRateLookupStatus('idle')}
                  className="text-[10px] text-slate-400 hover:text-slate-600 text-center"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
          {rateLookupStatus === 'error' && (
            <p className="text-xs text-red-500 mt-1">{rateLookupErr}</p>
          )}
        </div>

        {/* Efficiency — optional */}
        <div>
          <label className="field-label">
            <span className="inline-flex items-center gap-1.5">
              {t.ev.efficiencyLabel}
              <span className="text-[10px] font-bold bg-slate-100 text-slate-400 rounded-full
                               px-2 py-0.5 uppercase tracking-wide">
                {t.ev.efficiencyOptional}
              </span>
            </span>
            <span className="font-normal text-slate-400 ml-1">{t.ev.efficiencyUnit}</span>
          </label>
          <input
            type="number"
            inputMode="decimal"
            className="input-field"
            placeholder="e.g. 3.8"
            value={efficiency}
            min="0.5" max="10" step="0.1"
            onChange={(e) => { setEfficiency(e.target.value); setResult(null); }}
            aria-label="Vehicle efficiency in miles per kWh"
          />
          <p className="text-xs text-slate-400 mt-1">
            Adds a "range added" estimate to your results. Find yours in your car's app or manual.
          </p>
        </div>

        {/* PHEV banner */}
        {isPHEV && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5
                          flex items-start gap-2.5 animate-fade-in">
            <span className="text-lg flex-shrink-0" aria-hidden="true">⚡🛢</span>
            <p className="text-xs font-semibold text-amber-800 leading-snug">
              {t.ev.phevBanner}
            </p>
          </div>
        )}

        {/* Calculate button */}
        <button
          onClick={handleCalculate}
          className="w-full py-4 px-6 rounded-2xl font-bold text-lg text-white
                     bg-[#1EB68F] hover:bg-[#189b7a] active:bg-[#157a61] active:scale-[0.98]
                     shadow-[0_4px_16px_rgba(30,182,143,0.4)] transition-all duration-150
                     focus:outline-none focus:ring-2 focus:ring-[#1EB68F] focus:ring-offset-2"
        >
          ⚡ {t.ev.calcBtn}
        </button>
      </div>

      {/* ── Guest nudge — shown after calculation for signed-out users ──── */}
      {result && !session && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-4
                        flex items-start gap-3 animate-fade-in">
          <span className="text-2xl flex-shrink-0" aria-hidden="true">🔋</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-black text-emerald-800 mb-0.5">
              {presetLabel
                ? `Save your ${presetLabel} to your garage`
                : 'Save this to your EV garage'}
            </p>
            <p className="text-[11px] text-emerald-700 leading-relaxed mb-3">
              Track every charge session, compare costs over time, and auto-fill
              your battery info next visit. Free account — no credit card required.
            </p>
            <div className="flex items-center gap-3">
              <Link
                href="/signup"
                className="px-4 py-2 rounded-xl bg-[#1EB68F] text-white text-xs font-bold
                           hover:bg-[#189b7a] transition-colors whitespace-nowrap"
              >
                Create free account →
              </Link>
              <Link
                href="/signin"
                className="text-[11px] text-emerald-700 font-semibold hover:underline"
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ── Results ─────────────────────────────────────────────────────── */}
      {result && (
        <div key={calcKey} className="bg-white rounded-2xl shadow-card overflow-hidden animate-result">

          {/* Header */}
          <div className="bg-gradient-to-r from-[#005F4A] to-[#1EB68F] px-5 py-4
                          flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-white/70 uppercase tracking-widest">
                {t.ev.resultsTitle}
              </p>
              <p className="text-xs text-white/60 mt-0.5">
                {presetLabel || 'Your EV'} · {currentPct}% → {targetPct}%
              </p>
            </div>
            <span className="text-2xl" aria-hidden="true">🔋</span>
          </div>

          <div className="p-5 space-y-4">

            {/* Main metrics grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 rounded-xl p-3 text-center">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                  {t.ev.kwhLabel}
                </p>
                <p className="text-2xl font-black text-slate-800 leading-none">
                  {result.kWhNeeded}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">{t.ev.kwhUnit}</p>
              </div>
              <div className="bg-emerald-50 rounded-xl p-3 text-center border border-emerald-100">
                <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wide mb-1">
                  {t.ev.costLabel}
                </p>
                <p className="text-2xl font-black text-[#005F4A] leading-none">
                  ${result.estimatedCost.toFixed(2)}
                </p>
                <p className="text-[10px] text-emerald-500 mt-0.5">
                  at ${parseFloat(ratePerKwh).toFixed(4)}/kWh
                </p>
              </div>
              {result.rangeAdded != null && (
                <div className="col-span-2 bg-slate-50 rounded-xl p-3 text-center">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                    {t.ev.rangeLabel}
                  </p>
                  <p className="text-xl font-black text-slate-800 leading-none">
                    ~{result.rangeAdded} {t.ev.miles}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    at {efficiency} mi/kWh efficiency
                  </p>
                </div>
              )}
            </div>

            {/* Battery bar */}
            <div>
              <div className="flex justify-between text-[10px] font-semibold text-slate-500 mb-1.5">
                <span>Battery level</span>
                <span className="text-[#005F4A] font-bold">+{result.chargeAdded}% added</span>
              </div>
              <div className="h-2.5 bg-slate-200 rounded-full overflow-hidden relative">
                <div
                  className="absolute left-0 top-0 h-full bg-slate-400 rounded-full"
                  style={{ width: `${currentPct}%` }}
                />
                <div
                  className="absolute top-0 h-full bg-gradient-to-r from-[#1EB68F] to-[#34d399]
                              rounded-r-full"
                  style={{ left: `${currentPct}%`, width: `${result.chargeAdded}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                <span>0%</span>
                <span className="text-slate-500">{currentPct}% start</span>
                <span className="text-[#005F4A] font-semibold">{targetPct}% target</span>
                <span>100%</span>
              </div>
            </div>

            {/* Charging time estimates */}
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3.5">
              <p className="text-[10px] font-black text-[#005F4A] uppercase tracking-widest mb-2.5
                            flex items-center gap-1">
                {t.ev.chargeTimesTitle}
              </p>
              <div className="space-y-2">
                {([
                  { label: t.ev.level1Label, hours: result.chargeTimesHours.level1 },
                  { label: t.ev.level2Label, hours: result.chargeTimesHours.level2 },
                  { label: t.ev.dcFastLabel, hours: result.chargeTimesHours.dcFast },
                ] as { label: string; hours: number }[]).map(({ label, hours }) => (
                  <div key={label}
                    className="flex items-center justify-between text-xs
                               pb-2 border-b border-emerald-100 last:border-0 last:pb-0"
                  >
                    <span className="text-slate-500 font-medium">{label}</span>
                    <span className="font-black text-[#005F4A]">{formatHours(hours)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* EIA data footnote */}
            <p className="text-[10px] text-slate-400 text-center leading-relaxed">
              📊 Electricity rate from U.S. EIA official data · Charge time estimates assume
              standard charger efficiency. Actual times may vary.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
