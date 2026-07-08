'use client';

import { useEffect, useRef, useState } from 'react';
import type { VehicleSpecs } from '@/lib/vehicleSpecs';
import { useTranslation } from '@/contexts/LanguageContext';
import { compressImageForUpload } from '@/lib/imageUtils';

interface MenuItem { text: string; value: string }

interface VehicleDetails {
  id:       string | number;
  year:     string | number;
  make:     string;
  model:    string;
  trim:     string;
  fuelType: string;
  tankEst:  number | null;
}

interface LookupResult {
  year:       string | number;
  make:       string;
  model:      string;
  fuelType:   string;
  displ:      string | number | null;
  cylinders:  string | number | null;
  tankEst:    number | null;
  matchCount: number;
  epaId:      string;
}

interface VehiclePickerProps {
  plan:     'free' | 'pro' | 'fleet';
  onSave:   (vehicle: {
    name:             string;
    gallons:          number;
    vin?:             string;
    year:             string;
    make:             string;
    model:            string;
    trim:             string;
    fuelType:         string;
    epaId:            string;
    currentOdometer?: number;
    vehicleSpecs?:    VehicleSpecs;
  }) => void;
  onCancel:  () => void;
  saving:    boolean;
  saveError: string;
}

// ── Shared helpers ────────────────────────────────────────────────────────

async function fetchMenu(action: string, params: Record<string, string> = {}): Promise<MenuItem[]> {
  const qs = new URLSearchParams({ action, ...params }).toString();
  const res = await fetch(`/api/fueleconomy?${qs}`);
  if (!res.ok) return [];
  return res.json() as Promise<MenuItem[]>;
}

// ── Sub-components ────────────────────────────────────────────────────────

