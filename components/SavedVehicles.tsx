'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState, useCallback, useRef } from 'react';
import VehiclePicker from './VehiclePicker';
import BadgeShelf   from './BadgeShelf';
import type { VehicleSpecs } from '@/lib/vehicleSpecs';
import { useTranslation } from '@/contexts/LanguageContext';
import { GarageDoor }                        from './GarageDoor';
import { useGarageDoorPrefs }                from '@/hooks/useGarageDoorPrefs';


export interface Vehicle {
  id:               string;
  name:             string;
  gallons:          number;
  vin?:             string;
  year?:            string;
  make?:            string;
  model?:           string;
  trim?:            string;
  fuelType?:        string;
  epaId?:           string;
  currentOdometer?: number;
  vehicleSpecs?:    VehicleSpecs;
}

interface GarageResponse {
  vehicles: Vehicle[];
  plan:     'free' | 'pro' | 'fleet';
  limit:    number;
}

interface SavedVehiclesProps {
  currentGallons:    string;
  onSelect:          (gallons: string, vehicle?: Vehicle) => void;
  selectedVehicleId?: string;
  /** Increments each time a calculation fires so BadgeShelf re-fetches */
  calcKey?:          number;
}

// ── Icons ────────────────────────────────────────────────────────────────

function CarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 17H3a2 2 0 01-2-2v-4l2.5-6h13l2.5 6v4a2 2 0 01-2 2h-2"/>
      <circle cx="7.5" cy="17.5" r="1.5"/>
      <circle cx="16.5" cy="17.5" r="1.5"/>
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2"/>
      <path d="M7 11V7a5 5 0 0110 0v4"/>
    </svg>
  );
}

// ── Manufacturer logo ────────────────────────────────────────────────────
// Source: filippofilip95/car-logos-dataset via jsDelivr CDN (387 brands, no API key)
// URL pattern: https://cdn.jsdelivr.net/gh/filippofilip95/car-logos-dataset@master/logos/thumb/{slug}.png

// Overrides where the make name doesn't map cleanly to the dataset slug
const MAKE_SLUG_OVERRIDES: Record<string, string> = {
  'chevy':           'chevrolet',
  'vw':              'volkswagen',
  'mercedes':        'mercedes-benz',
  'alfa romeo':      'alfa-romeo',
  'land rover':      'land-rover',
  'aston martin':    'aston-martin',
};

function getMakeLogoUrl(make: string): string {
  const key  = make.toLowerCase().trim();
  const slug = MAKE_SLUG_OVERRIDES[key] ?? key.replace(/\s+/g, '-');
  return `https://cdn.jsdelivr.net/gh/filippofilip95/car-logos-dataset@master/logos/thumb/${slug}.png`;
}

