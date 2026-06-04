'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useTranslation } from '@/contexts/LanguageContext';

interface GasPriceLookupResult {
  price:      number | null;
  state:      string;
  isState?:   boolean;
  isNational?:boolean;
  approximate?: boolean;   // true = EIA outage fallback estimate (not live data)
  noApiKey?:  boolean;
  error?:     string;
}

interface GasPriceLookupProps {
  /** Called with the detected price (and optional coords) when the user accepts it */
  onApply: (price: string, lat?: number, lng?: number) => void;
}

type Status = 'idle' | 'locating' | 'fetching' | 'done' | 'error';

/** AbortSignal that fires after `ms` — so a slow/hung request can't spin forever. */
function timeoutSignal(ms: number): AbortSignal {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
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
  US:'United States (national avg)',
};

export default function GasPriceLookup({ onApply }: GasPriceLookupProps) {
  const { t } = useTranslation();
  const { data: session, status: sessionStatus } = useSession();
  const isGuest = sessionStatus !== 'loading' && !session;

  const [status, setStatus]   = useState<Status>('idle');
  const [result, setResult]   = useState<GasPriceLookupResult | null>(null);
  const [errMsg, setErrMsg]   = useState('');
  const [showGate, setShowGate] = useState(false);
  const [coords, setCoords]   = useState<{ lat: number; lng: number } | null>(null);

  async function handleLookup() {
    setStatus('locating');
    setResult(null);
    setErrMsg('');
    setCoords(null);

    // 1. Get geolocation
    let position: GeolocationCoordinates;
    try {
      position = await new Promise<GeolocationCoordinates>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos.coords),
          (err) => reject(err),
          { timeout: 10000, maximumAge: 300_000 },
        );
      });
    } catch {
      setStatus('error');
      setErrMsg(t.gasPrice.errorDenied);
      return;
    }

    // Store coords for use in onApply
    setCoords({ lat: position.latitude, lng: position.longitude });

    // 2. Fetch price from our API route
    setStatus('fetching');
    try {
      const res = await fetch(
        `/api/gas-price?lat=${position.latitude}&lng=${position.longitude}`,
        { signal: timeoutSignal(15000) },
      );
      const data = await res.json() as GasPriceLookupResult;
      setResult(data);
      setStatus('done');
    } catch {
      setStatus('error');
      setErrMsg(t.gasPrice.errorNetwork);
    }
  }

  function handleApply() {
    if (result?.price) {
      onApply(result.price.toFixed(2), coords?.lat, coords?.lng);
      setStatus('idle');
      setResult(null);
    }
  }

  const stateName = result?.state ? (STATE_NAMES[result.state] ?? result.state) : '';

  return (
    <div>
      {/* ── Trigger button ── */}
      {status === 'idle' && !showGate && (
        <button
          type="button"
          onClick={() => {
            if (isGuest) {
              setShowGate(true);
            } else {
              handleLookup();
            }
          }}
          className="inline-flex items-center gap-1.5 mt-2.5 px-3.5 py-2 rounded-xl
                     border border-amber-300 bg-amber-50 text-sm font-black text-amber-700
                     hover:bg-amber-100 hover:border-amber-400 transition-colors"
        >
          <span className="text-base leading-none" aria-hidden="true">📍</span>
          {t.gasPrice.trigger}
        </button>
      )}

      {/* ── Guest gate — sign-up prompt ── */}
      {showGate && (
        <div className="mt-2 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
          <p className="text-xs font-black text-amber-800 mb-0.5">
            📍 Live gas prices — free with an account
          </p>
          <p className="text-[11px] text-amber-700 leading-relaxed mb-3">
            Create your free GasCap account to auto-detect local gas prices by location.
            No credit card required.
          </p>
          <div className="flex items-center gap-3">
            <Link
              href="/signup"
              className="px-4 py-2 rounded-xl bg-[#005F4A] text-white text-xs font-bold
                         hover:bg-[#004d3b] transition-colors whitespace-nowrap"
            >
              Create free account →
            </Link>
            <button
              type="button"
              onClick={() => setShowGate(false)}
              className="text-[11px] text-amber-600 font-semibold hover:underline"
            >
              Enter manually
            </button>
          </div>
        </div>
      )}

      {/* ── Loading states ── */}
      {(status === 'locating' || status === 'fetching') && (
        <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
          <span className="inline-block w-3 h-3 border-2 border-amber-400 border-t-transparent
                           rounded-full animate-spin" aria-hidden="true" />
          {status === 'locating' ? t.gasPrice.locating : t.gasPrice.fetching}
        </div>
      )}

      {/* ── Error ── */}
      {status === 'error' && (
        <div className="mt-2">
          <p className="text-xs text-red-500">{errMsg}</p>
          <button
            onClick={() => setStatus('idle')}
            className="text-xs text-amber-600 font-semibold mt-1 hover:underline"
          >
            {t.gasPrice.tryAgain}
          </button>
        </div>
      )}

      {/* ── Result ── */}
      {status === 'done' && result && (
        <div className="mt-3 animate-fade-in">
          {result.noApiKey ? (
            /* EIA key not configured — show setup instructions */
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
              <p className="text-xs font-bold text-amber-800 mb-1">EIA API key needed</p>
              <p className="text-xs text-amber-700 leading-relaxed">
                Add a free key from{' '}
                <a href="https://www.eia.gov/opendata/" target="_blank" rel="noopener noreferrer"
                   className="underline font-semibold">eia.gov/opendata</a>
                {' '}to your <code className="bg-amber-100 px-1 rounded">.env.local</code>:{' '}
                <code className="bg-amber-100 px-1 rounded">EIA_API_KEY=your_key</code>
              </p>
              <button onClick={() => setStatus('idle')}
                className="text-xs text-amber-600 font-bold mt-2 hover:underline">
                {t.gasPrice.dismiss}
              </button>
            </div>
          ) : result.price ? (
            /* Price found — offer to apply it */
            <div className="space-y-2">
              <div className={`border rounded-xl px-3 py-3 flex items-center justify-between gap-3 ${
                result.approximate ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'
              }`}>
                <div>
                  <p className={`text-xs font-bold ${result.approximate ? 'text-amber-800' : 'text-emerald-800'}`}>
                    {result.approximate
                      ? t.gasPrice.estimateTitle
                      : result.isState ? t.gasPrice.stateAvg(stateName) : t.gasPrice.nationalAvg}
                  </p>
                  <p className={`text-lg font-black ${result.approximate ? 'text-amber-700' : 'text-emerald-700'}`}>
                    {result.approximate ? '≈ ' : ''}${result.price.toFixed(2)}
                    <span className={`text-xs font-normal ml-0.5 ${result.approximate ? 'text-amber-600' : 'text-emerald-600'}`}>/gal</span>
                  </p>
                  <p className="mt-1 flex items-center gap-1.5">
                    <span className={`inline-flex items-center gap-0.5 text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none border ${
                      result.approximate
                        ? 'bg-amber-100 text-amber-700 border-amber-200'
                        : 'bg-emerald-100 text-emerald-700 border-emerald-200'
                    }`}>
                      {result.approximate ? '⚠️ Estimate' : '📊 U.S. EIA Official'}
                    </span>
                    <span className={`text-[10px] ${result.approximate ? 'text-amber-500' : 'text-emerald-500'}`}>
                      {result.approximate ? t.gasPrice.estimateNote : 'regular unleaded'}
                    </span>
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <button
                    onClick={handleApply}
                    className={`px-4 py-2 rounded-xl text-white text-xs font-bold transition-colors whitespace-nowrap ${
                      result.approximate ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'
                    }`}
                  >
                    {t.gasPrice.useThisPrice}
                  </button>
                  <button
                    onClick={() => setStatus('idle')}
                    className="text-[10px] text-slate-400 hover:text-slate-600 text-center"
                  >
                    {t.gasPrice.dismiss}
                  </button>
                </div>
              </div>

            </div>
          ) : (
            <p className="text-xs text-slate-500 mt-2">
              {t.gasPrice.unavailable}{' '}
              <button onClick={() => setStatus('idle')}
                className="text-amber-600 font-semibold hover:underline">{t.gasPrice.dismiss}</button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