/** Shared "confirm tank size + nickname + odometer + save" block */
function ConfirmBlock({
  tankSize, setTankSize,
  nickname, setNickname,
  odometer, setOdometer,
  fuelType, cylinders, displ,
  onSave, onCancel,
  saving, saveError, canSave,
}: {
  tankSize: string; setTankSize: (v: string) => void;
  nickname: string; setNickname: (v: string) => void;
  odometer: string; setOdometer: (v: string) => void;
  fuelType?: string; cylinders?: string | number | null; displ?: string | number | null;
  onSave: () => void; onCancel: () => void;
  saving: boolean; saveError: string; canSave: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="bg-slate-50 rounded-xl p-3 space-y-3 border border-slate-100">
      {/* Spec chips */}
      <div className="flex flex-wrap gap-2">
        {fuelType && (
          <span className="text-xs bg-white border border-slate-200 rounded-lg px-2 py-1 font-medium text-slate-600">
            {String(fuelType)}
          </span>
        )}
        {cylinders && (
          <span className="text-xs bg-white border border-slate-200 rounded-lg px-2 py-1 font-medium text-slate-600">
            {t.vehiclePicker.cylChip(String(cylinders))}
          </span>
        )}
        {displ && (
          <span className="text-xs bg-white border border-slate-200 rounded-lg px-2 py-1 font-medium text-slate-600">
            {Number(displ).toFixed(1)} L
          </span>
        )}
        {tankSize && (
          <span className="text-xs bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 font-semibold text-amber-700">
            {t.vehiclePicker.tankEstChip(tankSize)}
          </span>
        )}
      </div>

      {/* Tank size */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">
          {t.vehiclePicker.tankSizeLabel}
        </label>
        <div className="relative">
          <input
            type="number" inputMode="decimal"
            className="input-field text-sm pr-12"
            value={tankSize} min="1" step="0.1"
            onChange={(e) => setTankSize(e.target.value)}
            placeholder={t.vehiclePicker.tankSizePlaceholder}
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">
            gal
          </span>
        </div>
      </div>

      {/* Nickname */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">{t.vehiclePicker.nicknameLabel}</label>
        <input
          type="text" className="input-field text-sm"
          value={nickname} onChange={(e) => setNickname(e.target.value)}
          placeholder={t.vehiclePicker.nicknamePlaceholder} maxLength={40}
        />
      </div>

      {/* Current odometer — optional, used as MPG tracking baseline */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">
          {t.vehiclePicker.currentOdometerLabel}{' '}
          <span className="font-normal text-slate-400">{t.vehiclePicker.optional}</span>
          <span className="ml-1.5 text-[10px] font-bold text-green-600 bg-green-50 rounded px-1 py-0.5">
            {t.vehiclePicker.mpgBaselineTag}
          </span>
        </label>
        <div className="relative">
          <input
            type="number" inputMode="numeric"
            className="input-field text-sm pr-10"
            value={odometer}
            min="0" step="1"
            onChange={(e) => setOdometer(e.target.value)}
            placeholder={t.vehiclePicker.odometerPlaceholder}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">mi</span>
        </div>
        <p className="text-[10px] text-slate-400 mt-1 leading-snug">
          {t.vehiclePicker.odometerHint}
        </p>
      </div>

      {saveError && <p className="text-xs text-red-500">{saveError}</p>}

      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex-1 py-2.5 rounded-xl border-2 border-slate-200 text-sm font-semibold
                     text-slate-500 hover:border-slate-300 transition-colors"
        >
          {t.vehiclePicker.cancel}
        </button>
        <button
          onClick={onSave} disabled={!canSave || saving}
          className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-bold
                     hover:bg-amber-400 disabled:opacity-40 transition-colors"
        >
          {saving ? t.vehiclePicker.saving : t.vehiclePicker.addToGarage}
        </button>
      </div>
    </div>
  );
}

// ── Search tab (existing cascading-dropdown flow) ─────────────────────────

function SearchTab({ onSave, onCancel, saving, saveError }: Omit<VehiclePickerProps, 'plan'>) {
  const { t } = useTranslation();
  const [years,  setYears]  = useState<MenuItem[]>([]);
  const [makes,  setMakes]  = useState<MenuItem[]>([]);
  const [models, setModels] = useState<MenuItem[]>([]);
  const [trims,  setTrims]  = useState<MenuItem[]>([]);

  const [year,   setYear]   = useState('');
  const [make,   setMake]   = useState('');
  const [model,  setModel]  = useState('');
  const [trimId, setTrimId] = useState('');

  const [details,  setDetails]  = useState<VehicleDetails | null>(null);
  const [tankSize, setTankSize] = useState('');
  const [nickname, setNickname] = useState('');
  const [odometer, setOdometer] = useState('');
  const [loading,  setLoading]  = useState<string | null>(null);

  useEffect(() => {
    setLoading('years');
    fetchMenu('years').then((items) => { setYears(items); setLoading(null); });
  }, []);

  useEffect(() => {
    if (!year) { setMakes([]); setMake(''); return; }
    setMake(''); setModel(''); setTrimId(''); setDetails(null); setTankSize('');
    setLoading('makes');
    fetchMenu('makes', { year }).then((items) => { setMakes(items); setLoading(null); });
  }, [year]);

  useEffect(() => {
    if (!year || !make) { setModels([]); setModel(''); return; }
    setModel(''); setTrimId(''); setDetails(null); setTankSize('');
    setLoading('models');
    fetchMenu('models', { year, make }).then((items) => { setModels(items); setLoading(null); });
  }, [year, make]);

  useEffect(() => {
    if (!year || !make || !model) { setTrims([]); setTrimId(''); return; }
    setTrimId(''); setDetails(null); setTankSize('');
    setLoading('trims');
    fetchMenu('trims', { year, make, model }).then((items) => {
      setTrims(items); setLoading(null);
      if (items.length === 1) setTrimId(items[0].value);
    });
  }, [year, make, model]);

  useEffect(() => {
    if (!trimId) { setDetails(null); setTankSize(''); return; }
    setLoading('vehicle');
    fetch(`/api/fueleconomy?action=vehicle&id=${trimId}`)
      .then((r) => r.json())
      .then((d: VehicleDetails) => {
        setDetails(d);
        if (d.tankEst) setTankSize(String(d.tankEst));
        setNickname(`${d.year} ${d.make} ${d.model}`);
        setLoading(null);
      });
  }, [trimId]);

  function handleSave() {
    if (!nickname.trim() || !tankSize || !year || !make || !model || !trimId) return;
    const trimLabel = trims.find((t) => t.value === trimId)?.text ?? '';
    onSave({
      name: nickname.trim(), gallons: parseFloat(tankSize),
      year, make, model, trim: trimLabel,
      fuelType: String(details?.fuelType ?? ''), epaId: trimId,
      currentOdometer: odometer ? parseInt(odometer, 10) : undefined,
    });
  }

  const canSave = !!nickname.trim() && !!tankSize && parseFloat(tankSize) > 0 && !!trimId;

  return (
    <div className="space-y-3">
      {/* Year */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">{t.vehiclePicker.yearLabel}</label>
        <select className="input-field text-sm" value={year}
          onChange={(e) => setYear(e.target.value)} disabled={loading === 'years'}>
          <option value="">{loading === 'years' ? t.vehiclePicker.loading : t.vehiclePicker.selectYear}</option>
          {years.map((y) => <option key={y.value} value={y.value}>{y.text}</option>)}
        </select>
      </div>

      {year && (
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">{t.vehiclePicker.makeLabel}</label>
          <select className="input-field text-sm" value={make}
            onChange={(e) => setMake(e.target.value)} disabled={loading === 'makes'}>
            <option value="">{loading === 'makes' ? t.vehiclePicker.loading : t.vehiclePicker.selectMake}</option>
            {makes.map((m) => <option key={m.value} value={m.value}>{m.text}</option>)}
          </select>
        </div>
      )}

      {year && make && (
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">{t.vehiclePicker.modelLabel}</label>
          <select className="input-field text-sm" value={model}
            onChange={(e) => setModel(e.target.value)} disabled={loading === 'models'}>
            <option value="">{loading === 'models' ? t.vehiclePicker.loading : t.vehiclePicker.selectModel}</option>
            {models.map((m) => <option key={m.value} value={m.value}>{m.text}</option>)}
          </select>
        </div>
      )}

      {year && make && model && (
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">{t.vehiclePicker.trimLabel}</label>
          <select className="input-field text-sm" value={trimId}
            onChange={(e) => setTrimId(e.target.value)} disabled={loading === 'trims'}>
            <option value="">{loading === 'trims' ? t.vehiclePicker.loading : t.vehiclePicker.selectTrim}</option>
            {trims.map((tr) => <option key={tr.value} value={tr.value}>{tr.text}</option>)}
          </select>
        </div>
      )}

      {loading === 'vehicle' && (
        <p className="text-xs text-slate-400 text-center py-2">{t.vehiclePicker.lookingUpVehicle}</p>
      )}

      {details && (
        <ConfirmBlock
          tankSize={tankSize} setTankSize={setTankSize}
          nickname={nickname} setNickname={setNickname}
          odometer={odometer} setOdometer={setOdometer}
          fuelType={String(details.fuelType)}
          onSave={handleSave} onCancel={onCancel}
          saving={saving} saveError={saveError} canSave={canSave}
        />
      )}

      {/* Cancel when no details yet */}
      {!details && (
        <button onClick={onCancel}
          className="w-full py-2.5 rounded-xl border-2 border-slate-200 text-sm font-semibold
                     text-slate-500 hover:border-slate-300 transition-colors mt-1">
          {t.vehiclePicker.cancel}
        </button>
      )}
    </div>
  );
}

// ── Manual Entry tab (Pro) ─────────────────────────────────────────────────

function ManualTab({ onSave, onCancel, saving, saveError }: Omit<VehiclePickerProps, 'plan'>) {
  const { t } = useTranslation();
  const [year,  setYear]  = useState('');
  const [make,  setMake]  = useState('');
  const [model, setModel] = useState('');

  const [lookupState, setLookupState] = useState<
    'idle' | 'loading' | 'found' | 'not_found' | 'error'
  >('idle');
  const [result,   setResult]   = useState<LookupResult | null>(null);
  const [tankSize, setTankSize] = useState('');
  const [nickname, setNickname] = useState('');
  const [odometer, setOdometer] = useState('');

  async function handleLookup() {
    if (!year.trim() || !make.trim() || !model.trim()) return;
    setLookupState('loading');
    setResult(null);
    setTankSize('');
    try {
      const qs = new URLSearchParams({
        action: 'lookup', year: year.trim(), make: make.trim(), model: model.trim(),
      });
      const res = await fetch(`/api/fueleconomy?${qs.toString()}`);
      if (res.status === 404) { setLookupState('not_found'); return; }
      if (!res.ok)            { setLookupState('error');     return; }
      const data = await res.json() as LookupResult;
      setResult(data);
      if (data.tankEst) setTankSize(String(data.tankEst));
      setNickname(`${data.year} ${data.make} ${data.model}`);
      setLookupState('found');
    } catch {
      setLookupState('error');
    }
  }

  function handleSave() {
    if (!nickname.trim() || !tankSize || parseFloat(tankSize) <= 0) return;
    onSave({
      name:     nickname.trim(),
      gallons:  parseFloat(tankSize),
      year:     year.trim(),
      make:     make.trim(),
      model:    model.trim(),
      trim:     '',
      fuelType: String(result?.fuelType ?? ''),
      epaId:    result?.epaId ?? '',
      currentOdometer: odometer ? parseInt(odometer, 10) : undefined,
    });
  }

  const canLookup = year.trim().length === 4 && make.trim().length > 0 && model.trim().length > 0;
  const canSave   = lookupState === 'found'
    && !!nickname.trim() && !!tankSize && parseFloat(tankSize) > 0;

  return (
    <div className="space-y-3">
      {/* Instruction */}
      <p className="text-xs text-slate-500 leading-relaxed">
        {t.vehiclePicker.manualInstructionPrefix}{' '}
        <span className="font-semibold text-amber-700">{t.vehiclePicker.manualInstructionAction}</span>{t.vehiclePicker.manualInstructionSuffix}
      </p>

      {/* Year / Make / Model inputs */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">{t.vehiclePicker.yearLabel}</label>
          <input
            type="number" inputMode="numeric" className="input-field text-sm" placeholder="2022"
            value={year} min="1985" max={new Date().getFullYear() + 1} step="1"
            onChange={(e) => { setYear(e.target.value); setLookupState('idle'); setResult(null); }}
          />
        </div>
        <div className="col-span-1">
          <label className="block text-xs font-semibold text-slate-500 mb-1">{t.vehiclePicker.makeLabel}</label>
          <input
            type="text" className="input-field text-sm" placeholder="Toyota"
            value={make}
            onChange={(e) => { setMake(e.target.value); setLookupState('idle'); setResult(null); }}
          />
        </div>
        <div className="col-span-1">
          <label className="block text-xs font-semibold text-slate-500 mb-1">{t.vehiclePicker.modelLabel}</label>
          <input
            type="text" className="input-field text-sm" placeholder="Camry"
            value={model}
            onChange={(e) => { setModel(e.target.value); setLookupState('idle'); setResult(null); }}
          />
        </div>
      </div>

      {/* Look up button */}
      <button
        onClick={handleLookup} disabled={!canLookup || lookupState === 'loading'}
        className="w-full py-2.5 rounded-xl border-2 border-amber-400 text-sm font-bold
                   text-amber-700 hover:bg-amber-50 disabled:opacity-40 transition-colors"
      >
        {lookupState === 'loading' ? t.vehiclePicker.lookingUp : t.vehiclePicker.lookUpSpecs}
      </button>

      {/* States */}
      {lookupState === 'not_found' && (
        <div className="rounded-xl bg-red-50 border border-red-100 px-3 py-2.5 text-xs text-red-700">
          <span className="font-semibold">{t.vehiclePicker.noMatchTitle}</span> {t.vehiclePicker.noMatchBody}
          <div className="mt-2 space-y-2">
            <div className="relative">
              <input type="number" inputMode="decimal" className="input-field text-sm pr-12"
                value={tankSize} min="1" step="0.1"
                onChange={(e) => setTankSize(e.target.value)} placeholder={t.vehiclePicker.tankSizeGalPlaceholder} />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">gal</span>
            </div>
            <input type="text" className="input-field text-sm" value={nickname}
              onChange={(e) => setNickname(e.target.value)} placeholder={t.vehiclePicker.nicknameTruckPlaceholder} maxLength={40} />
            {saveError && <p className="text-xs text-red-500">{saveError}</p>}
            <div className="flex gap-2">
              <button onClick={onCancel}
                className="flex-1 py-2.5 rounded-xl border-2 border-slate-200 text-sm font-semibold text-slate-500 hover:border-slate-300 transition-colors">
                {t.vehiclePicker.cancel}
              </button>
              <button onClick={handleSave}
                disabled={!nickname.trim() || !tankSize || parseFloat(tankSize) <= 0 || saving}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-400 disabled:opacity-40 transition-colors">
                {saving ? t.vehiclePicker.saving : t.vehiclePicker.addToGarage}
              </button>
            </div>
          </div>
        </div>
      )}

      {lookupState === 'error' && (
        <p className="text-xs text-red-500 text-center">
          {t.vehiclePicker.lookupFailed}
        </p>
      )}

      {lookupState === 'found' && result && (
        <>
          {result.matchCount > 1 && (
            <p className="text-[11px] text-slate-400 text-center">
              {t.vehiclePicker.trimVariants(result.matchCount)}
            </p>
          )}
          <ConfirmBlock
            tankSize={tankSize} setTankSize={setTankSize}
            nickname={nickname} setNickname={setNickname}
            odometer={odometer} setOdometer={setOdometer}
            fuelType={String(result.fuelType)}
            cylinders={result.cylinders} displ={result.displ}
            onSave={handleSave} onCancel={onCancel}
            saving={saving} saveError={saveError} canSave={canSave}
          />
        </>
      )}

      {/* Cancel when idle */}
      {(lookupState === 'idle') && (
        <button onClick={onCancel}
          className="w-full py-2.5 rounded-xl border-2 border-slate-200 text-sm font-semibold
                     text-slate-500 hover:border-slate-300 transition-colors">
          {t.vehiclePicker.cancel}
        </button>
      )}
    </div>
  );
}

// ── VIN Lookup tab ─────────────────────────────────────────────────────────

interface VinResult {
  vin:          string;
  make:         string;
  model:        string;
  year:         string;
  body:         string | null;
  fuel:         string | null;
  cylinders:    string | null;
  displacement: string | null;
  trim:         string | null;
  drive:        string | null;
  transmission: string | null;
  tankEst?:     number | null;
  specs?:       VehicleSpecs;
}

function VinTab({ onSave, onCancel, saving, saveError }: Omit<VehiclePickerProps, 'plan'>) {
  const { t } = useTranslation();
  const [vin,          setVin]          = useState('');
  const [state,        setState]        = useState<'idle' | 'loading' | 'found' | 'error'>('idle');
  const [result,       setResult]       = useState<VinResult | null>(null);
  const [errorMsg,     setErrorMsg]     = useState('');
  const [tankSize,     setTankSize]     = useState('');
  const [nickname,     setNickname]     = useState('');
  const [odometer,     setOdometer]     = useState('');
  const [epaLoading,   setEpaLoading]   = useState(false);
  const [vehicleSpecs, setVehicleSpecs] = useState<VehicleSpecs | null>(null);
  const [scanning,     setScanning]     = useState(false);
  const [scanError,    setScanError]    = useState('');


  async function handleVinScan(file: File) {
    setScanning(true);
    setScanError('');
    try {
      const compressed = await compressImageForUpload(file);
      const fd = new FormData();
      fd.append('image', compressed, 'vin.jpg');
      const res  = await fetch('/api/vin/scan', { method: 'POST', body: fd, credentials: 'include' });
      const data = await res.json() as { vin?: string | null; error?: string };
      if (!res.ok || data.error) { setScanError(data.error ?? t.vehiclePicker.scanCouldNotRead); return; }
      if (!data.vin) { setScanError(t.vehiclePicker.scanNoVin); return; }
      setVin(data.vin);
      setScanError('');
    } catch {
      setScanError(t.vehiclePicker.scanNetworkError);
    } finally {
      setScanning(false);
    }
  }

  // Validate VIN characters as user types
  const vinClean  = vin.trim().toUpperCase();
  const vinValid  = /^[A-HJ-NPR-Z0-9]{17}$/.test(vinClean);
  const vinLength = vinClean.length;

  async function handleLookup() {
    if (!vinValid) return;
    setState('loading');
    setResult(null);
    setTankSize('');
    setVehicleSpecs(null);
    setErrorMsg('');
    try {
      const res = await fetch(`/api/vin?vin=${vinClean}`);
      const data = await res.json() as VinResult & { error?: string };
      if (!res.ok || data.error) {
        setErrorMsg(data.error ?? t.vehiclePicker.vinLookupFailed);
        setState('error');
        return;
      }
      setResult(data);
      setVehicleSpecs(data.specs ?? null);
      setNickname(`${data.year} ${data.make} ${data.model}${data.trim ? ' ' + data.trim : ''}`);
      setState('found');

      // Use tank size from VIN API (which already did EPA lookup internally)
      if (data.tankEst != null) {
        setTankSize(String(data.tankEst));
      } else {
        // Fallback: try separate EPA lookup if VIN API's EPA lookup failed
        setEpaLoading(true);
        try {
          const qs = new URLSearchParams({
            action: 'lookup',
            year:   data.year,
            make:   data.make,
            model:  data.model,
          });
          const epaRes = await fetch(`/api/fueleconomy?${qs}`);
          if (epaRes.ok) {
            const epa = await epaRes.json() as { tankEst?: number | null };
            if (epa.tankEst) setTankSize(String(epa.tankEst));
          }
        } catch { /* silent */ }
        setEpaLoading(false);
      }
    } catch {
      setErrorMsg(t.vehiclePicker.vinNetworkError);
      setState('error');
    }
  }

  function handleSave() {
    if (!nickname.trim() || !tankSize || parseFloat(tankSize) <= 0 || !result) return;
    onSave({
      name:     nickname.trim(),
      gallons:  parseFloat(tankSize),
      vin:      result.vin,
      year:     result.year,
      make:     result.make,
      model:    result.model,
      trim:     result.trim ?? '',
      fuelType: result.fuel ?? '',
      epaId:    '',
      currentOdometer: odometer ? parseInt(odometer, 10) : undefined,
      vehicleSpecs: vehicleSpecs ?? undefined,
    });
  }

  const canSave = state === 'found' && !!nickname.trim() && !!tankSize && parseFloat(tankSize) > 0;

  // Color coding for VIN length indicator
  const lenColor = vinLength === 0 ? 'text-slate-300'
    : vinLength === 17 && vinValid ? 'text-green-600'
    : vinLength > 17 ? 'text-red-500'
    : 'text-amber-500';

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 leading-relaxed">
        {t.vehiclePicker.vinIntroPrefix} <span className="font-semibold text-slate-700">{t.vehiclePicker.vinIntroHighlight}</span> {t.vehiclePicker.vinIntroSuffix}
      </p>

      {/* VIN input */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-semibold text-slate-500">
            {t.vehiclePicker.vinFieldLabel}
          </label>
          {/* Label wraps the file input directly — avoids programmatic .click() which crashes WKWebView */}
          <label
            className={[
              'flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50',
              'border border-amber-200 rounded-lg px-2 py-1 hover:bg-amber-100 transition-colors',
              scanning ? 'opacity-50 pointer-events-none' : 'cursor-pointer',
            ].join(' ')}
            title={t.vehiclePicker.scanVinTitle}
          >
            <input
              type="file" accept="image/*"
              className="hidden"
              disabled={scanning}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleVinScan(f);
                e.target.value = '';
              }}
            />
            <span>{scanning ? '🔄' : '📷'}</span>
            <span>{scanning ? t.vehiclePicker.scanning : t.vehiclePicker.scanVin}</span>
          </label>
        </div>
        {scanError && <p className="text-[11px] text-red-500 mb-1 font-medium">{scanError}</p>}
        <div className="relative">
          <input
            type="text"
            className={[
              'input-field text-sm font-mono tracking-wider pr-16',
              vinLength > 0 && !vinValid && vinLength !== 17 ? 'border-amber-300 ring-1 ring-amber-200' : '',
              vinLength === 17 && !vinValid ? 'input-field-error' : '',
            ].join(' ')}
            placeholder="e.g. 1HGCM82633A123456"
            value={vin}
            maxLength={17}
            onChange={(e) => {
              // Strip spaces/dashes, uppercase
              const cleaned = e.target.value.replace(/[\s-]/g, '').toUpperCase();
              setVin(cleaned);
              setState('idle');
              setResult(null);
            }}
            aria-label={t.vehiclePicker.vinAriaLabel}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
          <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold pointer-events-none ${lenColor}`}>
            {vinLength}/17
          </span>
        </div>
        {vinLength === 17 && !vinValid && (
          <p className="mt-1 text-xs text-red-500">
            {t.vehiclePicker.vinInvalidChars}
          </p>
        )}
        {vinLength > 0 && vinLength < 17 && (
          <p className="mt-1 text-[10px] text-amber-600">
            {t.vehiclePicker.vinCharsNeeded(17 - vinLength)}
          </p>
        )}
      </div>

      {/* Where to find your VIN */}
      <div className="bg-slate-50 rounded-xl px-3 py-2.5 border border-slate-100 space-y-2">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{t.vehiclePicker.whereToFind}</p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
          {[
            `🚗 ${t.vehiclePicker.locationDashboard}`,
            `📋 ${t.vehiclePicker.locationRegistration}`,
            `🚪 ${t.vehiclePicker.locationDoorJamb}`,
            `🏦 ${t.vehiclePicker.locationInsurance}`,
          ].map((s) => (
            <p key={s} className="text-[10px] text-slate-500">{s}</p>
          ))}
        </div>
        {/* Camera scan tip */}
        <div className="flex items-start gap-1.5 pt-1 border-t border-slate-200">
          <span className="text-[10px] mt-0.5">📷</span>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            <span className="font-semibold text-slate-600">{t.vehiclePicker.bestForScanning}</span> {t.vehiclePicker.scanTipBody1}
            <span className="font-semibold">{t.vehiclePicker.vinLabelQuoted}</span> {t.vehiclePicker.scanTipBody2}
          </p>
        </div>
      </div>

      {/* Decode button */}
      <button
        onClick={handleLookup}
        disabled={!vinValid || state === 'loading'}
        className="w-full py-2.5 rounded-xl border-2 border-amber-400 text-sm font-bold
                   text-amber-700 hover:bg-amber-50 disabled:opacity-40 transition-colors"
      >
        {state === 'loading' ? t.vehiclePicker.decodingVin : t.vehiclePicker.decodeVin}
      </button>

      {/* Error */}
      {state === 'error' && (
        <div className="rounded-xl bg-red-50 border border-red-100 px-3 py-2.5 text-xs text-red-700">
          <span className="font-semibold">❌ {errorMsg}</span>
        </div>
      )}

      {/* Decoded result */}
      {state === 'found' && result && (
        <>
          {/* Vehicle identity card */}
          <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-3 space-y-2">
            <div className="flex items-start gap-2">
              <span className="text-green-600 text-lg mt-0.5">✅</span>
              <div>
                <p className="text-sm font-black text-slate-800">
                  {result.year} {result.make} {result.model}
                  {result.trim ? ` ${result.trim}` : ''}
                </p>
                <p className="text-[10px] text-slate-500 font-mono mt-0.5">{result.vin}</p>
              </div>
            </div>

            {/* Spec chips */}
            <div className="flex flex-wrap gap-1.5">
              {result.fuel && (
                <Chip>{result.fuel}</Chip>
              )}
              {result.cylinders && (
                <Chip>{t.vehiclePicker.cylChip(result.cylinders)}</Chip>
              )}
              {result.displacement && (
                <Chip>{Number(result.displacement).toFixed(1)} L</Chip>
              )}
              {result.body && (
                <Chip>{result.body}</Chip>
              )}
              {result.drive && (
                <Chip>{result.drive}</Chip>
              )}
            </div>
          </div>

          {/* EPA tank size lookup result */}
          {epaLoading && (
            <p className="text-[10px] text-slate-400 text-center">{t.vehiclePicker.epaTankLookup}</p>
          )}

          <ConfirmBlock
            tankSize={tankSize} setTankSize={setTankSize}
            nickname={nickname} setNickname={setNickname}
            odometer={odometer} setOdometer={setOdometer}
            fuelType={result.fuel ?? undefined}
            cylinders={result.cylinders} displ={result.displacement}
            onSave={handleSave} onCancel={onCancel}
            saving={saving} saveError={saveError} canSave={canSave}
          />
        </>
      )}

      {/* Cancel when idle/error */}
      {(state === 'idle' || state === 'error') && (
        <button onClick={onCancel}
          className="w-full py-2.5 rounded-xl border-2 border-slate-200 text-sm font-semibold
                     text-slate-500 hover:border-slate-300 transition-colors">
          {t.vehiclePicker.cancel}
        </button>
      )}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs bg-white border border-slate-200 rounded-lg px-2 py-1 font-medium text-slate-600">
      {children}
    </span>
  );
}

// ── Root component ─────────────────────────────────────────────────────────

export default function VehiclePicker({ plan, onSave, onCancel, saving, saveError }: VehiclePickerProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'search' | 'manual' | 'vin'>('search');
  const isPro = plan === 'pro' || plan === 'fleet';

  return (
    <div className="space-y-3 animate-fade-in">

      {/* Tab bar */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
        <button
          onClick={() => setTab('search')}
          className={[
            'flex-1 py-1.5 rounded-lg text-xs font-bold transition-all',
            tab === 'search'
              ? 'bg-white text-slate-700 shadow-sm'
              : 'text-slate-400 hover:text-slate-600',
          ].join(' ')}
        >
          🔍 {t.vehiclePicker.tabSearch}
        </button>
        <button
          onClick={() => setTab('vin')}
          className={[
            'flex-1 py-1.5 rounded-lg text-xs font-bold transition-all',
            tab === 'vin'
              ? 'bg-white text-slate-700 shadow-sm'
              : 'text-slate-400 hover:text-slate-600',
          ].join(' ')}
        >
          🔑 {t.vehiclePicker.tabVin}
        </button>
        <button
          onClick={() => setTab('manual')}
          className={[
            'flex-1 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1',
            tab === 'manual'
              ? 'bg-white text-slate-700 shadow-sm'
              : 'text-slate-400 hover:text-slate-600',
          ].join(' ')}
        >
          ✏️
          {isPro
            ? <span className={`text-[9px] text-white px-1 rounded-full ${plan === 'fleet' ? 'bg-blue-600' : 'bg-amber-500'}`}>
                {plan === 'fleet' ? 'FLEET' : 'PRO'}
              </span>
            : <span className="text-[9px] bg-slate-300 text-slate-500 px-1 rounded-full">PRO</span>
          }
        </button>
      </div>

      {/* Tab content */}
      {tab === 'search' && (
        <SearchTab onSave={onSave} onCancel={onCancel} saving={saving} saveError={saveError} />
      )}

      {tab === 'manual' && isPro && (
        <ManualTab onSave={onSave} onCancel={onCancel} saving={saving} saveError={saveError} />
      )}

      {tab === 'manual' && !isPro && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-5 text-center space-y-2">
          <p className="text-2xl">🔒</p>
          <p className="text-sm font-bold text-amber-800">{t.vehiclePicker.proFeatureTitle}</p>
          <p className="text-xs text-amber-700 leading-relaxed">
            {t.vehiclePicker.proFeatureBody1}{' '}
            <span className="font-semibold">GasCap™ Pro</span>{t.vehiclePicker.proFeatureBody2}
          </p>
          <button
            onClick={() => setTab('search')}
            className="mt-1 text-xs font-bold text-amber-700 hover:text-amber-900 underline"
          >
            {t.vehiclePicker.switchToSearch}
          </button>
        </div>
      )}

      {tab === 'vin' && (
        <VinTab onSave={onSave} onCancel={onCancel} saving={saving} saveError={saveError} />
      )}
    </div>
  );
}
