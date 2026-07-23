'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useSession }                        from 'next-auth/react';
import { useTranslation }                    from '@/contexts/LanguageContext';
import Link                                  from 'next/link';
import FuelGauge                             from './FuelGauge';
import GasPriceLookup                        from './GasPriceLookup';
import GoogleMapsHandoffButton               from './GoogleMapsHandoffButton';
import { canAccessFeature, getPlanTier, UPGRADE_COPY } from '@/lib/featureAccess';
import { trackLockedFeatureShown }           from '@/lib/gtag';
import { metersToMiles }                     from '@/lib/tripFuelPlanner';
import { resolveVehicleMpg }                 from '@/lib/fillups';
import type { RouteResult, FuelStop }        from '@/lib/mapsProvider/types';
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
  stops:             number;   // en-route refuel stops based on current fuel
  stopsIfFull:       number;   // en-route stops if you top off before leaving
  tankRange:         number;   // full-tank range in miles (for diagnostics)
  costPerPerson:     number | null;
  milesPerDollar:    number;
  tankfulls:         number;
  summary:           string;
}

// ── Rental presets ─────────────────────────────────────────────────────────

type RentalPresetKey =
  | 'compactCar' | 'midsizeCar' | 'fullsizeCar' | 'smallSuv' | 'midsizeSuv'
  | 'largeSuv' | 'minivan' | 'pickupHalfTon' | 'pickupFullTon' | 'hybridCar'
  | 'enterManually';

interface RentalPreset {
  label:    string;          // stable code identifier (not user-facing)
  labelKey: RentalPresetKey; // translation key under tripCostEstimator
  mpg:      number;
  tankGal:  number;
}

