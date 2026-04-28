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

interface DataPoint {
  date:  string;   // YYYY-MM-DD
  label: string;   // "Mar 5"
  mpg:   number;
  vehicle: string;
}

// ── SVG chart constants ─────────────────────────────────────────────────────
const W   = 320;
const H   = 140;
const PAD = { top: 16, right: 16, bottom: 28, left: 40 };
const IW  = W - PAD.left - PAD.right;  // inner width
const IH  = H - PAD.top  - PAD.bottom; // inner height

/** Build a smooth cubic-bezier path through the points */
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

export default function MpgChart() {
  const { data: session, status } = useSession();
  const [data,     setData]     = useState<HistoryResponse | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [open,     setOpen]     = useState(false);
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

  // Re-load when new fillup is saved
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('fillup-saved', handler);
    return () => window.removeEventListener('fillup-saved', handler);
  }, [load]);

  if (status === 'loading' || !session) return null;

  // ── Build data points ──────────────────────────────────────────────────────
  const points: DataPoint[] = [];
  if (data) {
    // mpgMap is keyed by fillup id; fillups are newest-first — reverse for chart order
    const sorted = [...(data.fillups ?? [])].reverse();
    for (const f of sorted) {
      const mpg = data.mpgMap[f.id];
      if (mpg != null) {
        const d = new Date(f.date + 'T12:00:00');
        points.push({
          date:    f.date,
          label:   d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          mpg,
          vehicle: f.vehicleName,
        });
      }
    }
  }

  const hasMpg    = points.length >= 2;
  const hasOneMpg = points.length === 1;
  const avgMpg    = data?.stats.avgMpg;
  const latestMpg = points.length > 0 ? points[points.length - 1].mpg : null;

  // ── Chart coordinate helpers ───────────────────────────────────────────────
  const mpgValues = points.map((p) => p.mpg);
  const minMpg    = mpgValues.length > 0 ? Math.floor(Math.min(...mpgValues) * 0.92) : 0;
  const maxMpg    = mpgValues.length > 0 ? Math.ceil(Math.max(...mpgValues)  * 1.08) : 50;
  const rangeY    = maxMpg - minMpg || 1;

  function toSvg(i: number, mpg: number) {
    const x = PAD.left + (points.length > 1 ? (i / (points.length - 1)) * IW : IW / 2);
    const y = PAD.top  + IH - ((mpg - minMpg) / rangeY) * IH;
    return { x, y };
  }

  const svgPts    = points.map((p, i) => toSvg(i, p.mpg));
  const linePath  = buildSmoothPath(svgPts);
  const areaPath  = hasMpg
    ? linePath + ` L${svgPts[svgPts.length - 1].x.toFixed(1)},${(PAD.top + IH).toFixed(1)} L${svgPts[0].x.toFixed(1)},${(PAD.top + IH).toFixed(1)} Z`
    : '';

  // Y-axis tick values: 3 ticks
  const ticks = hasMpg ? [minMpg, Math.round((minMpg + maxMpg) / 2), maxMpg] : [0, 25, 50];

  return (
    <div className="mt-4 rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => { setOpen((v) => !v); }}
        className="w-full flex items-center justify-between py-3 px-4 bg-white
                   hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-lg">📈</span>
          <div className="text-left">
            <p className="text-sm font-black text-slate-700">MPG Trend</p>
            {avgMpg != null
              ? <p className="text-[10px] text-slate-400">Avg {avgMpg} mpg · {points.length} readings</p>
              : <p className="text-[10px] text-slate-400">Add odometer readings to unlock</p>
            }
          </div>
        </div>
        <div className="flex items-center gap-3">
          {latestMpg != null && (
            <span className="text-sm font-black text-green-600">{latestMpg} mpg</span>
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
        <div className="border-t border-slate-100 bg-white p-4">

          {loading && (
            <p className="text-xs text-slate-400 text-center py-6">Loading…</p>
          )}

          {!loading && !hasMpg && (() => {
            const fillupCount  = data?.fillups?.length ?? 0;
            const withOdo      = data?.fillups?.filter((f) => f.odometerReading != null).length ?? 0;
            const needsOdo     = fillupCount > 0 && withOdo === 0;
            const needsMoreOdo = fillupCount > 0 && withOdo === 1;
            return (
              <div className="text-center py-6">
                <p className="text-3xl mb-2">🛣️</p>
                {hasOneMpg ? (
                  <>
                    <p className="text-sm font-bold text-slate-600">Almost there!</p>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed max-w-[240px] mx-auto">
                      Your first MPG reading is <strong>{points[0].mpg} mpg</strong>. Log one more
                      fill-up with an odometer reading to see your trend graph.
                    </p>
                  </>
                ) : needsOdo ? (
                  <>
                    <p className="text-sm font-bold text-slate-600">Add odometer readings</p>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed max-w-[240px] mx-auto">
                      You have <strong>{fillupCount} fill-up{fillupCount !== 1 ? 's' : ''}</strong> logged,
                      but none include an odometer reading.
                      Enter the mileage when logging a fill-up to unlock MPG tracking.
                    </p>
                  </>
                ) : needsMoreOdo ? (
                  <>
                    <p className="text-sm font-bold text-slate-600">One more fill-up needed</p>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed max-w-[240px] mx-auto">
                      You have 1 fill-up with an odometer reading — log <strong>one more</strong> with
                      a mileage reading and your MPG trend will appear here.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-bold text-slate-600">No MPG data yet</p>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed max-w-[220px] mx-auto">
                      Log fill-ups with odometer readings to start tracking fuel efficiency.
                    </p>
                  </>
                )}
              </div>
            );
          })()}

          {!loading && hasMpg && (
            <>
              {/* Stat pills */}
              <div className="flex gap-2 mb-4">
                <StatPill label="Latest"  value={`${latestMpg} mpg`}   color="text-green-600" />
                <StatPill label="Average" value={`${avgMpg} mpg`}       color="text-amber-600" />
                <StatPill label="Readings" value={String(points.length)} color="text-navy-700" />
              </div>

              {/* SVG Line Chart */}
              <div className="relative w-full overflow-hidden" onMouseLeave={() => setActiveIdx(null)}>
                <svg
                  viewBox={`0 0 ${W} ${H}`}
                  className="w-full"
                  style={{ touchAction: 'none' }}
                  onMouseMove={(e) => {
                    if (!hasMpg) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const svgX = ((e.clientX - rect.left) / rect.width) * W;
                    // Find nearest point
                    let nearest = 0;
                    let minDist = Infinity;
                    svgPts.forEach((p, i) => {
                      const d = Math.abs(p.x - svgX);
                      if (d < minDist) { minDist = d; nearest = i; }
                    });
                    setActiveIdx(nearest);
                  }}
                >
                  <defs>
                    <linearGradient id="mpg-area" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="#22c55e" stopOpacity="0.18" />
                      <stop offset="100%" stopColor="#22c55e" stopOpacity="0.01" />
                    </linearGradient>
                  </defs>

                  {/* Y-axis ticks + grid lines */}
                  {ticks.map((t) => {
                    const y = PAD.top + IH - ((t - minMpg) / rangeY) * IH;
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
                          {t}
                        </text>
                      </g>
                    );
                  })}

                  {/* "mpg" y-axis label */}
                  <text
                    x="6" y={(PAD.top + IH / 2).toFixed(1)}
                    fontSize="7" fill="#94a3b8"
                    textAnchor="middle"
                    transform={`rotate(-90, 6, ${PAD.top + IH / 2})`}
                  >
                    mpg
                  </text>

                  {/* Area fill */}
                  <path d={areaPath} fill="url(#mpg-area)" />

                  {/* Line */}
                  <path
                    d={linePath}
                    fill="none"
                    stroke="#22c55e"
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
                      fill={activeIdx === i ? '#16a34a' : '#22c55e'}
                      stroke="white" strokeWidth="2"
                      style={{ transition: 'r 0.1s' }}
                    />
                  ))}

                  {/* X-axis date labels — only first, middle, last */}
                  {[0, Math.floor((points.length - 1) / 2), points.length - 1]
                    .filter((i, idx, arr) => arr.indexOf(i) === idx) // dedupe
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

                  {/* Tooltip vertical line + callout for active point */}
                  {activeIdx != null && (
                    <>
                      <line
                        x1={svgPts[activeIdx].x.toFixed(1)} y1={PAD.top.toString()}
                        x2={svgPts[activeIdx].x.toFixed(1)} y2={(PAD.top + IH).toFixed(1)}
                        stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3 2"
                      />
                      {/* Tooltip bubble */}
                      {(() => {
                        const p   = svgPts[activeIdx];
                        const tip = points[activeIdx];
                        const bW  = 68;
                        const bH  = 28;
                        // Clamp horizontally
                        const bX  = Math.min(Math.max(p.x - bW / 2, PAD.left), PAD.left + IW - bW);
                        const bY  = Math.max(PAD.top - 4, p.y - bH - 8);
                        return (
                          <g>
                            <rect x={bX} y={bY} width={bW} height={bH}
                              rx="5" fill="#1e3a5f" opacity="0.92" />
                            <text x={(bX + bW / 2).toFixed(1)} y={(bY + 11).toFixed(1)}
                              fontSize="9" fill="white" textAnchor="middle" fontWeight="700">
                              {tip.mpg} mpg
                            </text>
                            <text x={(bX + bW / 2).toFixed(1)} y={(bY + 21).toFixed(1)}
                              fontSize="7.5" fill="#93c5fd" textAnchor="middle">
                              {tip.label} · {tip.vehicle}
                            </text>
                          </g>
                        );
                      })()}
                    </>
                  )}
                </svg>
              </div>

              <p className="text-[9px] text-slate-300 text-center mt-2">
                Hover over a point to see details · Add odometer readings at each fill-up to keep this chart growing
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
