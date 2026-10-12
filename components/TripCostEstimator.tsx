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
import { metersToMiles, calcTrip }           from '@/lib/tripFuelPlanner';
import type { TripResult }                   from '@/lib/tripFuelPlanner';
import { resolveVehicleMpg }                 from '@/lib/mpgResolver';
import type { RouteResult, FuelStop, LatLng } from '@/lib/mapsProvider/types';
import type { Vehicle }                      from './SavedVehicles';
import { resolveVehicleGaugeStyle } from '@/lib/gaugeStyles';
import { useIsNative }                       from '@/hooks/useIsNative';
import { requestCurrentLocation }            from '@/lib/currentLocation';
import { createPlacesSessionToken }          from '@/lib/placesSessionToken';
import GoogleAttribution                     from './GoogleAttribution';
import { createLatestWinsGuard }             from '@/lib/latestWinsGuard';
import { resolveSelectedPlace }              from '@/lib/placeSelectionResolver';
import { fetchPlaceCoordinates }             from '@/lib/placeLocationClient';

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

// ── Favorite Addresses (Phase 2) ──────────────────────────────────────────

interface FavoriteAddressClient {
  id:             string;
  label:          string;
  displayAddress: string;
  placeId?:       string;
  source:         'google_place' | 'manual_text';
}

// ── Saved vehicle + avg MPG loader ────────────────────────────────────────

interface GarageResp    { vehicles: Vehicle[]; fuelGaugeStyle?: string | null; }
interface AvgMpgResp    { avgMpgByVehicleId: Record<string, number>; }

function useGarageData() {
  const { data: session } = useSession();
  const [vehicles,          setVehicles]          = useState<Vehicle[]>([]);
  const [userGaugeStyle,    setUserGaugeStyle]    = useState<string | null>(null);
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
      setUserGaugeStyle(d.fuelGaugeStyle ?? null);
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

  return { vehicles, avgMpgByVehicleId, userGaugeStyle, load };
}

// ── Resolve best MPG for a garage vehicle ─────────────────────────────────
// Shared with every other MPG-consuming surface — see lib/fillups.ts.

function resolveMpg(v: Vehicle, avgMpgByVehicleId: Record<string, number>) {
  return resolveVehicleMpg(v.vehicleSpecs, avgMpgByVehicleId[v.id]);
}

// ── Duration formatting ────────────────────────────────────────────────────
// Exported for direct unit testing (routing-integrity audit, 2026-10-12) —
// no prior test exercised the Google-duration-string -> seconds -> formatted
// hours/minutes pipeline at all.