const RENTAL_PRESETS: RentalPreset[] = [
  { label: 'Compact Car',       labelKey: 'compactCar',    mpg: 32, tankGal: 12.0 },
  { label: 'Midsize Car',       labelKey: 'midsizeCar',    mpg: 28, tankGal: 16.0 },
  { label: 'Full-size Car',     labelKey: 'fullsizeCar',   mpg: 24, tankGal: 17.0 },
  { label: 'Small SUV',         labelKey: 'smallSuv',      mpg: 28, tankGal: 15.9 },
  { label: 'Midsize SUV',       labelKey: 'midsizeSuv',    mpg: 24, tankGal: 19.0 },
  { label: 'Large SUV',         labelKey: 'largeSuv',      mpg: 18, tankGal: 26.0 },
  { label: 'Minivan',           labelKey: 'minivan',       mpg: 22, tankGal: 20.0 },
  { label: 'Pickup (Half-ton)', labelKey: 'pickupHalfTon', mpg: 20, tankGal: 26.0 },
  { label: 'Pickup (Full-ton)', labelKey: 'pickupFullTon', mpg: 16, tankGal: 34.0 },
  { label: 'Hybrid Car',        labelKey: 'hybridCar',     mpg: 50, tankGal: 11.3 },
  { label: 'Enter manually',    labelKey: 'enterManually', mpg: 0,  tankGal: 0    },
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
  // En-route stops if the driver tops off to full before leaving
  // (the initial fill-up is pre-trip, so stops = additional full-tank fills required on the road)
  const remainingIfFull = Math.max(0, miles - tankRange);
  const stopsIfFull     = remainingIfFull <= 0 ? 0 : Math.ceil(remainingIfFull / tankRange);
  // En-route stops based on current fuel level
  // KEY: when fuelPct = 0, the driver will fill up before leaving (not on the road),
  // so the stop count is the same as starting full — avoids the off-by-one overcount.
  const currentMilesInTank    = tankGal * (fuelPct / 100) * mpg;
  const remainingAfterCurrent = miles - currentMilesInTank;
  const stops = remainingAfterCurrent <= 0
    ? 0
    : fuelPct <= 0
      ? stopsIfFull   // at E → first fill-up is pre-trip, not a road stop
      : Math.ceil(remainingAfterCurrent / tankRange);
  const milesPerDollar        = totalTripCost > 0 ? Math.round((miles / totalTripCost) * 10) / 10 : 0;
  const tankfulls          = Math.round((totalGallons / tankGal) * 10) / 10;
  const costPerPerson      = people > 1 ? Math.round((fuelCost / people) * 100) / 100 : null;

  let summary = '';
  if (gallonsNeeded === 0) {
    summary = `Great news — you already have enough fuel for the full ${miles.toLocaleString()}-mile trip!`;
  } else {
    summary = `This ${miles.toLocaleString()}-mile trip needs ${totalGallons.toFixed(2)} gal total ` +
              `($${totalTripCost.toFixed(2)}). You'll need to buy ${gallonsNeeded.toFixed(2)} gal ` +
              `($${fuelCost.toFixed(2)}) on top of what's in your tank.`;
    if (stops > 0) summary += ` Plan for ${stops} refuel stop${stops > 1 ? 's' : ''} on the road.`;
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
    stopsIfFull,
    tankRange:         Math.round(tankRange),
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
  const [vehicles,          setVehicles]          = useState<Vehicle[]>([]);
  const [avgMpgByVehicleId, setAvgMpgByVehicleId] = useState<Record<string, number>>({});
  const [loaded,            setLoaded]            = useState(false);

  // fetchAll always fetches fresh — used by load() and the vehicle-saved event listener
  const fetchAll = useCallback(async () => {
    if (!session) return;
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
  }, [session]);

  const load = useCallback(async () => {
    if (!session || loaded) return;
    await fetchAll();
  }, [session, loaded, fetchAll]);

  // Re-sync whenever a vehicle is saved or updated anywhere in the app
  // (SavedVehicles dispatches 'vehicle-saved' on add, edit, or spec lookup)
  useEffect(() => {
    function onVehicleSaved() { fetchAll(); }
    window.addEventListener('vehicle-saved', onVehicleSaved);
    return () => window.removeEventListener('vehicle-saved', onVehicleSaved);
  }, [fetchAll]);

  return { vehicles, avgMpgByVehicleId, load };
}

// ── Resolve best MPG for a garage vehicle ─────────────────────────────────
// Shared with every other MPG-consuming surface — see lib/fillups.ts.

function resolveMpg(v: Vehicle, avgMpgByVehicleId: Record<string, number>) {
  return resolveVehicleMpg(v.vehicleSpecs, avgMpgByVehicleId[v.id]);
}

// ── Duration formatting ────────────────────────────────────────────────────

function formatDuration(
  seconds: number,
  fmt: {
    durationMin:       (mins: number) => string;
    durationHours:     (hours: number) => string;
    durationHoursMins: (hours: number, mins: number) => string;
  },
): string {
  const totalMins = Math.round(seconds / 60);
  if (totalMins < 60) return fmt.durationMin(totalMins);
  const hours = Math.floor(totalMins / 60);
  const mins  = totalMins % 60;
  return mins === 0 ? fmt.durationHours(hours) : fmt.durationHoursMins(hours, mins);
}

// ── Address autocomplete hook ─────────────────────────────────────────────

function useAddressAutocomplete(query: string, enabled: boolean) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || query.length < 2) { setSuggestions([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetch('/api/maps/autocomplete', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ input: query }),
      })
        .then((r) => r.json() as Promise<{ ok: boolean; suggestions: string[] }>)
        .then((d) => { if (d.ok) setSuggestions(d.suggestions); })
        .catch(() => {});
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, enabled]);

  function clear() { setSuggestions([]); }
  return { suggestions, clear };
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
  const { t } = useTranslation();
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
  const [mpgLookingUp,      setMpgLookingUp]      = useState(false);
  const [mpgOptions, setMpgOptions] = useState<{ city: number; hwy: number; comb: number } | null>(null);
  const [vehicleMode,       setVehicleMode]       = useState<VehicleMode>('garage');
  const [rentalType,        setRentalType]        = useState<string>('');
  const [tripPlanMode,      setTripPlanMode]      = useState<TripPlanMode>('manual');
  const [gasCoords,         setGasCoords]         = useState<{ lat: number; lng: number } | null>(null);

  // Route-based planner state
  const [routeOrigin,       setRouteOrigin]       = useState('');
  const [routeDest,         setRouteDest]         = useState('');
  const [routeData,         setRouteData]         = useState<RouteResult | null>(null);
  const [routeLoading,      setRouteLoading]      = useState(false);
  const [routeError,        setRouteError]        = useState('');
  const [fuelStops,         setFuelStops]         = useState<FuelStop[]>([]);
  const [stopsLoading,      setStopsLoading]      = useState(false);

  const userPlan       = (session?.user as { plan?: string })?.plan ?? '';
  const planTier       = getPlanTier((session?.user as { plan?: string } | null) ?? null);
  const canUseRoutePlanner = canAccessFeature('route_based_trip_planner', userPlan);
  const canSaveTrips       = canAccessFeature('save_trip', userPlan);

  // Lock tank size when a garage vehicle is selected (tank is auto-populated from the vehicle)
  const garageVehicleLocked = vehicleMode === 'garage' && selectedVehicleId !== '';

  // Address autocomplete for route-based planner
  const { suggestions: originSuggestions, clear: clearOriginSugg } =
    useAddressAutocomplete(routeOrigin, canUseRoutePlanner && tripPlanMode === 'route');
  const { suggestions: destSuggestions, clear: clearDestSugg } =
    useAddressAutocomplete(routeDest, canUseRoutePlanner && tripPlanMode === 'route');

  // Save-trip state
  const [tripSaved,   setTripSaved]   = useState(false);
  const [tripSaving,  setTripSaving]  = useState(false);

  // When embedded (tab panel), eagerly load garage so vehicles are ready without a button click
  useEffect(() => {
    if (embedded && session) loadGarage();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, session]);

  // Scroll back to trip results when returning from an external navigation (e.g. Google Maps / Waze).
  // Uses three complementary events because mobile platform behaviour varies:
  //   • visibilitychange — most browsers on Android
  //   • pageshow         — iOS BFCache restore / Safari PWA app-switch
  //   • focus            — desktop fallback when the tab regains focus
  useEffect(() => {
    function scrollBack() {
      try {
        if (!sessionStorage.getItem('gc_trip_nav_away')) return;
        sessionStorage.removeItem('gc_trip_nav_away');
        // 350 ms lets the PWA finish its own transition animation before scrolling
        setTimeout(() => {
          document.getElementById('trip-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 350);
      } catch { /* sessionStorage may be unavailable in some private modes */ }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') scrollBack();
    }
    function onPageShow(e: PageTransitionEvent) {
      // e.persisted === true when the page is restored from the back-forward cache
      if (e.persisted || document.visibilityState === 'visible') scrollBack();
    }
    function onFocus() {
      scrollBack();
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

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

  async function loadVehicle(v: Vehicle) {
    const { mpg: resolvedMpg, labelKey } = resolveMpg(v, avgMpgByVehicleId);
    const label = labelKey ? t.tripCostEstimator[labelKey] : '';
    setTankGal(String(v.gallons));
    setSelectedVehicleId(v.id);
    setMpgOptions(null);

    if (resolvedMpg != null) {
      // Fill-up history or EPA spec already has MPG — use it directly
      setMpg(String(resolvedMpg));
      setMpgSourceLabel(label);
      setMpgLookingUp(false);
    } else if (v.epaId || (v.year && v.make && v.model)) {
      // No stored EPA data — fetch live from FuelEconomy.gov.
      // Prefer epaId (exact trim) over year/make/model (averaged across trims).
      setMpg('');
      setMpgSourceLabel('');
      setMpgLookingUp(true);
      try {
        const qs = v.epaId
          ? `epaId=${encodeURIComponent(v.epaId)}`
          : `year=${encodeURIComponent(v.year!)}&make=${encodeURIComponent(v.make!)}&model=${encodeURIComponent(v.model!)}`;
        const res  = await fetch(`/api/mpg-lookup?${qs}`);
        const data = await res.json() as {
          ok: boolean; combMpg?: number; cityMpg?: number; hwyMpg?: number;
        };
        if (data.ok && data.combMpg) {
          setMpg(String(data.combMpg));
          const vehicleLabel = [v.year, v.make, v.model].filter(Boolean).join(' ');
          setMpgSourceLabel(t.tripCostEstimator.epaEstimateForVehicle(vehicleLabel));
          setMpgOptions({
            comb: data.combMpg,
            city: data.cityMpg ?? data.combMpg,
            hwy:  data.hwyMpg  ?? data.combMpg,
          });
        }
      } catch { /* ignore — field stays empty, user can pick a toggle value */ }
      finally { setMpgLookingUp(false); }
    } else {
      setMpg('');
      setMpgSourceLabel(label);
      setMpgLookingUp(false);
    }
    setResult(null);
  }

  function loadRentalPreset(label: string) {
    setRentalType(label);
    const preset = RENTAL_PRESETS.find((p) => p.label === label);
    if (!preset) return;
    if (preset.mpg > 0) {
      setMpg(String(preset.mpg));
      setMpgSourceLabel(preset.labelKey === 'enterManually' ? '' : t.tripCostEstimator.typicalForVehicle(t.tripCostEstimator[preset.labelKey]));
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

    if (!milesNum || milesNum <= 0)        errs.miles         = t.tripCostEstimator.errMiles;
    if (milesNum > 20000)                  errs.miles         = t.tripCostEstimator.errMilesTooLarge;
    if (!mpgNum  || mpgNum  <= 0)          errs.mpg           = t.tripCostEstimator.errMpg;
    if (mpgNum   > 200)                    errs.mpg           = t.tripCostEstimator.errMpgTooHigh;
    if (!tankNum || tankNum <= 0)          errs.tankGal       = t.tripCostEstimator.errTank;
    if (!priceNum || priceNum <= 0)        errs.pricePerGallon = t.tripCostEstimator.errPrice;
    if (isNaN(pctNum) || pctNum < 0 || pctNum > 100) errs.fuelPct = t.tripCostEstimator.errFuelPct;
    if (!pplNum  || pplNum < 1)            errs.people        = t.tripCostEstimator.errPeople;

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleRouteCalculate() {
    setRouteError('');
    setRouteData(null);
    setFuelStops([]);
    setResult(null);

    // Validate vehicle inputs
    const mpgNum   = parseFloat(mpg);
    const tankNum  = parseFloat(tankGal);
    const priceNum = parseFloat(pricePerGallon);
    const pctNum   = parseFloat(fuelPct);
    const errs: Record<string, string> = {};
    if (!routeOrigin.trim())              errs.routeOrigin = t.tripCostEstimator.errOrigin;
    if (!routeDest.trim())                errs.routeDest   = t.tripCostEstimator.errDest;
    if (!mpgNum || mpgNum <= 0)           errs.mpg         = t.tripCostEstimator.errMpg;
    if (!tankNum || tankNum <= 0)         errs.tankGal     = t.tripCostEstimator.errTankShort;
    if (!priceNum || priceNum <= 0)       errs.pricePerGallon = t.tripCostEstimator.errPrice;
    if (isNaN(pctNum) || pctNum < 0 || pctNum > 100) errs.fuelPct = t.tripCostEstimator.errFuelPct;
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    // 1. Fetch route
    setRouteLoading(true);
    let route: RouteResult;
    try {
      const res  = await fetch('/api/maps/route', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ origin: routeOrigin.trim(), destination: routeDest.trim() }),
      });
      const data = await res.json() as { ok: boolean; route?: RouteResult; error?: string; featureDisabled?: boolean };
      if (!data.ok) {
        setRouteError(
          data.featureDisabled
            ? t.tripCostEstimator.routeFeatureDisabled
            : (data.error ?? t.tripCostEstimator.routeCalcFailed),
        );
        setRouteLoading(false);
        return;
      }
      route = data.route!;
    } catch {
      setRouteError(t.tripCostEstimator.networkError);
      setRouteLoading(false);
      return;
    }
    setRouteLoading(false);
    setRouteData(route);

    // 2. Run local fuel calculation with the route distance
    const routeMiles = metersToMiles(route.distanceMeters);
    const r = calcTrip(routeMiles, mpgNum, tankNum, pctNum, priceNum, parseInt(people, 10));
    setResult(r);
    setTripSaved(false);
    setTimeout(() => {
      document.getElementById('trip-result')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);

    // 3. If refuel needed, search for nearby stations (fire-and-forget, non-blocking)
    if (r.stops > 0 && route.legs?.length) {
      setStopsLoading(true);
      const fraction = Math.min(1, Math.max(0, (routeMiles * 0.5) / routeMiles));
      const start    = route.legs[0].startLocation;
      const end      = route.legs[route.legs.length - 1].endLocation;
      const refuelLat = start.latitude  + (end.latitude  - start.latitude)  * fraction;
      const refuelLng = start.longitude + (end.longitude - start.longitude) * fraction;

      fetch('/api/maps/search-fuel-stops', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ nearLat: refuelLat, nearLng: refuelLng }),
      })
        .then((res) => res.json() as Promise<{ ok: boolean; stops?: FuelStop[] }>)
        .then((data) => { if (data.ok && data.stops) setFuelStops(data.stops); })
        .catch(() => {})
        .finally(() => setStopsLoading(false));
    }
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
    setTripSaved(false);
    setTimeout(() => {
      document.getElementById('trip-result')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
  }

  function handleReset() {
    setMiles(''); setMpg(''); setTankGal(''); setFuelPct('0');
    setPricePerGallon(''); setPeople('1'); setResult(null); setErrors({});
    setSelectedVehicleId('');
    setMpgSourceLabel('');
    setMpgLookingUp(false);
    setMpgOptions(null);
    setRentalType('');
    setVehicleMode(session && vehicles.length > 0 ? 'garage' : 'rental');
    // Route planner reset
    setRouteOrigin(''); setRouteDest('');
    setRouteData(null); setRouteError(''); setFuelStops([]);
    // Save state reset
    setTripSaved(false);
  }

  async function handleSaveTrip(r: TripResult) {
    if (!session || !canSaveTrips || tripSaved || tripSaving) return;
    setTripSaving(true);
    try {
      await fetch('/api/trips', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin:         tripPlanMode === 'route' ? routeOrigin.trim() || undefined : undefined,
          destination:    tripPlanMode === 'route' ? routeDest.trim()   || undefined : undefined,
          distanceMiles:  r.totalMiles,
          mpg:            parseFloat(mpg),
          tankGallons:    parseFloat(tankGal),
          pricePerGallon: parseFloat(pricePerGallon),
          travelers:      parseInt(people, 10),
          fuelPct:        parseFloat(fuelPct),
          gallonsNeeded:  r.gallonsNeeded,
          fuelCost:       r.fuelCost,
          stops:          r.stops,
          totalTripCost:  r.totalTripCost,
        }),
      });
      setTripSaved(true);
    } finally {
      setTripSaving(false);
    }
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
              <p className="text-sm font-black text-slate-700">{t.tripCostEstimator.title}</p>
              <p className="text-[10px] text-slate-400">{t.tripCostEstimator.subtitle}</p>
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
                📏 {t.tripCostEstimator.manualDistance}
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
                🗺️ {t.tripCostEstimator.routeBased} {!canUseRoutePlanner && '⭐'}
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
                          {t.tripCostEstimator.routeUpgradeDesc}
                        </p>
                      </div>
                    </div>
                    <Link
                      href="/upgrade"
                      onClick={() => trackLockedFeatureShown('route_based_trip_planner', userPlan)}
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
                      {t.tripCostEstimator.useManualInstead}
                    </button>
                  </div>
                ) : (
                  /* Pro user — full route form */
                  <div className="space-y-3">
                    <div>
                      <p className="field-label">{t.tripCostEstimator.startingPoint}</p>
                      <div className="relative">
                        <input
                          type="text"
                          className={`${errors.routeOrigin ? 'input-field-error' : 'input-field'} ${routeOrigin ? 'pr-8' : ''}`}
                          placeholder={t.tripCostEstimator.addressPlaceholder}
                          value={routeOrigin}
                          autoComplete="off"
                          onChange={(e) => { setRouteOrigin(e.target.value); setRouteData(null); setResult(null); }}
                          onBlur={() => { setTimeout(clearOriginSugg, 150); }}
                          aria-label={t.tripCostEstimator.ariaStartingPoint}
                        />
                        {routeOrigin && (
                          <button
                            type="button"
                            onClick={() => { setRouteOrigin(''); clearOriginSugg(); setRouteData(null); setResult(null); }}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 transition-colors"
                            aria-label={t.tripCostEstimator.ariaClearStartingPoint}
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                              <path d="M1 1l10 10M11 1L1 11" />
                            </svg>
                          </button>
                        )}
                        {originSuggestions.length > 0 && (
                          <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                            {originSuggestions.map((s) => (
                              <button
                                key={s}
                                type="button"
                                className="w-full text-left px-3 py-2.5 text-xs text-slate-700 hover:bg-amber-50 hover:text-amber-800 border-b border-slate-50 last:border-0 transition-colors"
                                onMouseDown={(e) => { e.preventDefault(); setRouteOrigin(s); clearOriginSugg(); setRouteData(null); setResult(null); }}
                              >
                                📍 {s}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {errors.routeOrigin && <p className="mt-1 text-xs text-red-500">{errors.routeOrigin}</p>}
                    </div>
                    <div>
                      <p className="field-label">{t.tripCostEstimator.destination}</p>
                      <div className="relative">
                        <input
                          type="text"
                          className={`${errors.routeDest ? 'input-field-error' : 'input-field'} ${routeDest ? 'pr-8' : ''}`}
                          placeholder={t.tripCostEstimator.addressPlaceholder}
                          value={routeDest}
                          autoComplete="off"
                          onChange={(e) => { setRouteDest(e.target.value); setRouteData(null); setResult(null); }}
                          onBlur={() => { setTimeout(clearDestSugg, 150); }}
                          aria-label={t.tripCostEstimator.ariaDestination}
                        />
                        {routeDest && (
                          <button
                            type="button"
                            onClick={() => { setRouteDest(''); clearDestSugg(); setRouteData(null); setResult(null); }}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 transition-colors"
                            aria-label={t.tripCostEstimator.ariaClearDestination}
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                              <path d="M1 1l10 10M11 1L1 11" />
                            </svg>
                          </button>
                        )}
                        {destSuggestions.length > 0 && (
                          <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                            {destSuggestions.map((s) => (
                              <button
                                key={s}
                                type="button"
                                className="w-full text-left px-3 py-2.5 text-xs text-slate-700 hover:bg-amber-50 hover:text-amber-800 border-b border-slate-50 last:border-0 transition-colors"
                                onMouseDown={(e) => { e.preventDefault(); setRouteDest(s); clearDestSugg(); setRouteData(null); setResult(null); }}
                              >
                                📍 {s}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {errors.routeDest && <p className="mt-1 text-xs text-red-500">{errors.routeDest}</p>}
                    </div>
                    {routeData && (
                      <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                        <span className="text-sm">📍</span>
                        <p className="text-xs font-bold text-emerald-700">
                          {t.tripCostEstimator.routeSummary(metersToMiles(routeData.distanceMeters).toLocaleString(), formatDuration(routeData.durationSeconds, t.tripCostEstimator))}
                        </p>
                      </div>
                    )}
                    {routeError && (
                      <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                        <p className="text-xs text-red-600 font-medium">{routeError}</p>
                      </div>
                    )}
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
                  🚗 {t.tripCostEstimator.myGarage}
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
                  🔄 {t.tripCostEstimator.rentalOther}
                </button>
              </div>
            </div>
          )}

          {/* ── Garage vehicle selector ── */}
          {vehicleMode === 'garage' && session && vehicles.length > 0 && (
            <div>
              <p className="field-label">{t.tripCostEstimator.quickLoadGarage}</p>
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
              <p className="field-label">{t.tripCostEstimator.vehicleType}</p>
              <select
                className="input-field"
                value={rentalType}
                onChange={(e) => loadRentalPreset(e.target.value)}
                aria-label={t.tripCostEstimator.ariaRentalType}
              >
                <option value="">{t.tripCostEstimator.selectVehicleType}</option>
                {RENTAL_PRESETS.map((p) => (
                  <option key={p.label} value={p.label}>{t.tripCostEstimator[p.labelKey]}</option>
                ))}
              </select>
            </div>
          )}

          {/* ── Distance — manual mode only; route mode gets distance from Google ── */}
          {tripPlanMode !== 'route' && (
            <div>
              <p className="field-label">{t.tripCostEstimator.tripDistance}</p>
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
                  placeholder={t.tripCostEstimator.tripMilesPlaceholder}
                  value={miles}
                  min="1" step="1"
                  onChange={(e) => { setMiles(e.target.value); setResult(null); }}
                  aria-label={t.tripCostEstimator.ariaTripDistance}
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">mi</span>
              </div>
              {errors.miles && <p className="mt-1 text-xs text-red-500">{errors.miles}</p>}
            </div>
          )}

          {/* ── Vehicle specs row ── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="field-label">
                {garageVehicleLocked ? t.tripCostEstimator.epaFuelEconomy : t.tripCostEstimator.yourMpg}
              </p>
              <div className="relative">
                <input
                  type="number" inputMode="decimal"
                  autoComplete="off"
                  className={
                    errors.mpg
                      ? 'input-field-error'
                      : garageVehicleLocked
                        ? 'input-field bg-slate-50 text-slate-400 cursor-not-allowed'
                        : 'input-field'
                  }
                  placeholder={mpgLookingUp ? '' : garageVehicleLocked ? '—' : t.tripCostEstimator.mpgPlaceholder}
                  value={mpg}
                  min="1" step="0.5"
                  readOnly={garageVehicleLocked || mpgLookingUp}
                  onChange={garageVehicleLocked ? undefined : (e) => { setMpg(e.target.value); setMpgSourceLabel(''); setMpgOptions(null); setResult(null); }}
                  aria-label={t.tripCostEstimator.ariaMpg}
                />
                {mpgLookingUp ? (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    <span className="inline-block w-3.5 h-3.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                  </span>
                ) : (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">mpg</span>
                )}
              </div>
              {errors.mpg && <p className="mt-1 text-xs text-red-500">{errors.mpg}</p>}
              {mpgLookingUp ? (
                <p className="text-[10px] text-amber-500 mt-1 font-medium leading-snug animate-pulse">
                  {t.tripCostEstimator.lookingUpEpa}
                </p>
              ) : mpgSourceLabel ? (
                <p className="text-[10px] text-amber-600 mt-1 font-medium leading-snug">{mpgSourceLabel}</p>
              ) : garageVehicleLocked ? (
                <p className="text-[10px] text-slate-400 mt-1 leading-snug">
                  🔍 {t.tripCostEstimator.fetchingEpa}
                </p>
              ) : (
                <p className="text-[10px] text-slate-400 mt-1 leading-snug">
                  💡 {t.tripCostEstimator.mpgHint}
                </p>
              )}
              {/* City / Highway / Combined toggle — shown when EPA lookup returned all three */}
              {mpgOptions && !mpgLookingUp && (
                <div className="flex gap-1 mt-2">
                  {(
                    [
                      ['comb', t.tripCostEstimator.mpgComb, mpgOptions.comb],
                      ['city', t.tripCostEstimator.mpgCity, mpgOptions.city],
                      ['hwy',  t.tripCostEstimator.mpgHwy,  mpgOptions.hwy ],
                    ] as const
                  ).map(([type, label, val]) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        setMpg(String(val));
                        setMpgSourceLabel(
                          type === 'comb' ? t.tripCostEstimator.mpgCombinedLabel :
                          type === 'city' ? t.tripCostEstimator.mpgCityLabel :
                          t.tripCostEstimator.mpgHwyLabel,
                        );
                        setResult(null);
                      }}
                      className={[
                        'flex-1 py-1 rounded-lg text-[9px] font-bold border transition-all leading-tight text-center',
                        mpg === String(val)
                          ? 'border-amber-400 bg-amber-50 text-amber-700'
                          : 'border-slate-200 bg-white text-slate-500 hover:border-amber-300',
                      ].join(' ')}
                    >
                      {label}<br />{val}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <p className="field-label">{t.tripCostEstimator.tankSize}</p>
              <div className="relative">
                <input
                  type="number" inputMode="decimal"
                  className={
                    errors.tankGal
                      ? 'input-field-error'
                      : garageVehicleLocked
                        ? 'input-field bg-slate-50 text-slate-400 cursor-not-allowed'
                        : 'input-field'
                  }
                  autoComplete="off"
                  placeholder={t.tripCostEstimator.tankPlaceholder}
                  value={tankGal}
                  min="1" step="0.5"
                  readOnly={garageVehicleLocked}
                  onChange={garageVehicleLocked ? undefined : (e) => { setTankGal(e.target.value); setResult(null); }}
                  aria-label={t.tripCostEstimator.ariaTank}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">gal</span>
              </div>
              {errors.tankGal && <p className="mt-1 text-xs text-red-500">{errors.tankGal}</p>}
              {garageVehicleLocked && (
                <p className="text-[10px] text-slate-400 mt-1">🚗 {t.tripCostEstimator.fromSavedVehicle}</p>
              )}
            </div>
          </div>

          {/* ── Current fuel level (gauge) ── */}
          <div>
            <p className="field-label">{t.tripCostEstimator.currentFuelLevel}</p>
            <FuelGauge
              percent={Number(fuelPct)}
              onChange={(pct) => { setFuelPct(String(pct)); setResult(null); }}
              tankCapacity={tankGal ? parseFloat(tankGal) || undefined : undefined}
            />
            {errors.fuelPct && <p className="mt-1 text-xs text-red-500">{errors.fuelPct}</p>}
            <p className="text-[10px] text-slate-400 mt-1">
              💡 {t.tripCostEstimator.gaugeHint}
            </p>
          </div>

          {/* ── Travelers (cost splitting) ── */}
          <div>
            <p className="field-label">{t.tripCostEstimator.travelers}</p>
            <div className="relative">
              <input
                type="number" inputMode="numeric"
                className={errors.people ? 'input-field-error' : 'input-field'}
                placeholder="1"
                value={people}
                min="1" max="20" step="1"
                onChange={(e) => { setPeople(e.target.value); setResult(null); }}
                aria-label={t.tripCostEstimator.ariaPeople}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">{t.tripCostEstimator.peopleUnit}</span>
            </div>
            {errors.people && <p className="mt-1 text-xs text-red-500">{errors.people}</p>}
          </div>

          {/* ── Gas price ── */}
          <div>
            <p className="field-label">{t.tripCostEstimator.gasPricePerGallon}</p>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-semibold pointer-events-none">$</span>
              <input
                type="number" inputMode="decimal"
                className={`${errors.pricePerGallon ? 'input-field-error' : 'input-field'} pl-8`}
                placeholder={t.tripCostEstimator.gasPricePlaceholder}
                value={pricePerGallon}
                min="0.01" step="0.01"
                onChange={(e) => { setPricePerGallon(e.target.value); setResult(null); }}
                aria-label={t.tripCostEstimator.ariaGasPrice}
              />
            </div>
            {errors.pricePerGallon && <p className="mt-1 text-xs text-red-500">{errors.pricePerGallon}</p>}
            {tripPlanMode === 'route' && (
              <p className="text-[10px] text-slate-400 mt-1 leading-snug">
                ⚠️ {t.tripCostEstimator.highwayPriceNote}
              </p>
            )}
            <GasPriceLookup
              autoFill
              currentValue={pricePerGallon}
              onApply={(p, lat, lng) => {
                setPricePerGallon(p);
                setResult(null);
                if (lat != null && lng != null) setGasCoords({ lat, lng });
              }}
            />
          </div>

          {/* ── Buttons ── */}
          <div className="flex gap-2 pt-1">
            {tripPlanMode === 'route' && canUseRoutePlanner ? (
              <button
                className="btn-amber flex-1"
                onClick={handleRouteCalculate}
                disabled={routeLoading || mpgLookingUp}
              >
                {routeLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    {t.tripCostEstimator.calculatingRoute}
                  </span>
                ) : mpgLookingUp ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    {t.tripCostEstimator.lookingUpMpg}
                  </span>
                ) : `${t.tripCostEstimator.calculateTrip} ⚡`}
              </button>
            ) : (
              <button
                className="btn-amber flex-1"
                onClick={handleCalculate}
                disabled={mpgLookingUp}
              >
                {mpgLookingUp ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    {t.tripCostEstimator.lookingUpMpg}
                  </span>
                ) : `${t.tripCostEstimator.calculateTrip} ⚡`}
              </button>
            )}
            {(miles || routeOrigin || mpg || result) && (
              <button className="btn-secondary" onClick={handleReset}>
                {t.tripCostEstimator.clear}
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
                routeOrigin={tripPlanMode === 'route' ? routeOrigin : undefined}
                routeDest={tripPlanMode   === 'route' ? routeDest   : undefined}
                fuelStops={fuelStops}
                stopsLoading={stopsLoading}
                canSave={canSaveTrips}
                isSaved={tripSaved}
                isSaving={tripSaving}
                isSignedIn={!!session}
                onSave={() => handleSaveTrip(result)}
                planTier={planTier}
                tankGalNum={parseFloat(tankGal) || 0}
                mpgNum={parseFloat(mpg) || 0}
                priceNum={parseFloat(pricePerGallon) || 0}
                fuelPctNum={parseFloat(fuelPct) || 0}
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
  routeOrigin,
  routeDest,
  fuelStops = [],
  stopsLoading = false,
  canSave      = false,
  isSaved      = false,
  isSaving     = false,
  isSignedIn   = false,
  onSave,
  planTier     = 'free',
  tankGalNum   = 0,
  mpgNum       = 0,
  priceNum     = 0,
  fuelPctNum   = 0,
}: {
  result:        TripResult;
  latitude?:     number;
  longitude?:    number;
  routeOrigin?:  string;
  routeDest?:    string;
  fuelStops?:    FuelStop[];
  stopsLoading?: boolean;
  canSave?:      boolean;
  isSaved?:      boolean;
  isSaving?:     boolean;
  isSignedIn?:   boolean;
  onSave?:       () => void;
  planTier?:     string;
  tankGalNum?:   number;
  mpgNum?:       number;
  priceNum?:     number;
  fuelPctNum?:   number;
}) {
  const { t } = useTranslation();
  const {
    totalMiles, totalGallons, totalTripCost,
    currentGalOffset,
    gallonsNeeded, fuelCost,
    stops, stopsIfFull, tankRange, costPerPerson, milesPerDollar,
  } = result;

  const noFuelNeeded      = gallonsNeeded === 0;
  const shortRangeWarning = tankRange > 0 && tankRange < 150;

  // ── Pre-trip top-off math ─────────────────────────────────────────────────
  // How much to add at a station near home to reach a full tank
  const currentGal       = tankGalNum * (fuelPctNum / 100);
  const galToTopOff      = Math.max(0, tankGalNum - currentGal);
  const costToTopOff     = Math.round(galToTopOff * priceNum * 100) / 100;
  const pctDisplay       = fuelPctNum <= 0 ? t.tripCostEstimator.emptyTank : `${Math.round(fuelPctNum)}%`;
  const needsPreTripFill = !noFuelNeeded && galToTopOff > 0.05; // >0.05 to skip rounding noise

  // ── En-route refuel math ──────────────────────────────────────────────────
  // After topping off at home, first road stop is ~tankRange miles out
  const firstStopMile    = tankRange; // miles from origin after a full home fill
  // Gallons needed at the road stop(s) vs. home fill
  const galAtRoadStops   = Math.max(0, gallonsNeeded - galToTopOff);
  const costAtRoadStops  = Math.round(galAtRoadStops * priceNum * 100) / 100;

  // Origin city label for buttons / text
  const originCity = routeOrigin
    ? routeOrigin.split(',')[0].trim()
    : t.tripCostEstimator.yourStartingPoint;

  return (
    <div className="animate-result space-y-3 pt-1">

      {/* ── Route badge ──────────────────────────────────────────────────── */}
      {routeOrigin && routeDest && (
        <div className="flex items-center gap-2 bg-[#005F4A]/10 border border-[#005F4A]/20 rounded-2xl px-4 py-3">
          <span className="text-base flex-shrink-0">🗺️</span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#005F4A]/70">{t.tripCostEstimator.yourRoute}</p>
            <p className="text-sm font-black text-[#005F4A] truncate">
              {routeOrigin} → {routeDest}
            </p>
          </div>
        </div>
      )}

      {/* ── Already-have-enough-fuel case ────────────────────────────────── */}
      {noFuelNeeded && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-4 flex items-start gap-3">
          <span className="text-2xl flex-shrink-0">✅</span>
          <div>
            <p className="text-sm font-black text-emerald-800 leading-snug">
              {t.tripCostEstimator.enoughFuelTitle}
            </p>
            <p className="text-xs text-emerald-700 mt-1 leading-relaxed">
              {t.tripCostEstimator.enoughFuelBody(totalMiles.toLocaleString(), totalGallons.toFixed(2))}
            </p>
          </div>
        </div>
      )}

      {/* ── TRIP OVERVIEW BANNER (shown when fuel is needed) ─────────────── */}
      {!noFuelNeeded && (
        <div className="rounded-2xl bg-[#1E2D4A] px-4 py-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-2">
            {t.tripCostEstimator.totalTripFuelUsage}
          </p>
          <div className="flex items-end gap-3">
            <div>
              <p className="text-2xl font-black text-amber-400 leading-none">
                {totalGallons.toFixed(2)} gal
              </p>
              <p className="text-[10px] text-white/40 mt-0.5">
                {t.tripCostEstimator.fullTripMiles(totalMiles.toLocaleString())}
              </p>
            </div>
            <div className="text-white/30 text-xl font-light pb-0.5">=</div>
            <div>
              <p className="text-2xl font-black text-white leading-none">
                ${totalTripCost.toFixed(2)}
              </p>
              <p className="text-[10px] text-white/40 mt-0.5">
                {t.tripCostEstimator.atPricePerGal(priceNum.toFixed(3))}
              </p>
            </div>
          </div>
          {currentGalOffset > 0 && (
            <p className="text-[10px] text-white/30 mt-2 leading-relaxed">
              {t.tripCostEstimator.tankAlreadyHas(currentGalOffset.toFixed(2), (currentGalOffset * priceNum).toFixed(2))}
            </p>
          )}
        </div>
      )}

      {/* ── SHORT RANGE WARNING ──────────────────────────────────────────── */}
      {shortRangeWarning && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 flex items-start gap-2">
          <span className="text-sm flex-shrink-0">⚠️</span>
          <p className="text-xs text-amber-800 font-medium leading-snug">
            <span className="font-black">{t.tripCostEstimator.checkInputsLead}</span>{' '}
            {t.tripCostEstimator.shortRangeBody1(tankRange.toLocaleString())}{' '}
            <span className="font-bold">{t.tripCostEstimator.mpgWord}</span> {t.tripCostEstimator.and}{' '}
            <span className="font-bold">{t.tripCostEstimator.tankSizeWord}</span> {t.tripCostEstimator.shortRangeBody2}
          </p>
        </div>
      )}

      {/* ── STEP-BY-STEP FUEL PLAN ───────────────────────────────────────── */}
      {!noFuelNeeded && !shortRangeWarning && (
        <div className="space-y-2">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
            {t.tripCostEstimator.fuelPlanStepByStep}
          </p>

          {/* STEP 1 — Pre-trip fill-up near home */}
          {needsPreTripFill && (
            <div className="rounded-2xl border-2 border-blue-200 bg-blue-50 overflow-hidden">
              {/* Step header */}
              <div className="flex items-center gap-2.5 px-4 py-2.5 bg-blue-600">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white text-blue-600 text-[10px] font-black flex items-center justify-center leading-none">
                  1
                </span>
                <p className="text-xs font-black text-white">{t.tripCostEstimator.step1Header}</p>
              </div>
              {/* Step body */}
              <div className="px-4 py-3 space-y-2.5">
                {/* Current tank status */}
                <div className="flex items-center gap-2">
                  <span className="text-base flex-shrink-0">🔋</span>
                  <p className="text-xs text-blue-800 leading-relaxed">
                    <span className="font-black">{t.tripCostEstimator.tankIsAt(pctDisplay)}</span>
                    {tankGalNum > 0 && (
                      <> {t.tripCostEstimator.tankGalOf(currentGal.toFixed(1), String(tankGalNum))}</>
                    )}
                    {' '}{t.tripCostEstimator.notEnoughWithoutStopping}
                  </p>
                </div>
                {/* Action */}
                <div className="bg-white rounded-xl border border-blue-100 px-3 py-3">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-wide mb-1.5">
                    ⛽ {t.tripCostEstimator.stopNearAndAdd(originCity)}
                  </p>
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="text-xl font-black text-blue-700 leading-none">
                        {galToTopOff.toFixed(2)} gal
                      </p>
                      <p className="text-[9px] text-slate-400 mt-0.5">{t.tripCostEstimator.toTopOffTank}</p>
                    </div>
                    <div className="text-slate-300 text-lg font-light">≈</div>
                    <div>
                      <p className="text-xl font-black text-slate-700 leading-none">
                        ${costToTopOff.toFixed(2)}
                      </p>
                      <p className="text-[9px] text-slate-400 mt-0.5">{t.tripCostEstimator.atPricePerGal(priceNum.toFixed(3))}</p>
                    </div>
                  </div>
                </div>
                {stopsIfFull < stops && (
                  <p className="text-[10px] text-blue-700 leading-relaxed">
                    💡 {t.tripCostEstimator.toppingOffReducesPre}{' '}
                    <span className="font-black">{stops}</span> {t.tripCostEstimator.to}{' '}
                    <span className="font-black">{stopsIfFull}</span> {t.tripCostEstimator.toppingOffReducesPost}
                  </p>
                )}
                <p className="text-[10px] text-blue-600 leading-relaxed">
                  {t.tripCostEstimator.afterFillRangePre}{' '}
                  <span className="font-black">{t.tripCostEstimator.rangeMiles(tankRange.toLocaleString())}</span> {t.tripCostEstimator.afterFillEnoughToReach}{' '}
                  {stopsIfFull === 0 ? t.tripCostEstimator.yourDestination : t.tripCostEstimator.mileBeforeNextStop(firstStopMile.toLocaleString())}.
                </p>
              </div>
            </div>
          )}

          {/* STEP 2+ — En-route refuel stop(s) */}
          {stopsIfFull > 0 && (
            <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 overflow-hidden">
              {/* Step header */}
              <div className="flex items-center gap-2.5 px-4 py-2.5 bg-amber-500">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white text-amber-600 text-[10px] font-black flex items-center justify-center leading-none">
                  {needsPreTripFill ? '2' : '1'}
                </span>
                <p className="text-xs font-black text-white">
                  {t.tripCostEstimator.onTheRoadStops(stopsIfFull)}
                </p>
              </div>
              {/* Step body */}
              <div className="px-4 py-3 space-y-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-base flex-shrink-0">📍</span>
                  <p className="text-xs text-amber-900 leading-relaxed">
                    <span className="font-black">
                      {t.tripCostEstimator.planToStopAroundMile(firstStopMile.toLocaleString())}
                    </span>{' '}
                    {t.tripCostEstimator.fromYourStartingPoint}
                    {mpgNum > 0 && tankGalNum > 0 && (
                      <> {t.tripCostEstimator.roughlyHoursIntoDrive(Math.round(firstStopMile / (mpgNum * 55 / 60)))}</>
                    )}
                    .
                  </p>
                </div>
                {galAtRoadStops > 0.1 && priceNum > 0 && (
                  <div className="bg-white rounded-xl border border-amber-100 px-3 py-3">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-wide mb-1.5">
                      ⛽ {t.tripCostEstimator.addAtHighwayStops(stopsIfFull)}
                    </p>
                    <div className="flex items-center gap-4">
                      <div>
                        <p className="text-xl font-black text-amber-700 leading-none">
                          {galAtRoadStops.toFixed(2)} gal
                        </p>
                        <p className="text-[9px] text-slate-400 mt-0.5">{t.tripCostEstimator.toReachDestination}</p>
                      </div>
                      <div className="text-slate-300 text-lg font-light">≈</div>
                      <div>
                        <p className="text-xl font-black text-slate-700 leading-none">
                          ${costAtRoadStops.toFixed(2)}
                        </p>
                        <p className="text-[9px] text-slate-400 mt-0.5">{t.tripCostEstimator.atPricePerGal(priceNum.toFixed(3))}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Gas stations for road stop */}
                {(stopsLoading || fuelStops.length > 0) && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-black text-amber-800 uppercase tracking-wide">
                      ⛽ {t.tripCostEstimator.gasStationsAroundMile(firstStopMile.toLocaleString())}
                      {routeOrigin && (
                        <span className="font-normal normal-case text-amber-600">
                          {' '}{t.tripCostEstimator.approxMiFrom(firstStopMile.toLocaleString(), originCity)}
                        </span>
                      )}
                    </p>
                    {stopsLoading ? (
                      <div className="flex items-center gap-2 text-xs text-amber-700 py-1">
                        <span className="inline-block w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                        {t.tripCostEstimator.searchingNearbyStations}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {fuelStops.map((stop, i) => (
                          <div
                            key={stop.placeId ?? i}
                            className="bg-white rounded-xl border border-amber-100 px-3 py-2.5 flex items-start justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-slate-700 truncate">{stop.name}</p>
                              {stop.address && (
                                <p className="text-[10px] text-slate-400 truncate mt-0.5">{stop.address}</p>
                              )}
                              <div className="flex items-center gap-2 mt-0.5">
                                {stop.rating && (
                                  <p className="text-[10px] text-amber-600 font-bold">★ {stop.rating.toFixed(1)}</p>
                                )}
                                <p className="text-[10px] text-slate-400">
                                  {t.tripCostEstimator.miFromOrigin(firstStopMile.toLocaleString(), originCity)}
                                </p>
                              </div>
                            </div>
                            <a
                              href={`https://www.google.com/maps/dir/?api=1&destination=${stop.latitude},${stop.longitude}&travelmode=driving`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => {
                                try { sessionStorage.setItem('gc_trip_nav_away', '1'); } catch { /* ignore */ }
                              }}
                              className="flex-shrink-0 text-[11px] font-bold text-[#1a73e8] hover:underline whitespace-nowrap mt-0.5"
                              aria-label={t.tripCostEstimator.ariaNavigateTo(stop.name)}
                            >
                              {t.tripCostEstimator.navigate} →
                            </a>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TOTAL COST SUMMARY */}
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wide">{t.tripCostEstimator.totalGasToBuy}</p>
                <p className="text-2xl font-black text-amber-600 leading-none mt-0.5">
                  ${fuelCost.toFixed(2)}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {t.tripCostEstimator.galAcrossAllStops(gallonsNeeded.toFixed(2), priceNum.toFixed(3))}
                </p>
              </div>
              {costPerPerson != null && (
                <div className="text-right border-l border-slate-100 pl-4">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wide">{t.tripCostEstimator.perPerson}</p>
                  <p className="text-xl font-black text-slate-700 leading-none mt-0.5">
                    ${costPerPerson.toFixed(2)}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── QUICK STATS row (range + efficiency) ─────────────────────────── */}
      {!noFuelNeeded && (
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-slate-50 rounded-xl border border-slate-100 px-3 py-2.5 text-center">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{t.tripCostEstimator.fullTankRange}</p>
            <p className="text-base font-black text-navy-700 mt-0.5">{tankRange} mi</p>
          </div>
          <div className="bg-slate-50 rounded-xl border border-slate-100 px-3 py-2.5 text-center">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{t.tripCostEstimator.milesPerDollar}</p>
            <p className="text-base font-black text-navy-700 mt-0.5">{milesPerDollar} mi</p>
          </div>
        </div>
      )}

      {/* ── Save this trip ────────────────────────────────────────────────── */}
      {isSignedIn && (
        canSave ? (
          <button
            onClick={onSave}
            disabled={isSaved || isSaving}
            className={[
              'w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl text-sm font-bold',
              'border-2 transition-all',
              isSaved
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700 cursor-default'
                : 'border-[#005F4A]/30 bg-[#005F4A]/10 text-[#005F4A] hover:bg-[#005F4A]/20 hover:border-[#005F4A]/50',
            ].join(' ')}
          >
            {isSaved ? (
              <>✓ {t.tripCostEstimator.tripSaved}</>
            ) : isSaving ? (
              <>
                <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                {t.tripCostEstimator.saving}
              </>
            ) : (
              <>🗺️ {t.tripCostEstimator.saveThisTrip}</>
            )}
          </button>
        ) : (
          <Link
            href="/upgrade"
            onClick={() => trackLockedFeatureShown('save_trip', planTier)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl text-sm font-bold
                       border-2 border-amber-200 bg-amber-50 text-amber-700
                       hover:bg-amber-100 transition-all"
          >
            🔒 {t.tripCostEstimator.saveThisTripProFeature}
          </Link>
        )
      )}

      {/* ── Navigation handoffs ───────────────────────────────────────────── */}
      {!noFuelNeeded && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div
          className="space-y-2 pt-1"
          onClick={() => {
            try { sessionStorage.setItem('gc_trip_nav_away', '1'); } catch { /* ignore */ }
          }}
        >
          <GoogleMapsHandoffButton
            mode="trip"
            calculationData={{
              gallonsNeeded: gallonsNeeded,
              estimatedCost: fuelCost,
              tripDistance:  totalMiles,
            }}
          />
        </div>
      )}
    </div>
  );
}
