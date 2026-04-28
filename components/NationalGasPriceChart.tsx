'use client';

import { useSession }  from 'next-auth/react';
import { useEffect, useState, useCallback } from 'react';
import type { PriceWeek } from '@/app/api/gas-price/history/route';
import Link from 'next/link';

// ── SVG constants ─────────────────────────────────────────────────────────────
const W   = 320;
const H   = 140;
const PAD = { top: 20, right: 16, bottom: 30, left: 44 };
const IW  = W - PAD.left - PAD.right;
const IH  = H - PAD.top  - PAD.bottom;

function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return '';
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const cx = (prev.x + curr.x) / 2;
    d += ` C${cx.toFixed(1)},${prev.y.toFixed(1)} ${cx.toFixed(1)},${curr.y.toFixed(1)} ${curr.x.toFixed(1)},${curr.y.toFixed(1)}`;
  }
  return d;
}

interface FillupPricePoint { date: string; price: number; }

export default function NationalGasPriceChart() {
  const { data: session } = useSession();
  const userPlan = (session?.user as { plan?: string })?.plan ?? 'free';
  const isPro    = userPlan === 'pro' || userPlan === 'fleet';

  const [weeks,      setWeeks]      = useState<52 | 104>(52);
  const [national,   setNational]   = useState<PriceWeek[]>([]);
  const [myPrices,   setMyPrices]   = useState<FillupPricePoint[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [activeIdx,  setActiveIdx]  = useState<number | null>(null);
  const [open,       setOpen]       = useState(false);

  const loadNational = useCallback(async (w: 52 | 104) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/gas-price/history?weeks=${w}`);
      if (res.ok) {
        const d = await res.json() as { data: PriceWeek[] };
        setNational(d.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMyPrices = useCallback(async () => {
    if (!session || !isPro) return;
    try {
      const res = await fetch('/api/fillups');
      if (!res.ok) return;
      const d = await res.json() as { fillups: { date: string; pricePerGallon: number }[] };
      setMyPrices(
        (d.fillups ?? [])
          .filter((f) => f.pricePerGallon > 0)
          .map((f) => ({ date: f.date, price: f.pricePerGallon }))
          .sort((a, b) => a.date.localeCompare(b.date))
      );
    } catch { /* silent */ }
  }, [session, isPro]);

  useEffect(() => {
    if (open) {
      loadNational(weeks);
      loadMyPrices();
    }
  }, [open, weeks, loadNational, loadMyPrices]);

  // ── Derived stats ────────────────────────────────────────────────────────────
  const hasData   = national.length >= 4;
  const latest    = hasData ? national[national.length - 1] : null;
  const yearAgo   = hasData && national.length >= 52 ? national[national.length - 52] : null;
  const minPrice  = hasData ? Math.min(...national.map((p) => p.price)) : 0;
  const maxPrice  = hasData ? Math.max(...national.map((p) => p.price)) : 5;
  const avgPrice  = hasData
    ? Math.round((national.reduce((s, p) => s + p.price, 0) / national.length) * 1000) / 1000
    : null;
  const vsYearAgo = latest && yearAgo
    ? Math.round((latest.price - yearAgo.price) * 1000) / 1000
    : null;

  // ── SVG helpers ──────────────────────────────────────────────────────────────
  const yPad  = (maxPrice - minPrice) * 0.12 || 0.3;
  const yMin  = Math.max(0, minPrice - yPad);
  const yMax  = maxPrice + yPad;
  const rangeY = yMax - yMin || 1;

  function toSvg(i: number, price: number, total: number) {
    const x = PAD.left + (total > 1 ? (i / (total - 1)) * IW : IW / 2);
    const y = PAD.top  + IH - ((price - yMin) / rangeY) * IH;
    return { x, y };
  }

  const natPts   = national.map((p, i) => toSvg(i, p.price, national.length));
  const linePath = smoothPath(natPts);
  const areaPath = hasData
    ? linePath +
      ` L${natPts[natPts.length - 1].x.toFixed(1)},${(PAD.top + IH).toFixed(1)}` +
      ` L${natPts[0].x.toFixed(1)},${(PAD.top + IH).toFixed(1)} Z`
    : '';

  // Map my-price points onto the same time axis
  const myPtsSvg: { x: number; y: number; date: string; price: number }[] = [];
  if (isPro && myPrices.length > 0 && national.length > 0) {
    const firstDate = new Date(national[0].period).getTime();
    const lastDate  = new Date(national[national.length - 1].period).getTime();
    const span      = lastDate - firstDate || 1;
    for (const mp of myPrices) {
      const t = new Date(mp.date + 'T12:00:00').getTime();
      if (t < firstDate || t > lastDate) continue;
      const xFrac = (t - firstDate) / span;
      const x     = PAD.left + xFrac * IW;
      const y     = PAD.top  + IH - ((mp.price - yMin) / rangeY) * IH;
      myPtsSvg.push({ x, y, date: mp.date, price: mp.price });
    }
  }

  const ticks = hasData
    ? [yMin, (yMin + yMax) / 2, yMax].map((v) => Math.round(v * 100) / 100)
    : [2.50, 3.50, 4.50];

  // X-axis label helpers
  function xLabel(i: number): string {
    const d = new Date(national[i].period + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }

  const xLabelIdxs = hasData
    ? [0, Math.floor(national.length / 2), national.length - 1]
    : [];

  return (
    <div className="mt-4 rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between py-2.5 px-4 bg-navy-700
                   hover:bg-navy-800 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm" aria-hidden="true">🇺🇸</span>
          <div className="text-left">
            <p className="text-xs font-black text-white uppercase tracking-wider">National Gas Price Trend</p>
            {latest
              ? <p className="text-[10px] text-white/50">
                  US avg ${latest.price.toFixed(3)}/gal
                  {vsYearAgo != null && (
                    <span className={vsYearAgo > 0 ? ' text-red-300' : ' text-green-300'}>
                      {' '}{vsYearAgo > 0 ? '▲' : '▼'} ${Math.abs(vsYearAgo).toFixed(3)} vs last year
                    </span>
                  )}
                </p>
              : <p className="text-[10px] text-white/50">Weekly EIA national averages</p>
            }
          </div>
        </div>
        <div className="flex items-center gap-2">
          {latest && (
            <span className="text-xs font-black text-white/80">
              ${latest.price.toFixed(3)}
            </span>
          )}
          <svg
            className={`w-4 h-4 text-white/60 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100 bg-white p-4 space-y-3">

          {/* Time range toggle */}
          <div className="flex gap-1.5 bg-slate-100 rounded-xl p-1">
            {([52, 104] as const).map((w) => (
              <button
                key={w}
                onClick={() => setWeeks(w)}
                className={[
                  'flex-1 py-1.5 rounded-lg text-xs font-bold transition-all',
                  weeks === w ? 'bg-white shadow-sm text-amber-600' : 'text-slate-500',
                ].join(' ')}
              >
                {w === 52 ? '1 Year' : '2 Years'}
              </button>
            ))}
          </div>

          {loading && (
            <div className="py-8 text-center">
              <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          )}

          {!loading && !hasData && (
            <div className="py-6 text-center">
              <p className="text-2xl mb-2">📡</p>
              <p className="text-sm font-bold text-slate-600">Could not load price data</p>
              <p className="text-xs text-slate-400 mt-1">Check your EIA_API_KEY environment variable.</p>
            </div>
          )}

          {!loading && hasData && (
            <>
              {/* Stats row */}
              <div className="grid grid-cols-4 gap-2">
                <StatPill label="Now"     value={`$${latest!.price.toFixed(3)}`}  color="text-slate-700" />
                <StatPill label="Average" value={`$${avgPrice!.toFixed(3)}`}       color="text-blue-600"  />
                <StatPill label="Low"     value={`$${minPrice.toFixed(3)}`}        color="text-green-600" />
                <StatPill label="High"    value={`$${maxPrice.toFixed(3)}`}        color="text-red-500"   />
              </div>

              {/* SVG chart */}
              <div
                className="relative w-full overflow-hidden"
                onMouseLeave={() => setActiveIdx(null)}
              >
                <svg
                  viewBox={`0 0 ${W} ${H}`}
                  className="w-full"
                  style={{ touchAction: 'none' }}
                  onMouseMove={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const svgX = ((e.clientX - rect.left) / rect.width) * W;
                    let nearest = 0, minDist = Infinity;
                    natPts.forEach((p, i) => {
                      const d = Math.abs(p.x - svgX);
                      if (d < minDist) { minDist = d; nearest = i; }
                    });
                    setActiveIdx(nearest);
                  }}
                >
                  <defs>
                    <linearGradient id="nat-area-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="#3b82f6" stopOpacity="0.18" />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.01" />
                    </linearGradient>
                  </defs>

                  {/* Grid + Y ticks */}
                  {ticks.map((t) => {
                    const y = PAD.top + IH - ((t - yMin) / rangeY) * IH;
                    return (
                      <g key={t}>
                        <line x1={PAD.left} y1={y} x2={PAD.left + IW} y2={y} stroke="#f1f5f9" strokeWidth="1" />
                        <text x={PAD.left - 5} y={y} fontSize="8" fill="#94a3b8" textAnchor="end" dominantBaseline="middle">
                          ${t.toFixed(2)}
                        </text>
                      </g>
                    );
                  })}

                  {/* Y axis label */}
                  <text x="7" y={PAD.top + IH / 2} fontSize="7" fill="#94a3b8" textAnchor="middle"
                    transform={`rotate(-90, 7, ${PAD.top + IH / 2})`}>$/gal</text>

                  {/* Average reference line */}
                  {avgPrice && (() => {
                    const yAvg = PAD.top + IH - ((avgPrice - yMin) / rangeY) * IH;
                    return (
                      <line x1={PAD.left} y1={yAvg} x2={PAD.left + IW} y2={yAvg}
                        stroke="#f59e0b" strokeWidth="1" strokeDasharray="4 3" opacity="0.6" />
                    );
                  })()}

                  {/* National area + line */}
                  <path d={areaPath} fill="url(#nat-area-grad)" />
                  <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth="2.5"
                    strokeLinecap="round" strokeLinejoin="round" />

                  {/* My price dots (Pro only) */}
                  {myPtsSvg.map((p, i) => (
                    <circle key={i} cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r="4"
                      fill="#f59e0b" stroke="white" strokeWidth="1.5" opacity="0.9" />
                  ))}

                  {/* Hover dot on national line */}
                  {activeIdx != null && natPts[activeIdx] && (
                    <circle
                      cx={natPts[activeIdx].x.toFixed(1)} cy={natPts[activeIdx].y.toFixed(1)}
                      r="5" fill="#1d4ed8" stroke="white" strokeWidth="2"
                    />
                  )}

                  {/* X-axis labels */}
                  {xLabelIdxs.map((i) => (
                    <text key={i} x={natPts[i].x.toFixed(1)} y={PAD.top + IH + 18}
                      fontSize="8" fill="#94a3b8" textAnchor="middle">
                      {xLabel(i)}
                    </text>
                  ))}

                  {/* Tooltip */}
                  {activeIdx != null && (() => {
                    const p   = natPts[activeIdx];
                    const tip = national[activeIdx];
                    const bW  = 90;
                    const bH  = 32;
                    const bX  = Math.min(Math.max(p.x - bW / 2, PAD.left), PAD.left + IW - bW);
                    const bY  = Math.max(PAD.top - 4, p.y - bH - 8);
                    const d   = new Date(tip.period + 'T12:00:00');
                    const lbl = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                    return (
                      <>
                        <line x1={p.x} y1={PAD.top} x2={p.x} y2={PAD.top + IH}
                          stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3 2" />
                        <rect x={bX} y={bY} width={bW} height={bH} rx="5" fill="#1e3a5f" opacity="0.93" />
                        <text x={bX + bW / 2} y={bY + 12} fontSize="9.5" fill="white"
                          textAnchor="middle" fontWeight="700">
                          ${tip.price.toFixed(3)}/gal
                        </text>
                        <text x={bX + bW / 2} y={bY + 23} fontSize="7.5" fill="#93c5fd" textAnchor="middle">
                          {lbl} · US avg
                        </text>
                      </>
                    );
                  })()}
                </svg>
              </div>

              {/* Legend */}
              <div className="flex items-center gap-4 justify-center text-[10px] text-slate-400">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-0.5 bg-blue-500 rounded" />
                  <span>National avg (EIA)</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-0.5 bg-amber-400 rounded" style={{ borderTop: '1px dashed #f59e0b' }} />
                  <span>Your avg</span>
                </div>
                {isPro && myPtsSvg.length > 0 && (
                  <div className="flex items-center gap-1">
                    <div className="w-2.5 h-2.5 bg-amber-400 rounded-full border border-white" />
                    <span>Your fill-ups</span>
                  </div>
                )}
              </div>

              {/* Pro upsell if logged in but not pro and has fillups */}
              {session && !isPro && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 flex items-center gap-2.5">
                  <span className="text-base">⭐</span>
                  <div className="flex-1">
                    <p className="text-xs font-black text-amber-800">See how your prices compare</p>
                    <p className="text-[10px] text-amber-700">Upgrade to Pro to overlay your fill-up prices on this chart.</p>
                  </div>
                  <Link href="/#pricing" className="text-[10px] font-black text-amber-600 hover:text-amber-500 whitespace-nowrap">
                    Upgrade →
                  </Link>
                </div>
              )}

              <p className="text-[9px] text-slate-300 text-center">
                Source: U.S. Energy Information Administration (EIA) · Updated weekly
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function StatPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-slate-50 rounded-xl border border-slate-100 px-2 py-2 text-center">
      <p className={`text-xs font-black ${color}`}>{value}</p>
      <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide mt-0.5">{label}</p>
    </div>
  );
}
