'use client';

import { useState, useRef, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import FuelGauge     from './FuelGauge';
import TankPresets   from './TankPresets';
import SavedVehicles from './SavedVehicles';
import RentalVehicleLookup from './RentalVehicleLookup';
import RentalVinLookup from './RentalVinLookup';
import { scheduleRentalReturnReminder, cancelRentalReturnReminder } from '@/lib/rentalReminder';
import GasPriceLookup from './GasPriceLookup';
import { TargetResultCard } from './ResultCard';
import {
  calcTargetFill,
  validateTargetFill,
  type TargetFillResult,
  type ValidationErrors,
} from '@/lib/calculations';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useIsNative, useNativePlatform } from '@/hooks/useIsNative';
import type { CalcTab } from './CalculatorTabs';
import { useTranslation } from '@/contexts/LanguageContext';
import { trackCalculateTarget, trackRentalReturnToggled } from '@/lib/gtag';
import { checkTankSize } from '@/lib/tankValidation';
import GaugeScanModal from './GaugeScanModal';

// Gauge photo-scan: SHELVED again (2026-07-09) — not accurate enough to trust, even
// on clean images. The full Pro geometry pipeline (vision locates needle/E/F, server
// computes angle→% + cross-check) is kept intact for a possible future revisit. The
// manual needle-drag slider is the free, accurate path. Flip to true (AND the server
// guard in app/api/gauge/scan/route.ts) to re-enable.
const GAUGE_SCAN_ENABLED = false;

// ── Types ──────────────────────────────────────────────────────────────

// 'miles' lets drivers enter the dash's distance-to-empty readout. Many newer
// vehicles have a digital or coarse bar gauge with no usable tick marks, so
// there's nothing to drag the needle to. Converted to gallons before it
// reaches the calculator, which only knows percent and gallons.
type FuelMode = 'percent' | 'gallons' | 'miles';

/**
 * Gallons left, from a dash distance-to-empty reading.
 *
 * Both inputs are themselves estimates — the dash figure is computed from
 * recent driving and is usually deliberately conservative — so this is an
 * approximation of an approximation. It is still far better than guessing at a
 * gauge with no tick marks, which is the alternative for these vehicles.
 * Capped at the tank so a generous readout can't imply more than the car holds.
 */
function gallonsFromMilesRemaining(miles: number, mpg: number, tankCapacity: number): number | undefined {
  if (!(miles > 0) || !(mpg > 0)) return undefined;
  const gallons = miles / mpg;
  return tankCapacity > 0 ? Math.min(gallons, tankCapacity) : gallons;
}

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
  milesRemaining:  string;   // dash distance-to-empty, when fuelMode is 'miles'
  mpgForMiles:     string;   // MPG used for the conversion (auto-filled, editable)
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
  milesRemaining:  '',
  mpgForMiles:     '',
};

// Eighth-tank increments — more obvious tap targets than typing an exact
// percentage. Rounded to the nearest whole percent (12.5 -> 13, etc).
// "Full" label is localized inside the component via t.calc.presetFull
const TARGET_PRESET_VALUES: { label: string; value: number }[] = [
  { label: '⅛', value: 13  },
  { label: '¼', value: 25  },
  { label: '⅜', value: 38  },
  { label: '½', value: 50  },
  { label: '⅝', value: 63  },
  { label: '¾', value: 75  },
  { label: '⅞', value: 88  },
];

