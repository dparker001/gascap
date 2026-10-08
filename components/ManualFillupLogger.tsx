'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession }          from 'next-auth/react';
import { useTranslation }      from '@/contexts/LanguageContext';
import FillupLogger            from './FillupLogger';
import { useIsNative }         from '@/hooks/useIsNative';
import { LOG_INTENT_EVENT, consumeLogIntent } from '@/lib/logIntent';

interface Vehicle {
  id:      string;
  name:    string;
  gallons: number;
  year?:   string;
  make?:   string;
  model?:  string;
}

export default function ManualFillupLogger() {
  const { data: session } = useSession();
  const { t } = useTranslation();
  const [open,     setOpen]     = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selId,    setSelId]    = useState<string>('');
  const [drivers,  setDrivers]  = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const isNative = useIsNative();
  // True after the user taps "Add a vehicle" from the empty state, so that
  // saving a vehicle brings them straight back to logging their fill-up.
  const returnToLogRef = useRef(false);

  // Keyed by the signed-in user's ID so the list always belongs to the current account.
  // If the user switches accounts the vehicles reset and refetch automatically.
  const sessionUserId = (session?.user as { id?: string } | undefined)?.id ?? session?.user?.email ?? null;

  const loadVehicles = useCallback(() => {
    return fetch('/api/vehicles')
      .then((r) => r.json())
      .then((d: { vehicles?: Vehicle[]; plan?: string }) => {
        const list = d.vehicles ?? [];
        setVehicles(list);
        setSelId((cur) => (list.some((v) => v.id === cur) ? cur : (list[0]?.id ?? '')));
        if (d.plan === 'fleet') {
          fetch('/api/fleet/drivers')
            .then((r) => r.json())
            .then((fd: { drivers?: string[] }) => setDrivers(fd.drivers ?? []))
            .catch(() => {});
        }
        return list;
      })
      .catch(() => [] as Vehicle[]);
  }, []);

  useEffect(() => {
    if (!sessionUserId) {
      setVehicles([]);
      setSelId('');
      setDrivers([]);
      return;
    }
    setVehicles([]);
    setSelId('');
    setDrivers([]);
    void loadVehicles();
  }, [sessionUserId, loadVehicles]);

  // `/?log=1` deep link: open the logger once. Only the instance the user can
  // actually see acts (the page mounts a mobile and a desktop copy; the hidden
  // one has no layout box), and consuming the intent makes it one-shot.
  const openFromIntent = useCallback(() => {
    const el = rootRef.current;
    if (!el || el.getClientRects().length === 0) return;
    if (!consumeLogIntent()) return;
    setOpen(true);
    window.setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }, []);

  useEffect(() => {
    if (!sessionUserId) return;
    openFromIntent();
    window.addEventListener(LOG_INTENT_EVENT, openFromIntent);
    return () => window.removeEventListener(LOG_INTENT_EVENT, openFromIntent);
  }, [sessionUserId, openFromIntent]);

  // After the user adds their first vehicle (SavedVehicles dispatches
  // 'vehicle-saved'), refresh the list; if they came here via "Add a vehicle",
  // return them to the logger.
  useEffect(() => {
    if (!sessionUserId) return;
    const onVehicleSaved = () => {
      void loadVehicles().then((list) => {
        if (!returnToLogRef.current || list.length === 0) return;
        returnToLogRef.current = false;
        if (isNative) window.dispatchEvent(new CustomEvent('gc:switch-tab', { detail: { tab: 'tools' } }));
        setOpen(true);
        window.setTimeout(() => rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
      });
    };
    window.addEventListener('vehicle-saved', onVehicleSaved);
    return () => window.removeEventListener('vehicle-saved', onVehicleSaved);
  }, [sessionUserId, loadVehicles, isNative]);

  // "Add a vehicle" opens the EXISTING add-vehicle flow (SavedVehicles →
  // VehiclePicker, with its normal validation and plan limits). It never
  // creates a vehicle itself.
  function handleAddVehicle() {
    returnToLogRef.current = true;
    if (isNative) window.dispatchEvent(new CustomEvent('gc:switch-tab', { detail: { tab: 'calculator' } }));
    const fire = () => {
      document.getElementById('gascap-calculator')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.dispatchEvent(new CustomEvent('gascap:focus-vehicles'));
    };
    if (isNative) window.setTimeout(fire, 200); else fire();
  }

  if (!session) return null;

  const selected = vehicles.find((v) => v.id === selId);

  function handleClose() {
    setOpen(false);
  }

  return (
    <div ref={rootRef}>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl
                     bg-amber-500 hover:bg-amber-400 text-white text-sm font-black
                     transition-colors shadow-sm"
        >
          <span>⛽</span>
          {t.manualFillupLogger.logAFillUp}
        </button>
      ) : (
        <div className="space-y-3">
          {/* Vehicle picker */}
          {vehicles.length > 1 && (
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                {t.manualFillupLogger.selectVehicle}
              </label>
              <select
                value={selId}
                onChange={(e) => setSelId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5
                           text-sm font-semibold text-slate-700 focus:outline-none
                           focus:border-amber-400"
              >
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}{v.year ? ` (${v.year} ${v.make} ${v.model})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {vehicles.length === 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-4 text-center">
              <p className="text-sm font-bold text-slate-600">{t.manualFillupLogger.noSavedVehicles}</p>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                {t.manualFillupLogger.noSavedVehiclesHint}
              </p>
              <button
                onClick={handleAddVehicle}
                className="mt-3 w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-sm font-black transition-colors"
              >
                {t.manualFillupLogger.addVehicle}
              </button>
              <button
                onClick={handleClose}
                className="mt-2 text-xs font-bold text-slate-400 hover:text-slate-500"
              >
                {t.manualFillupLogger.cancel}
              </button>
            </div>
          )}

          {selected && (
            <FillupLogger
              prefill={{
                gallonsPumped:  0,
                pricePerGallon: 0,
                vehicleName:    selected.name,
                vehicleId:      selected.id,
              }}
              drivers={drivers}
              onSaved={handleClose}
              onCancel={handleClose}
            />
          )}
        </div>
      )}
    </div>
  );
}
