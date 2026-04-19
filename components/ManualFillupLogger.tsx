'use client';

import { useEffect, useState } from 'react';
import { useSession }          from 'next-auth/react';
import FillupLogger            from './FillupLogger';

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
  const [open,     setOpen]     = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selId,    setSelId]    = useState<string>('');
  const [drivers,  setDrivers]  = useState<string[]>([]);

  // Fetch saved vehicles once when opened
  useEffect(() => {
    if (!session || vehicles.length > 0) return;
    fetch('/api/vehicles')
      .then((r) => r.json())
      .then((d: { vehicles?: Vehicle[]; plan?: string }) => {
        const list = d.vehicles ?? [];
        setVehicles(list);
        if (list.length > 0) setSelId(list[0].id);
        // Fetch driver roster for fleet users
        if (d.plan === 'fleet') {
          fetch('/api/fleet/drivers')
            .then((r) => r.json())
            .then((fd: { drivers?: string[] }) => setDrivers(fd.drivers ?? []))
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, [session, vehicles.length]);

  if (!session) return null;

  const selected = vehicles.find((v) => v.id === selId);

  function handleClose() {
    setOpen(false);
  }

  return (
    <div>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl
                     bg-amber-500 hover:bg-amber-400 text-white text-sm font-black
                     transition-colors shadow-sm"
        >
          <span>⛽</span>
          Log a Fill-Up
        </button>
      ) : (
        <div className="space-y-3">
          {/* Vehicle picker */}
          {vehicles.length > 1 && (
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                Select vehicle
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
              <p className="text-sm font-bold text-slate-600">No saved vehicles</p>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Add a vehicle in the Saved Vehicles section above, then come back to log a fill-up.
              </p>
              <button
                onClick={handleClose}
                className="mt-3 text-xs font-bold text-amber-600 hover:text-amber-500"
              >
                Cancel
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
