'use client';

/**
 * VehicleChip — compact active-vehicle indicator for the Calculator tab title bar.
 *
 * Shows the selected vehicle name + tank size. Tapping opens a slide-up sheet
 * to switch vehicles without navigating away to Tools. Signed-in only.
 */

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import type { Vehicle } from '@/components/SavedVehicles';

interface Props {
  /** Currently selected vehicle id (from CalculatorTabs state) */
  selectedVehicleId?: string;
  /** Called when user picks a different vehicle — parent updates tank size */
  onSelect: (gallons: string, vehicle?: Vehicle) => void;
}

function CarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 17H3a2 2 0 01-2-2v-4l2.5-6h13l2.5 6v4a2 2 0 01-2 2h-2"/>
      <circle cx="7.5" cy="17.5" r="1.5"/>
      <circle cx="16.5" cy="17.5" r="1.5"/>
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6"/>
    </svg>
  );
}

export default function VehicleChip({ selectedVehicleId, onSelect }: Props) {
  const { data: session } = useSession();
  const [vehicles,  setVehicles]  = useState<Vehicle[]>([]);
  const [open,      setOpen]      = useState(false);
  // Read active vehicle id from localStorage so we stay in sync with the calculator.
  const [activeId, setActiveId] = useState<string | undefined>(selectedVehicleId);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('gc_target_v2');
      if (raw) {
        const parsed = JSON.parse(raw) as { vehicleId?: string };
        if (parsed.vehicleId) setActiveId(parsed.vehicleId);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!session) return;
    fetch('/api/vehicles')
      .then((r) => r.json())
      .then((d: { vehicles?: Vehicle[] }) => setVehicles(d.vehicles ?? []))
      .catch(() => { /* silent — chip just won't show */ });
  }, [session]);

  if (!session || vehicles.length === 0) return null;

  const active = vehicles.find((v) => v.id === (activeId ?? selectedVehicleId)) ?? vehicles[0];

  return (
    <>
      {/* Chip button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 bg-white/15 rounded-full px-2.5 py-1
                   text-white text-[11px] font-semibold active:bg-white/25 transition-colors"
        aria-label="Switch vehicle"
      >
        <CarIcon />
        <span className="max-w-[100px] truncate">{active.name}</span>
        <span className="opacity-60">· {active.gallons}g</span>
        <ChevronDown />
      </button>

      {/* Slide-up sheet */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end"
          onClick={() => setOpen(false)}
        >
          {/* Scrim */}
          <div className="absolute inset-0 bg-black/40" />

          {/* Sheet */}
          <div
            className="relative bg-white rounded-t-3xl shadow-xl pb-10"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full bg-slate-200" />
            </div>

            <p className="text-center text-sm font-black text-slate-900 pb-3 border-b border-slate-100">
              Switch Vehicle
            </p>

            <div className="overflow-y-auto max-h-72">
              {vehicles.map((v) => {
                const isActive = v.id === active.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      setActiveId(v.id);
                      onSelect(String(v.gallons), v);
                      setOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-5 py-3.5
                                text-left transition-colors active:bg-slate-50
                                ${isActive ? 'bg-teal-50' : ''}`}
                  >
                    <div className="flex items-center gap-3">
                      <CarIcon />
                      <div>
                        <p className={`text-sm font-bold ${isActive ? 'text-teal-700' : 'text-slate-800'}`}>
                          {v.name}
                        </p>
                        <p className="text-xs text-slate-400">
                          {v.gallons} gal tank
                          {v.year && v.make ? ` · ${v.year} ${v.make}` : ''}
                        </p>
                      </div>
                    </div>
                    {isActive && (
                      <span className="text-xs font-black text-teal-600">✓ Active</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
