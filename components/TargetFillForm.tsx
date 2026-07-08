'use client';

import { useState, useRef, useEffect } from 'react';
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
import { useIsNative } from '@/hooks/useIsNative';
import type { CalcTab } from './CalculatorTabs';
import { useTranslation } from '@/contexts/LanguageContext';
import { trackCalculateTarget, trackRentalReturnToggled } from '@/lib/gtag';
import { checkTankSize } from '@/lib/tankValidation';
import GaugeScanModal from './GaugeScanModal';

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
  const { data: session, status } = useSession();
  const { t }               = useTranslation();
  const isPro      = ['pro', 'fleet', 'lifetime'].includes((session?.user as { plan?: string })?.plan ?? '');
  const isLoggedIn = !!session;
  const isNative   = useIsNative();

  const GOAL_TABS: { id: CalcTab; emoji: string; label: string; sub: string }[] = [
    { id: 'target', emoji: '⛽', label: t.calc.targetFillLabel, sub: t.calc.targetFillSub },
    { id: 'budget', emoji: '💵', label: t.calc.byBudgetLabel,   sub: t.calc.byBudgetSub  },
    { id: 'ev',     emoji: '⚡', label: t.calc.evLabel,         sub: t.calc.evSub         },
  ];

  const TARGET_PRESETS = [
    ...TARGET_PRESET_VALUES,
    { label: t.calc.presetFull, value: 100 },
  ];

  const [form, setForm]   = useLocalStorage<FormState>('gc_target_v2', DEFAULTS);
  const [errors, setErrors]         = useState<ValidationErrors>({});
  const [result, setResult]         = useState<TargetFillResult | null>(null);
  const [calculated, setCalculated] = useState(false);
  const [tip, setTip]               = useState(''); // "you forgot a step" hint at the Calculate button
  const [calcKey, setCalcKey]       = useState(0);
  const [showLiveNudge, setShowLiveNudge] = useState(false);
  const [gaugeScanning, setGaugeScanning] = useState(false);
  const [gaugeScanMsg,  setGaugeScanMsg]  = useState('');
  const [showScanModal,    setShowScanModal]    = useState(false);
  const [scanFromDashboard, setScanFromDashboard] = useState(false);
  const [rentalMode,        setRentalMode]        = useState(false);
  const [rentalRate,        setRentalRate]        = useState('');
  const [rentalPickupLevel, setRentalPickupLevel] = useState(100); // % — 100 = full
  const [rentalReturnDate,  setRentalReturnDate]  = useState('');  // YYYY-MM-DD
  const [gasCoords,     setGasCoords]     = useState<{ lat: number; lng: number } | null>(null);
  const [nearbyAttrib,  setNearbyAttrib]  = useState<{ name: string; distanceMi: number; grade: string } | null>(null);
  const [nearbyStatus,  setNearbyStatus]  = useState<'idle' | 'fetching' | 'found' | 'unavailable'>('idle');
  // EPA/AI tank estimate for the currently-selected vehicle (used for validation warning)
  const [vehicleTankEst,   setVehicleTankEst]   = useState<number | undefined>(undefined);
  const [vehicleBodyClass, setVehicleBodyClass] = useState<string | undefined>(undefined);
  // Tank-size source tracking — drives the "From garage / From list" badge in TankPresets
  const [presetLabel, setPresetLabel] = useState('');
  const calcStartFired  = useRef(false);
  // Stable ref so the gc:inject-gas-price event handler always calls the latest liveRecalc
  const liveRecalcRef   = useRef<(p: Partial<FormState>) => void>(() => {});

  // Persist rental pickup level + return date in localStorage so values survive a page refresh
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const lvl  = localStorage.getItem('gc_rental_pickup_level');
    const date = localStorage.getItem('gc_rental_return_date');
    if (lvl)  setRentalPickupLevel(Number(lvl));
    if (date) setRentalReturnDate(date);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('gc_rental_pickup_level', String(rentalPickupLevel));
  }, [rentalPickupLevel]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (rentalReturnDate) localStorage.setItem('gc_rental_return_date', rentalReturnDate);
    else localStorage.removeItem('gc_rental_return_date');
  }, [rentalReturnDate]);

  // Compute return-day alert (today or tomorrow local date)
  const rentalReturnAlert: 'today' | 'tomorrow' | null = (() => {
    if (!rentalReturnDate) return null;
    const now   = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const tomorrow = (() => {
      const d = new Date(now); d.setDate(d.getDate() + 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();
    if (rentalReturnDate === today)     return 'today';
    if (rentalReturnDate === tomorrow)  return 'tomorrow';
    return null;
  })();

  // Auto-activate rental mode for users whose driver mode is 'rental',
  // or when arriving from the /rental landing page via ?rental=1
  const sessionUserMode = (session?.user as { userMode?: string | null })?.userMode;
  // Seed from sessionStorage on mount so rental mode fires even before JWT refreshes
  const [localUserMode, setLocalUserMode] = useState<string | null | undefined>(() => {
    if (typeof window === 'undefined') return undefined;
    return sessionStorage.getItem('gc_user_mode') ?? undefined;
  });
  useEffect(() => {
    function onModeChange(e: Event) {
      setLocalUserMode((e as CustomEvent<{ mode: string | null }>).detail?.mode ?? null);
    }
    window.addEventListener('gc:user-mode', onModeChange);
    return () => window.removeEventListener('gc:user-mode', onModeChange);
  }, []);
  const userMode = localUserMode !== undefined ? localUserMode : sessionUserMode;
  const isGigMode = userMode === 'gig';
  useEffect(() => {
    const fromRentalPage = typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('rental') === '1';
    if ((userMode === 'rental' || fromRentalPage) && !rentalMode) {
      setRentalMode(true);
      setForm(prev => ({ ...prev, targetPreset: rentalPickupLevel, customTarget: '' }));
    } else if (userMode !== 'rental' && userMode != null && !fromRentalPage && rentalMode) {
      setRentalMode(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userMode]);

  // Clear stale garage-vehicle data when the user is confirmed logged out.
  // useLocalStorage hydrates from the previous session's JSON, so a logged-in
  // user's vehicleId/vehicleName can persist in localStorage after sign-out and
  // show "From garage: Don's vehicle" to a guest. Keep tankCapacity (still useful).
  useEffect(() => {
    if (status !== 'unauthenticated') return;
    setForm((prev) =>
      prev.vehicleId || prev.vehicleName
        ? { ...prev, vehicleId: '', vehicleName: '', vehicleOdometer: undefined }
        : prev
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Apply the user's preferred fill level on first mount if the form is still at the system default
  useEffect(() => {
    const stored = localStorage.getItem('gascap_fill_pref');
    if (!stored) return;
    const pref = parseInt(stored, 10);
    if (isNaN(pref) || pref < 1 || pref > 100) return;
    // Only override when the form is still at the hardcoded default (haven't been customised yet)
    setForm((prev) => {
      if (prev.targetPreset !== DEFAULTS.targetPreset) return prev; // user changed it — leave alone
      return { ...prev, targetPreset: pref, customTarget: '' };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for gas price injected from Find Gas tab
  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent<{ price: string; name?: string; distanceMi?: number; grade?: string }>).detail;
      if (detail?.price) {
        liveRecalcRef.current({ pricePerGallon: detail.price });
        if (detail.name) {
          setNearbyAttrib({ name: detail.name, distanceMi: detail.distanceMi ?? 0, grade: detail.grade ?? 'Regular' });
          setNearbyStatus('found');
        }
      }
    }
    window.addEventListener('gc:inject-gas-price', handler);
    return () => window.removeEventListener('gc:inject-gas-price', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Native only: silently fetch nearest gas price on mount and pre-fill if field is empty
  useEffect(() => {
    if (!isNative || !isPro) return;
    if (form.pricePerGallon) return; // don't overwrite user-entered value
    const locAsked = (() => { try { return localStorage.getItem('gc_loc_asked') === '1'; } catch { return false; } })();

    if (!locAsked) {
      // Location never asked — show prompt to go to Find Gas
      setNearbyStatus('unavailable');
      return;
    }

    setNearbyStatus('fetching');
    navigator.geolocation?.getCurrentPosition(
      async (pos) => {
        try {
          const lat = Math.round(pos.coords.latitude  * 100) / 100;
          const lng = Math.round(pos.coords.longitude * 100) / 100;
          const res  = await fetch(`/gas/nearby?lat=${lat}&lng=${lng}`);
          if (!res.ok) { setNearbyStatus('unavailable'); return; }
          const data = await res.json() as { stations?: import('@/lib/nearbyGas').NearbyStation[] };
          const station = data.stations?.find((s) => s.prices.length > 0);
          if (!station) { setNearbyStatus('unavailable'); return; }
          const regular = station.prices.find((p) => p.type === 'REGULAR') ?? station.prices[0];
          if (!regular) { setNearbyStatus('unavailable'); return; }
          setForm((prev) => {
            if (prev.pricePerGallon) return prev;
            return { ...prev, pricePerGallon: regular.price.toFixed(2) };
          });
          setNearbyAttrib({ name: station.name, distanceMi: station.distanceMi, grade: regular.label });
          setNearbyStatus('found');
          setGasCoords({ lat: station.lat, lng: station.lng });
        } catch { setNearbyStatus('unavailable'); }
      },
      () => setNearbyStatus('unavailable'),
      { timeout: 6000, maximumAge: 300_000, enableHighAccuracy: false },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNative, isPro]);

  // Standard patch — clears result (free/guest behaviour)
  function patch(p: Partial<FormState>) {
    // QR placard pilot — fire calc_start the first time the user touches the form
    if (!calcStartFired.current && typeof window !== 'undefined' && typeof window.gcTrack === 'function') {
      calcStartFired.current = true;
      window.gcTrack('calc_start', { mode: 'target_fill' });
    }
    setForm((prev) => ({ ...prev, ...p }));
    if (tip) setTip(''); // they're filling something in — clear the "you forgot a step" hint
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

  // Keep ref in sync so the event listener always has the latest version
  liveRecalcRef.current = liveRecalc;

  const gaugePercent = form.fuelMode === 'percent'
    ? (isNaN(Number(form.currentFuel)) ? 0 : Number(form.currentFuel))
    : 0;

  function handleScanConfirm({ percent, confidence, gaugeType, detected, reason }: {
    percent: number; confidence: number; gaugeType: string; detected: number | null; reason: string;
  }) {
    liveRecalc({ currentFuel: String(percent), fuelMode: 'percent' });
    setScanFromDashboard(true);
    setGaugeScanMsg('');
    setShowScanModal(false);
    // Fire-and-forget feedback log
    fetch('/api/gauge/scan-feedback', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        detectedPercent:  detected,
        confirmedPercent: percent,
        confidence,
        gaugeType,
        reason,
        vehicleId:   form.vehicleId   || undefined,
        vehicleName: form.vehicleName || undefined,
        tankSize:    Number(form.tankCapacity) || undefined,
      }),
    }).catch(() => { /* non-critical */ });
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
    if (Object.keys(errs).length > 0) {
      // Don't fail silently — tell them which step they missed, right at the button,
      // and take them up to the highlighted field.
      const need = t.calc.need;
      const labels = [
        errs.tankCapacity   && need.tank,
        errs.currentFuel    && need.fuel,
        errs.targetPercent  && need.goal,
        errs.pricePerGallon && need.price,
      ].filter(Boolean) as string[];
      setTip(labels.length ? `${t.calc.tipPrefix} ${labels.join(' · ')}` : '');
      setTimeout(() => {
        document.querySelector('.input-field-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 60);
      return;
    }

    setTip('');
    const calcResult = calcTargetFill(input);
    setResult(calcResult);
    setCalculated(true);
    setShowLiveNudge(false);
    setCalcKey((k) => k + 1);
    trackCalculateTarget();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('gascap:calculated'));
      const prefillData = {
        gallons: calcResult.gallonsNeeded,
        ppg:     Number(form.pricePerGallon),
        station: nearbyAttrib?.name ?? '',
      };
      sessionStorage.setItem('gc_gig_prefill', JSON.stringify(prefillData));
      window.dispatchEvent(new CustomEvent('gc:gig-prefill', { detail: prefillData }));
    }
    fetch('/api/activity', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ event: 'calc', localDate: new Date().toLocaleDateString('en-CA') }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d?.firstCalcBonusGranted) {
          window.dispatchEvent(new CustomEvent('gascap:entries-earned', { detail: { entriesWon: 5 } }));
        }
      })
      .catch(() => {});
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
    setVehicleTankEst(undefined);
    setVehicleBodyClass(undefined);
    setPresetLabel('');
  }

  const isCustom    = form.targetPreset === null;
  const tankNum     = Number(form.tankCapacity) || undefined;
  const isLive      = isPro && calculated;
  const tankWarning = checkTankSize(Number(form.tankCapacity) || undefined, vehicleTankEst, vehicleBodyClass);

  return (
    <div className="pb-2">

      {/* ── Tool header ──────────────────────────────────────────── */}
      <div className="bg-[#1E2D4A] rounded-2xl px-4 py-3.5 mb-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center flex-shrink-0">
          <span className="text-lg leading-none">⛽</span>
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-black text-white">{t.calc.introTitle}</h2>
          <p className="text-[11px] text-white/60 leading-snug mt-0.5">
            {t.calc.introSub}
          </p>
        </div>
      </div>

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
          trackRentalReturnToggled(next);
          if (next) liveRecalc({ targetPreset: rentalPickupLevel, customTarget: '' });
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

      {/* Rental detail panel — only when rental mode is on */}
      {rentalMode && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3 mb-3 space-y-3">

          {/* Return-day alert */}
          {rentalReturnAlert && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-xl px-3 py-2">
              <span className="text-base flex-shrink-0" aria-hidden="true">⏰</span>
              <p className="text-[11px] font-bold text-amber-800 leading-snug">
                {rentalReturnAlert === 'today'
                  ? t.calc.rentalReturnAlertToday
                  : t.calc.rentalReturnAlertTomorrow}
              </p>
            </div>
          )}

          {/* Pickup fuel level */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base" aria-hidden="true">⛽</span>
              <p className="text-xs font-black text-blue-800">{t.calc.rentalPickupLevelLabel}</p>
            </div>
            <p className="text-[11px] text-blue-600 leading-snug mb-2">{t.calc.rentalPickupLevelHint}</p>
            <div className="flex gap-1.5 flex-wrap">
              {([100, 75, 50, 25, 0] as const).map((pct) => {
                const label = pct === 100 ? 'Full' : pct === 75 ? '¾' : pct === 50 ? '½' : pct === 25 ? '¼' : 'E';
                const active = rentalPickupLevel === pct;
                return (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => {
                      setRentalPickupLevel(pct);
                      liveRecalc({ targetPreset: pct, customTarget: '' });
                    }}
                    className={[
                      'flex-1 min-w-[44px] py-1.5 rounded-lg text-xs font-black border transition-colors',
                      active
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-blue-700 border-blue-200 hover:border-blue-400',
                    ].join(' ')}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Return date */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base" aria-hidden="true">📅</span>
              <p className="text-xs font-black text-blue-800">{t.calc.rentalReturnDateLabel}</p>
              <span className="text-[10px] text-blue-500 font-medium">{t.calc.rentalRateOptional}</span>
            </div>
            <p className="text-[11px] text-blue-600 leading-snug mb-1.5">{t.calc.rentalReturnDateHint}</p>
            <input
              type="date"
              className="input-field border-blue-200 bg-white text-sm"
              value={rentalReturnDate}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setRentalReturnDate(e.target.value)}
              aria-label={t.calc.rentalReturnDateLabel}
            />
          </div>

          {/* Rental company rate */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base" aria-hidden="true">🏢</span>
              <p className="text-xs font-black text-blue-800">{t.calc.rentalRateLabel}</p>
              <span className="text-[10px] text-blue-500 font-medium">{t.calc.rentalRateOptional}</span>
            </div>
            <p className="text-[11px] text-blue-600 leading-snug mb-1.5">{t.calc.rentalRateHint}</p>
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

        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          STEP 1 — Tank size (pick a vehicle or enter gallons)
      ══════════════════════════════════════════════════════════════ */}
      <StepLabel n={1} title={t.calc.step1} />
      <div className="card">
        <TankPresets
          value={form.tankCapacity}
          onChange={(v) => {
            // Manual typing — clear both garage and preset selections
            patch({ tankCapacity: v, vehicleId: '', vehicleName: '', vehicleOdometer: undefined });
            setVehicleTankEst(undefined);
            setVehicleBodyClass(undefined);
            setPresetLabel('');
          }}
          onPresetSelect={(v, label) => {
            // Dropdown selection — clear garage, set preset label
            patch({ tankCapacity: v, vehicleId: '', vehicleName: '', vehicleOdometer: undefined });
            setVehicleTankEst(undefined);
            setVehicleBodyClass(undefined);
            setPresetLabel(label);
          }}
          vehicleSourceLabel={form.vehicleId ? form.vehicleName : presetLabel}
          vehicleSourceType={form.vehicleId ? 'garage' : presetLabel ? 'preset' : undefined}
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
            onSelect={(g, v) => {
              patch({ tankCapacity: g, vehicleName: v?.name ?? '', vehicleId: v?.id ?? '', vehicleOdometer: v?.currentOdometer });
              setVehicleTankEst(v?.vehicleSpecs?.tankEstGallons);
              setVehicleBodyClass(v?.vehicleSpecs?.bodyClass);
              setPresetLabel('');
              // Notify VehicleChip in the native header so it updates immediately
              if (v?.id) window.dispatchEvent(new CustomEvent('gc:vehicle-selected', { detail: { vehicleId: v.id } }));
            }}
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

            {/* ── Scan gauge button ── */}
            <div className="mt-2 space-y-1.5">
              {isLoggedIn ? (
                <>
                  {scanFromDashboard && (
                    <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-3 py-1.5">
                      <p className="text-[11px] text-green-700 font-medium">{t.scan.setFromScan}</p>
                      <button type="button" onClick={() => setScanFromDashboard(false)}
                        className="text-green-400 hover:text-green-600 text-xs ml-2">✕</button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => { setGaugeScanMsg(''); setShowScanModal(true); }}
                    disabled={gaugeScanning}
                    className="flex items-center gap-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2 hover:border-amber-300 hover:text-amber-700 transition-colors disabled:opacity-50"
                  >
                    <span>📷</span>
                    <span>{t.calc.scanGauge}</span>
                  </button>
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
            onChange={(e) => { setNearbyAttrib(null); setNearbyStatus('unavailable'); patch({ pricePerGallon: e.target.value }); }}
            onBlur={(e)  => liveRecalc({ pricePerGallon: e.target.value })}
            aria-label={t.calc.ariaGasPrice}
          />
        </div>
        {errors.pricePerGallon && <FieldError msg={errors.pricePerGallon} />}
        {isNative ? (
          <div className="mt-1.5 min-h-[20px]">
            {nearbyStatus === 'fetching' && (
              <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <span className="w-3 h-3 border-2 border-slate-300 border-t-teal-500 rounded-full animate-spin inline-block" />
                Finding nearby gas price…
              </p>
            )}
            {nearbyStatus === 'found' && nearbyAttrib && (
              <p className="text-[11px] text-slate-400 flex items-center gap-1 flex-wrap">
                <span>📍</span>
                <span>{nearbyAttrib.name} · {nearbyAttrib.distanceMi} mi · {nearbyAttrib.grade}</span>
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('gc:switch-tab', { detail: { tab: 'findgas' } }))}
                  className="text-teal-600 font-bold"
                >
                  Change →
                </button>
              </p>
            )}
            {(nearbyStatus === 'unavailable' || nearbyStatus === 'idle') && (
              <button
                onClick={() => window.dispatchEvent(new CustomEvent('gc:switch-tab', { detail: { tab: 'findgas' } }))}
                className="text-[11px] text-teal-600 font-bold flex items-center gap-1"
              >
                <span>📍</span> Find nearby gas price →
              </button>
            )}
          </div>
        ) : (
          <GasPriceLookup
            autoFill
            currentValue={form.pricePerGallon}
            onApply={(p, lat, lng) => {
              liveRecalc({ pricePerGallon: p });
              if (lat != null && lng != null) setGasCoords({ lat, lng });
            }}
          />
        )}
      </div>

      {/* Tank size validation warning — shown when entered gallons diverges from EPA estimate */}
      {tankWarning && (
        <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 mb-2">
          <span className="text-sm flex-shrink-0 mt-0.5" aria-hidden="true">⚠️</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-amber-800 leading-snug">{tankWarning.message}</p>
            {tankWarning.suggestion !== undefined && (
              <button
                type="button"
                onClick={() => patch({ tankCapacity: String(tankWarning.suggestion) })}
                className="mt-1.5 text-[11px] font-bold text-amber-900 underline underline-offset-2 hover:text-amber-700 transition-colors"
              >
                Use EPA estimate ({tankWarning.suggestion} gal)
              </button>
            )}
          </div>
        </div>
      )}

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

      {/* "You forgot a step" hint — shown right at the button so a tap never feels broken */}
      {tip && (
        <div className="mb-3 flex items-start gap-2 rounded-xl bg-red-50 border border-red-300 px-3.5 py-2.5 animate-fade-in">
          <span className="text-base leading-none flex-shrink-0" aria-hidden="true">👆</span>
          <p className="text-sm font-bold text-red-700">{tip}</p>
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
            latitude={gasCoords?.lat}
            longitude={gasCoords?.lng}
            stationName={nearbyAttrib?.name}
            fuelGrade={nearbyAttrib?.grade}
          />
        )}
        {result && isGigMode && (
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('gc:switch-tab', { detail: { tab: 'driver' } }));
              window.dispatchEvent(new CustomEvent('gascap:switch-tools-tab', { detail: { tab: 'driver' } }));
            }}
            className="mt-3 w-full flex items-center gap-3 bg-[#1E2D4A] rounded-2xl px-4 py-3 text-left active:opacity-80 transition-opacity"
          >
            <span className="text-xl flex-shrink-0">📦</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-black text-white leading-tight">You&rsquo;re in Gig Driver mode</p>
              <p className="text-[10px] text-white/60 mt-0.5 leading-snug">This fill-up is pre-filled in your Driver tab — tap to log it for taxes.</p>
            </div>
            <svg className="w-4 h-4 text-white/40 flex-shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 4l4 4-4 4"/></svg>
          </button>
        )}
      </div>

      {/* ── Gauge scan modal ── */}
      {showScanModal && (
        <GaugeScanModal
          onConfirm={handleScanConfirm}
          onClose={() => setShowScanModal(false)}
        />
      )}
    </div>
  );
}

// ── Shared sub-components ──────────────────────────────────────────────

function StepLabel({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-3 mt-5 mb-2.5">
      <span className="w-7 h-7 rounded-full bg-navy-700 text-white text-sm font-black
                       flex items-center justify-center flex-shrink-0 shadow-sm">
        {n}
      </span>
      <span className="text-base font-black text-slate-700 dark:text-slate-100">{title}</span>
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
