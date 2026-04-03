'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { Fillup } from '@/lib/fillups';

interface FillupResponse {
  fillups: Fillup[];
}

type Trend = 'up' | 'down' | 'stable';

export default function GasPricePrediction() {
  const { data: session } = useSession();
  const [trend,  setTrend]  = useState<Trend | null>(null);
  const [prices, setPrices] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) return;
    fetch('/api/fillups', { credentials: 'include' })
      .then(r => r.json())
      .then((data: FillupResponse) => {
        const fills = (data.fillups ?? [])
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
          .slice(0, 6);
        if (fills.length < 4) return;
        const pts = fills.map(f => f.pricePerGallon).reverse();
        setPrices(pts.slice(-4));
        const older = (pts[0] + pts[1]) / 2;
        const newer = (pts[pts.length - 2] + pts[pts.length - 1]) / 2;
        const diff  = newer - older;
        if (diff > 0.05)       setTrend('up');
        else if (diff < -0.05) setTrend('down');
        else                   setTrend('stable');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [session]);

  if (!session || loading || !trend || prices.length < 4) return null;

  const config = {
    up:     { icon: '📈', label: 'Prices trending UP',     sub: 'Consider filling up soon before prices rise further.', bg: 'bg-red-50',    border: 'border-red-100',   text: 'text-red-600'   },
    down:   { icon: '📉', label: 'Prices trending DOWN',   sub: 'You might save a little by waiting a few more days.',  bg: 'bg-green-50',  border: 'border-green-100', text: 'text-green-600' },
    stable: { icon: '➡️', label: 'Prices are stable',      sub: 'No strong trend in your recent fill-up prices.',       bg: 'bg-amber-50',  border: 'border-amber-100', text: 'text-amber-600' },
  }[trend];

  // Mini sparkline
  const min  = Math.min(...prices);
  const max  = Math.max(...prices);
  const range = max - min || 0.01;
  const W = 64, H = 28, pad = 4;
  const points = prices.map((p, i) => {
    const x = pad + (i / (prices.length - 1)) * (W - pad * 2);
    const y = H - pad - ((p - min) / range) * (H - pad * 2);
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className={`rounded-2xl border ${config.bg} ${config.border} p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-base">{config.icon}</span>
            <p className={`text-xs font-black ${config.text}`}>{config.label}</p>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">{config.sub}</p>
        </div>

        {/* Sparkline */}
        <svg width={W} height={H} className="flex-shrink-0 mt-0.5" aria-hidden="true">
          <polyline
            points={points}
            fill="none"
            stroke={trend === 'up' ? '#ef4444' : trend === 'down' ? '#22c55e' : '#f59e0b'}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {prices.map((p, i) => {
            const x = pad + (i / (prices.length - 1)) * (W - pad * 2);
            const y = H - pad - ((p - min) / range) * (H - pad * 2);
            return <circle key={i} cx={x} cy={y} r="2.5"
              fill={trend === 'up' ? '#ef4444' : trend === 'down' ? '#22c55e' : '#f59e0b'} />;
          })}
        </svg>
      </div>

      <p className="text-[10px] text-slate-300 mt-2">
        Based on your last {prices.length} fill-ups
      </p>
    </div>
  );
}
