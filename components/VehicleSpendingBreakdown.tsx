'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState, useCallback } from 'react';
import type { Fillup } from '@/lib/fillups';

interface HistoryResponse {
  fillups: Fillup[];
  mpgMap:  Record<string, number | null>;
  stats: {
    count:        number;
    totalSpent:   number;
    totalGallons: number;
    avgMpg:       number | null;
  };
}

interface VehicleStat {
  name:         string;
  totalSpent:   number;
  totalGallons: number;
  fillupCount:  number;
  avgMpg:       number | null;
  avgPrice:     number;
  lastDate:     string;
  pct:          number; // percentage of total spend
}

// Distinct color palette for up to 8 vehicles
const COLORS = [
  '#f59e0b', // amber
  '#3b82f6', // blue
  '#10b981', // emerald
  '#8b5cf6', // violet
  '#ef4444', // red
  '#06b6d4', // cyan
  '#f97316', // orange
  '#84cc16', // lime
];

export default function VehicleSpendingBreakdown() {
  const { data: session, status } = useSession();
  const [data,    setData]    = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [open,    setOpen]    = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/fillups');
      if (res.ok) setData(await res.json() as HistoryResponse);
    } finally {
      setLoading(false);
    }
  }, []);

  // Eager-load on mount so toggle header shows real data immediately
  useEffect(() => {
    if (session) load();
  }, [session, load]);

  // Re-load when new fillup saved
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('fillup-saved', handler);
    return () => window.removeEventListener('fillup-saved', handler);
  }, [load]);

  if (status === 'loading' || !session) return null;

  // ── Build per-vehicle stats ──────────────────────────────────────────────
  const vehicleStats: VehicleStat[] = [];

  if (data?.fillups?.length) {
    const byVehicle: Record<string, Fillup[]> = {};
    for (const f of data.fillups) {
      const key = f.vehicleId ?? f.vehicleName;
      if (!byVehicle[key]) byVehicle[key] = [];
      byVehicle[key].push(f);
    }

    const totalAllSpent = data.fillups.reduce((s, f) => s + f.totalCost, 0);

    for (const [, fills] of Object.entries(byVehicle)) {
      const totalSpent   = fills.reduce((s, f) => s + f.totalCost, 0);
      const totalGallons = fills.reduce((s, f) => s + f.gallonsPumped, 0);
      const avgPrice     = totalGallons > 0 ? totalSpent / totalGallons : 0;

      // Collect MPG values for this vehicle
      const mpgValues = fills
        .map((f) => data.mpgMap[f.id])
        .filter((v): v is number => v !== null);
      const avgMpg = mpgValues.length > 0
        ? Math.round((mpgValues.reduce((s, v) => s + v, 0) / mpgValues.length) * 10) / 10
        : null;

      const lastDate = fills.reduce((latest, f) =>
        f.date > latest ? f.date : latest, '');

      vehicleStats.push({
        name:        fills[0].vehicleName,
        totalSpent:  Math.round(totalSpent * 100) / 100,
        totalGallons: Math.round(totalGallons * 10) / 10,
        fillupCount:  fills.length,
        avgMpg,
        avgPrice:    Math.round(avgPrice * 100) / 100,
        lastDate,
        pct:         totalAllSpent > 0 ? (totalSpent / totalAllSpent) * 100 : 0,
      });
    }

    // Sort by total spend descending
    vehicleStats.sort((a, b) => b.totalSpent - a.totalSpent);
  }

  const hasData = vehicleStats.length > 0;
  const topVehicle = vehicleStats[0];

  return (
    <div className="mt-4">
      {/* Toggle header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between py-3 px-4 bg-white rounded-2xl
                   border border-slate-100 shadow-sm hover:border-amber-200 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-lg">🚗</span>
          <div className="text-left">
            <p className="text-sm font-black text-slate-700">Vehicle Spending</p>
            {loading
              ? <p className="text-[10px] text-slate-400">Loading…</p>
              : hasData
                ? <p className="text-[10px] text-slate-400">{vehicleStats.length} vehicle{vehicleStats.length !== 1 ? 's' : ''} · ${data?.stats.totalSpent.toFixed(2)} total</p>
                : <p className="text-[10px] text-slate-400">Log fillups to see breakdown</p>
            }
          </div>
        </div>
        <div className="flex items-center gap-3">
          {topVehicle && (
            <span className="text-[11px] font-black text-amber-600 max-w-[80px] truncate">
              {topVehicle.name}
            </span>
          )}
          <svg
            className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="mt-2 bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-4">

          {loading && (
            <p className="text-xs text-slate-400 text-center py-6">Loading…</p>
          )}

          {!loading && !hasData && (
            <div className="text-center py-6">
              <p className="text-3xl mb-2">⛽</p>
              <p className="text-sm font-bold text-slate-600">No fillups logged yet</p>
              <p className="text-xs text-slate-400 mt-1">Log your first fillup to see per-vehicle spending.</p>
            </div>
          )}

          {!loading && hasData && (
            <>
              {/* Summary pills */}
              <div className="flex gap-2">
                <SummaryPill label="Vehicles" value={String(vehicleStats.length)} color="text-slate-700" />
                <SummaryPill label="Total Spent" value={`$${data?.stats.totalSpent.toFixed(0)}`} color="text-amber-600" />
                <SummaryPill label="Total Gal" value={`${data?.stats.totalGallons}`} color="text-blue-600" />
              </div>

              {/* Per-vehicle bars */}
              <div className="space-y-3">
                {vehicleStats.map((v, i) => (
                  <VehicleBar key={v.name} stat={v} color={COLORS[i % COLORS.length]} rank={i + 1} />
                ))}
              </div>

              {vehicleStats.length > 1 && (
                <p className="text-[9px] text-slate-300 text-center">
                  Bar width = share of total fuel spend across all vehicles
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SummaryPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex-1 bg-slate-50 rounded-xl border border-slate-100 px-2 py-2 text-center">
      <p className={`text-sm font-black ${color}`}>{value}</p>
      <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide mt-0.5">{label}</p>
    </div>
  );
}

function VehicleBar({ stat, color, rank }: { stat: VehicleStat; color: string; rank: number }) {
  const d = new Date(stat.lastDate + 'T12:00:00');
  const lastFill = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });

  return (
    <div className="space-y-1.5">
      {/* Vehicle name + total */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
          <span className="text-xs font-bold text-slate-700 truncate max-w-[140px]">{stat.name}</span>
          {rank === 1 && (
            <span className="text-[9px] font-black bg-amber-100 text-amber-700 rounded px-1 py-0.5 flex-shrink-0">
              #1
            </span>
          )}
        </div>
        <span className="text-sm font-black text-slate-800 flex-shrink-0">${stat.totalSpent.toFixed(2)}</span>
      </div>

      {/* Bar */}
      <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.max(stat.pct, 2)}%`, backgroundColor: color }}
        />
      </div>

      {/* Stat chips */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        <StatChip label="fillups" value={String(stat.fillupCount)} />
        <StatChip label="gal" value={String(stat.totalGallons)} />
        <StatChip label="avg $/gal" value={`$${stat.avgPrice.toFixed(2)}`} />
        {stat.avgMpg != null && (
          <StatChip label="avg MPG" value={String(stat.avgMpg)} highlight />
        )}
        <StatChip label="last fill" value={lastFill} />
      </div>
    </div>
  );
}

function StatChip({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <span className="text-[10px] text-slate-400">
      <span className={`font-bold ${highlight ? 'text-green-600' : 'text-slate-600'}`}>{value}</span>
      {' '}{label}
    </span>
  );
}