const CUSTOM_NUDGE_STEP = 5;


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
  // iOS's WKWebView renders <input type=date/time> without the ghost-text
  // segments Safari/Chrome show — Android's WebView is Chromium-based and
  // already renders its own, so this overlay is iOS-only to avoid doubling
  // up with a native rendering that (unlike iOS) is already there.
  const nativePlatform = useNativePlatform();

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
  // Persisted (not just component state) so switching to the Budget/EV tab —
  // which unmounts this component entirely — doesn't silently exit rental mode.
  const [rentalMode,        setRentalMode]        = useLocalStorage<boolean>('gc_rental_mode_active', false);
  const [rentalRate,        setRentalRate]        = useState('');
  const [rentalPickupLevel, setRentalPickupLevel] = useState(100); // % — 100 = full
  const [rentalReturnDate,  setRentalReturnDate]  = useState('');  // YYYY-MM-DD
  const [rentalReturnTime,  setRentalReturnTime]  = useState('');  // HH:MM (24h)
  const [gasCoords,     setGasCoords]     = useState<{ lat: number; lng: number } | null>(null);
  const [nearbyAttrib,  setNearbyAttrib]  = useState<{ name: string; distanceMi: number; grade: string } | null>(null);
  const [nearbyStatus,  setNearbyStatus]  = useState<'idle' | 'fetching' | 'found' | 'unavailable'>('idle');
  // Confirms the price was applied after a Find Gas tap — the calculator doesn't
  // auto-scroll to the price field, so without this the user has no feedback that
  // anything happened.
  const [priceToast,        setPriceToast]        = useState<string | null>(null);
  const [priceToastExiting, setPriceToastExiting]  = useState(false);
  // EPA/AI tank estimate for the currently-selected vehicle (used for validation warning)
  const [vehicleTankEst,   setVehicleTankEst]   = useState<number | undefined>(undefined);
  const [vehicleBodyClass, setVehicleBodyClass] = useState<string | undefined>(undefined);
  // Tank-size source tracking — drives the "From garage / VIN match / Lookup
  // match / From list" badge in TankPresets. 'dropdown' is the rental-class
  // preset picker; 'lookup' is Year/Make/Model; 'vin' is the VIN scan/entry —
  // kept distinct from 'dropdown' so TankPresets knows to blank its own
  // <select> display when the tank size came from somewhere else instead of
  // showing a stale rental-class selection next to the real (exact) one.
  // Persisted — form.tankCapacity (the actual gallons number) already
  // survives a close/reopen via its own useLocalStorage, but this label was
  // plain useState, so the number would survive while the vehicle identity
  // attached to it silently vanished, making the selection look cleared.
  const [presetLabel, setPresetLabel] = useLocalStorage<string>('gc_target_preset_label', '');
  const [presetSourceKind, setPresetSourceKind] = useLocalStorage<'dropdown' | 'lookup' | 'vin'>('gc_target_preset_source', 'dropdown');
  // Once a vehicle source is set in Rental Mode, the Year/Make/Model and VIN
  // lookup sections collapse behind a toggle instead of staying visible
  // alongside the already-resolved tank size — was confusing users into
  // thinking they needed to fill in every option.
  const [expandAltVehicleInputs, setExpandAltVehicleInputs] = useState(false);
  const calcStartFired  = useRef(false);
  // Stable ref so the gc:inject-gas-price event handler always calls the latest liveRecalc
  const liveRecalcRef   = useRef<(p: Partial<FormState>) => void>(() => {});

  // Persist rental pickup level + return date/time in localStorage so values survive a page refresh
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const lvl  = localStorage.getItem('gc_rental_pickup_level');
    const date = localStorage.getItem('gc_rental_return_date');
    const time = localStorage.getItem('gc_rental_return_time');
    if (lvl)  setRentalPickupLevel(Number(lvl));
    if (date) setRentalReturnDate(date);
    if (time) setRentalReturnTime(time);
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
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (rentalReturnTime) localStorage.setItem('gc_rental_return_time', rentalReturnTime);
    else localStorage.removeItem('gc_rental_return_time');
  }, [rentalReturnTime]);

  // Schedule (or cancel) the 2-hours-before drop-off reminder whenever date/time change
  useEffect(() => {
    if (rentalReturnDate && rentalReturnTime) {
      scheduleRentalReturnReminder(rentalReturnDate, rentalReturnTime);
    } else {
      cancelRentalReturnReminder();
    }
  }, [rentalReturnDate, rentalReturnTime]);

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
  // Rental Mode already persists across sessions via useLocalStorage above —
  // that's correct, it should survive a close/reopen exactly as the user left
  // it. The bug this ref fixes: this effect's job is to auto-activate rental
  // mode for accounts whose Driver Mode default is 'rental', but it used to
  // ALSO auto-deactivate it on every single mount whenever the account's
  // default wasn't 'rental' — silently undoing a manual toggle for anyone
  // who isn't a rental-by-default user but turned it on for one trip.
  // "Only disabled manually" means the auto-off should fire for a genuine
  // LIVE account-mode change away from 'rental' during this session, never
  // for the initial resolution of whatever the account's mode already was.
  const prevUserModeRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const fromRentalPage = typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('rental') === '1';
    const isFirstResolution = prevUserModeRef.current === undefined;
    const wasRental = prevUserModeRef.current === 'rental';
    prevUserModeRef.current = userMode;

    if ((userMode === 'rental' || fromRentalPage) && !rentalMode) {
      setRentalMode(true);
      setForm(prev => ({ ...prev, targetPreset: rentalPickupLevel, customTarget: '' }));
    } else if (!isFirstResolution && wasRental && userMode !== 'rental' && !fromRentalPage && rentalMode) {
      // A real switch away from 'rental' happened while the app was open —
      // safe to turn rental mode off since it was tracking the account default.
      setRentalMode(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userMode]);

  // Let the native header know rental mode's state — it hides the garage
  // VehicleChip while rental mode is active, since garage vehicles aren't
  // used for rental calculations.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('gc:rental-mode', { detail: { active: rentalMode } }));
  }, [rentalMode]);

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
        // Switching tabs to the calculator doesn't scroll to the price field, so
        // confirm the tap actually did something via a toast instead.
        setPriceToastExiting(false);
        setPriceToast(t.calc.priceAppliedToast(detail.price, detail.name));
      }
    }
    window.addEventListener('gc:inject-gas-price', handler);
    return () => window.removeEventListener('gc:inject-gas-price', handler);
  // liveRecalcRef intentionally omitted (see its own comment) — t is included so the
  // toast doesn't use a stale-language closure if the user switches language mid-session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  // Auto-dismiss the price-applied toast
  useEffect(() => {
    if (!priceToast) return;
    const dismissTimer = setTimeout(() => {
      setPriceToastExiting(true);
      setTimeout(() => setPriceToast(null), 350);
    }, 5000);
    return () => clearTimeout(dismissTimer);
  }, [priceToast]);

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

    async function applyNearby(lat: number, lng: number) {
      try {
        const rLat = Math.round(lat * 100) / 100;
        const rLng = Math.round(lng * 100) / 100;
        const res  = await fetch(`/gas/nearby?lat=${rLat}&lng=${rLng}`);
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
    }

    // Raw navigator.geolocation is unreliable inside an Android WebView — it
    // doesn't reliably surface the native permission dialog the way it does
    // in iOS's WKWebView. Use the Capacitor plugin on native so this behaves
    // the same on both platforms (matches the Find Gas tab's approach).
    if (isNative) {
      import('@capacitor/geolocation').then(({ Geolocation }) => {
        Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 6000 })
          .then((pos) => applyNearby(pos.coords.latitude, pos.coords.longitude))
          .catch(() => setNearbyStatus('unavailable'));
      }).catch(() => setNearbyStatus('unavailable'));
    } else {
      navigator.geolocation?.getCurrentPosition(
        (pos) => applyNearby(pos.coords.latitude, pos.coords.longitude),
        () => setNearbyStatus('unavailable'),
        { timeout: 6000, maximumAge: 300_000, enableHighAccuracy: false },
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNative, isPro]);

  // Applied to all 4 step cards so rental mode stays visually identifiable
  // while scrolling, not just on the toggle/detail panel up top.
  const stepCardClass = rentalMode ? 'card border-2 border-blue-200 bg-blue-50/40' : 'card';

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
      // 'miles' is a UI convenience — resolve it to gallons here so the
      // calculator keeps its two-mode contract.
      fuelInputMode:      merged.fuelMode === 'percent' ? 'percent' as const : 'gallons' as const,
      currentFuelPercent: merged.fuelMode === 'percent' ? Number(merged.currentFuel) : undefined,
      currentFuelGallons: merged.fuelMode === 'gallons'
        ? Number(merged.currentFuel)
        : merged.fuelMode === 'miles'
          ? gallonsFromMilesRemaining(Number(merged.milesRemaining), Number(merged.mpgForMiles), Number(merged.tankCapacity))
          : undefined,
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

  function nudgeCustomTarget(delta: number) {
    const base = form.customTarget !== '' ? Number(form.customTarget) : (form.targetPreset ?? 50);
    const next = Math.min(100, Math.max(1, (isNaN(base) ? 50 : base) + delta));
    liveRecalc({ targetPreset: null, customTarget: String(next) });
  }

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
      fuelInputMode:      form.fuelMode === 'percent' ? 'percent' as const : 'gallons' as const,
      currentFuelPercent: form.fuelMode === 'percent' ? Number(form.currentFuel) : undefined,
      currentFuelGallons: form.fuelMode === 'gallons'
        ? Number(form.currentFuel)
        : form.fuelMode === 'miles'
          ? gallonsFromMilesRemaining(Number(form.milesRemaining), Number(form.mpgForMiles), Number(form.tankCapacity))
          : undefined,
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
    setPresetSourceKind('dropdown');
  }

  const isCustom    = form.targetPreset === null;
  const tankNum     = Number(form.tankCapacity) || undefined;
  const isLive      = isPro && calculated;
  const tankWarning = checkTankSize(Number(form.tankCapacity) || undefined, vehicleTankEst, vehicleBodyClass);
  // A Y/M/M or VIN lookup selection is Rental Mode-specific — once Rental
  // Mode is off, the garage's own SavedVehicles list is the source of truth
  // again, so don't keep attributing the tank number to a rental vehicle
  // that's no longer active. The dropdown preset (a rental-class average,
  // not a specific rental lookup) is useful in both modes, so it stays
  // visible either way. presetLabel/presetSourceKind themselves are
  // untouched — turning Rental Mode back on restores this badge as-is.
  const showPreset  = !!presetLabel && (presetSourceKind === 'dropdown' || rentalMode);

  return (
    <div className="pb-2">

      {/* ── Price-applied toast (confirms a Find Gas tap actually did something,
           since switching to the calculator tab doesn't auto-scroll to the price field) ── */}
      {priceToast && (
        <div
          role="status"
          aria-live="polite"
          onClick={() => { setPriceToastExiting(true); setTimeout(() => setPriceToast(null), 350); }}
          className={[
            'fixed left-1/2 z-[9999] -translate-x-1/2',
            'flex items-center gap-2',
            'max-w-[90vw] w-max rounded-2xl px-5 py-3.5',
            'bg-navy-700 text-white shadow-2xl',
            'text-sm font-semibold leading-snug text-center',
            'cursor-pointer select-none',
            priceToastExiting ? 'animate-toast-exit' : 'animate-toast-enter',
          ].join(' ')}
          style={{ bottom: isNative ? 'calc(92px + env(safe-area-inset-bottom))' : '1.25rem' }}
        >
          {priceToast}
        </div>
      )}

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

      {rentalMode && (
        <a
          href="/rental-return"
          className="flex items-center justify-between gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 mb-3 -mt-1 hover:bg-blue-100 transition-colors"
        >
          <span className="text-[11px] text-blue-700 font-semibold leading-snug">{t.calc.rentalReturnAssistantLinkHint}</span>
          <svg viewBox="0 0 12 12" className="w-3.5 h-3.5 flex-shrink-0 text-blue-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M2 6h8M6 2l4 4-4 4" />
          </svg>
        </a>
      )}

      {/* ══════════════════════════════════════════════════════════════
          STEP 1 — Tank size (pick a vehicle or enter gallons)
          Shown first in Rental Mode — you know the vehicle before you know
          the return date or pickup fuel level.
      ══════════════════════════════════════════════════════════════ */}
      <StepLabel n={1} title={t.calc.step1} />
      <div className={stepCardClass}>
        {rentalMode && isLoggedIn && (
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5 mb-2">
            <span className="text-base flex-shrink-0" aria-hidden="true">🚪</span>
            <p className="text-[11px] text-blue-600 leading-snug">
              <span className="font-black">{t.calc.garageClosedTitle}</span>{t.calc.garageClosedHint}
            </p>
          </div>
        )}
        <TankPresets
          value={form.tankCapacity}
          onChange={(v) => {
            // Manual typing — clear both garage and preset selections
            patch({ tankCapacity: v, vehicleId: '', vehicleName: '', vehicleOdometer: undefined });
            setVehicleTankEst(undefined);
            setVehicleBodyClass(undefined);
            setPresetLabel('');
            setPresetSourceKind('dropdown');
          }}
          onPresetSelect={(v, label) => {
            // Dropdown selection — clear garage, set preset label
            patch({ tankCapacity: v, vehicleId: '', vehicleName: '', vehicleOdometer: undefined });
            setVehicleTankEst(undefined);
            setVehicleBodyClass(undefined);
            setPresetLabel(label);
            setPresetSourceKind('dropdown');
            setExpandAltVehicleInputs(false);
          }}
          vehicleSourceLabel={form.vehicleId ? form.vehicleName : showPreset ? presetLabel : undefined}
          vehicleSourceType={form.vehicleId ? 'garage' : showPreset ? (presetSourceKind === 'vin' ? 'vin' : presetSourceKind === 'lookup' ? 'lookup' : 'preset') : undefined}
          rentalMode={rentalMode}
        />
        {errors.tankCapacity && <FieldError msg={errors.tankCapacity} />}
        {rentalMode ? (
          <>
            {(!presetLabel || expandAltVehicleInputs) ? (
              <>
                {/* "Change" reopens this section without clearing the current
                    selection (tankCapacity/presetLabel are untouched until a
                    new lookup actually resolves) — surface a way back out so
                    the user isn't forced to redo the search just to keep what
                    they already picked. */}
                {presetLabel && (
                  <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 mb-2">
                    <p className="text-[11px] text-slate-500 truncate">
                      {t.calc.rentalKeepCurrentVehicle(presetLabel)}
                    </p>
                    <button
                      type="button"
                      onClick={() => setExpandAltVehicleInputs(false)}
                      className="flex-shrink-0 text-[11px] font-bold text-teal-600 hover:text-teal-800 ml-2"
                    >
                      {t.calc.rentalCancelChange}
                    </button>
                  </div>
                )}
                <RentalVehicleLookup
                  onTankSize={(g, label) => {
                    patch({ tankCapacity: g, vehicleId: '', vehicleName: '', vehicleOdometer: undefined });
                    setVehicleTankEst(undefined);
                    setVehicleBodyClass(undefined);
                    setPresetLabel(label);
                    setPresetSourceKind('lookup');
                    setExpandAltVehicleInputs(false);
                  }}
                />
                <RentalVinLookup
                  onTankSize={(g, label) => {
                    patch({ tankCapacity: g, vehicleId: '', vehicleName: '', vehicleOdometer: undefined });
                    setVehicleTankEst(undefined);
                    setVehicleBodyClass(undefined);
                    setPresetLabel(label);
                    setPresetSourceKind('vin');
                    setExpandAltVehicleInputs(false);
                  }}
                />
              </>
            ) : presetSourceKind === 'dropdown' ? (
              // Dropdown-origin selection is already visible in the Tank Size
              // <select> above — no need for a redundant summary here.
              <button
                type="button"
                onClick={() => setExpandAltVehicleInputs(true)}
                className="text-[11px] font-bold text-blue-600 hover:text-blue-800 mt-2"
              >
                {t.calc.rentalShowOtherVehicleOptions}
              </button>
            ) : (
              // Lookup/VIN-origin selection has no other visible trace once
              // these sections collapse — show a real summary right where the
              // user was just interacting, not just a small badge up in the
              // Tank Size field.
              <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 mt-2">
                <span className="text-xl flex-shrink-0" aria-hidden="true">✅</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black text-amber-800 truncate">{presetLabel}</p>
                  <p className="text-[11px] text-amber-600">{t.calc.rentalVehicleAppliedTank(form.tankCapacity)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setExpandAltVehicleInputs(true)}
                  className="flex-shrink-0 text-[11px] font-bold text-amber-700 hover:text-amber-900 underline underline-offset-2"
                >
                  {t.calc.rentalChangeVehicle}
                </button>
              </div>
            )}
          </>
        ) : (
          <SavedVehicles
            currentGallons={form.tankCapacity}
            onSelect={(g, v) => {
              patch({
                tankCapacity: g, vehicleName: v?.name ?? '', vehicleId: v?.id ?? '',
                vehicleOdometer: v?.currentOdometer,
                // Prefill the MPG used for distance-to-empty conversion. EPA
                // combined is the same figure MpgInsightCard prefers, and it's
                // available immediately for VIN-added vehicles. Still editable.
                ...(v?.vehicleSpecs?.combMpg ? { mpgForMiles: String(v.vehicleSpecs.combMpg) } : {}),
              });
              setVehicleTankEst(v?.vehicleSpecs?.tankEstGallons);
              setVehicleBodyClass(v?.vehicleSpecs?.bodyClass);
              setPresetLabel('');
              setPresetSourceKind('dropdown');
              // Notify VehicleChip in the native header so it updates immediately
              if (v?.id) window.dispatchEvent(new CustomEvent('gc:vehicle-selected', { detail: { vehicleId: v.id } }));
            }}
            selectedVehicleId={form.vehicleId}
            calcKey={calcKey}
          />
        )}
      </div>

      {/* Rental detail panel — only when rental mode is on. Ordered to match
          the actual pickup sequence: return date/time is usually known before
          you even leave for the counter; pickup fuel level is checked once
          you're physically in the car; rental rate is optional and last. */}
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

          {/* Return date */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base" aria-hidden="true">📅</span>
              <p className="text-xs font-black text-blue-800">{t.calc.rentalReturnDateTimeLabel}</p>
              <span className="text-[10px] text-blue-500 font-medium">{t.calc.rentalRateOptional}</span>
            </div>
            <p className="text-[11px] text-blue-600 leading-snug mb-1.5">{t.calc.rentalReturnDateHint}</p>
            <div className="flex flex-col gap-2 w-full min-w-0 overflow-hidden">
              <div className="min-w-0 overflow-hidden">
                <label className="block text-[10px] font-bold text-blue-500 mb-0.5">{t.calc.rentalReturnDateLabel}</label>
                <div className="relative" style={{ width: '148px', maxWidth: '100%' }}>
                  <input
                    type="date"
                    className="input-field border-blue-200 bg-white text-sm px-3 py-2"
                    style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}
                    value={rentalReturnDate}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setRentalReturnDate(e.target.value)}
                    aria-label={t.calc.rentalReturnDateLabel}
                  />
                  {/* Native <input type=date> has no functional placeholder attribute —
                      browsers show their own locale-formatted "mm/dd/yyyy" segments
                      instead, which the iOS/Android WebView doesn't reliably render.
                      Web already shows the native version, so this is native-only to
                      avoid doubling up with it there. */}
                  {nativePlatform === 'ios' && !rentalReturnDate && (
                    <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-sm text-slate-400">
                      mm/dd/yyyy
                    </span>
                  )}
                </div>
              </div>
              <div className="min-w-0 overflow-hidden">
                <label className="block text-[10px] font-bold text-blue-500 mb-0.5">{t.calc.rentalReturnTimeLabel}</label>
                <div className="relative" style={{ width: '110px', maxWidth: '100%' }}>
                  <input
                    type="time"
                    className="input-field border-blue-200 bg-white text-sm px-3 py-2"
                    style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}
                    value={rentalReturnTime}
                    onChange={(e) => setRentalReturnTime(e.target.value)}
                    aria-label={t.calc.rentalReturnTimeLabel}
                  />
                  {nativePlatform === 'ios' && !rentalReturnTime && (
                    <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-sm text-slate-400">
                      --:-- --
                    </span>
                  )}
                </div>
              </div>
            </div>
            {rentalReturnDate && !rentalReturnTime && (
              <p className="text-[10px] text-blue-500 mt-1">{t.calc.rentalReturnTimeHint}</p>
            )}
          </div>

          {/* Pickup fuel level */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base" aria-hidden="true">⛽</span>
              <p className="text-xs font-black text-blue-800">{t.calc.rentalPickupLevelLabel}</p>
            </div>
            <p className="text-[11px] text-blue-600 leading-snug mb-2">{t.calc.rentalPickupLevelHint}</p>
            {/* No "Empty" option — a rental is never handed over with 0 fuel. */}
            <div className="flex gap-1.5 mb-1.5">
              {([13, 25, 38, 50, 63, 75, 88] as const).map((pct) => {
                const label = pct === 88 ? '⅞' : pct === 75 ? '¾' : pct === 63 ? '⅝'
                  : pct === 50 ? '½' : pct === 38 ? '⅜' : pct === 25 ? '¼' : '⅛';
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
                      'flex-1 min-w-[36px] py-1.5 rounded-lg text-xs font-black border transition-colors',
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
            <button
              type="button"
              onClick={() => {
                setRentalPickupLevel(100);
                liveRecalc({ targetPreset: 100, customTarget: '' });
              }}
              className={[
                'w-full py-1.5 rounded-lg text-xs font-black border transition-colors',
                rentalPickupLevel === 100
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-blue-700 border-blue-200 hover:border-blue-400',
              ].join(' ')}
            >
              Full
            </button>
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
          STEP 2 — Set fuel level
      ══════════════════════════════════════════════════════════════ */}
      <StepLabel n={2} title={t.calc.step2} />
      <div className={stepCardClass}>
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
            <ModeBtn label={t.calc.fuelModeMiles} active={form.fuelMode === 'miles'}
              onClick={() => patch({ fuelMode: 'miles' })} />
          </div>
        </div>

        {form.fuelMode === 'percent' ? (
          <>
            <FuelGauge
              percent={gaugePercent}
              onChange={(pct) => liveRecalc({ currentFuel: String(pct) })}
              tankCapacity={tankNum}
            />

            {/* ── Scan gauge button (shelved — see GAUGE_SCAN_ENABLED) ── */}
            {GAUGE_SCAN_ENABLED && (
            <div className="mt-2 space-y-1.5">
              {isPro ? (
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
              ) : isLoggedIn ? (
                /* Logged-in free users: gauge scan is a Pro perk. */
                <a href="/upgrade" className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  <span className="text-amber-500 text-sm">📷</span>
                  <p className="text-[11px] text-amber-700 leading-snug">
                    <span className="font-bold underline underline-offset-2">{t.scan.upgradeCta}</span>
                    {' — '}{t.scan.proRequired}
                  </p>
                </a>
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
            )}
          </>
        ) : form.fuelMode === 'miles' ? (
          /* Distance-to-empty entry, for vehicles whose gauge has no usable
             tick marks. Converted to gallons via MPG. */
          <div className="space-y-2">
            <div className="relative">
              <input
                type="number" inputMode="decimal"
                className="input-field"
                placeholder={t.calc.placeholderMiles}
                value={form.milesRemaining}
                min="0" step="1"
                onChange={(e) => patch({ milesRemaining: e.target.value })}
                onBlur={(e)  => liveRecalc({ milesRemaining: e.target.value })}
                aria-label={t.calc.ariaMilesRemaining}
              />
              <Unit>{t.calc.unitMiles}</Unit>
            </div>

            <div className="relative">
              <input
                type="number" inputMode="decimal"
                className="input-field"
                placeholder={t.calc.placeholderMpg}
                value={form.mpgForMiles}
                min="1" max="200" step="0.1"
                onChange={(e) => patch({ mpgForMiles: e.target.value })}
                onBlur={(e)  => liveRecalc({ mpgForMiles: e.target.value })}
                aria-label={t.calc.ariaMpgForMiles}
              />
              <Unit>{t.calc.unitMpg}</Unit>
            </div>

            {(() => {
              const gal = gallonsFromMilesRemaining(
                Number(form.milesRemaining), Number(form.mpgForMiles), Number(form.tankCapacity),
              );
              if (gal == null) {
                return (
                  <p className="text-[11px] text-slate-400 leading-snug">{t.calc.milesHint}</p>
                );
              }
              const tank = Number(form.tankCapacity);
              const pct  = tank > 0 ? Math.round((gal / tank) * 100) : null;
              return (
                <p className="text-[11px] text-slate-500 leading-snug bg-slate-50 border border-slate-200
                              rounded-xl px-3 py-2">
                  {t.calc.milesEstimate(gal.toFixed(1), pct)}
                </p>
              );
            })()}
          </div>
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
      <div className={stepCardClass}>
        <p className="field-label">{t.calc.fillUpTo}</p>
        <div className="grid grid-cols-4 gap-2 mb-2">
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
        </div>
        <button
          className={`w-full mb-3 ${isCustom ? 'btn-preset-active' : 'btn-preset-inactive'}`}
          onClick={() => patch({ targetPreset: null })}
          aria-pressed={isCustom}
        >
          {t.calc.custom}
        </button>

        {isCustom && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex-none w-11 h-11 flex items-center justify-center rounded-xl border-2 border-slate-200 text-slate-500 bg-white hover:border-amber-300 hover:text-amber-600 font-bold text-xl transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:ring-offset-1"
              onClick={() => nudgeCustomTarget(-CUSTOM_NUDGE_STEP)}
              aria-label={t.calc.ariaNudgeDown}
            >
              −
            </button>
            <div className="relative flex-1">
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
            <button
              type="button"
              className="flex-none w-11 h-11 flex items-center justify-center rounded-xl border-2 border-slate-200 text-slate-500 bg-white hover:border-amber-300 hover:text-amber-600 font-bold text-xl transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:ring-offset-1"
              onClick={() => nudgeCustomTarget(CUSTOM_NUDGE_STEP)}
              aria-label={t.calc.ariaNudgeUp}
            >
              +
            </button>
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
      <div className={`${stepCardClass} mb-4`}>
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
            onFocus={(e) => {
              // This field sits low in Step 4 — the native keyboard can cover it
              // even when the browser's own scroll-into-view doesn't kick in.
              // Force it into view, centered above the keyboard.
              setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
            }}
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
