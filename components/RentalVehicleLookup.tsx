'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';

interface MenuItem { text: string; value: string }

interface VehicleDetails {
  year:     string | number;
  make:     string;
  model:    string;
  fuelType: string;
  tankEst:  number | null;
}

async function fetchMenu(action: string, params: Record<string, string> = {}): Promise<MenuItem[]> {
  const qs = new URLSearchParams({ action, ...params }).toString();
  const res = await fetch(`/api/fueleconomy?${qs}`);
  if (!res.ok) return [];
  return res.json() as Promise<MenuItem[]>;
}

interface RentalVehicleLookupProps {
  /** Fired once a trim resolves to an EPA tank estimate. */
  onTankSize: (gallons: string, label: string) => void;
}

/**
 * Lightweight Year/Make/Model → EPA tank size lookup for Rental Mode.
 * Unlike VehiclePicker, this never saves anything to the garage — it just
 * resolves the exact rental car's tank size instead of a generic class
 * average (e.g. "Midsize rental — 15.9 gal"), for renters who know exactly
 * what they were handed at the counter.
 */
export default function RentalVehicleLookup({ onTankSize }: RentalVehicleLookupProps) {
  const { t } = useTranslation();
  const [years,  setYears]  = useState<MenuItem[]>([]);
  const [makes,  setMakes]  = useState<MenuItem[]>([]);
  const [models, setModels] = useState<MenuItem[]>([]);
  const [trims,  setTrims]  = useState<MenuItem[]>([]);

  const [year,   setYear]   = useState('');
  const [make,   setMake]   = useState('');
  const [model,  setModel]  = useState('');
  const [trimId, setTrimId] = useState('');
  const [loading, setLoading] = useState<string | null>(null);
  const [foundVehicle, setFoundVehicle] = useState<{ label: string; tank: string } | null>(null);
  const [lookupError,  setLookupError]  = useState(false);

  useEffect(() => {
    setLoading('years');
    fetchMenu('years').then((items) => { setYears(items); setLoading(null); });
  }, []);

  useEffect(() => {
    if (!year) { setMakes([]); setMake(''); return; }
    setMake(''); setModel(''); setTrimId('');
    setFoundVehicle(null); setLookupError(false);
    setLoading('makes');
    fetchMenu('makes', { year }).then((items) => { setMakes(items); setLoading(null); });
  }, [year]);

  useEffect(() => {
    if (!year || !make) { setModels([]); setModel(''); return; }
    setModel(''); setTrimId('');
    setFoundVehicle(null); setLookupError(false);
    setLoading('models');
    fetchMenu('models', { year, make }).then((items) => { setModels(items); setLoading(null); });
  }, [year, make]);

  useEffect(() => {
    if (!year || !make || !model) { setTrims([]); setTrimId(''); return; }
    setTrimId('');
    setFoundVehicle(null); setLookupError(false);
    setLoading('trims');
    fetchMenu('trims', { year, make, model }).then((items) => {
      setTrims(items); setLoading(null);
      if (items.length === 1) setTrimId(items[0].value);
    });
  }, [year, make, model]);

  useEffect(() => {
    if (!trimId) return;
    setFoundVehicle(null); setLookupError(false);
    setLoading('vehicle');
    fetch(`/api/fueleconomy?action=vehicle&id=${trimId}`)
      .then((r) => r.json())
      .then((d: VehicleDetails) => {
        setLoading(null);
        if (d.tankEst) {
          const label = `${d.year} ${d.make} ${d.model}`;
          onTankSize(String(d.tankEst), label);
          setFoundVehicle({ label, tank: String(d.tankEst) });
        } else {
          setLookupError(true);
        }
      })
      .catch(() => { setLoading(null); setLookupError(true); });
  }, [trimId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-2 mt-2">
      <p className="text-[11px] font-bold text-blue-700">{t.rentalLookup.title}</p>
      <div className="grid grid-cols-3 gap-2">
        <select className="input-field text-xs" value={year}
          onChange={(e) => setYear(e.target.value)} disabled={loading === 'years'}>
          <option value="">{loading === 'years' ? t.vehiclePicker.loading : t.rentalLookup.year}</option>
          {years.map((y) => <option key={y.value} value={y.value}>{y.text}</option>)}
        </select>
        <select className="input-field text-xs" value={make}
          onChange={(e) => setMake(e.target.value)} disabled={!year || loading === 'makes'}>
          <option value="">{loading === 'makes' ? t.vehiclePicker.loading : t.rentalLookup.make}</option>
          {makes.map((m) => <option key={m.value} value={m.value}>{m.text}</option>)}
        </select>
        <select className="input-field text-xs" value={model}
          onChange={(e) => setModel(e.target.value)} disabled={!make || loading === 'models'}>
          <option value="">{loading === 'models' ? t.vehiclePicker.loading : t.rentalLookup.model}</option>
          {models.map((m) => <option key={m.value} value={m.value}>{m.text}</option>)}
        </select>
      </div>

      {trims.length > 1 && (
        <select className="input-field text-xs" value={trimId}
          onChange={(e) => setTrimId(e.target.value)} disabled={loading === 'trims'}>
          <option value="">{loading === 'trims' ? t.vehiclePicker.loading : t.rentalLookup.trim}</option>
          {trims.map((tr) => <option key={tr.value} value={tr.value}>{tr.text}</option>)}
        </select>
      )}

      {loading === 'vehicle' && (
        <p className="text-[10px] text-blue-500">{t.rentalLookup.looking}</p>
      )}

      {foundVehicle && (
        <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
          <span className="text-base flex-shrink-0" aria-hidden="true">✅</span>
          <p className="text-[11px] text-emerald-700 leading-snug">
            <span className="font-black block">{t.rentalLookup.vehicleFoundTitle(foundVehicle.label)}</span>
            {t.rentalLookup.vehicleFoundTank(foundVehicle.tank)}
          </p>
        </div>
      )}

      {lookupError && (
        <p className="text-[11px] text-red-600 font-semibold">❌ {t.rentalLookup.vehicleLookupError}</p>
      )}
    </div>
  );
}