export function formatDuration(
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

interface AutocompleteSuggestion {
  text:    string;
  placeId: string;
}

/**
 * Phase 2 (2026-10-11): now tracks a Places Autocomplete (New) session
 * token — a fresh one per search, reused across keystrokes, sent with the
 * search's eventual /api/maps/place-location lookup via
 * consumeSessionToken() — so Google bills the search+selection as one
 * session instead of charging each keystroke's request separately. Also
 * now returns placeId per suggestion (previously discarded), needed so a
 * selected address can become a Favorite or be routed by coordinates.
 */
function useAddressAutocomplete(query: string, enabled: boolean) {
  const [results, setResults] = useState<AutocompleteSuggestion[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || query.length < 2) { setResults([]); return; }
    if (!sessionTokenRef.current) sessionTokenRef.current = createPlacesSessionToken();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetch('/api/maps/autocomplete', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ input: query, sessionToken: sessionTokenRef.current }),
      })
        .then((r) => r.json() as Promise<{ ok: boolean; results?: AutocompleteSuggestion[] }>)
        .then((d) => { if (d.ok) setResults(d.results ?? []); })
        .catch(() => {});
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, enabled]);

  function clear() { setResults([]); }

  /** Call when a suggestion is selected (or the field is abandoned) — returns the token that covered this search and starts a fresh one for next time. */
  function consumeSessionToken(): string | undefined {
    const token = sessionTokenRef.current ?? undefined;
    sessionTokenRef.current = null;
    return token;
  }

  return { results, clear, consumeSessionToken };
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
  const { vehicles, avgMpgByVehicleId, userGaugeStyle, load: loadGarage } = useGarageData();

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
  // Set when a saved favorite's Place Details lookup failed and the route
  // was built from its saved text as a fallback instead — surfaced per
  // independent review, since that could in principle resolve to a
  // similarly-named but different location than the one originally saved.
  const [usedFavoriteFallback, setUsedFavoriteFallback] = useState(false);

  // Current Location + Favorite Addresses (Phase 2, 2026-10-11)
  const isNative = useIsNative();
  const [originMode, setOriginMode] = useState<'manual' | 'current_location' | 'favorite'>('manual');
  const [destMode,   setDestMode]   = useState<'manual' | 'favorite'>('manual');
  const [originFavoriteId, setOriginFavoriteId] = useState('');
  const [destFavoriteId,   setDestFavoriteId]   = useState('');
  const [originPlaceId, setOriginPlaceId] = useState<string | undefined>(undefined);
  const [destPlaceId,   setDestPlaceId]   = useState<string | undefined>(undefined);
  // Resolved immediately on suggestion selection (see selectOriginSuggestion/
  // selectDestSuggestion) — this is what actually closes the Autocomplete
  // session with a USEFUL Place Details call (precise routing coordinates),
  // rather than a call added only to spend the session token. Falls back to
  // the typed/selected text at Calculate time if this never resolves.
  const [originCoords, setOriginCoords] = useState<LatLng | undefined>(undefined);
  const [destCoords,   setDestCoords]   = useState<LatLng | undefined>(undefined);
  // Routing-integrity fix (2026-10-12): origin and destination each get
  // their own LatestWinsGuard, so a Place Details lookup from an abandoned
  // selection can never overwrite coordinates for the current one — see
  // selectOriginSuggestion/selectDestSuggestion and every mode-switch
  // handler below, all of which invalidate the relevant guard. Independent
  // in-flight counters drive originResolving/destResolving (a UI-visible
  // "still resolving" state, not just a correctness fix) since more than
  // one lookup can be outstanding for the same field at once.
  const originGuard = useRef(createLatestWinsGuard());
  const destGuard   = useRef(createLatestWinsGuard());
  const originInFlight = useRef(0);
  const destInFlight   = useRef(0);
  const [originResolving, setOriginResolving] = useState(false);
  const [destResolving,   setDestResolving]   = useState(false);

  // Unmount safety: invalidate both guards so a lookup that outlives this
  // component's lifetime can never call a setState on an unmounted instance.
  useEffect(() => {
    return () => {
      originGuard.current.invalidateAll();
      destGuard.current.invalidateAll();
    };
  }, []);
  const [currentLocationStatus, setCurrentLocationStatus] =
    useState<'idle' | 'locating' | 'granted' | 'denied' | 'unavailable' | 'timeout' | 'unsupported'>('idle');
  const [currentLocationCoords, setCurrentLocationCoords] = useState<LatLng | null>(null);
  const [favorites,       setFavorites]       = useState<FavoriteAddressClient[]>([]);
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);
  const [savePrompt, setSavePrompt] = useState<{ which: 'origin' | 'destination'; displayAddress: string; placeId?: string; label: string } | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{ existingLabel: string } | null>(null);
  const [savingFavorite,   setSavingFavorite]   = useState(false);
  const [manageOpen,       setManageOpen]       = useState(false);
  const [pendingDeleteFavoriteId, setPendingDeleteFavoriteId] = useState<string | null>(null);

  const userPlan       = (session?.user as { plan?: string })?.plan ?? '';
  const planTier       = getPlanTier((session?.user as { plan?: string } | null) ?? null);
  const canUseRoutePlanner = canAccessFeature('route_based_trip_planner', userPlan);
  const canSaveTrips       = canAccessFeature('save_trip', userPlan);

  // Lock tank size when a garage vehicle is selected (tank is auto-populated from the vehicle)
  const garageVehicleLocked = vehicleMode === 'garage' && selectedVehicleId !== '';

  // Address autocomplete for route-based planner
  const { results: originResults, clear: clearOriginSugg, consumeSessionToken: consumeOriginToken } =
    useAddressAutocomplete(routeOrigin, canUseRoutePlanner && tripPlanMode === 'route' && originMode === 'manual');
  const { results: destResults, clear: clearDestSugg, consumeSessionToken: consumeDestToken } =
    useAddressAutocomplete(routeDest, canUseRoutePlanner && tripPlanMode === 'route' && destMode === 'manual');

  const loadFavorites = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch('/api/favorite-addresses');
      if (res.ok) {
        const d = await res.json() as { favorites: FavoriteAddressClient[] };
        setFavorites(d.favorites ?? []);
      }
    } catch { /* non-critical — favorites list just stays empty/stale */ }
    setFavoritesLoaded(true);
  }, [session]);

  useEffect(() => {
    if (session && canUseRoutePlanner && tripPlanMode === 'route' && !favoritesLoaded) loadFavorites();
  }, [session, canUseRoutePlanner, tripPlanMode, favoritesLoaded, loadFavorites]);

  async function handleUseCurrentLocation() {
    originGuard.current.invalidateAll();
    setOriginMode('current_location');
    setOriginFavoriteId('');
    setOriginPlaceId(undefined);
    setOriginCoords(undefined);
    setRouteOrigin('');
    clearOriginSugg();
    setRouteData(null);
    setResult(null);
    setCurrentLocationStatus('locating');
    const loc = await requestCurrentLocation(isNative);
    if (loc.status === 'granted') {
      setCurrentLocationCoords({ latitude: loc.latitude, longitude: loc.longitude });
      setCurrentLocationStatus('granted');
    } else {
      setCurrentLocationCoords(null);
      setCurrentLocationStatus(loc.status);
    }
  }

  function handleOriginBackToManual() {
    originGuard.current.invalidateAll();
    setOriginMode('manual');
    setOriginFavoriteId('');
    setOriginPlaceId(undefined);
    setOriginCoords(undefined);
    setCurrentLocationStatus('idle');
    setCurrentLocationCoords(null);
    setRouteData(null);
    setResult(null);
  }

  function handleSelectOriginFavorite(fav: FavoriteAddressClient) {
    originGuard.current.invalidateAll();
    setOriginMode('favorite');
    setOriginFavoriteId(fav.id);
    setOriginPlaceId(undefined);
    setOriginCoords(undefined);
    setCurrentLocationStatus('idle');
    setCurrentLocationCoords(null);
    setRouteOrigin('');
    clearOriginSugg();
    setRouteData(null);
    setResult(null);
  }

  function handleDestBackToManual() {
    destGuard.current.invalidateAll();
    setDestMode('manual');
    setDestFavoriteId('');
    setDestPlaceId(undefined);
    setDestCoords(undefined);
    setRouteData(null);
    setResult(null);
  }

  function handleSelectDestFavorite(fav: FavoriteAddressClient) {
    destGuard.current.invalidateAll();
    setDestMode('favorite');
    setDestFavoriteId(fav.id);
    setDestPlaceId(undefined);
    setDestCoords(undefined);
    setRouteDest('');
    clearDestSugg();
    setRouteData(null);
    setResult(null);
  }

  /**
   * Resolves the selected suggestion's placeId immediately, using the same
   * session token that covered the search — this is the Place Details call
   * that actually closes the Autocomplete (New) billing session, and it's
   * useful on its own merits (precise coordinates beat re-geocoding a text
   * string), not added solely to spend the token.
   */
  async function selectOriginSuggestion(s: AutocompleteSuggestion) {
    setRouteOrigin(s.text);
    setOriginPlaceId(s.placeId);
    setOriginCoords(undefined);
    const token = consumeOriginToken();
    clearOriginSugg();
    setRouteData(null);
    setResult(null);
    originInFlight.current += 1;
    setOriginResolving(true);
    try {
      await resolveSelectedPlace(
        originGuard.current,
        () => fetchPlaceCoordinates(s.placeId, token),
        (coords) => setOriginCoords(coords),
      );
    } finally {
      originInFlight.current -= 1;
      if (originInFlight.current <= 0) {
        originInFlight.current = 0;
        setOriginResolving(false);
      }
    }
  }

  async function selectDestSuggestion(s: AutocompleteSuggestion) {
    setRouteDest(s.text);
    setDestPlaceId(s.placeId);
    setDestCoords(undefined);
    const token = consumeDestToken();
    clearDestSugg();
    setRouteData(null);
    setResult(null);
    destInFlight.current += 1;
    setDestResolving(true);
    try {
      await resolveSelectedPlace(
        destGuard.current,
        () => fetchPlaceCoordinates(s.placeId, token),
        (coords) => setDestCoords(coords),
      );
    } finally {
      destInFlight.current -= 1;
      if (destInFlight.current <= 0) {
        destInFlight.current = 0;
        setDestResolving(false);
      }
    }
  }

  function openSavePrompt(which: 'origin' | 'destination') {
    const displayAddress = (which === 'origin' ? routeOrigin : routeDest).trim();
    if (!displayAddress) return;
    const placeId = which === 'origin' ? originPlaceId : destPlaceId;
    setSavePrompt({ which, displayAddress, placeId, label: '' });
    setDuplicateWarning(null);
  }

  async function submitFavorite(confirmDuplicate: boolean) {
    if (!savePrompt || !savePrompt.label.trim()) return;
    setSavingFavorite(true);
    try {
      const res = await fetch('/api/favorite-addresses', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label:          savePrompt.label.trim(),
          displayAddress: savePrompt.displayAddress,
          placeId:        savePrompt.placeId,
          source:         savePrompt.placeId ? 'google_place' : 'manual_text',
          confirmDuplicate,
        }),
      });
      if (res.status === 409) {
        const d = await res.json() as { existing?: { label: string } };
        setDuplicateWarning({ existingLabel: d.existing?.label ?? savePrompt.label.trim() });
        return;
      }
      if (res.ok) {
        setSavePrompt(null);
        setDuplicateWarning(null);
        setFavoritesLoaded(false);
        await loadFavorites();
      }
    } finally {
      setSavingFavorite(false);
    }
  }

  async function handleDeleteFavorite(id: string) {
    await fetch(`/api/favorite-addresses?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
    if (originMode === 'favorite' && originFavoriteId === id) handleOriginBackToManual();
    if (destMode === 'favorite' && destFavoriteId === id) handleDestBackToManual();
    setFavoritesLoaded(false);
    await loadFavorites();
  }

  /** Resolves the From/To field currently in play into something /api/maps/route accepts. */
  async function resolveWaypoint(
    mode: 'manual' | 'current_location' | 'favorite',
    favoriteId: string,
    manualText: string,
    manualCoords?: LatLng,
  ): Promise<{ waypoint: string | LatLng; usedFallback?: boolean } | null> {
    if (mode === 'current_location') {
      return currentLocationCoords ? { waypoint: currentLocationCoords } : null;
    }
    if (mode === 'favorite') {
      try {
        const res = await fetch(`/api/favorite-addresses/${encodeURIComponent(favoriteId)}/resolve`, { method: 'POST' });
        if (!res.ok) return null;
        const d = await res.json() as { ok: boolean; kind?: string; latitude?: number; longitude?: number; text?: string; usedFallback?: boolean };
        if (!d.ok) return null;
        if (d.kind === 'coordinates' && d.latitude != null && d.longitude != null) return { waypoint: { latitude: d.latitude, longitude: d.longitude } };
        // usedFallback: a 'google_place' favorite whose Place Details lookup
        // failed — this is the saved text as a fallback, not an
        // intentionally-manual address. Surfaced to the user per independent
        // review, since a route built from it could land somewhere
        // similarly-named but not the exact saved place.
        if (d.kind === 'address' && d.text) return { waypoint: d.text, usedFallback: d.usedFallback };
        return null;
      } catch {
        return null;
      }
    }
    // manual: prefer coordinates resolved when the suggestion was selected
    // (selectOriginSuggestion/selectDestSuggestion) — more precise than
    // re-geocoding the text string, and it's what actually closed the
    // Autocomplete session. Falls back to the text if that never resolved
    // (place-location failed, or the text was typed free-hand with no
    // suggestion selected at all).
    const waypoint = manualCoords ?? (manualText.trim() || null);
    return waypoint ? { waypoint } : null;
  }

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
    // Routing-integrity fix (2026-10-12): refuse to calculate while a
    // Place Details lookup is still resolving — resolveWaypoint() would
    // silently fall back to the typed text, discarding the precise
    // coordinates about to arrive, and the result could change out from
    // under the user a moment later with no indication why.
    if (originResolving || destResolving) return;
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
    if (originMode === 'manual' && !routeOrigin.trim()) errs.routeOrigin = t.tripCostEstimator.errOrigin;
    if (originMode === 'current_location' && currentLocationStatus !== 'granted') errs.routeOrigin = t.tripCostEstimator.errOrigin;
    if (destMode === 'manual' && !routeDest.trim())     errs.routeDest   = t.tripCostEstimator.errDest;
    if (!mpgNum || mpgNum <= 0)           errs.mpg         = t.tripCostEstimator.errMpg;
    if (!tankNum || tankNum <= 0)         errs.tankGal     = t.tripCostEstimator.errTankShort;
    if (!priceNum || priceNum <= 0)       errs.pricePerGallon = t.tripCostEstimator.errPrice;
    if (isNaN(pctNum) || pctNum < 0 || pctNum > 100) errs.fuelPct = t.tripCostEstimator.errFuelPct;
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    // 1. Resolve From/To into something /api/maps/route accepts — a plain
    // address string (manual entry), or coordinates (Current Location, or a
    // 'google_place' favorite resolved fresh via its placeId — see
    // resolveWaypoint() and lib/favoriteAddresses.ts's resolve-on-use design).
    setRouteLoading(true);
    setUsedFavoriteFallback(false);
    const [originResolved, destResolved] = await Promise.all([
      resolveWaypoint(originMode, originFavoriteId, routeOrigin, originCoords),
      resolveWaypoint(destMode, destFavoriteId, routeDest, destCoords),
    ]);
    if (originResolved == null || destResolved == null) {
      setRouteError(t.tripCostEstimator.routeCalcFailed);
      setRouteLoading(false);
      return;
    }
    if (originResolved.usedFallback || destResolved.usedFallback) setUsedFavoriteFallback(true);

    let route: RouteResult;
    try {
      const res  = await fetch('/api/maps/route', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ origin: originResolved.waypoint, destination: destResolved.waypoint }),
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
                      {originMode !== 'manual' ? (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-amber-800 truncate">
                            {originMode === 'current_location'
                              ? (currentLocationStatus === 'locating' ? t.tripCostEstimator.currentLocationLocating : t.tripCostEstimator.currentLocationLabel)
                              : `📍 ${favorites.find((f) => f.id === originFavoriteId)?.label ?? ''}`}
                          </span>
                          <button type="button" onClick={handleOriginBackToManual} className="text-[11px] text-amber-600 font-semibold hover:underline flex-shrink-0">
                            {t.tripCostEstimator.changeLocation}
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          <button type="button" onClick={handleUseCurrentLocation}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 transition-colors">
                            {t.tripCostEstimator.currentLocationLabel}
                          </button>
                          {favorites.map((fav) => (
                            <button key={fav.id} type="button" onClick={() => handleSelectOriginFavorite(fav)}
                              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100 transition-colors">
                              📍 {fav.label}
                            </button>
                          ))}
                        </div>
                      )}
                      {originMode === 'current_location' && currentLocationStatus !== 'granted' && currentLocationStatus !== 'locating' && currentLocationStatus !== 'idle' && (
                        <p className="mt-1 text-[11px] text-amber-700 leading-relaxed">
                          {currentLocationStatus === 'denied'      && t.tripCostEstimator.currentLocationDenied}
                          {currentLocationStatus === 'unavailable' && t.tripCostEstimator.currentLocationUnavailable}
                          {currentLocationStatus === 'timeout'     && t.tripCostEstimator.currentLocationTimeout}
                          {currentLocationStatus === 'unsupported' && t.tripCostEstimator.currentLocationUnsupported}
                        </p>
                      )}
                      {originMode === 'manual' && (
                        <div className="relative">
                          <input
                            type="text"
                            className={`${errors.routeOrigin ? 'input-field-error' : 'input-field'} ${routeOrigin ? 'pr-8' : ''}`}
                            placeholder={t.tripCostEstimator.enterAnotherLocation}
                            value={routeOrigin}
                            autoComplete="off"
                            onChange={(e) => { originGuard.current.invalidateAll(); setRouteOrigin(e.target.value); setOriginPlaceId(undefined); setOriginCoords(undefined); setRouteData(null); setResult(null); }}
                            onBlur={() => { setTimeout(clearOriginSugg, 150); }}
                            aria-label={t.tripCostEstimator.ariaStartingPoint}
                          />
                          {routeOrigin && (
                            <button
                              type="button"
                              onClick={() => { originGuard.current.invalidateAll(); setRouteOrigin(''); setOriginPlaceId(undefined); setOriginCoords(undefined); clearOriginSugg(); setRouteData(null); setResult(null); }}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 transition-colors"
                              aria-label={t.tripCostEstimator.ariaClearStartingPoint}
                            >
                              <svg className="w-3.5 h-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                <path d="M1 1l10 10M11 1L1 11" />
                              </svg>
                            </button>
                          )}
                          {originResults.length > 0 && (
                            <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                              {originResults.map((s) => (
                                <button
                                  key={s.placeId}
                                  type="button"
                                  className="w-full text-left px-3 py-2.5 text-xs text-slate-700 hover:bg-amber-50 hover:text-amber-800 border-b border-slate-50 last:border-0 transition-colors"
                                  onMouseDown={(e) => { e.preventDefault(); selectOriginSuggestion(s); }}
                                >
                                  📍 {s.text}
                                </button>
                              ))}
                              <GoogleAttribution />
                            </div>
                          )}
                        </div>
                      )}
                      {errors.routeOrigin && <p className="mt-1 text-xs text-red-500">{errors.routeOrigin}</p>}
                      {originMode === 'manual' && routeOrigin.trim() && (
                        <button type="button" onClick={() => openSavePrompt('origin')} className="mt-1 text-[11px] text-slate-500 font-semibold hover:underline">
                          {t.tripCostEstimator.saveAsFavorite}
                        </button>
                      )}
                    </div>
                    <div>
                      <p className="field-label">{t.tripCostEstimator.destination}</p>
                      {destMode !== 'manual' ? (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-amber-800 truncate">
                            📍 {favorites.find((f) => f.id === destFavoriteId)?.label ?? ''}
                          </span>
                          <button type="button" onClick={handleDestBackToManual} className="text-[11px] text-amber-600 font-semibold hover:underline flex-shrink-0">
                            {t.tripCostEstimator.changeLocation}
                          </button>
                        </div>
                      ) : (
                        favorites.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {favorites.map((fav) => (
                              <button key={fav.id} type="button" onClick={() => handleSelectDestFavorite(fav)}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100 transition-colors">
                                📍 {fav.label}
                              </button>
                            ))}
                          </div>
                        )
                      )}
                      {destMode === 'manual' && (
                        <div className="relative">
                          <input
                            type="text"
                            className={`${errors.routeDest ? 'input-field-error' : 'input-field'} ${routeDest ? 'pr-8' : ''}`}
                            placeholder={t.tripCostEstimator.enterAnotherLocation}
                            value={routeDest}
                            autoComplete="off"
                            onChange={(e) => { destGuard.current.invalidateAll(); setRouteDest(e.target.value); setDestPlaceId(undefined); setDestCoords(undefined); setRouteData(null); setResult(null); }}
                            onBlur={() => { setTimeout(clearDestSugg, 150); }}
                            aria-label={t.tripCostEstimator.ariaDestination}
                          />
                          {routeDest && (
                            <button
                              type="button"
                              onClick={() => { destGuard.current.invalidateAll(); setRouteDest(''); setDestPlaceId(undefined); setDestCoords(undefined); clearDestSugg(); setRouteData(null); setResult(null); }}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 transition-colors"
                              aria-label={t.tripCostEstimator.ariaClearDestination}
                            >
                              <svg className="w-3.5 h-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                <path d="M1 1l10 10M11 1L1 11" />
                              </svg>
                            </button>
                          )}
                          {destResults.length > 0 && (
                            <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                              {destResults.map((s) => (
                                <button
                                  key={s.placeId}
                                  type="button"
                                  className="w-full text-left px-3 py-2.5 text-xs text-slate-700 hover:bg-amber-50 hover:text-amber-800 border-b border-slate-50 last:border-0 transition-colors"
                                  onMouseDown={(e) => { e.preventDefault(); selectDestSuggestion(s); }}
                                >
                                  📍 {s.text}
                                </button>
                              ))}
                              <GoogleAttribution />
                            </div>
                          )}
                        </div>
                      )}
                      {errors.routeDest && <p className="mt-1 text-xs text-red-500">{errors.routeDest}</p>}
                      {destMode === 'manual' && routeDest.trim() && (
                        <button type="button" onClick={() => openSavePrompt('destination')} className="mt-1 text-[11px] text-slate-500 font-semibold hover:underline">
                          {t.tripCostEstimator.saveAsFavorite}
                        </button>
                      )}
                    </div>
                    {favorites.length > 0 && (
                      <button type="button" onClick={() => setManageOpen((v) => !v)} className="text-[11px] text-slate-400 font-semibold hover:underline">
                        {t.tripCostEstimator.manageSavedLocations}
                      </button>
                    )}
                    {manageOpen && (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-2 space-y-1">
                        {favorites.length === 0 && <p className="text-[11px] text-slate-400 px-2 py-1">{t.tripCostEstimator.noSavedLocations}</p>}
                        {favorites.map((fav) => (
                          <div key={fav.id} className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 ${pendingDeleteFavoriteId === fav.id ? 'bg-red-50' : 'bg-white'}`}>
                            {pendingDeleteFavoriteId === fav.id ? (
                              <>
                                <p className="text-[11px] font-semibold text-red-700">{t.tripCostEstimator.deleteFavoriteConfirm}</p>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <button type="button" onClick={() => setPendingDeleteFavoriteId(null)} className="text-[11px] font-bold text-slate-500 hover:text-slate-700">
                                    {t.tripCostEstimator.favoriteCancel}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { setPendingDeleteFavoriteId(null); handleDeleteFavorite(fav.id); }}
                                    className="text-[11px] font-bold text-white bg-red-500 hover:bg-red-600 px-3 py-1 rounded-lg"
                                  >
                                    {t.tripCostEstimator.favoriteDelete}
                                  </button>
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-slate-700 truncate">{fav.label}</p>
                                  <p className="text-[10px] text-slate-400 truncate">{fav.displayAddress}</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setPendingDeleteFavoriteId(fav.id)}
                                  className="text-[11px] text-red-500 font-semibold hover:underline flex-shrink-0"
                                >
                                  {t.tripCostEstimator.favoriteDelete}
                                </button>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {savePrompt && (
                      <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2 shadow-sm">
                        <p className="field-label">{t.tripCostEstimator.favoriteLabelPrompt}</p>
                        <p className="text-[11px] text-slate-400 truncate">{savePrompt.displayAddress}</p>
                        <input
                          type="text"
                          className="input-field"
                          placeholder={t.tripCostEstimator.favoriteLabelPlaceholder}
                          value={savePrompt.label}
                          autoFocus
                          onChange={(e) => setSavePrompt({ ...savePrompt, label: e.target.value })}
                        />
                        {duplicateWarning && (
                          <p className="text-[11px] text-amber-700 leading-relaxed">
                            {t.tripCostEstimator.favoriteDuplicateWarning(duplicateWarning.existingLabel)}
                          </p>
                        )}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={!savePrompt.label.trim() || savingFavorite}
                            onClick={() => submitFavorite(!!duplicateWarning)}
                            className="flex-1 px-3 py-2 rounded-lg bg-[#005F4A] text-white text-xs font-bold disabled:opacity-50"
                          >
                            {duplicateWarning ? t.tripCostEstimator.favoriteSaveAnyway : t.tripCostEstimator.favoriteSave}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setSavePrompt(null); setDuplicateWarning(null); }}
                            className="px-3 py-2 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold"
                          >
                            {t.tripCostEstimator.favoriteCancel}
                          </button>
                        </div>
                      </div>
                    )}
                    {routeData && (
                      <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                        <span className="text-sm">📍</span>
                        <p className="text-xs font-bold text-emerald-700">
                          {t.tripCostEstimator.routeSummary(metersToMiles(routeData.distanceMeters).toLocaleString(), formatDuration(routeData.durationSeconds, t.tripCostEstimator))}
                        </p>
                      </div>
                    )}
                    {routeData && usedFavoriteFallback && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                        <p className="text-[11px] text-amber-700 leading-relaxed">
                          {t.tripCostEstimator.favoriteFallbackWarning}
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
              style={resolveVehicleGaugeStyle(vehicles, garageVehicleLocked ? selectedVehicleId : null, userGaugeStyle)}
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
                disabled={routeLoading || mpgLookingUp || originResolving || destResolving}
              >
                {routeLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    {t.tripCostEstimator.calculatingRoute}
                  </span>
                ) : (originResolving || destResolving) ? (
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
