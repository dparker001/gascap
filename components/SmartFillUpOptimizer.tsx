'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';

interface OptimizerResult {
  state:             string;
  usingNational:     boolean;
  currentPrice:      number;
  oldestPrice:       number;
  pctChange:         number;
  weeklyPrices:      number[];
  projectedNextWeek: number;
  slope:             number;
  recommendation:    'fill_now' | 'wait' | 'neutral';
  avgGallons:        number;
  potentialSavings:  number;
  fillupCount:       number;
}

const STATE_NAMES: Record<string, string> = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',
  CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',
  HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',
  KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',
  MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',
  NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',
  NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',
  OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',
  SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',
  VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',
};

type Status = 'idle' | 'locating' | 'loading' | 'done' | 'error';

function Sparkline({ prices, color }: { prices: number[]; color: string }) {
  if (prices.length < 2) return null;
  const W = 80, H = 36, pad = 4;
  const min   = Math.min(...prices);
  const max   = Math.max(...prices);
  const range = max - min || 0.01;
  const pts   = prices.map((p, i) => ({
    x: pad + (i / (prices.length - 1)) * (W - pad * 2),
    y: H - pad - ((p - min) / range) * (H - pad * 2),
  }));
  const polyline = pts.map((p) => `${p.x},${p.y}`).join(' ');
  return (
    <svg width={W} height={H} aria-hidden="true" className="flex-shrink-0">
      <polyline points={polyline} fill="none" stroke={color}
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y}
          r={i === pts.length - 1 ? 3.5 : 2} fill={color} />
      ))}
    </svg>
  );
}

const CONFIG = {
  fill_now: {
    icon: '⛽', label: 'Fill Up Now',
    sub: 'Prices are trending up. Locking in today\'s price saves you money vs. waiting.',
    bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', color: '#ef4444',
  },
  wait: {
    icon: '⏳', label: 'Consider Waiting',
    sub: 'Prices are trending down. Waiting a few days could save you real dollars.',
    bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', color: '#22c55e',
  },
  neutral: {
    icon: '⚖️', label: 'No Strong Signal',
    sub: 'Prices are holding steady — no clear advantage to waiting or filling now.',
    bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', color: '#f59e0b',
  },
} as const;

