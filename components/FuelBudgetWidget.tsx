'use client';

/**
 * FuelBudgetWidget
 *
 * Shows three things for logged-in Pro/Fleet users:
 *   1. Monthly fuel budget ring + current month spend
 *   2. All-time stats summary (total fill-ups, gallons, dollars)
 *   3. A nudge to set a budget / upgrade if neither is available
 *
 * Fetches from two endpoints on mount:
 *   GET /api/user/profile  → monthlyFuelBudget
 *   GET /api/fillups        → stats (totalSpent, totalGallons, fillups array)
 */

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';

interface ProfileData {
  monthlyFuelBudget: number | null;
}

interface FillupStats {
  totalSpent:   number;
  totalGallons: number;
  avgMpg:       number | null;
  fillupCount:  number;
}

interface FillupEntry {
  date: string;        // ISO string or YYYY-MM-DD
  totalCost: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Returns YYYY-MM for the current month */
function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Clamp a value between 0–100 for the SVG arc */
function clamp(v: number) { return Math.max(0, Math.min(100, v)); }

/** SVG arc path for a percentage of a circle */
function arcPath(pct: number, r = 38, cx = 44, cy = 44) {
  const angle = (pct / 100) * 2 * Math.PI - Math.PI / 2;
  const x = cx + r * Math.cos(angle);
  const y = cy + r * Math.sin(angle);
  const large = pct > 50 ? 1 : 0;
  const start = { x: cx, y: cy - r };
  if (pct >= 100) {
    // Full circle — use two arcs to avoid degenerate SVG path
    return `M ${start.x} ${start.y} A ${r} ${r} 0 1 1 ${start.x - 0.01} ${start.y}`;
  }
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${x} ${y}`;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function FuelBudgetWidget() {
  const { data: session }  = useSession();
  const plan               = (session?.user as { plan?: string })?.plan ?? 'free';
  const isPro              = plan === 'pro' || plan === 'fleet';
  const isProTrial         = (session?.user as { isProTrial?: boolean })?.isProTrial ?? false;
  const showFull           = isPro || isProTrial;

  const [budget,    setBudget]    = useState<number | null>(null);
  const [stats,     setStats]     = useState<FillupStats | null>(null);
  const [monthSpend, setMonthSpend] = useState<number>(0);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    if (!session) return;

    const monthKey = currentMonthKey();

    Promise.all([
      fetch('/api/user/profile').then(r => r.json()) as Promise<ProfileData>,
      fetch('/api/fillups').then(r => r.json()) as Promise<{ stats: FillupStats; fillups: FillupEntry[] }>,
    ]).then(([profile, fillupData]) => {
      setBudget(profile.monthlyFuelBudget ?? null);
      setStats(fillupData.stats ?? null);

      // Current-month spend
      const thisMonth = (fillupData.fillups ?? [])
        .filter((f) => (f.date ?? '').startsWith(monthKey))
        .reduce((acc, f) => acc + (f.totalCost ?? 0), 0);
      setMonthSpend(Math.round(thisMonth * 100) / 100);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [session]);

  if (!session || loading) return null;
  // Hide the widget entirely if there's no data at all and not a Pro user
  if (!showFull && (!stats || stats.fillupCount === 0)) return null;

  const hasBudget = budget !== null && budget > 0;
  const pct       = hasBudget ? clamp((monthSpend / budget) * 100) : 0;
  const over      = hasBudget && monthSpend > budget;
  const monthName = new Date().toLocaleString('default', { month: 'long' });

  // Colour theme based on budget usage
  const ringColor =
    !hasBudget           ? '#1EB68F'    // teal default
    : pct >= 100         ? '#EF4444'    // red — over budget
    : pct >= 80          ? '#F97316'    // orange — close
    : '#1EB68F';                        // teal — safe

  return (
    <section className="px-4 lg:px-0 pb-3 max-w-lg lg:max-w-none mx-auto w-full">
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100
                      dark:border-slate-700 shadow-sm overflow-hidden">

        {/* ── Header ── */}
        <div className="px-4 pt-4 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base" aria-hidden="true">📊</span>
            <h2 className="text-sm font-black text-slate-700 dark:text-slate-200">
              Your Fuel Summary
            </h2>
          </div>
          {showFull && (
            <a href="/settings?tab=preferences"
               className="text-[10px] font-semibold text-brand-teal hover:text-brand-dark transition-colors">
              {hasBudget ? 'Edit budget →' : 'Set budget →'}
            </a>
          )}
        </div>

        <div className="px-4 pb-4">

          {/* ── Budget ring + month stats ── */}
          {showFull && (
            <div className="flex items-center gap-4 mb-4">
              {/* SVG ring */}
              <div className="relative flex-shrink-0 w-[88px] h-[88px]">
                <svg viewBox="0 0 88 88" className="w-full h-full -rotate-90">
                  {/* Track */}
                  <circle cx="44" cy="44" r="38" fill="none"
                          stroke="#E2E8F0" strokeWidth="8" />
                  {/* Progress */}
                  {hasBudget && (
                    <path
                      d={arcPath(pct)}
                      fill="none"
                      stroke={ringColor}
                      strokeWidth="8"
                      strokeLinecap="round"
                    />
                  )}
                  {/* No-budget placeholder arc */}
                  {!hasBudget && (
                    <circle cx="44" cy="44" r="38" fill="none"
                            stroke="#1EB68F" strokeWidth="8"
                            strokeDasharray="4 8" strokeLinecap="round" />
                  )}
                </svg>
                {/* Centre label */}
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  {hasBudget ? (
                    <>
                      <span className="text-[11px] font-black leading-none"
                            style={{ color: ringColor }}>
                        {Math.round(pct)}%
                      </span>
                      <span className="text-[9px] text-slate-400 leading-none mt-0.5">used</span>
                    </>
                  ) : (
                    <span className="text-[10px] text-slate-400 font-semibold text-center leading-tight px-2">
                      No budget set
                    </span>
                  )}
                </div>
              </div>

              {/* Month spend breakdown */}
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-400 mb-1">{monthName} spend</p>
                <p className="text-2xl font-black text-slate-800 dark:text-slate-100 leading-none">
                  ${monthSpend.toFixed(2)}
                </p>
                {hasBudget && (
                  <p className={`text-[11px] font-semibold mt-1 ${over ? 'text-red-500' : 'text-slate-400'}`}>
                    {over
                      ? `$${(monthSpend - budget).toFixed(2)} over budget`
                      : `$${(budget - monthSpend).toFixed(2)} remaining`}
                  </p>
                )}
                {!hasBudget && (
                  <a href="/settings?tab=preferences"
                     className="inline-block mt-1 text-[11px] font-bold text-brand-teal hover:text-brand-dark transition-colors">
                    + Set a monthly budget
                  </a>
                )}
              </div>
            </div>
          )}

          {/* ── All-time stats row ── */}
          {stats && stats.fillupCount > 0 ? (
            <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-100 dark:border-slate-700">
              <div className="text-center">
                <p className="text-base font-black text-slate-800 dark:text-slate-100">
                  {stats.fillupCount}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">fill-ups logged</p>
              </div>
              <div className="text-center border-x border-slate-100 dark:border-slate-700">
                <p className="text-base font-black text-slate-800 dark:text-slate-100">
                  {stats.totalGallons.toFixed(0)} <span className="text-xs font-semibold text-slate-400">gal</span>
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">total pumped</p>
              </div>
              <div className="text-center">
                <p className="text-base font-black text-slate-800 dark:text-slate-100">
                  ${stats.totalSpent.toFixed(0)}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">total spent</p>
              </div>
            </div>
          ) : (
            /* No fill-ups yet */
            <div className="flex items-center gap-3 pt-3 border-t border-slate-100 dark:border-slate-700">
              <span className="text-xl" aria-hidden="true">📋</span>
              <div>
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  No fill-ups logged yet
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Log your first fill-up to start tracking spend &amp; MPG.
                </p>
              </div>
            </div>
          )}

          {/* ── Free-user upsell (only shown if no full access) ── */}
          {!showFull && stats && stats.fillupCount > 0 && (
            <a href="/upgrade"
               className="mt-3 flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20
                          border border-amber-200 dark:border-amber-800
                          rounded-xl px-3 py-2.5 hover:border-amber-300 transition-colors">
              <span className="text-base flex-shrink-0" aria-hidden="true">⭐</span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-black text-amber-800 dark:text-amber-300 leading-tight">
                  Unlock fuel budget tracking
                </p>
                <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                  Set monthly spending goals and get alerts — Pro from $4.99/mo
                </p>
              </div>
              <svg viewBox="0 0 12 12" className="w-3 h-3 flex-shrink-0 text-amber-500"
                   fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M2 6h8M6 2l4 4-4 4"/>
              </svg>
            </a>
          )}

        </div>
      </div>
    </section>
  );
}
