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

interface PricePoint {
  date:    string;   // YYYY-MM-DD
  label:   string;   // "Mar 5"
  price:   number;   // $/gal
  vehicle: string;
}

// ── SVG chart constants ──────────────────────────────────────────────────────
const W   = 320;
const H   = 130;
const PAD = { top: 16, right: 16, bottom: 28, left: 44 };
const IW  = W - PAD.left - PAD.right;
const IH  = H - PAD.top  - PAD.bottom;

function buildSmoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return '';
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const cpX  = (prev.x + curr.x) / 2;
    d += ` C${cpX.toFixed(1)},${prev.y.toFixed(1)} ${cpX.toFixed(1)},${curr.y.toFixed(1)} ${curr.x.toFixed(1)},${curr.y.toFixed(1)}`;
  }
  return d;
}

export default function FuelPriceHistory() {
  const { data: session, status } = useSession();
  const [data,      setData]      = useState<HistoryResponse | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [open,      setOpen]      = useState(false);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

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

  useEffect(() => {
    const handler = () => load();
    window.addEventListener('fillup-saved', handler);
    return () => window.removeEventListener('fillup-saved', handler);
  }, [load]);

  if (status === 'loading' || !session) return null;

  // ── Build data points (oldest → newest) ───────────────────────────────────
  const points: PricePoint[] = [];
  if (data?.fillups?.length) {
    const sorted = [...data.fillups].sort((a, b) => a.date.localeCompare(b.date));
    for (const f of sorted) {
      const d = new Date(f.date + 'T12:00:00');
      points.push({
        date:    f.date,
        label:   d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        price:   f.pricePerGallon,
        vehicle: f.vehicleName,
      });
    }
  }

  const hasData    = points.length >= 2;
  const latestPrice = points.length > 0 ? points[points.length - 1].price : null;
  const minPrice   = hasData ? Math.min(...points.map((p) => p.price)) : 0;
  const maxPrice   = hasData ? Math.max(...points.map((p) => p.price)) : 5;
  const avgPrice   = hasData
    ? Math.round((points.reduce((s, p) => s + p.price, 0) / points.length) * 100) / 100
    : null;

  // Padding for Y axis so the line doesn't hit the edges
  const yPad   = (maxPrice - minPrice) * 0.1 || 0.2;
  const yMin   = Math.max(0, minPrice - yPad);
  const yMax   = maxPrice + yPad;
  const rangeY = yMax - yMin || 1;

  function toSvg(i: number, price: number) {
    const x = PAD.left + (points.length > 1 ? (i / (points.length - 1)) * IW : IW / 2);
    const y = PAD.top  + IH - ((price - yMin) / rangeY) * IH;
    return { x, y };
  }

  const svgPts   = points.map((p, i) => toSvg(i, p.price));
  const linePath = buildSmoothPath(svgPts);
  const areaPath = hasData
    ? linePath + ` L${svgPts[svgPts.length - 1].x.toFixed(1)},${(PAD.top + IH).toFixed(1)} L${svgPts[0].x.toFixed(1)},${(PAD.top + IH).toFixed(1)} Z`
    : '';

  // Y-axis ticks
  const ticks = hasData ? [yMin, (yMin + yMax) / 2, yMax].map((v) => Math.round(v * 100) / 100) : [2, 3, 4];

  // Color: blue gradient (price chart aesthetic)
  const lineColor = '#3b82f6';
  const areaColor = '#3b82f6';

  return (
    <div className="mt-4">
      {/* Toggle header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between py-3 px-4 bg-white rounded-2xl
                   border border-slate-100 shadow-sm hover:border-amber-200 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-lg">💰</span>
          <div className="text-left">
            <p className="text-sm font-black text-slate-700">Price History</p>
            {avgPrice != null
              ? <p className="text-[10px] text-slate-400">Avg ${avgPrice}/gal · {points.length} fill-up{points.length !== 1 ? 's' : ''}</p>
              : <p className="text-[10px] text-slate-400">Log fill-ups to track price trends</p>
            }
          </div>
        </div>
        <div className="flex items-center gap-3">
          {latestPrice != null && (
            <span className="text-sm font-black text-blue-600">${latestPrice.toFixed(3)}</span>
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
        <div className="mt-2 bg-white rounded-2xl border border-slate-100 shadow-sm p-4">

          {loading && (
            <p className="text-xs text-slate-400 text-center py-6">Loading…</p>
          )}

          {!loading && !hasData && (
            <div className="text-center py-6">
              <p className="text-3xl mb-2">💲</p>
              <p className="text-sm font-bold text-slate-600">Not enough data yet</p>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed max-w-[220px] mx-auto">
                Log at least 2 fill-ups to see your personal gas price trend.
              </p>
            </div>
          )}

          {!loading && hasData && (
            <>
              {/* Stat pills */}
              <div className="flex gap-2 mb-4">
                <StatPill label="Latest"  value={`$${latestPrice!.toFixed(3)}`} color="text-blue-600" />
                <StatPill label="Average" value={`$${avgPrice}/gal`}             color="text-amber-600" />
                <StatPill label="Lowest"  value={`$${minPrice.toFixed(3)}`}      color="text-green-600" />
              </div>

              {/* SVG Line Chart */}
              <div className="relative w-full overflow-hidden" onMouseLeave={() => setActiveIdx(null)}>
                <svg
                  viewBox={`0 0 ${W} ${H}`}
                  className="w-full"
                  style={{ touchAction: 'none' }}
                  onMouseMove={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const svgX = ((e.clientX - rect.left) / rect.width) * W;
                    let nearest = 0, minDist = Infinity;
                    svgPts.forEach((p, i) => {
                      const d = Math.abs(p.x - svgX);
                      if (d < minDist) { minDist = d; nearest = i; }
                    });
                    setActiveIdx(nearest);
                  }}
                >
                  <defs>
                    <linearGradient id="price-area" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor={areaColor} stopOpacity="0.15" />
                      <stop offset="100%" stopColor={areaColor} stopOpacity="0.01" />
                    </linearGradient>
                  </defs>

                  {/* Y-axis ticks + grid */}
                  {ticks.map((t) => {
                    const y = PAD.top + IH - ((t - yMin) / rangeY) * IH;
                    return (
                      <g key={t}>
                        <line
                          x1={PAD.left} y1={y.toFixed(1)}
                          x2={PAD.left + IW} y2={y.toFixed(1)}
                          stroke="#f1f5f9" strokeWidth="1"
                        />
                        <text
                          x={PAD.left - 6} y={y.toFixed(1)}
                          fontSize="8" fill="#94a3b8"
                          textAnchor="end" dominantBaseline="middle"
                        >
                          ${t.toFixed(2)}
                        </text>
                      </g>
                    );
                  })}

                  {/* Y-axis label */}
                  <text
                    x="7" y={(PAD.top + IH / 2).toFixed(1)}
                    fontSize="7" fill="#94a3b8"
                    textAnchor="middle"
                    transform={`rotate(-90, 7, ${PAD.top + IH / 2})`}
                  >
                    $/gal
                  </text>

                  {/* Area */}
                  <path d={areaPath} fill="url(#price-area)" />

                  {/* Line */}
                  <path
                    d={linePath}
                    fill="none"
                    stroke={lineColor}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />

                  {/* Dots */}
                  {svgPts.map((p, i) => (
                    <circle
                      key={i}
                      cx={p.x.toFixed(1)} cy={p.y.toFixed(1)}
                      r={activeIdx === i ? 5 : 3.5}
                      fill={activeIdx === i ? '#1d4ed8' : lineColor}
                      stroke="white" strokeWidth="2"
                      style={{ transition: 'r 0.1s' }}
                    />
                  ))}

                  {/* X-axis labels */}
                  {[0, Math.floor((points.length - 1) / 2), points.length - 1]
                    .filter((i, idx, arr) => arr.indexOf(i) === idx)
                    .map((i) => (
                      <text
                        key={i}
                        x={svgPts[i].x.toFixed(1)}
                        y={(PAD.top + IH + 16).toFixed(1)}
                        fontSize="8" fill="#94a3b8"
                        textAnchor="middle"
                      >
                        {points[i].label}
                      </text>
                    ))
                  }

                  {/* Tooltip */}
                  {activeIdx != null && (() => {
                    const p   = svgPts[activeIdx];
                    const tip = points[activeIdx];
                    const bW  = 76;
                    const bH  = 28;
                    const bX  = Math.min(Math.max(p.x - bW / 2, PAD.left), PAD.left + IW - bW);
                    const bY  = Math.max(PAD.top - 4, p.y - bH - 8);
                    return (
                      <>
                        <line
                          x1={p.x.toFixed(1)} y1={PAD.top.toString()}
                          x2={p.x.toFixed(1)} y2={(PAD.top + IH).toFixed(1)}
                          stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3 2"
                        />
                        <g>
                          <rect x={bX} y={bY} width={bW} height={bH} rx="5" fill="#1e3a5f" opacity="0.92" />
                          <text x={(bX + bW / 2).toFixed(1)} y={(bY + 11).toFixed(1)}
                            fontSize="9" fill="white" textAnchor="middle" fontWeight="700">
                            ${tip.price.toFixed(3)}/gal
                          </text>
                          <text x={(bX + bW / 2).toFixed(1)} y={(bY + 21).toFixed(1)}
                            fontSize="7.5" fill="#93c5fd" textAnchor="middle">
                            {tip.label} · {tip.vehicle}
                          </text>
                        </g>
                      </>
                    );
                  })()}
                </svg>
              </div>

              {maxPrice > minPrice && (
                <p className="text-[10px] text-center text-slate-400 mt-1">
                  Price range: <span className="font-bold text-green-600">${minPrice.toFixed(3)}</span>
                  {' '}→{' '}
                  <span className="font-bold text-red-500">${maxPrice.toFixed(3)}</span>
                  {' '}(${(maxPrice - minPrice).toFixed(3)} spread)
                </p>
              )}

              <p className="text-[9px] text-slate-300 text-center mt-1">
                Hover over a point to see details · Based on your logged fill-up prices
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
    <div className="flex-1 bg-slate-50 rounded-xl border border-slate-100 px-2 py-2 text-center">
      <p className={`text-sm font-black ${color}`}>{value}</p>
      <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide mt-0.5">{label}</p>
    </div>
  );
}
