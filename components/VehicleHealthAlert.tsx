'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { Fillup } from '@/lib/fillups';

interface FillupResponse {
  fillups: Fillup[];
  mpgMap:  Record<string, number | null>;
}

interface VehicleAlert {
  vehicleName: string;
  recentMpg:   number;
  avgMpg:      number;
  dropPct:     number;
}

export default function VehicleHealthAlert() {
  const { data: session } = useSession();
  const [alerts,  setAlerts]  = useState<VehicleAlert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) return;
    fetch('/api/fillups', { credentials: 'include' })
      .then(r => r.json())
      .then((data: FillupResponse) => {
        const fillups = data.fillups ?? [];
        const mpgMap  = data.mpgMap  ?? {};

        // Group fillups by vehicle
        const byVehicle: Record<string, Fillup[]> = {};
        for (const f of fillups) {
          const key = f.vehicleId ?? f.vehicleName;
          if (!byVehicle[key]) byVehicle[key] = [];
          byVehicle[key].push(f);
        }

        const found: VehicleAlert[] = [];

        for (const [, vFillups] of Object.entries(byVehicle)) {
          if (vFillups.length < 4) continue; // need enough data

          // Collect MPG readings in date order
          const sorted = [...vFillups].sort(
            (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
          );

          const readings: number[] = sorted
            .map(f => mpgMap[f.id])
            .filter((v): v is number => typeof v === 'number' && v > 0);

          if (readings.length < 4) continue;

          const allButLast  = readings.slice(0, -2);
          const lastTwo     = readings.slice(-2);
          const avgMpg      = allButLast.reduce((s, v) => s + v, 0) / allButLast.length;
          const recentMpg   = lastTwo.reduce((s, v) => s + v, 0) / lastTwo.length;
          const dropPct     = ((avgMpg - recentMpg) / avgMpg) * 100;

          if (dropPct >= 10) {
            found.push({
              vehicleName: sorted[0].vehicleName,
              recentMpg:   Math.round(recentMpg * 10) / 10,
              avgMpg:      Math.round(avgMpg * 10) / 10,
              dropPct:     Math.round(dropPct),
            });
          }
        }

        setAlerts(found);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [session]);

  if (!session || loading || alerts.length === 0) return null;

  return (
    <div className="space-y-2">
      {alerts.map((alert, i) => (
        <div
          key={i}
          className="bg-orange-50 border border-orange-200 rounded-2xl p-4 space-y-2"
        >
          <div className="flex items-start gap-3">
            <span className="text-xl flex-shrink-0">🔧</span>
            <div className="flex-1">
              <p className="text-sm font-black text-orange-700">
                MPG Drop Detected — {alert.vehicleName}
              </p>
              <p className="text-[11px] text-orange-600 leading-relaxed mt-0.5">
                Your recent MPG ({alert.recentMpg} mpg) is{' '}
                <span className="font-bold">{alert.dropPct}% below</span> your average
                ({alert.avgMpg} mpg). This could indicate low tire pressure, a dirty
                air filter, or it may be time for an oil change.
              </p>
            </div>
          </div>
          <div className="flex gap-2 pl-8">
            <div className="flex-1 bg-white rounded-xl px-3 py-2 text-center border border-orange-100">
              <p className="text-xs font-black text-orange-600">{alert.recentMpg} mpg</p>
              <p className="text-[10px] text-slate-400">Recent avg</p>
            </div>
            <div className="flex-1 bg-white rounded-xl px-3 py-2 text-center border border-orange-100">
              <p className="text-xs font-black text-slate-600">{alert.avgMpg} mpg</p>
              <p className="text-[10px] text-slate-400">Historical avg</p>
            </div>
            <div className="flex-1 bg-orange-100 rounded-xl px-3 py-2 text-center border border-orange-200">
              <p className="text-xs font-black text-orange-700">−{alert.dropPct}%</p>
              <p className="text-[10px] text-orange-500">Drop</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
