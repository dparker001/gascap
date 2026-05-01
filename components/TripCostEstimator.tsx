'use client';

import { useState, useCallback, useEffect } from 'react';
import { useSession }                        from 'next-auth/react';
import Link                                  from 'next/link';
import GasPriceLookup                        from './GasPriceLookup';
import GoogleMapsHandoffButton               from './GoogleMapsHandoffButton';
import WazeDeepLinkButton                    from './WazeDeepLinkButton';
import { canAccessFeature, UPGRADE_COPY }    from '@/lib/featureAccess';
import type { Vehicle }                      from './SavedVehicles';

// ── Types ──────────────────────────────────────────────────────────────────

interface TripResult {
  totalMiles:        number;
  totalGallons:      number;   // full trip gallons (no offset)
  totalTripCost:     number;   // full trip cost (no offset)
  currentGalOffset:  number;   // gallons already in tank
  currentCostOffset: number;   // value of fuel already in tank
  gallonsNeeded:     number;   // gallons still to buy
  fuelCost:          number;   // cost of gallons still to buy
  stops:             number;
  costPerPerson:     number | null;
  milesPerDollar:    number;
  tankfulls:         number;
  summary:           string;
}

// ── Rental presets ─────────────────────────────────────────────────────────

interface RentalPreset {
  label:   string;
  mpg:     number;
  tankGal: number;
}

const RENTAL_PRESETS: RentalPreset[] = [
  { label: 'Compact Car',       mpg: 32, tankGal: 12.0 },
  { label: 'Midsize Car',       mpg: 28, tankGal: 16.0 },
  { label: 'Full-size Car',     mpg: 24, tankGal: 17.0 },
  { label: 'Small SUV',         mpg: 28, tankGal: 15.9 },
  { label: 'Midsize SUV',       mpg: 24, tankGal: 19.0 },
  { label: 'Large SUV',         mpg: 18, tankGal: 26.0 },
  { label: 'Minivan',           mpg: 22, tankGal: 20.0 },
  { label: 'Pickup (Half-ton)', mpg: 20, tankGal: 26.0 },
  { label: 'Pickup (Full-ton)', mpg: 16, tankGal: 34.0 },
  { label: 'Hybrid Car',        mpg: 50, tankGal: 11.3 },
  { label: 'Enter manually',    mpg: 0,  tankGal: 0    },
];

// ── Calculation ────────────────────────────────────────────────────────────

function calcTrip(
  miles:     number,
  mpg:       number,
  tankGal:   number,
  fuelPct:   number,    // 0–100 current fuel %
  pricePGal: number,
  people:    number,
): TripResult {
  const totalGallons       = miles / mpg;                          // total gallons for full trip
  const totalTripCost      = totalGallons * pricePGal;             // full trip cost ignoring current fuel
  const currentGalOffset   = Math.min(tankGal * (fuelPct / 100), totalGallons); // gallons already in tank (capped at trip need)
  const currentCostOffset  = currentGalOffset * pricePGal;         // value of current fuel toward trip
  const gallonsNeeded      = Math.max(0, totalGallons - currentGalOffset);
  const fuelCost           = gallonsNeeded * pricePGal;
  const tankRange          = tankGal * mpg;
  // How many times do we need to stop? (after using current fuel)
  const currentMilesInTank = tankGal * (fuelPct / 100) * mpg;
  const remainingAfterCurrent = miles - currentMilesInTank;
  const stops              = remainingAfterCurrent <= 0 ? 0 : Math.ceil(remainingAfterCurrent / tankRange);
  const milesPerDollar     = totalTripCost > 0 ? Math.round((miles / totalTripCost) * 10) / 10 : 0;
  const tankfulls          = Math.round((totalGallons / tankGal) * 10) / 10;
  const costPerPerson      = people > 1 ? Math.round((fuelCost / people) * 100) / 100 : null;

  let summary = '';
  if (gallonsNeeded === 0) {
    summary = `Great news — you already have enough fuel for the full ${miles.toLocaleString()}-mile trip!`;
  } else {
    summary = `This ${miles.toLocaleString()}-mile trip needs ${totalGallons.toFixed(2)} gal total ` +
              `($${totalTripCost.toFixed(2)}). You'll need to buy ${gallonsNeeded.toFixed(2)} gal ` +
              `($${fuelCost.toFixed(2)}) on top of what's in your tank.`;
    if (stops > 0) summary += ` Plan for ${stops} fuel stop${stops > 1 ? 's' : ''} along the way.`;
  }

  return {
    totalMiles:        miles,
    totalGallons:      Math.round(totalGallons * 100) / 100,
    totalTripCost:     Math.round(totalTripCost * 100) / 100,
    currentGalOffset:  Math.round(currentGalOffset * 100) / 100,
    currentCostOffset: Math.round(currentCostOffset * 100) / 100,
    gallonsNeeded:     Math.round(gallonsNeeded * 100) / 100,
    fuelCost:          Math.round(fuelCost * 100) / 100,
    stops,
    costPerPerson,
    milesPerDollar,
    tankfulls,
    summary,
  };
}