function MakeLogo({ make, selected }: { make: string; selected: boolean }) {
  const [failed, setFailed] = useState(false);

  const containerCls = [
    'flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center overflow-hidden transition-all',
    selected
      ? 'bg-white shadow-sm border border-amber-200'
      : 'bg-white border border-slate-100 shadow-sm',
  ].join(' ');

  if (failed) {
    return (
      <div className={containerCls}>
        <span className="text-xs font-black text-slate-400 select-none">
          {make.charAt(0).toUpperCase()}
        </span>
      </div>
    );
  }

  return (
    <div className={containerCls}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={getMakeLogoUrl(make)}
        alt={`${make} logo`}
        loading="lazy"
        className="w-6 h-6 object-contain"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

// ── Vehicle Info Modal ────────────────────────────────────────────────────

function VehicleInfoModal({ vehicle, onClose, onSpecsUpdated }: {
  vehicle: Vehicle;
  onClose: () => void;
  onSpecsUpdated?: (specs: VehicleSpecs) => void;
}) {
  const { t } = useTranslation();
  const [specs,        setSpecs]        = useState<VehicleSpecs | undefined>(vehicle.vehicleSpecs);
  const [fetchingSpec, setFetchingSpec] = useState(false);
  const [fetchError,   setFetchError]   = useState('');

  // Auto-fetch specs on open if a VIN is on file but specs haven't been decoded yet
  useEffect(() => {
    if (specs || !vehicle.vin || fetchingSpec) return;
    let cancelled = false;
    setFetchingSpec(true);
    setFetchError('');
    (async () => {
      try {
        const res  = await fetch(`/api/vin?vin=${vehicle.vin}`);
        const data = await res.json() as { specs?: VehicleSpecs; error?: string };
        if (cancelled) return;
        if (!res.ok || data.error || !data.specs) {
          setFetchError(data.error ?? t.garage.lookupFailed);
          return;
        }
        // Persist decoded specs to the server
        await fetch(`/api/vehicles?id=${vehicle.id}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ vehicleSpecs: data.specs }),
        });
        window.dispatchEvent(new Event('vehicle-saved'));
        setSpecs(data.specs);
        onSpecsUpdated?.(data.specs);
      } catch {
        if (!cancelled) setFetchError(t.garage.networkErrorCheck);
      } finally {
        if (!cancelled) setFetchingSpec(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleFetchSpecs() {
    if (!vehicle.vin) return;
    setFetchingSpec(true);
    setFetchError('');
    try {
      const res  = await fetch(`/api/vin?vin=${vehicle.vin}`);
      const data = await res.json() as { specs?: VehicleSpecs; error?: string };
      if (!res.ok || data.error) { setFetchError(data.error ?? t.garage.lookupFailed); return; }
      if (!data.specs) { setFetchError(t.garage.noSpecsReturned); return; }

      // Persist to the server
      const patch = await fetch(`/api/vehicles?id=${vehicle.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ vehicleSpecs: data.specs }),
      });
      if (!patch.ok) { setFetchError(t.garage.savedLocallyNotPersisted); }

      window.dispatchEvent(new Event('vehicle-saved'));
      setSpecs(data.specs);
      onSpecsUpdated?.(data.specs);
    } catch {
      setFetchError(t.garage.networkErrorCheck);
    } finally {
      setFetchingSpec(false);
    }
  }

  function Row({ label, value }: { label: string; value?: string | number | boolean | null }) {
    if (value === undefined || value === null || value === '') return null;
    const display = typeof value === 'boolean' ? (value ? t.garage.rowYes : t.garage.rowNo) : String(value);
    return (
      <div className="flex items-start justify-between gap-3 py-1.5 border-b border-slate-50 last:border-0">
        <span className="text-xs text-slate-500 flex-shrink-0">{label}</span>
        <span className="text-xs font-semibold text-slate-700 text-right">{display}</span>
      </div>
    );
  }

  function Section({ title, emoji, children }: { title: string; emoji: string; children: React.ReactNode }) {
    return (
      <div className="mb-4">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-sm">{emoji}</span>
          <p className="text-xs font-black text-slate-600 uppercase tracking-wider">{title}</p>
        </div>
        <div className="bg-slate-50 rounded-xl px-3 py-1">{children}</div>
      </div>
    );
  }

  const vinDisplay = vehicle.vin ?? specs?.vin;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl w-full max-w-sm max-h-[85vh] overflow-hidden flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-navy-700 px-5 py-4 flex items-start justify-between flex-shrink-0">
          <div>
            <p className="text-white font-black text-base leading-tight">
              {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.name}
            </p>
            {vehicle.trim && <p className="text-white/60 text-xs mt-0.5">{vehicle.trim}</p>}
            {vinDisplay && (
              <p className="text-white/40 text-[10px] font-mono mt-1 tracking-wider">{vinDisplay}</p>
            )}
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white text-xl leading-none mt-0.5 ml-4">✕</button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-4 py-4">
          {!specs ? (
            <div className="text-center py-8 space-y-3">
              {fetchingSpec ? (
                <>
                  <p className="text-2xl animate-spin inline-block">⚙️</p>
                  <p className="text-sm text-slate-500 font-semibold">Looking up your vehicle…</p>
                  {vinDisplay && (
                    <p className="text-xs text-slate-400 font-mono tracking-wider">{vinDisplay}</p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-3xl">🔍</p>
                  <p className="text-sm text-slate-500">{t.garage.noSpecsOnFile}</p>
                  {vehicle.vin ? (
                    <>
                      <p className="text-xs text-slate-400">{t.garage.vinOnFile}</p>
                      {fetchError && <p className="text-xs text-red-500">{fetchError}</p>}
                      <button
                        onClick={handleFetchSpecs}
                        disabled={fetchingSpec}
                        className="mx-auto px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white text-xs font-black transition-colors"
                      >
                        {t.garage.fetchSpecsNow}
                      </button>
                    </>
                  ) : (
                    <p className="text-xs text-slate-400 leading-relaxed">
                      {t.garage.deleteAndReAdd}
                    </p>
                  )}
                </>
              )}
            </div>
          ) : (
            <>
              {/* Overview */}
              <Section title={t.garage.sectionOverview} emoji="🚗">
                <Row label={t.garage.rowBodyStyle}   value={specs.bodyClass} />
                <Row label={t.garage.rowVehicleType} value={specs.vehicleType} />
                <Row label={t.garage.rowSeries}      value={specs.series} />
                <Row label={t.garage.rowManufacturer} value={specs.manufacturer} />
                <Row label={t.garage.rowSeats}       value={specs.seats} />
              </Section>

              {/* Engine */}
              <Section title={t.garage.sectionEngine} emoji="⚙️">
                <Row label={t.garage.rowDisplacement}  value={specs.engineDisplL  ? `${specs.engineDisplL.toFixed(1)} L`    : null} />
                <Row label={t.garage.rowCylinders}     value={specs.engineCylinders} />
                <Row label={t.garage.rowConfiguration} value={specs.engineConfig} />
                <Row label={t.garage.rowHorsepower}    value={specs.engineHP      ? `${specs.engineHP} hp`                  : null} />
                <Row label={t.garage.rowTorque}        value={specs.engineTorqueLbFt ? `${specs.engineTorqueLbFt} lb-ft`   : null} />
                <Row label={t.garage.rowTurbo}         value={specs.turbo} />
                <Row label={t.garage.rowSupercharger}  value={specs.supercharger} />
                <Row label={t.garage.rowFuelInjector}  value={specs.fuelInjector} />
                <Row label={t.garage.rowFuelType}      value={specs.fuelType} />
              </Section>

              {/* Performance / Economy */}
              <Section title={t.garage.sectionFuelEconomy} emoji="⛽">
                <Row label={t.garage.rowCombinedMpg} value={specs.combMpg   ? `${specs.combMpg} mpg`       : null} />
                <Row label={t.garage.rowCityMpg}     value={specs.cityMpg   ? `${specs.cityMpg} mpg`       : null} />
                <Row label={t.garage.rowHighwayMpg}  value={specs.hwyMpg    ? `${specs.hwyMpg} mpg`        : null} />
                <Row label={t.garage.rowTankEst}     value={specs.tankEstGallons ? `~${specs.tankEstGallons} gal` : null} />
                <Row label={t.garage.rowRangeEst}    value={specs.rangeEstMiles  ? `~${specs.rangeEstMiles} mi`   : null} />
                <Row label={t.garage.rowCo2}         value={specs.co2GPerMile    ? `${Math.round(specs.co2GPerMile)} g/mi` : null} />
              </Section>

              {/* Drivetrain */}
              <Section title={t.garage.sectionDrivetrain} emoji="🔧">
                <Row label={t.garage.rowDriveType}    value={specs.driveType} />
                <Row label={t.garage.rowTransmission} value={specs.transmission} />
                <Row label={t.garage.rowWheelbase}    value={specs.wheelbaseIn ? `${specs.wheelbaseIn}"` : null} />
                <Row label={t.garage.rowGvwr}         value={specs.gvwr} />
              </Section>

              {/* Safety */}
              <Section title={t.garage.sectionSafety} emoji="🛡️">
                <Row label={t.garage.rowAbs}             value={specs.abs} />
                <Row label={t.garage.rowTpms}            value={specs.tpmsType ? `${specs.tpmsType}` : null} />
                <Row label={t.garage.rowBackupCamera}    value={specs.backupCamera} />
                <Row label={t.garage.rowBlindSpot}       value={specs.blindSpotMonitor} />
                <Row label={t.garage.rowLaneDeparture}   value={specs.laneDeparture} />
                <Row label={t.garage.rowAdaptiveCruise}  value={specs.adaptiveCruise} />
                <Row label={t.garage.rowFrontAirbags}    value={specs.frontAirbags} />
                <Row label={t.garage.rowSideAirbags}     value={specs.sideAirbags} />
                <Row label={t.garage.rowCurtainAirbags}  value={specs.curtainAirbags} />
                <Row label={t.garage.rowKneeAirbags}     value={specs.kneeAirbags} />
              </Section>

              {specs.decodedAt && (
                <p className="text-[10px] text-slate-300 text-center pb-2">
                  {t.garage.dataDecoded(new Date(specs.decodedAt).toLocaleDateString())}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function SavedVehicles({ currentGallons, onSelect, selectedVehicleId, calcKey }: SavedVehiclesProps) {
  const { data: session, status } = useSession();
  const { t } = useTranslation();
  const { doorStyle, doorDirection } = useGarageDoorPrefs();
  const [data,        setData]        = useState<GarageResponse | null>(null);
  const [showPicker,  setShowPicker]  = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [saveError,   setSaveError]   = useState('');
  const [infoVehicle, setInfoVehicle] = useState<Vehicle | null>(null);

  // Edit state
  const [editingId,       setEditingId]       = useState<string | null>(null);
  const [editName,        setEditName]        = useState('');
  const [editGallons,     setEditGallons]     = useState('');
  const [editVin,         setEditVin]         = useState('');
  const [editSaving,      setEditSaving]      = useState(false);
  const [editVinStatus,   setEditVinStatus]   = useState<'idle' | 'fetching' | 'done' | 'error'>('idle');
  const [editVinScanning, setEditVinScanning] = useState(false);
  const [editVinScanErr,  setEditVinScanErr]  = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const editVinFileRef = useRef<HTMLInputElement>(null);

  // Fleet search + pagination
  const [searchQuery,     setSearchQuery]     = useState('');
  const [showAllVehicles, setShowAllVehicles] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/vehicles');
    if (res.ok) setData(await res.json() as GarageResponse);
  }, []);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  // Allow the setup checklist to open the vehicle picker via a custom event
  useEffect(() => {
    const handler = () => setShowPicker(true);
    window.addEventListener('gascap:focus-vehicles', handler);
    return () => window.removeEventListener('gascap:focus-vehicles', handler);
  }, []);

  if (status === 'loading') return null;

  if (!session) {
    return (
      <p className="text-xs text-slate-400 mt-3 text-center">
        <a href="/signin" className="text-amber-600 font-semibold hover:underline">{t.nav.signIn}</a>
        {' '}{t.calc.signInToSave}
      </p>
    );
  }

  const vehicles = data?.vehicles ?? [];
  const plan     = data?.plan     ?? 'free';
  const limit    = data?.limit    ?? 1;
  const atLimit  = vehicles.length >= limit;

  const isPro    = plan === 'pro' || plan === 'fleet';
  const isFleet  = plan === 'fleet';

  // Fleet: filter by search query, then page to first 4 until expanded
  const FLEET_PAGE = 4;
  const filteredVehicles = searchQuery.trim()
    ? vehicles.filter((v) => {
        const q = searchQuery.toLowerCase();
        return (
          v.name.toLowerCase().includes(q)   ||
          v.make?.toLowerCase().includes(q)  ||
          v.model?.toLowerCase().includes(q) ||
          v.year?.toLowerCase().includes(q)
        );
      })
    : vehicles;
  const visibleVehicles = isFleet && !showAllVehicles && !searchQuery.trim()
    ? filteredVehicles.slice(0, FLEET_PAGE)
    : filteredVehicles;
  const hasMore = isFleet && !showAllVehicles && !searchQuery.trim()
    && filteredVehicles.length > FLEET_PAGE;

  async function handleDelete(id: string) {
    await fetch(`/api/vehicles?id=${id}`, { method: 'DELETE' });
    load();
  }

  function startEdit(v: Vehicle) {
    setConfirmDeleteId(null);   // dismiss any pending delete confirmation
    setEditingId(v.id);
    setEditName(v.name);
    setEditGallons(String(v.gallons));
    setEditVin(v.vin ?? '');
    setEditVinStatus('idle');
    setEditVinScanning(false);
    setEditVinScanErr('');
  }

  async function handleEditVinScan(file: File) {
    setEditVinScanning(true);
    setEditVinScanErr('');
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res  = await fetch('/api/vin/scan', { method: 'POST', body: fd, credentials: 'include' });
      const data = await res.json() as { vin?: string | null; error?: string };
      if (!res.ok || data.error) {
        setEditVinScanErr(data.error ?? 'Could not read VIN from image.');
        return;
      }
      if (!data.vin) {
        setEditVinScanErr('No VIN found — zoom in so the "VIN" label is clearly visible, or try the dashboard plate.');
        return;
      }
      setEditVin(data.vin);
      setEditVinScanErr('');
    } catch {
      setEditVinScanErr('Network error — try again.');
    } finally {
      setEditVinScanning(false);
    }
  }

  async function handleEditSave() {
    if (!editingId) return;
    setEditSaving(true);

    const currentVehicle = vehicles.find(v => v.id === editingId);
    const cleanVin       = editVin.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || undefined;
    const vinChanged     = cleanVin !== (currentVehicle?.vin ?? undefined);

    // 1. Persist name, gallons, and VIN
    const patchRes = await fetch(`/api/vehicles?id=${editingId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        name:    editName.trim(),
        gallons: parseFloat(editGallons),
        ...(vinChanged ? { vin: cleanVin ?? '' } : {}),
      }),
    });

    if (!patchRes.ok) { setEditSaving(false); return; }

    // 2. If a VIN was newly added or changed, fetch & persist the decoded specs
    if (vinChanged && cleanVin && cleanVin.length === 17) {
      setEditVinStatus('fetching');
      try {
        const specRes  = await fetch(`/api/vin?vin=${cleanVin}`);
        const specData = await specRes.json() as { specs?: VehicleSpecs };
        if (specRes.ok && specData.specs) {
          await fetch(`/api/vehicles?id=${editingId}`, {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ vehicleSpecs: specData.specs }),
          });
          setEditVinStatus('done');
        } else {
          setEditVinStatus('error');
        }
      } catch {
        setEditVinStatus('error');
      }
    }

    setEditSaving(false);
    setEditingId(null);
    window.dispatchEvent(new Event('vehicle-saved'));
    load();
  }

  async function handleSave(vehicle: {
    name: string; gallons: number; vin?: string; year: string; make: string;
    model: string; trim: string; fuelType: string; epaId: string;
    currentOdometer?: number; vehicleSpecs?: VehicleSpecs;
  }) {
    setSaving(true);
    setSaveError('');
    const res = await fetch('/api/vehicles', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(vehicle),
    });
    setSaving(false);
    if (res.ok) {
      window.dispatchEvent(new Event('vehicle-saved'));
      setShowPicker(false);
      load();
    } else {
      const d = await res.json() as { error?: string };
      setSaveError(d.error ?? t.garage.couldNotSave);
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-slate-100">

      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <CarIcon className="w-4 h-4 text-slate-400" />
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{t.garage.myGarage}</p>
          {plan === 'pro' && (
            <span className="text-[10px] font-bold bg-amber-500 text-white px-1.5 py-0.5 rounded-full">
              {t.garage.proBadge}
            </span>
          )}
          {plan === 'fleet' && (
            <span className="text-[10px] font-bold bg-blue-600 text-white px-1.5 py-0.5 rounded-full">
              {t.garage.fleetBadge}
            </span>
          )}
        </div>
        {!showPicker && (
          <button
            onClick={() => {
              if (atLimit) return; // handled by slot UI
              setShowPicker(true);
              setSaveError('');
            }}
            disabled={atLimit}
            className="text-xs font-bold text-amber-600 hover:text-amber-700 disabled:opacity-40
                       disabled:cursor-not-allowed transition-colors"
            title={atLimit ? t.garage.vehicleLimitReached : t.garage.addVehicleTitle}
          >
            {t.garage.addVehicle}
          </button>
        )}
      </div>

      {/* Vehicle picker */}
      {showPicker && (
        <VehiclePicker
          plan={plan}
          onSave={handleSave}
          onCancel={() => { setShowPicker(false); setSaveError(''); }}
          saving={saving}
          saveError={saveError}
        />
      )}

      {/* Saved vehicle cards — wrapped in animated garage door for Pro members */}
      {!showPicker && (
        <>
          {/* Fleet vehicle search — always visible above the closed/open door */}
          {isFleet && vehicles.length > 0 && (
            <div className="relative mb-2">
              <div className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                <svg viewBox="0 0 20 20" fill="currentColor"
                     className="w-3.5 h-3.5 text-slate-400" aria-hidden="true">
                  <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
                </svg>
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search vehicles…"
                className="w-full pl-8 pr-7 py-2 text-xs bg-slate-50 border border-slate-200
                           rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400
                           focus:border-transparent placeholder:text-slate-400 text-slate-700"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400
                             hover:text-slate-600 transition-colors"
                  aria-label="Clear search"
                >
                  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor"
                       strokeWidth="2" strokeLinecap="round" className="w-3 h-3" aria-hidden="true">
                    <path d="M1 1l10 10M11 1L1 11"/>
                  </svg>
                </button>
              )}
            </div>
          )}

          <GarageDoor
            isPro={isPro}
            doorStyle={doorStyle}
            doorDirection={doorDirection}
            userName={session.user?.name ?? undefined}
            isFleet={isFleet}
            locked={vehicles.length === 0}
          >
        <>
          {vehicles.length === 0 ? (
            <div className="text-center py-4 space-y-1">
              <CarIcon className="w-8 h-8 text-slate-200 mx-auto" />
              <p className="text-xs text-slate-400">{t.garage.emptyGarage}</p>
              <p className="text-xs text-slate-400">{t.garage.emptyGarageHint}</p>
            </div>
          ) : filteredVehicles.length === 0 ? (
            /* No search results */
            <div className="text-center py-5 space-y-2">
              <p className="text-2xl">🔍</p>
              <p className="text-xs font-semibold text-slate-500">
                No vehicles match &ldquo;{searchQuery}&rdquo;
              </p>
              <button
                onClick={() => setSearchQuery('')}
                className="text-[11px] text-blue-600 font-bold hover:underline"
              >
                Clear search
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {visibleVehicles.map((v) => (
                <div key={v.id}>
                  {editingId === v.id ? (
                    /* ── Inline edit mode ── */
                    <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-3 space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">
                        {t.garage.editVehicle}
                      </p>

                      {/* Nickname */}
                      <input
                        type="text"
                        className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm
                                   text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder={t.garage.nicknamePlaceholder}
                        maxLength={40}
                      />

                      {/* Tank size */}
                      <div className="relative">
                        <input
                          type="number"
                          inputMode="decimal"
                          className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm
                                     text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white pr-10"
                          value={editGallons}
                          onChange={(e) => setEditGallons(e.target.value)}
                          min="1" step="0.1"
                          placeholder={t.garage.tankSizePlaceholder}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">
                          {t.calc.unitGal}
                        </span>
                      </div>

                      {/* VIN */}
                      <div className="space-y-1">
                        {/* Hidden file input — opens camera/gallery */}
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          ref={editVinFileRef}
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleEditVinScan(f);
                            e.target.value = '';
                          }}
                        />

                        {/* Label row with scan button */}
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                            VIN <span className="font-normal normal-case">(optional)</span>
                          </label>
                          <button
                            type="button"
                            onClick={() => editVinFileRef.current?.click()}
                            disabled={editVinScanning}
                            className="flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50
                                       border border-amber-200 rounded-lg px-2 py-0.5 hover:bg-amber-100
                                       disabled:opacity-50 transition-colors"
                            title="Photograph the VIN plate on your dashboard or door jamb"
                          >
                            <span>{editVinScanning ? '🔄' : '📷'}</span>
                            <span>{editVinScanning ? 'Scanning…' : 'Scan VIN'}</span>
                          </button>
                        </div>

                        {editVinScanErr && (
                          <p className="text-[10px] text-red-500 font-medium">{editVinScanErr}</p>
                        )}

                        <div className="relative">
                          <input
                            type="text"
                            inputMode="text"
                            className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm
                                       text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white
                                       font-mono tracking-wider uppercase pr-14"
                            value={editVin}
                            onChange={(e) =>
                              setEditVin(
                                e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 17)
                              )
                            }
                            placeholder="e.g. 1HGCM82633A123456"
                            maxLength={17}
                            autoCorrect="off"
                            autoCapitalize="characters"
                            spellCheck={false}
                          />
                          <span className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none tabular-nums font-bold ${
                            editVin.length === 0 ? 'text-slate-300'
                            : editVin.length === 17 ? 'text-green-600'
                            : 'text-amber-500'
                          }`}>
                            {editVin.length}/17
                          </span>
                        </div>
                        {editVin.length > 0 && editVin.length !== 17 && (
                          <p className="text-[10px] text-amber-600">
                            VIN must be exactly 17 characters ({17 - editVin.length} more needed)
                          </p>
                        )}
                      </div>

                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => { setEditingId(null); setEditVinStatus('idle'); }}
                          className="flex-1 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-500"
                        >
                          {t.garage.cancel}
                        </button>
                        <button
                          onClick={handleEditSave}
                          disabled={
                            editSaving ||
                            !editName.trim() ||
                            parseFloat(editGallons) <= 0 ||
                            (editVin.length > 0 && editVin.length !== 17)
                          }
                          className="flex-1 py-2 rounded-lg bg-amber-500 text-white text-xs font-bold
                                     hover:bg-amber-400 disabled:opacity-40 transition-colors"
                        >
                          {editVinStatus === 'fetching'
                            ? 'Looking up VIN…'
                            : editSaving
                            ? t.garage.saving
                            : t.garage.save}
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ── Normal card ── */
                    <div className={[
                      'relative flex items-center gap-2 rounded-xl px-3 py-2.5 transition-colors overflow-hidden',
                      v.id === selectedVehicleId
                        ? 'bg-amber-50 border-2 border-amber-400 shadow-sm'
                        : 'bg-slate-50 border border-slate-200 group hover:border-amber-300',
                    ].join(' ')}>
                      {/* Manufacturer logo */}
                      {v.make && (
                        <MakeLogo make={v.make} selected={v.id === selectedVehicleId} />
                      )}

                      {/* Select / load button */}
                      <button
                        onClick={() => onSelect(String(v.gallons), v)}
                        className="flex-1 min-w-0 text-left"
                        title={t.garage.loadTitle(v.name, v.gallons)}
                      >
                        <p className="text-sm font-semibold text-slate-700 group-hover:text-amber-700
                                      transition-colors leading-tight">
                          {v.name}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5 leading-tight">
                          {[v.year, v.make, v.model].filter(Boolean).join(' ') || t.garage.tankFallback(v.gallons)}
                          {v.year && <span className="ml-1">· {v.gallons} {t.calc.unitGal}</span>}
                        </p>
                        {v.fuelType && (
                          <span className="inline-block mt-1 text-[10px] bg-white border border-slate-200
                                           rounded px-1.5 py-0.5 text-slate-500 font-medium">
                            {v.fuelType}
                          </span>
                        )}
                        {v.id === selectedVehicleId && (
                          <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-bold text-amber-600">
                            <svg viewBox="0 0 10 10" className="w-2.5 h-2.5" fill="currentColor" aria-hidden="true">
                              <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            {t.garage.active}
                          </span>
                        )}
                      </button>

                      {/* Info */}
                      <button
                        onClick={(e) => { e.stopPropagation(); setInfoVehicle(v); }}
                        className="flex-shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
                        title={t.garage.vehicleInfoTitle}
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-label={t.garage.vehicleInfoAria}>
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
                        </svg>
                      </button>

                      {confirmDeleteId === v.id ? (
                        /* ── Delete confirmation — replaces edit+delete buttons ── */
                        <div className="flex-shrink-0 flex flex-col items-end gap-1">
                          <span className="text-[10px] font-bold text-red-500 whitespace-nowrap">Remove vehicle?</span>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-[10px] font-bold px-2 py-1 rounded-lg bg-slate-100 text-slate-600
                                         hover:bg-slate-200 border border-slate-200 transition-colors whitespace-nowrap"
                            >
                              Keep it
                            </button>
                            <button
                              onClick={() => { handleDelete(v.id); setConfirmDeleteId(null); }}
                              className="text-[10px] font-black px-2 py-1 rounded-lg bg-red-500 text-white
                                         hover:bg-red-600 transition-colors whitespace-nowrap"
                            >
                              Yes, remove
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* Edit */}
                          <button
                            onClick={() => startEdit(v)}
                            className="flex-shrink-0 text-slate-300 hover:text-amber-500 transition-colors p-1"
                            aria-label={t.garage.editAria(v.name)}
                          >
                            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none"
                                 stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                              <path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z"/>
                            </svg>
                          </button>

                          {/* Delete — tapping shows confirmation above */}
                          <button
                            onClick={() => setConfirmDeleteId(v.id)}
                            className="flex-shrink-0 text-slate-300 hover:text-red-400 transition-colors p-1"
                            aria-label={t.garage.removeAria(v.name)}
                          >
                            <svg viewBox="0 0 12 12" className="w-3.5 h-3.5" fill="none"
                                 stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                              <path d="M1 1l10 10M11 1L1 11"/>
                            </svg>
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Show more — fleet only, when first-4 page is active */}
          {hasMore && (
            <button
              onClick={() => setShowAllVehicles(true)}
              className="w-full flex flex-col items-center gap-0.5 pt-2 pb-1
                         text-slate-400 hover:text-blue-600 transition-colors group"
              aria-label="Show more vehicles"
            >
              <svg viewBox="0 0 20 20" fill="currentColor"
                   className="w-5 h-5 group-hover:animate-bounce" aria-hidden="true">
                <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
              </svg>
              <span className="text-[10px] font-bold">
                {filteredVehicles.length - FLEET_PAGE} more vehicle{filteredVehicles.length - FLEET_PAGE !== 1 ? 's' : ''}
              </span>
            </button>
          )}

          {/* Slot indicators */}
          <div className="flex items-center gap-1.5 mt-3">
            {Array.from({ length: limit }).map((_, i) => (
              <div
                key={i}
                className={[
                  'h-1 flex-1 rounded-full transition-all',
                  i < vehicles.length ? 'bg-amber-400' : 'bg-slate-200',
                ].join(' ')}
              />
            ))}
            <span className="text-[10px] text-slate-400 font-medium ml-1 flex-shrink-0">
              {vehicles.length}/{limit}
            </span>
          </div>

          {/* Upgrade prompt for free users at limit */}
          {plan === 'free' && atLimit && (
            <a href="/upgrade"
              className="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-200
                         rounded-xl px-3 py-2.5 hover:bg-amber-100 transition-colors group"
            >
              <LockIcon className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-amber-800 group-hover:text-amber-900">
                  {t.garage.upgradeProTitle}
                </p>
                <p className="text-[11px] text-amber-600 mt-0.5">
                  {t.garage.upgradeProSub}
                </p>
              </div>
            </a>
          )}

          {/* Fleet upgrade wall for Pro users at 5-vehicle limit */}
          {plan === 'pro' && atLimit && (
            <a href="/upgrade#fleet"
              className="mt-3 flex items-start gap-2 bg-blue-50 border border-blue-200
                         rounded-xl px-3 py-2.5 hover:bg-blue-100 transition-colors group"
            >
              <LockIcon className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-blue-800 group-hover:text-blue-900">
                  {t.garage.upgradeFleetTitle}
                </p>
                <p className="text-[11px] text-blue-600 mt-0.5">
                  {t.garage.upgradeFleetSub}
                </p>
              </div>
            </a>
          )}

          {/* "1 slot remaining" nudge for Pro users at 4/5 vehicles */}
          {plan === 'pro' && !atLimit && vehicles.length === limit - 1 && (
            <a href="/upgrade#fleet"
              className="mt-2 flex items-center gap-1.5 text-[11px] text-blue-500
                         hover:text-blue-700 transition-colors"
            >
              <span>⚠️</span>
              <span>{t.garage.oneSlotWarning}<span className="font-bold underline">{t.garage.oneSlotWarningLink}</span></span>
            </a>
          )}

          {/* Slot count hint for free users not at limit */}
          {plan === 'free' && !atLimit && vehicles.length === 0 && (
            <p className="text-[11px] text-slate-400 text-center mt-1">
              {t.garage.freePlanSlot}
            </p>
          )}

          {/* Billing shortcut for paid users */}
          {(plan === 'pro' || plan === 'fleet') && (
            <p className="text-[11px] text-slate-400 text-center mt-1">
              {t.garage.manageBilling1}{' '}
              <a href="/settings" className="font-semibold text-amber-600 hover:underline">
                {t.garage.manageBillingLink}
              </a>
            </p>
          )}
        </>
          </GarageDoor>
        </>
      )}

      {/* ── Achievements ── */}
      <BadgeShelf refreshKey={calcKey} />

      {infoVehicle && (
        <VehicleInfoModal
          vehicle={infoVehicle}
          onClose={() => setInfoVehicle(null)}
          onSpecsUpdated={(specs) => {
            // Merge new specs into the displayed vehicle and the vehicles list
            setInfoVehicle((v) => v ? { ...v, vehicleSpecs: specs } : v);
            load(); // re-fetch garage list so specs persist after close
          }}
        />
      )}
    </div>
  );
}
