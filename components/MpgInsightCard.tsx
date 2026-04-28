'use client';

/**
 * MpgInsightCard — at-a-glance MPG summary for the main screen.
 *
 * Shows: avg MPG (hero), trend vs. prior fills, best single fill-up,
 * and odometer tracking coverage. Taps through to the Charts tab.
 *
 * Only renders when the user has at least one calculable MPG value
 * (i.e., two consecutive fillups with odometer readings).
 */

import { useState, useEffect, useCallback } from 'react';
import { useSession }                        from 'next-auth/react';

interface Fillup {
  id:             string;
  date:           string;
  vehicleName:    string;
  gallonsPumped:  number;
  odometerReading?: number;
}

interface ApiResponse {
  fillups: Fillup[];
  mpgMap:  Record<string, number | null>;
  stats: {
    avgMpg:       number | null;
    count:        number;
    totalSpent:   number;
    totalGallons: number;
  };
}

interface Trend {
  delta:     number;   // positive = improving
  direction: 'up' | 'down' | 'flat';
  fills:     number;   // number of fills each half is based on
}

/** Compare the most-recent N fills against the prior N fills. */
function computeTrend(fillups: Fillup[], mpgMap: Record<string, number | null>): Trend | null {
  const withMpg = fillups
    .filter((f) => mpgMap[f.id] != null)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Need at least 4 data points to split into meaningful halves
  if (withMpg.length < 4) return null;

  const half   = Math.floor(withMpg.length / 2);
  const recent = withMpg.slice(-half);
  const prior  = withMpg.slice(withMpg.length - half * 2, withMpg.length - half);

  const avg = (arr: Fillup[]) =>
    arr.reduce((s, f) => s + (mpgMap[f.id] as number), 0) / arr.length;

  const recentAvg = avg(recent);
  const priorAvg  = avg(prior);
  const delta     = Math.round((recentAvg - priorAvg) * 10) / 10;

  return {
    delta,
    direction: delta > 0.2 ? 'up' : delta < -0.2 ? 'down' : 'flat',
    fills:     half,
  };
}

/** Tiny inline sparkline — last N MPG readings as an SVG polyline. */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;

  const W = 72, H = 28, PAD = 2;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const coords = points.map((v, i) => {
    const x = PAD + (i / (points.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((v - min) / range) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <polyline
        points={coords.join(' ')}
        fill="none"
        stroke="#f59e0b"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.8"
      />
      {/* Final dot */}
      {(() => {
        const last = coords[coords.length - 1].split(',');
        return (
          <circle
            cx={last[0]} cy={last[1]} r="2.5"
            fill="#f59e0b"
          />
        );
      })()}
    </svg>
  );
}

export default function MpgInsightCard() {
  const { data: session } = useSession();
  const [data,    setData]    = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/fillups');
      if (res.ok) setData(await res.json() as ApiResponse);
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  // Refresh whenever a new fill-up is saved
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('fillup-saved', handler);
    return () => window.removeEventListener('fillup-saved', handler);
  }, [load]);

  function goToCharts() {
    // Card lives inside the Charts tab — just scroll down to the full chart
    document.getElementById('tabpanel-charts')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Gates
  if (!session || loading || !data || data.stats.avgMpg === null) return null;

  const { fillups, mpgMap, stats } = data;

  const mpgValues    = Object.values(mpgMap).filter((v): v is number => v !== null);
  const bestMpg      = mpgValues.length > 0 ? Math.max(...mpgValues) : null;
  const fillsWithData = mpgValues.length;
  const trend        = computeTrend(fillups, mpgMap);

  // Sparkline: last 8 MPG readings in chronological order
  const sparkPoints = fillups
    .filter((f) => mpgMap[f.id] != null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-8)
    .map((f) => mpgMap[f.id] as number);

  const trendColor =
    trend?.direction === 'up'   ? 'text-green-500' :
    trend?.direction === 'down' ? 'text-red-400'   : 'text-slate-400';

  const trendIcon =
    trend?.direction === 'up'   ? '↑' :
    trend?.direction === 'down' ? '↓' : '→';

  const coveragePct = stats.count > 0
    ? Math.round((fillsWithData / stats.count) * 100)
    : 0;

  return (
    <section className="px-4 pb-4 max-w-lg mx-auto w-full">
      <button
        onClick={goToCharts}
        className="w-full text-left rounded-2xl overflow-hidden shadow-sm
                   border border-slate-100 hover:border-amber-200
                   transition-colors group focus:outline-none
                   focus-visible:ring-2 focus-visible:ring-amber-400"
        aria-label="View MPG charts"
      >
        {/* ── Header strip ── */}
        <div className="bg-navy-700 px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm" aria-hidden="true">⛽</span>
            <p className="text-xs font-black text-white uppercase tracking-wider">
              MPG Insights
            </p>
          </div>
          <span className="text-[10px] text-white/40 group-hover:text-white/60 transition-colors">
            See full chart ↓
          </span>
        </div>

        {/* ── Body ── */}
        <div className="bg-white px-4 py-4">
          <div className="flex items-center gap-4">

            {/* Hero: avg MPG + sparkline */}
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-0.5">
                Avg MPG
              </p>
              <div className="flex items-baseline gap-1.5 flex-wrap">
                <span className="text-3xl font-black text-amber-500 leading-none">
                  {stats.avgMpg}
                </span>
                <span className="text-xs text-slate-400 font-semibold">mpg</span>

                {trend && trend.direction !== 'flat' && (
                  <span className={`text-sm font-black ${trendColor}`}>
                    {trendIcon} {Math.abs(trend.delta)}
                  </span>
                )}
              </div>

              {trend ? (
                <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">
                  {trend.direction === 'flat'
                    ? `Steady vs. prior ${trend.fills} fills`
                    : `vs. prior ${trend.fills} fills`}
                </p>
              ) : (
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Log more fills with odometer to see trend
                </p>
              )}
            </div>

            {/* Sparkline */}
            {sparkPoints.length >= 2 && (
              <div className="flex-shrink-0 opacity-90">
                <Sparkline points={sparkPoints} />
              </div>
            )}

            {/* Divider */}
            <div className="w-px self-stretch bg-slate-100 flex-shrink-0" />

            {/* Right column: best + coverage */}
            <div className="flex-shrink-0 space-y-2.5">
              {bestMpg && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                    Best Fill
                  </p>
                  <div className="flex items-baseline gap-0.5">
                    <span className="text-lg font-black text-slate-700">
                      {bestMpg.toFixed(1)}
                    </span>
                    <span className="text-[10px] text-slate-400 font-semibold ml-0.5">mpg</span>
                  </div>
                </div>
              )}

              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                  Tracked
                </p>
                <div className="flex items-baseline gap-0.5">
                  <span className="text-lg font-black text-slate-700">{coveragePct}%</span>
                </div>
                <p className="text-[9px] text-slate-400">
                  {fillsWithData}/{stats.count} fills
                </p>
              </div>
            </div>
          </div>

          {/* Nudge when coverage is low */}
          {coveragePct < 60 && stats.count >= 3 && (
            <p className="text-[10px] text-amber-600 bg-amber-50 rounded-lg px-2.5 py-1.5 mt-3 leading-relaxed">
              💡 Add your <strong>odometer reading</strong> each fill-up to improve MPG accuracy
            </p>
          )}
        </div>
      </button>
    </section>
  );
}