// ── Saved vehicle + avg MPG loader ────────────────────────────────────────

interface GarageResp    { vehicles: Vehicle[]; }
interface AvgMpgResp    { avgMpgByVehicleId: Record<string, number>; }

function useGarageData() {
  const { data: session } = useSession();
  const [vehicles,         setVehicles]         = useState<Vehicle[]>([]);
  const [avgMpgByVehicleId, setAvgMpgByVehicleId] = useState<Record<string, number>>({});
  const [loaded,           setLoaded]           = useState(false);

  const load = useCallback(async () => {
    if (!session || loaded) return;
    const [vRes, mRes] = await Promise.all([
      fetch('/api/vehicles'),
      fetch('/api/fillups/avg-mpg'),
    ]);
    if (vRes.ok) {
      const d = await vRes.json() as GarageResp;
      setVehicles(d.vehicles ?? []);
    }
    if (mRes.ok) {
      const d = await mRes.json() as AvgMpgResp;
      setAvgMpgByVehicleId(d.avgMpgByVehicleId ?? {});
    }
    setLoaded(true);
  }, [session, loaded]);

  return { vehicles, avgMpgByVehicleId, load };
}

// ── Resolve best MPG for a garage vehicle ─────────────────────────────────

interface MpgResolution {
  mpg:   number | null;
  label: string;
}

function resolveMpg(v: Vehicle, avgMpgByVehicleId: Record<string, number>): MpgResolution {
  const historyMpg = avgMpgByVehicleId[v.id];
  if (historyMpg != null) {
    return { mpg: historyMpg, label: '📊 Your avg from fillup log' };
  }
  const epaMpg = v.vehicleSpecs?.combMpg;
  if (epaMpg != null) {
    return { mpg: epaMpg, label: '📋 EPA estimate' };
  }
  return { mpg: null, label: 'Enter manually' };
}

// ── Component ─────────────────────────────────────────────────────────────

const DISTANCE_PRESETS = [
  { label: '50 mi',    value: 50   },
  { label: '100 mi',   value: 100  },
  { label: '250 mi',   value: 250  },
  { label: '500 mi',   value: 500  },
  { label: '1,000 mi', value: 1000 },
];

type VehicleMode = 'garage' | 'rental';
type TripPlanMode = 'manual' | 'route';

