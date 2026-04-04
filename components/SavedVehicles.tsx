'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState, useCallback } from 'react';
import VehiclePicker from './VehiclePicker';
import BadgeShelf   from './BadgeShelf';
import type { VehicleSpecs } from '@/lib/vehicleSpecs';

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

// ── Vehicle Info Modal ────────────────────────────────────────────────────

function VehicleInfoModal({ vehicle, onClose, onSpecsUpdated }: {
  vehicle: Vehicle;
  onClose: () => void;
  onSpecsUpdated?: (specs: VehicleSpecs) => void;
}) {
  const [specs,        setSpecs]        = useState<VehicleSpecs | undefined>(vehicle.vehicleSpecs);
  const [fetchingSpec, setFetchingSpec] = useState(false);
  const [fetchError,   setFetchError]   = useState('');

  async function handleFetchSpecs() {
    if (!vehicle.vin) return;
    setFetchingSpec(true);
    setFetchError('');
    try {
      const res  = await fetch(`/api/vin?vin=${vehicle.vin}`);
      const data = await res.json() as { specs?: VehicleSpecs; error?: string };
      if (!res.ok || data.error) { setFetchError(data.error ?? 'Lookup failed.'); return; }
      if (!data.specs) { setFetchError('No specs returned.'); return; }

      // Persist to the server
      const patch = await fetch(`/api/vehicles?id=${vehicle.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ vehicleSpecs: data.specs }),
      });
      if (!patch.ok) { setFetchError('Saved locally but could not persist.'); }

      setSpecs(data.specs);
      onSpecsUpdated?.(data.specs);
    } catch {
      setFetchError('Network error — check your connection.');
    } finally {
      setFetchingSpec(false);
    }
  }

  function Row({ label, value }: { label: string; value?: string | number | boolean | null }) {
    if (value === undefined || value === null || value === '') return null;
    const display = typeof value === 'boolean' ? (value ? '✓ Yes' : '✗ No') : String(value);
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
            {specs?.vin && <p className="text-white/40 text-[10px] font-mono mt-1">{specs.vin}</p>}
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white text-xl leading-none mt-0.5 ml-4">✕</button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-4 py-4">
          {!specs ? (
            <div className="text-center py-8 space-y-3">
              <p className="text-3xl">🔍</p>
              <p className="text-sm text-slate-500">No detailed specs on file.</p>
              {vehicle.vin ? (
                <>
                  <p className="text-xs text-slate-400">
                    VIN on file — tap below to fetch specs from NHTSA.
                  </p>
                  {fetchError && (
                    <p className="text-xs text-red-500">{fetchError}</p>
                  )}
                  <button
                    onClick={handleFetchSpecs}
                    disabled={fetchingSpec}
                    className="mx-auto px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white text-xs font-black transition-colors"
                  >
                    {fetchingSpec ? 'Fetching…' : '🔄 Fetch Specs Now'}
                  </button>
                </>
              ) : (
                <>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Delete this vehicle and re-add it using the VIN tab to capture full specs.
                  </p>
                </>
              )}
            </div>
          ) : (
            <>
              {/* Overview */}
              <Section title="Overview" emoji="🚗">
                <Row label="Body Style"    value={specs.bodyClass} />
                <Row label="Vehicle Type"  value={specs.vehicleType} />
                <Row label="Series / Trim" value={specs.series} />
                <Row label="Manufacturer"  value={specs.manufacturer} />
                <Row label="Seats"         value={specs.seats} />
              </Section>

              {/* Engine */}
              <Section title="Engine" emoji="⚙️">
                <Row label="Displacement"  value={specs.engineDisplL  ? `${specs.engineDisplL.toFixed(1)} L`    : null} />
                <Row label="Cylinders"     value={specs.engineCylinders} />
                <Row label="Configuration" value={specs.engineConfig} />
                <Row label="Horsepower"    value={specs.engineHP      ? `${specs.engineHP} hp`                  : null} />
                <Row label="Torque"        value={specs.engineTorqueLbFt ? `${specs.engineTorqueLbFt} lb-ft`   : null} />
                <Row label="Turbo"         value={specs.turbo} />
                <Row label="Supercharger"  value={specs.supercharger} />
                <Row label="Fuel Injector" value={specs.fuelInjector} />
                <Row label="Fuel Type"     value={specs.fuelType} />
              </Section>

              {/* Performance / Economy */}
              <Section title="Fuel Economy" emoji="⛽">
                <Row label="Combined MPG"  value={specs.combMpg   ? `${specs.combMpg} mpg`       : null} />
                <Row label="City MPG"      value={specs.cityMpg   ? `${specs.cityMpg} mpg`       : null} />
                <Row label="Highway MPG"   value={specs.hwyMpg    ? `${specs.hwyMpg} mpg`        : null} />
                <Row label="Tank Est."     value={specs.tankEstGallons ? `~${specs.tankEstGallons} gal` : null} />
                <Row label="Range Est."    value={specs.rangeEstMiles  ? `~${specs.rangeEstMiles} mi`   : null} />
                <Row label="CO₂ Emissions" value={specs.co2GPerMile    ? `${Math.round(specs.co2GPerMile)} g/mi` : null} />
              </Section>

              {/* Drivetrain */}
              <Section title="Drivetrain" emoji="🔧">
                <Row label="Drive Type"    value={specs.driveType} />
                <Row label="Transmission"  value={specs.transmission} />
                <Row label="Wheelbase"     value={specs.wheelbaseIn ? `${specs.wheelbaseIn}"` : null} />
                <Row label="GVWR"          value={specs.gvwr} />
              </Section>

              {/* Safety */}
              <Section title="Safety Features" emoji="🛡️">
                <Row label="ABS"                  value={specs.abs} />
                <Row label="TPMS"                 value={specs.tpmsType ? `${specs.tpmsType}` : null} />
                <Row label="Backup Camera"        value={specs.backupCamera} />
                <Row label="Blind Spot Monitor"   value={specs.blindSpotMonitor} />
                <Row label="Lane Departure Warn." value={specs.laneDeparture} />
                <Row label="Adaptive Cruise"      value={specs.adaptiveCruise} />
                <Row label="Front Airbags"        value={specs.frontAirbags} />
                <Row label="Side Airbags"         value={specs.sideAirbags} />
                <Row label="Curtain Airbags"      value={specs.curtainAirbags} />
                <Row label="Knee Airbags"         value={specs.kneeAirbags} />
              </Section>

              {specs.decodedAt && (
                <p className="text-[10px] text-slate-300 text-center pb-2">
                  Data decoded {new Date(specs.decodedAt).toLocaleDateString()}
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
  const [data,        setData]        = useState<GarageResponse | null>(null);
  const [showPicker,  setShowPicker]  = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [saveError,   setSaveError]   = useState('');
  const [infoVehicle, setInfoVehicle] = useState<Vehicle | null>(null);

  // Edit state
  const [editingId,   setEditingId]   = useState<string | null>(null);
  const [editName,    setEditName]    = useState('');
  const [editGallons, setEditGallons] = useState('');
  const [editSaving,  setEditSaving]  = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/vehicles');
    if (res.ok) setData(await res.json() as GarageResponse);
  }, []);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  if (status === 'loading') return null;

  if (!session) {
    return (
      <p className="text-xs text-slate-400 mt-3 text-center">
        <a href="/signin" className="text-amber-600 font-semibold hover:underline">Sign in</a>
        {' '}to save vehicles to your garage.
      </p>
    );
  }

  const vehicles = data?.vehicles ?? [];
  const plan     = data?.plan     ?? 'free';
  const limit    = data?.limit    ?? 1;
  const atLimit  = vehicles.length >= limit;

  async function handleDelete(id: string) {
    await fetch(`/api/vehicles?id=${id}`, { method: 'DELETE' });
    load();
  }

  function startEdit(v: Vehicle) {
    setEditingId(v.id);
    setEditName(v.name);
    setEditGallons(String(v.gallons));
  }

  async function handleEditSave() {
    if (!editingId) return;
    setEditSaving(true);
    await fetch(`/api/vehicles?id=${editingId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: editName.trim(), gallons: parseFloat(editGallons) }),
    });
    setEditSaving(false);
    setEditingId(null);
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
      setShowPicker(false);
      load();
    } else {
      const d = await res.json() as { error?: string };
      setSaveError(d.error ?? 'Could not save vehicle.');
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-slate-100">

      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <CarIcon className="w-4 h-4 text-slate-400" />
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">My Garage</p>
          {plan === 'pro' && (
            <span className="text-[10px] font-bold bg-amber-500 text-white px-1.5 py-0.5 rounded-full">
              PRO
            </span>
          )}
          {plan === 'fleet' && (
            <span className="text-[10px] font-bold bg-blue-600 text-white px-1.5 py-0.5 rounded-full">
              FLEET
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
            title={atLimit ? 'Vehicle limit reached' : 'Add a vehicle'}
          >
            + Add vehicle
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

      {/* Saved vehicle cards */}
      {!showPicker && (
        <>
          {vehicles.length === 0 ? (
            <div className="text-center py-4 space-y-1">
              <CarIcon className="w-8 h-8 text-slate-200 mx-auto" />
              <p className="text-xs text-slate-400">Your garage is empty.</p>
              <p className="text-xs text-slate-400">Add your vehicle to auto-fill tank size.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {vehicles.map((v) => (
                <div key={v.id}>
                  {editingId === v.id ? (
                    /* ── Inline edit mode ── */
                    <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-3 space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">
                        Edit Vehicle
                      </p>
                      <input
                        type="text"
                        className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm
                                   text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Nickname"
                        maxLength={40}
                      />
                      <div className="relative">
                        <input
                          type="number"
                          inputMode="decimal"
                          className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm
                                     text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white pr-10"
                          value={editGallons}
                          onChange={(e) => setEditGallons(e.target.value)}
                          min="1" step="0.1"
                          placeholder="Tank size"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">
                          gal
                        </span>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => setEditingId(null)}
                          className="flex-1 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-500"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleEditSave}
                          disabled={editSaving || !editName.trim() || parseFloat(editGallons) <= 0}
                          className="flex-1 py-2 rounded-lg bg-amber-500 text-white text-xs font-bold
                                     hover:bg-amber-400 disabled:opacity-40 transition-colors"
                        >
                          {editSaving ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ── Normal card ── */
                    <div className={[
                      'flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors',
                      v.id === selectedVehicleId
                        ? 'bg-amber-50 border-2 border-amber-400 shadow-sm'
                        : 'bg-slate-50 border border-slate-200 group hover:border-amber-300',
                    ].join(' ')}>
                      {/* Select / load button */}
                      <button
                        onClick={() => onSelect(String(v.gallons), v)}
                        className="flex-1 text-left"
                        title={`Load ${v.name} (${v.gallons} gal)`}
                      >
                        <p className="text-sm font-semibold text-slate-700 group-hover:text-amber-700
                                      transition-colors leading-tight">
                          {v.name}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5 leading-tight">
                          {[v.year, v.make, v.model].filter(Boolean).join(' ') || `${v.gallons} gal tank`}
                          {v.year && <span className="ml-1">· {v.gallons} gal</span>}
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
                            Active
                          </span>
                        )}
                      </button>

                      {/* Info */}
                      <button
                        onClick={(e) => { e.stopPropagation(); setInfoVehicle(v); }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
                        title="Vehicle information"
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-label="Vehicle info">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
                        </svg>
                      </button>

                      {/* Edit */}
                      <button
                        onClick={() => startEdit(v)}
                        className="text-slate-300 hover:text-amber-500 transition-colors flex-shrink-0"
                        aria-label={`Edit ${v.name}`}
                      >
                        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none"
                             stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                          <path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z"/>
                        </svg>
                      </button>

                      {/* Delete */}
                      <button
                        onClick={() => handleDelete(v.id)}
                        className="text-slate-300 hover:text-red-400 transition-colors flex-shrink-0"
                        aria-label={`Remove ${v.name}`}
                      >
                        <svg viewBox="0 0 12 12" className="w-3.5 h-3.5" fill="none"
                             stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                          <path d="M1 1l10 10M11 1L1 11"/>
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
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
                  Upgrade to Pro — save up to 5 vehicles
                </p>
                <p className="text-[11px] text-amber-600 mt-0.5">
                  $4.99/mo · Manual entry · Auto spec lookup →
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
                  Upgrade to Fleet — unlimited vehicles
                </p>
                <p className="text-[11px] text-blue-600 mt-0.5">
                  $19.99/mo · Unlimited vehicles · Up to 10 drivers →
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
              <span>1 vehicle slot remaining — <span className="font-bold underline">upgrade to Fleet for unlimited</span></span>
            </a>
          )}

          {/* Slot count hint for free users not at limit */}
          {plan === 'free' && !atLimit && vehicles.length === 0 && (
            <p className="text-[11px] text-slate-400 text-center mt-1">
              Free plan · 1 vehicle slot
            </p>
          )}

          {/* Billing shortcut for paid users */}
          {(plan === 'pro' || plan === 'fleet') && (
            <p className="text-[11px] text-slate-400 text-center mt-1">
              Manage billing &amp; subscription in{' '}
              <a href="/settings" className="font-semibold text-amber-600 hover:underline">
                Settings
              </a>
            </p>
          )}
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