export default function SmartFillUpOptimizer() {
  const { data: session } = useSession();
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<OptimizerResult | null>(null);
  const [errMsg, setErrMsg] = useState('');

  async function handleRun() {
    setStatus('locating');
    setResult(null);
    setErrMsg('');

    // Try geolocation → Nominatim → state code
    let state = 'US';
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 }),
      );
      const { latitude, longitude } = position.coords;
      const geo = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
        { headers: { 'User-Agent': 'GasCap/1.0 (info@gascap.app)' } },
      );
      if (geo.ok) {
        const d = await geo.json() as { address?: { state_code?: string; 'ISO3166-2-lvl4'?: string } };
        const raw  = d.address?.state_code ?? d.address?.['ISO3166-2-lvl4'] ?? '';
        const code = raw.includes('-') ? raw.split('-')[1] : raw;
        if (code) state = code.toUpperCase();
      }
    } catch {
      // Location denied — fall back to national average silently
    }

    setStatus('loading');
    try {
      const res = await fetch(`/api/fillup-optimizer?state=${state}`);
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? 'Lookup failed');
      }
      setResult(await res.json() as OptimizerResult);
      setStatus('done');
    } catch (err: unknown) {
      setErrMsg(err instanceof Error ? err.message : 'Could not load price data.');
      setStatus('error');
    }
  }

  if (!session) return null;

  const cfg = result ? CONFIG[result.recommendation] : null;

  return (
    <div className="rounded-2xl border border-slate-100 shadow-sm overflow-hidden">

      {/* Navy header strip */}
      <div className="flex items-center gap-2 py-2.5 px-4 bg-navy-700">
        <span className="text-sm" aria-hidden="true">🔮</span>
        <div>
          <p className="text-xs font-black text-white uppercase tracking-wider">Smart Fill-Up Optimizer</p>
          <p className="text-[10px] text-white/50">Live EIA market data · personalized to your fill-up size</p>
        </div>
      </div>

      <div className="bg-white p-4 space-y-4">

      {/* Idle */}
      {status === 'idle' && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500 leading-relaxed">
            Combines live government gas price data for your state with your personal
            fill-up history to tell you the best time to fill up — with exact dollar savings.
          </p>
          <button
            onClick={handleRun}
            className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-white
                       font-bold text-sm rounded-2xl transition-colors"
          >
            Get My Recommendation →
          </button>
        </div>
      )}

      {/* Loading */}
      {(status === 'locating' || status === 'loading') && (
        <div className="flex items-center justify-center gap-2.5 py-5">
          <span className="w-4 h-4 border-2 border-amber-400 border-t-transparent
                           rounded-full animate-spin inline-block" aria-hidden="true" />
          <p className="text-xs text-slate-500">
            {status === 'locating' ? 'Detecting your location…' : 'Fetching live price data…'}
          </p>
        </div>
      )}

      {/* Error */}
      {status === 'error' && (
        <div className="space-y-2">
          <p className="text-xs text-red-500">{errMsg}</p>
          <button onClick={() => setStatus('idle')}
            className="text-xs text-amber-600 font-semibold hover:underline">
            Try again
          </button>
        </div>
      )}

      {/* Result */}
      {status === 'done' && result && cfg && (
        <div className="space-y-3">

          {/* Recommendation hero */}
          <div className={`rounded-2xl border ${cfg.bg} ${cfg.border} p-4`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-base">{cfg.icon}</span>
                  <p className={`text-sm font-black ${cfg.text}`}>{cfg.label}</p>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">{cfg.sub}</p>
              </div>
              <Sparkline prices={result.weeklyPrices} color={cfg.color} />
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-50 rounded-xl p-3 text-center border border-slate-100">
              <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400 mb-0.5">
                {result.usingNational ? 'National avg' : `${STATE_NAMES[result.state] ?? result.state} avg`}
              </p>
              <p className="text-xl font-black text-navy-700">
                ${result.currentPrice.toFixed(2)}
              </p>
              <p className="text-[9px] text-slate-400 mt-0.5">this week</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 text-center border border-slate-100">
              <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400 mb-0.5">8-week trend</p>
              <p className={`text-xl font-black ${
                result.pctChange > 0 ? 'text-red-600'
                : result.pctChange < 0 ? 'text-emerald-600'
                : 'text-slate-500'
              }`}>
                {result.pctChange > 0 ? '+' : ''}{result.pctChange.toFixed(1)}%
              </p>
              <p className="text-[9px] text-slate-400 mt-0.5">
                {result.pctChange > 0 ? 'price increase' : result.pctChange < 0 ? 'price drop' : 'stable'}
              </p>
            </div>
          </div>

          {/* Dollar savings callout — only show if meaningful */}
          {result.potentialSavings >= 0.10 && (
            <div className="bg-navy-700 rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="text-xl flex-shrink-0">💰</span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-white/50 uppercase tracking-wide">
                  {result.recommendation === 'wait'
                    ? 'Potential savings if you wait ~1 week'
                    : 'Potential extra cost if you wait ~1 week'}
                </p>
                <p className="text-lg font-black text-amber-400 leading-tight">
                  ~${result.potentialSavings.toFixed(2)}
                  <span className="text-xs font-normal text-white/50 ml-1.5">
                    on your typical {result.avgGallons} gal fill-up
                  </span>
                </p>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-0.5">
            <p className="text-[9px] text-slate-300 leading-relaxed">
              EIA weekly data ·{' '}
              {result.fillupCount > 0
                ? `avg from your ${result.fillupCount} logged fill-up${result.fillupCount !== 1 ? 's' : ''}`
                : '12-gal default (log fill-ups to personalize)'}
            </p>
            <button onClick={() => setStatus('idle')}
              className="text-[9px] text-amber-500 font-semibold hover:underline flex-shrink-0 ml-2">
              Refresh
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