export default function TripCostEstimator({ embedded = false }: { embedded?: boolean }) {
  const { data: session } = useSession();
  const { vehicles, avgMpgByVehicleId, load: loadGarage } = useGarageData();

  const [open,          setOpen]          = useState(embedded);
  const [miles,         setMiles]         = useState('');
  const [mpg,           setMpg]           = useState('');
  const [tankGal,       setTankGal]       = useState('');
  const [fuelPct,       setFuelPct]       = useState('0');
  const [pricePerGallon,setPricePerGallon] = useState('');
  const [people,        setPeople]        = useState('1');
  const [result,        setResult]        = useState<TripResult | null>(null);
  const [errors,        setErrors]        = useState<Record<string, string>>({});
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('');
  const [mpgSourceLabel,    setMpgSourceLabel]    = useState<string>('');
  const [vehicleMode,       setVehicleMode]       = useState<VehicleMode>('garage');
  const [rentalType,        setRentalType]        = useState<string>('');
  const [tripPlanMode,      setTripPlanMode]      = useState<TripPlanMode>('manual');
  const [gasCoords,         setGasCoords]         = useState<{ lat: number; lng: number } | null>(null);

  const userPlan = (session?.user as { plan?: string })?.plan ?? '';
  const canUseRoutePlanner = canAccessFeature('route_based_trip_planner', userPlan);

  // When embedded (tab panel), eagerly load garage so vehicles are ready without a button click
  useEffect(() => {
    if (embedded && session) loadGarage();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, session]);

  // Once vehicles load, default to garage if there are vehicles, otherwise rental
  useEffect(() => {
    if (!session) setVehicleMode('rental');
  }, [session]);

  // Auto-select first garage vehicle when vehicles load and nothing is selected yet
  useEffect(() => {
    if (vehicles.length > 0 && !selectedVehicleId && vehicleMode === 'garage') {
      loadVehicle(vehicles[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicles]);

  function loadVehicle(v: Vehicle) {
    const { mpg: resolvedMpg, label } = resolveMpg(v, avgMpgByVehicleId);
    setTankGal(String(v.gallons));
    setSelectedVehicleId(v.id);
    if (resolvedMpg != null) {
      setMpg(String(resolvedMpg));
      setMpgSourceLabel(label);
    } else {
      setMpg('');
      setMpgSourceLabel(label);
    }
    setResult(null);
  }

  function loadRentalPreset(label: string) {
    setRentalType(label);
    const preset = RENTAL_PRESETS.find((p) => p.label === label);
    if (!preset) return;
    if (preset.mpg > 0) {
      setMpg(String(preset.mpg));
      setMpgSourceLabel(label === 'Enter manually' ? '' : `📦 Typical for ${label}`);
    } else {
      setMpg('');
      setMpgSourceLabel('');
    }
    if (preset.tankGal > 0) {
      setTankGal(String(preset.tankGal));
    } else {
      setTankGal('');
    }
    setResult(null);
  }

  function setMilesPreset(val: number) {
    setMiles(String(val));
    setResult(null);
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    const milesNum = parseFloat(miles);
    const mpgNum   = parseFloat(mpg);
    const tankNum  = parseFloat(tankGal);
    const priceNum = parseFloat(pricePerGallon);
    const pctNum   = parseFloat(fuelPct);
    const pplNum   = parseInt(people, 10);

    if (!milesNum || milesNum <= 0)        errs.miles         = 'Enter a valid trip distance.';
    if (milesNum > 20000)                  errs.miles         = 'Distance seems too large — max 20,000 mi.';
    if (!mpgNum  || mpgNum  <= 0)          errs.mpg           = 'Enter your vehicle\'s MPG.';
    if (mpgNum   > 200)                    errs.mpg           = 'MPG seems too high — check your entry.';
    if (!tankNum || tankNum <= 0)          errs.tankGal       = 'Enter tank capacity in gallons.';
    if (!priceNum || priceNum <= 0)        errs.pricePerGallon = 'Enter gas price per gallon.';
    if (isNaN(pctNum) || pctNum < 0 || pctNum > 100) errs.fuelPct = 'Enter 0–100%.';
    if (!pplNum  || pplNum < 1)            errs.people        = 'Enter at least 1 person.';

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleCalculate() {
    if (!validate()) return;
    const r = calcTrip(
      parseFloat(miles),
      parseFloat(mpg),
      parseFloat(tankGal),
      parseFloat(fuelPct),
      parseFloat(pricePerGallon),
      parseInt(people, 10),
    );
    setResult(r);
    setTimeout(() => {
      document.getElementById('trip-result')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
  }

  function handleReset() {
    setMiles(''); setMpg(''); setTankGal(''); setFuelPct('0');
    setPricePerGallon(''); setPeople('1'); setResult(null); setErrors({});
    setSelectedVehicleId('');
    setMpgSourceLabel('');
    setRentalType('');
    setVehicleMode(session && vehicles.length > 0 ? 'garage' : 'rental');
  }

  const hasResult = result !== null;

  return (
    <div className={embedded ? '' : 'mt-4'}>
      {/* Toggle header — hidden when embedded in tab panel */}
      {!embedded && (
        <button
          onClick={() => { setOpen((v) => !v); if (!open) loadGarage(); }}
          className="w-full flex items-center justify-between py-3 px-4 bg-white rounded-2xl
                     border border-slate-100 shadow-sm hover:border-amber-200 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <span className="text-lg">🗺️</span>
            <div className="text-left">
              <p className="text-sm font-black text-slate-700">Trip Cost Estimator</p>
              <p className="text-[10px] text-slate-400">How much will my road trip cost?</p>
            </div>
          </div>
          <svg
            className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
      )}

      {(open || embedded) && (
        <div className={embedded ? 'space-y-4' : 'mt-2 bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-4'}>

          {/* ── Trip plan mode: Manual vs Route-Based ── */}
          <div>
            <div className="flex gap-2">
              <button
                onClick={() => setTripPlanMode('manual')}
                className={[
                  'flex-1 py-2 rounded-xl text-xs font-bold border-2 transition-all',
                  tripPlanMode === 'manual'
                    ? 'border-amber-500 bg-amber-50 text-amber-700'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-amber-300',
                ].join(' ')}
              >
                📏 Manual Distance
              </button>
              <button
                onClick={() => setTripPlanMode('route')}
                className={[
                  'flex-1 py-2 rounded-xl text-xs font-bold border-2 transition-all',
                  tripPlanMode === 'route'
                    ? 'border-amber-500 bg-amber-50 text-amber-700'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-amber-300',
                  !canUseRoutePlanner ? 'opacity-70' : '',
                ].join(' ')}
              >
                🗺️ Route-Based {!canUseRoutePlanner && '⭐'}
              </button>
            </div>

            {/* Route-based mode panel */}
            {tripPlanMode === 'route' && (
              <div className="mt-3">
                {!canUseRoutePlanner ? (
                  /* Free user — upgrade prompt */
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-4 space-y-3">
                    <div className="flex items-start gap-2.5">
                      <span className="text-xl flex-shrink-0">⭐</span>
                      <div>
                        <p className="text-sm font-black text-amber-800 leading-snug">
                          {UPGRADE_COPY.routeBasedTripPlanner}
                        </p>
                        <p className="text-[11px] text-amber-700 mt-1 leading-relaxed">
                          Enter a starting point and destination to calculate fuel needs
                          along your actual route — including a recommended refuel window
                          and gas stations along the way.
                        </p>
                      </div>
                    </div>
                    <Link
                      href="/upgrade"
                      className="block w-full text-center px-4 py-2.5 rounded-xl
                                 bg-[#005F4A] text-white text-xs font-bold
                                 hover:bg-[#004d3b] transition-colors"
                    >
                      {UPGRADE_COPY.upgradeCta} →
                    </Link>
                    <button
                      type="button"
                      onClick={() => setTripPlanMode('manual')}
                      className="w-full text-[11px] text-amber-600 font-semibold hover:underline"
                    >
                      Use manual distance instead
                    </button>
                  </div>
                ) : (
                  /* Pro user — coming soon (API not yet configured) */
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-4 space-y-2">
                    <div className="flex items-start gap-2.5">
                      <span className="text-xl flex-shrink-0">🗺️</span>
                      <div>
                        <p className="text-sm font-black text-slate-700 leading-snug">
                          Route-based planning is coming soon.
                        </p>
                        <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                          Enter a starting point and destination to calculate fuel needs
                          along your actual route. For now, GasCap™ can still estimate
                          your fuel need using trip distance below.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTripPlanMode('manual')}
                      className="text-[11px] text-amber-600 font-semibold hover:underline"
                    >
                      Use manual distance for now →
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Mode toggle (garage/rental — signed-in only) ── */}
          {session && (
            <div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setVehicleMode('garage'); loadGarage(); setRentalType(''); }}
                  className={[
                    'flex-1 py-2 rounded-xl text-xs font-bold border-2 transition-all',
                    vehicleMode === 'garage'
                      ? 'border-amber-500 bg-amber-50 text-amber-700'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-amber-300',
                  ].join(' ')}
                >
                  🚗 My Garage
                </button>
                <button
                  onClick={() => { setVehicleMode('rental'); setSelectedVehicleId(''); setMpg(''); setTankGal(''); setMpgSourceLabel(''); }}
                  className={[
                    'flex-1 py-2 rounded-xl text-xs font-bold border-2 transition-all',
                    vehicleMode === 'rental'
                      ? 'border-amber-500 bg-amber-50 text-amber-700'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-amber-300',
                  ].join(' ')}
                >
                  🔄 Rental / Other
                </button>
              </div>
            </div>
          )}

          {/* ── Garage vehicle selector ── */}
          {vehicleMode === 'garage' && session && vehicles.length > 0 && (
            <div>
              <p className="field-label">Quick-load from My Garage</p>
              <div className="flex gap-2 flex-wrap">
                {vehicles.map((v) => {
                  const { mpg: resolvedMpg } = resolveMpg(v, avgMpgByVehicleId);
                  return (
                    <button
                      key={v.id}
                      onClick={() => loadVehicle(v)}
                      className={[
                        'px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition-all',
                        v.id === selectedVehicleId
                          ? 'border-amber-500 bg-amber-50 text-amber-700'
                          : 'border-slate-200 bg-white text-slate-500 hover:border-amber-300',
                      ].join(' ')}
                    >
                      {v.name}
                      <span className="opacity-60"> · {resolvedMpg ?? '?'} mpg · {v.gallons}g</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Rental type selector ── */}
          {(vehicleMode === 'rental' || !session) && (
            <div>
              <p className="field-label">Vehicle Type</p>
              <select
                className="input-field"
                value={rentalType}
                onChange={(e) => loadRentalPreset(e.target.value)}
                aria-label="Rental vehicle type"
              >
                <option value="">Select vehicle type…</option>
                {RENTAL_PRESETS.map((p) => (
                  <option key={p.label} value={p.label}>{p.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* ── Distance ── */}
          <div>
            <p className="field-label">Trip Distance</p>
            <div className="flex gap-2 mb-2 overflow-x-auto pb-0.5">
              {DISTANCE_PRESETS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setMilesPreset(p.value)}
                  className={[
                    'flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition-all',
                    miles === String(p.value)
                      ? 'border-amber-500 bg-amber-50 text-amber-700'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-amber-300',
                  ].join(' ')}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="relative">
              <input
                type="number" inputMode="decimal"
                className={errors.miles ? 'input-field-error' : 'input-field'}
                placeholder="Enter trip miles"
                value={miles}
                min="1" step="1"
                onChange={(e) => { setMiles(e.target.value); setResult(null); }}
                aria-label="Trip distance in miles"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">mi</span>
            </div>
            {errors.miles && <p className="mt-1 text-xs text-red-500">{errors.miles}</p>}
          </div>

          {/* ── Vehicle specs row ── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="field-label">Your MPG</p>
              <div className="relative">
                <input
                  type="number" inputMode="decimal"
                  className={errors.mpg ? 'input-field-error' : 'input-field'}
                  placeholder="e.g. 30"
                  value={mpg}
                  min="1" step="0.5"
                  onChange={(e) => { setMpg(e.target.value); setMpgSourceLabel(''); setResult(null); }}
                  aria-label="Miles per gallon"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">mpg</span>
              </div>
              {errors.mpg && <p className="mt-1 text-xs text-red-500">{errors.mpg}</p>}
              {mpgSourceLabel ? (
                <p className="text-[10px] text-amber-600 mt-1 font-medium">{mpgSourceLabel}</p>
              ) : (
                <p className="text-[10px] text-slate-400 mt-1">
                  💡 Check your MPG Trend chart for an accurate figure.
                </p>
              )}
            </div>
            <div>
              <p className="field-label">Tank Size</p>
              <div className="relative">
                <input
                  type="number" inputMode="decimal"
                  className={errors.tankGal ? 'input-field-error' : 'input-field'}
                  placeholder="e.g. 15"
                  value={tankGal}
                  min="1" step="0.5"
                  onChange={(e) => { setTankGal(e.target.value); setResult(null); }}
                  aria-label="Tank capacity in gallons"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">gal</span>
              </div>
              {errors.tankGal && <p className="mt-1 text-xs text-red-500">{errors.tankGal}</p>}
            </div>
          </div>

          {/* ── Current fuel + people row ── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="field-label">Current Fuel Level</p>
              <div className="relative">
                <input
                  type="number" inputMode="decimal"
                  className={errors.fuelPct ? 'input-field-error' : 'input-field'}
                  placeholder="0"
                  value={fuelPct}
                  min="0" max="100" step="5"
                  onChange={(e) => { setFuelPct(e.target.value); setResult(null); }}
                  aria-label="Current fuel percentage"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">%</span>
              </div>
              {errors.fuelPct && <p className="mt-1 text-xs text-red-500">{errors.fuelPct}</p>}
              <p className="text-[10px] text-slate-400 mt-1">
                💡 0% = show full trip cost. Enter your actual level to see how much more you need to buy.
              </p>
            </div>
            <div>
              <p className="field-label">Splitting costs?</p>
              <div className="relative">
                <input
                  type="number" inputMode="numeric"
                  className={errors.people ? 'input-field-error' : 'input-field'}
                  placeholder="1"
                  value={people}
                  min="1" max="20" step="1"
                  onChange={(e) => { setPeople(e.target.value); setResult(null); }}
                  aria-label="Number of people splitting cost"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">people</span>
              </div>
              {errors.people && <p className="mt-1 text-xs text-red-500">{errors.people}</p>}
            </div>
          </div>

          {/* ── Gas price ── */}
          <div>
            <p className="field-label">Gas Price per Gallon</p>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-semibold pointer-events-none">$</span>
              <input
                type="number" inputMode="decimal"
                className={`${errors.pricePerGallon ? 'input-field-error' : 'input-field'} pl-8`}
                placeholder="e.g. 3.49"
                value={pricePerGallon}
                min="0.01" step="0.01"
                onChange={(e) => { setPricePerGallon(e.target.value); setResult(null); }}
                aria-label="Gas price per gallon"
              />
            </div>
            {errors.pricePerGallon && <p className="mt-1 text-xs text-red-500">{errors.pricePerGallon}</p>}
            <GasPriceLookup
              onApply={(p, lat, lng) => {
                setPricePerGallon(p);
                setResult(null);
                if (lat != null && lng != null) setGasCoords({ lat, lng });
              }}
            />
          </div>

          {/* ── Buttons ── */}
          <div className="flex gap-2 pt-1">
            <button className="btn-amber flex-1" onClick={handleCalculate}>
              Calculate Trip ⚡
            </button>
            {(miles || mpg || result) && (
              <button className="btn-secondary" onClick={handleReset}>
                Clear
              </button>
            )}
          </div>

          {/* ── Result ── */}
          <div id="trip-result">
            {hasResult && result && (
              <TripResultCard
                result={result}
                latitude={gasCoords?.lat}
                longitude={gasCoords?.lng}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Result Card ────────────────────────────────────────────────────────────

function TripResultCard({
  result,
  latitude,
  longitude,
}: {
  result: TripResult;
  latitude?: number;
  longitude?: number;
}) {
  const {
    totalMiles, totalGallons, totalTripCost,
    currentGalOffset, currentCostOffset,
    gallonsNeeded, fuelCost,
    stops, costPerPerson, milesPerDollar, tankfulls, summary,
  } = result;
  const noFuelNeeded     = gallonsNeeded === 0;
  const hasCurrentFuel   = currentGalOffset > 0;

  return (
    <div className="animate-result space-y-3 pt-1">

      {/* Summary */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3.5 flex items-start gap-3">
        <span className="text-xl flex-shrink-0 mt-0.5">{noFuelNeeded ? '✅' : '🗺️'}</span>
        <p className="text-sm text-slate-700 font-medium leading-relaxed">{summary}</p>
      </div>

      {/* Hero stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-amber-500 rounded-2xl p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">
            {hasCurrentFuel ? 'Gas to Buy' : 'Total Fuel Cost'}
          </p>
          <p className="text-3xl font-black text-white leading-none mt-1">${fuelCost.toFixed(2)}</p>
          {hasCurrentFuel && (
            <p className="text-[10px] text-white/60 mt-1">of ${totalTripCost.toFixed(2)} full trip cost</p>
          )}
        </div>
        <div className="bg-navy-700 rounded-2xl p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">
            {hasCurrentFuel ? 'Gallons to Buy' : 'Gallons Needed'}
          </p>
          <p className="text-3xl font-black text-white leading-none mt-1">
            {gallonsNeeded.toFixed(2)}
            <span className="text-base font-semibold text-white/60 ml-1">gal</span>
          </p>
          {hasCurrentFuel && (
            <p className="text-[10px] text-white/60 mt-1">of {totalGallons.toFixed(2)} gal total</p>
          )}
        </div>
      </div>

      {/* Fuel breakdown (only shown when current fuel offsets the total) */}
      {hasCurrentFuel && (
        <div className="bg-slate-50 rounded-2xl border border-slate-100 px-4 py-3 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Fuel Breakdown</p>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Total fuel for trip</span>
            <span className="font-bold text-slate-700">{totalGallons.toFixed(2)} gal · ${totalTripCost.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Fuel already in tank</span>
            <span className="font-bold text-green-600">− {currentGalOffset.toFixed(2)} gal · ${currentCostOffset.toFixed(2)}</span>
          </div>
          <div className="border-t border-slate-200 pt-2 flex justify-between text-sm">
            <span className="font-black text-slate-700">Gas to buy</span>
            <span className="font-black text-amber-600">{gallonsNeeded.toFixed(2)} gal · ${fuelCost.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Secondary stats grid */}
      <div className="grid grid-cols-2 gap-3">
        <SecStat label="Fuel stops"      value={stops === 0 ? 'None needed' : `${stops} stop${stops > 1 ? 's' : ''}`} />
        <SecStat label="Tank fill-ups"   value={`${tankfulls}×`} />
        <SecStat label="Miles per $1"    value={`${milesPerDollar} mi`} />
        {costPerPerson != null && (
          <SecStat label="Per person"    value={`$${costPerPerson.toFixed(2)}`} accent />
        )}
      </div>

      {/* Smart range tip */}
      {stops > 0 && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5 flex items-start gap-2">
          <span className="text-sm flex-shrink-0">⛽</span>
          <p className="text-xs text-blue-700 font-medium leading-snug">
            Top off your tank before you leave to maximize range and reduce the number of stops.
          </p>
        </div>
      )}

      {/* Navigation handoffs */}
      {!noFuelNeeded && (
        <div className="space-y-2 pt-1">
          <GoogleMapsHandoffButton
            mode="trip"
            calculationData={{
              gallonsNeeded: gallonsNeeded,
              estimatedCost: fuelCost,
              tripDistance:  totalMiles,
            }}
          />
          <WazeDeepLinkButton
            latitude={latitude}
            longitude={longitude}
            label="Find Fuel Along the Way"
          />
        </div>
      )}
    </div>
  );
}

function SecStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className={`text-xl font-bold leading-tight mt-0.5 ${accent ? 'text-amber-600' : 'text-navy-700'}`}>
        {value}
      </p>
    </div>
  );
}
