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

interface VehicleProfile {
  name:          string;
  fillupCount:   number;
  totalSpent:    number;
  totalGallons:  number;
  avgMpg:        number | null;
  bestMpg:       number | null;
  worstMpg:      number | null;
  avgPrice:      number;
  costPerMile:   number | null;  // $/mi = avgPrice/avgMpg
  lastDate:      string;
  firstDate:     string;
  daysTracked:   number;
  fillsPerMonth: number | null;
}

// Distinct colors — same palette as VehicleSpendingBreakdown
const COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#06b6d4', '#f97316', '#84cc16'];

export default function VehicleComparison() {
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

  // ── Build per-vehicle profiles ───────────────────────────────────────────
  const profiles: VehicleProfile[] = [];

  if (data?.fillups?.length) {
    const byVehicle: Record<string, Fillup[]> = {};
    for (const f of data.fillups) {
      const key = f.vehicleId ?? f.vehicleName;
      if (!byVehicle[key]) byVehicle[key] = [];
      byVehicle[key].push(f);
    }

    for (const [, fills] of Object.entries(byVehicle)) {
      const totalSpent   = fills.reduce((s, f) => s + f.totalCost, 0);
      const totalGallons = fills.reduce((s, f) => s + f.gallonsPumped, 0);
      const avgPrice     = totalGallons > 0 ? totalSpent / totalGallons : 0;

      const mpgValues = fills
        .map((f) => data.mpgMap[f.id])
        .filter((v): v is number => v !== null);
      const avgMpg  = mpgValues.length > 0
        ? Math.round((mpgValues.reduce((s, v) => s + v, 0) / mpgValues.length) * 10) / 10
        : null;
      const bestMpg  = mpgValues.length > 0 ? Math.max(...mpgValues) : null;
      const worstMpg = mpgValues.length > 0 ? Math.min(...mpgValues) : null;

      const costPerMile = avgMpg != null && avgMpg > 0
        ? Math.round((avgPrice / avgMpg) * 1000) / 1000  // $/mile
        : null;

      const dates = fills.map((f) => f.date).sort();
      const firstDate = dates[0];
      const lastDate  = dates[dates.length - 1];
      const daysTracked = Math.max(1,
        Math.round((new Date(lastDate + 'T12:00:00').getTime() - new Date(firstDate + 'T12:00:00').getTime()) / 86400000)
      );
      const fillsPerMonth = daysTracked >= 14
        ? Math.round((fills.length / daysTracked) * 30 * 10) / 10
        : null;

      profiles.push({
        name:         fills[0].vehicleName,
        fillupCount:  fills.length,
        totalSpent:   Math.round(totalSpent * 100) / 100,
        totalGallons: Math.round(totalGallons * 10) / 10,
        avgMpg,
        bestMpg,
        worstMpg,
        avgPrice:     Math.round(avgPrice * 100) / 100,
        costPerMile,
        lastDate,
        firstDate,
        daysTracked,
        fillsPerMonth,
      });
    }

    profiles.sort((a, b) => b.totalSpent - a.totalSpent);
  }

  const hasMultiple = profiles.length >= 2;
  const hasData     = profiles.length >= 1;

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between py-3 px-4 bg-white rounded-2xl
                   border border-slate-100 shadow-sm hover:border-amber-200 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-lg">⚖️</span>
          <div className="text-left">
            <p className="text-sm font-black text-slate-700">Vehicle Comparison</p>
            {loading
              ? <p className="text-[10px] text-slate-400">Loading…</p>
              : hasMultiple
                ? <p className="text-[10px] text-slate-400">{profiles.length} vehicles · side-by-side stats</p>
                : hasData
                  ? <p className="text-[10px] text-slate-400">{profiles[0].name} · add a 2nd vehicle to compare</p>
                  : <p className="text-[10px] text-slate-400">Log fill-ups to see vehicle stats</p>
            }
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

      {open && (
        <div className="mt-2 bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-4">

          {loading && (
            <p className="text-xs text-slate-400 text-center py-6">Loading…</p>
          )}

          {!loading && !hasData && (
            <div className="text-center py-6">
              <p className="text-3xl mb-2">🚗</p>
              <p className="text-sm font-bold text-slate-600">No fill-ups logged yet</p>
              <p className="text-xs text-slate-400 mt-1">Log fill-ups for at least one vehicle to see comparison data.</p>
            </div>
          )}

          {!loading && hasData && !hasMultiple && (
            <div className="text-center py-4">
              <p className="text-3xl mb-2">➕</p>
              <p className="text-sm font-bold text-slate-600">Only one vehicle tracked</p>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed max-w-[220px] mx-auto">
                Log fill-ups for a second vehicle to unlock side-by-side comparison.
              </p>
              {/* Show single vehicle stats anyway */}
              <div className="mt-4">
                <SingleVehicleCard profile={profiles[0]} color={COLORS[0]} />
              </div>
            </div>
          )}

          {!loading && hasMultiple && (
            <>
              {/* Winner badges */}
              <WinnerRow profiles={profiles} />

              {/* Side-by-side cards — horizontal scroll on mobile */}
              <div className="overflow-x-auto -mx-1 px-1">
                <div
                  className="flex gap-3"
                  style={{ minWidth: `${profiles.length * 160}px` }}
                >
                  {profiles.map((p, i) => (
                    <VehicleCard key={p.name} profile={p} color={COLORS[i % COLORS.length]} rank={i + 1} />
                  ))}
                </div>
              </div>

              {/* Comparison bar chart rows */}
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Head-to-Head</p>

                <CompareBar
                  label="Total Spent"
                  profiles={profiles}
                  colors={COLORS}
                  getValue={(p) => p.totalSpent}
                  format={(v) => `$${v.toFixed(0)}`}
                  lowerIsBetter
                />
                <CompareBar
                  label="Avg MPG"
                  profiles={profiles}
                  colors={COLORS}
                  getValue={(p) => p.avgMpg ?? 0}
                  format={(v) => v > 0 ? `${v} mpg` : 'N/A'}
                  lowerIsBetter={false}
                  skipZero
                />
                <CompareBar
                  label="Cost / Mile"
                  profiles={profiles}
                  colors={COLORS}
                  getValue={(p) => p.costPerMile ?? 0}
                  format={(v) => v > 0 ? `$${v.toFixed(3)}` : 'N/A'}
                  lowerIsBetter
                  skipZero
                />
                <CompareBar
                  label="Avg $/Gallon"
                  profiles={profiles}
                  colors={COLORS}
                  getValue={(p) => p.avgPrice}
                  format={(v) => `$${v.toFixed(2)}`}
                  lowerIsBetter
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Winner Row ───────────────────────────────────────────────────────────────

function WinnerRow({ profiles }: { profiles: VehicleProfile[] }) {
  const mpgProfiles  = profiles.filter((p) => p.avgMpg != null);
  const cpmProfiles  = profiles.filter((p) => p.costPerMile != null);

  const bestMpg  = mpgProfiles.length  > 0 ? mpgProfiles.reduce((a, b)  => (a.avgMpg!  > b.avgMpg!  ? a : b)) : null;
  const cheapCpm = cpmProfiles.length  > 0 ? cpmProfiles.reduce((a, b)  => (a.costPerMile! < b.costPerMile! ? a : b)) : null;
  const mostFill = [...profiles].sort((a, b) => b.fillupCount - a.fillupCount)[0];

  const badges = [
    bestMpg  && { emoji: '🏆', label: 'Best MPG',       vehicle: bestMpg.name,   value: `${bestMpg.avgMpg} mpg`        },
    cheapCpm && { emoji: '💰', label: 'Cheapest/Mile',  vehicle: cheapCpm.name,  value: `$${cheapCpm.costPerMile!.toFixed(3)}/mi` },
    mostFill && { emoji: '⛽', label: 'Most Active',    vehicle: mostFill.name,  value: `${mostFill.fillupCount} fill-ups` },
  ].filter(Boolean) as { emoji: string; label: string; vehicle: string; value: string }[];

  if (badges.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto pb-0.5">
      {badges.map((b) => (
        <div key={b.label} className="flex-shrink-0 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-center min-w-[100px]">
          <p className="text-base">{b.emoji}</p>
          <p className="text-[10px] font-black text-amber-700 uppercase tracking-wide mt-0.5">{b.label}</p>
          <p className="text-[11px] font-bold text-slate-700 truncate max-w-[90px] mx-auto">{b.vehicle}</p>
          <p className="text-[10px] text-amber-600 font-semibold">{b.value}</p>
        </div>
      ))}
    </div>
  );
}

// ── Vehicle Card ─────────────────────────────────────────────────────────────

function VehicleCard({ profile: p, color, rank }: { profile: VehicleProfile; color: string; rank: number }) {
  return (
    <div
      className="flex-1 min-w-[150px] rounded-2xl border-2 p-3 space-y-2"
      style={{ borderColor: color + '40', backgroundColor: color + '08' }}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5">
        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
        <p className="text-xs font-black text-slate-700 truncate leading-tight">{p.name}</p>
      </div>
      {rank === 1 && (
        <span className="inline-block text-[9px] font-black bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">
          #1 Spend
        </span>
      )}

      {/* Stats */}
      <div className="space-y-1.5">
        <StatRow label="Total spent"  value={`$${p.totalSpent.toFixed(2)}`}  bold />
        <StatRow label="Fill-Ups"     value={String(p.fillupCount)} />
        <StatRow label="Total gal"    value={`${p.totalGallons} gal`} />
        <StatRow label="Avg $/gal"    value={`$${p.avgPrice.toFixed(2)}`} />
        {p.avgMpg != null && (
          <StatRow label="Avg MPG"    value={`${p.avgMpg} mpg`}    green />
        )}
        {p.bestMpg != null && (
          <StatRow label="Best MPG"   value={`${p.bestMpg} mpg`}   small />
        )}
        {p.costPerMile != null && (
          <StatRow label="Cost/mile"  value={`$${p.costPerMile.toFixed(3)}`} />
        )}
        {p.fillsPerMonth != null && (
          <StatRow label="Fills/mo"   value={String(p.fillsPerMonth)} small />
        )}
      </div>
    </div>
  );
}

function StatRow({ label, value, bold, green, small }: {
  label: string; value: string; bold?: boolean; green?: boolean; small?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-1">
      <span className={`text-slate-400 leading-none ${small ? 'text-[9px]' : 'text-[10px]'}`}>{label}</span>
      <span className={[
        'font-bold leading-none',
        small   ? 'text-[10px]' : 'text-xs',
        bold    ? 'text-slate-800' : 'text-slate-600',
        green   ? '!text-green-600' : '',
      ].join(' ')}>{value}</span>
    </div>
  );
}

// ── Single Vehicle Card (when only 1 vehicle) ────────────────────────────────

function SingleVehicleCard({ profile: p, color }: { profile: VehicleProfile; color: string }) {
  return (
    <div className="grid grid-cols-2 gap-2 text-left mt-2">
      {[
        { label: 'Total Spent',   value: `$${p.totalSpent.toFixed(2)}` },
        { label: 'Total Gallons', value: `${p.totalGallons} gal` },
        { label: 'Fill-Ups',      value: String(p.fillupCount) },
        { label: 'Avg $/gal',     value: `$${p.avgPrice.toFixed(2)}` },
        p.avgMpg != null && { label: 'Avg MPG',   value: `${p.avgMpg} mpg` },
        p.costPerMile != null && { label: 'Cost/mile', value: `$${p.costPerMile.toFixed(3)}/mi` },
      ].filter(Boolean).map((s) => {
        const stat = s as { label: string; value: string };
        return (
          <div key={stat.label} className="bg-slate-50 rounded-xl border border-slate-100 px-3 py-2">
            <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">{stat.label}</p>
            <p className="text-sm font-black mt-0.5" style={{ color }}>{stat.value}</p>
          </div>
        );
      })}
    </div>
  );
}

// ── Compare Bar ──────────────────────────────────────────────────────────────

function CompareBar({
  label,
  profiles,
  colors,
  getValue,
  format,
  lowerIsBetter,
  skipZero = false,
}: {
  label:         string;
  profiles:      VehicleProfile[];
  colors:        string[];
  getValue:      (p: VehicleProfile) => number;
  format:        (v: number) => string;
  lowerIsBetter: boolean;
  skipZero?:     boolean;
}) {
  const values    = profiles.map(getValue);
  const nonZero   = skipZero ? values.filter((v) => v > 0) : values;
  if (nonZero.length === 0) return null;

  const maxVal    = Math.max(...nonZero);
  const minVal    = Math.min(...nonZero);
  const winnerVal = lowerIsBetter ? minVal : maxVal;

  return (
    <div className="space-y-1">
      <p className="text-[10px] text-slate-500 font-bold">{label}</p>
      {profiles.map((p, i) => {
        const val     = getValue(p);
        const isWinner = val === winnerVal && (!skipZero || val > 0);
        const barPct  = maxVal > 0 ? (val / maxVal) * 100 : 0;
        const display = skipZero && val === 0 ? 'N/A' : format(val);

        return (
          <div key={p.name} className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 w-[90px] truncate flex-shrink-0">{p.name}</span>
            <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
              {val > 0 && (
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${barPct}%`, backgroundColor: colors[i % colors.length] }}
                />
              )}
            </div>
            <span className={`text-[10px] font-bold w-[56px] text-right flex-shrink-0 ${isWinner ? 'text-green-600' : 'text-slate-600'}`}>
              {display}
              {isWinner && ' ✓'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
