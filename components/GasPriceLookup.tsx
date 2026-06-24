'use client';

import { useState, useEffect, useRef } from 'react';
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
  /** Phase A: auto-detect + pre-fill the price on mount (for signed-in users). */
  autoFill?: boolean;
  /** The current price-field value — auto-fill is skipped when it's non-empty so we
   *  never overwrite something the user typed. */
  currentValue?: string;
}

type Status = 'idle' | 'locating' | 'fetching' | 'done' | 'error';

const LAST_PRICE_KEY = 'gc_last_gas_price';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // remembered price is "recent" for 7 days

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

export default function GasPriceLookup({ onApply, autoFill = false, currentValue = '' }: GasPriceLookupProps) {
  const { t } = useTranslation();
  const { data: session, status: sessionStatus } = useSession();
  const isGuest = sessionStatus !== 'loading' && !session;

  const [status, setStatus]   = useState<Status>('idle');
  const [result, setResult]   = useState<GasPriceLookupResult | null>(null);
  const [errMsg, setErrMsg]   = useState('');
  const [showGate, setShowGate] = useState(false);
  const [coords, setCoords]   = useState<{ lat: number; lng: number } | null>(null);
  // When set, the price was applied automatically — show a compact note, not the card.
  const [autoApplied, setAutoApplied] = useState<{ price: number; state: string } | null>(null);
  const autoRan = useRef(false);

  /** Persist the last detected price so the next visit can pre-fill instantly. */
  function remember(price: number, state: string) {
    try { localStorage.setItem(LAST_PRICE_KEY, JSON.stringify({ price, state, at: Date.now() })); } catch { /* ignore */ }
  }

  async function handleLookup(auto = false) {
    if (!auto) setStatus('locating');
    setResult(null);
    setErrMsg('');

    // 1. Geolocation
    let position: GeolocationCoordinates;
    try {
      position = await Promise.race([
        new Promise<GeolocationCoordinates>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve(pos.coords),
            (err) => reject(err),
            { timeout: 7000, maximumAge: 300_000, enableHighAccuracy: false },
          );
        }),
        // iOS WKWebView can ignore getCurrentPosition's own `timeout` and never fire
        // either callback — leaving the button spinning forever. This hard timeout
        // guarantees the spinner always resolves (→ error state) so it can't hang.
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('geo-timeout')), 8000)),
      ]);
    } catch {
      if (!auto) { setStatus('error'); setErrMsg(t.gasPrice.errorDenied); }
      return;
    }

    // Round to ~1 decimal (~11 km) — only ever transmit APPROXIMATE location.
    const apxLat = Math.round(position.latitude  * 10) / 10;
    const apxLng = Math.round(position.longitude * 10) / 10;
    setCoords({ lat: apxLat, lng: apxLng });

    // 2. Fetch price (now instant server-side — local geocode + cached EIA)
    if (!auto) setStatus('fetching');
    try {
      const res  = await fetch(`/api/gas-price?lat=${apxLat}&lng=${apxLng}`, { signal: timeoutSignal(12000) });
      const data = await res.json() as GasPriceLookupResult;

      if (auto) {
        // Silent auto-fill: apply only if the field is still empty.
        if (data.price && !currentValue) {
          onApply(data.price.toFixed(2), apxLat, apxLng);
          setAutoApplied({ price: data.price, state: data.state });
          remember(data.price, data.state);
        }
        setStatus('idle');
      } else {
        setResult(data);
        setStatus('done');
        if (data.price) remember(data.price, data.state);
      }
    } catch {
      if (!auto) { setStatus('error'); setErrMsg(t.gasPrice.errorNetwork); }
    }
  }

  // Phase A: auto-detect + pre-fill on mount for signed-in users with an empty field.
  useEffect(() => {
    if (!autoFill || autoRan.current) return;
    if (sessionStatus !== 'authenticated') return;   // wait until we know they're signed in
    if (currentValue) return;                          // never overwrite a typed value
    autoRan.current = true;

    // a) Instant pre-fill from the remembered price (no waiting on geolocation).
    try {
      const raw = localStorage.getItem(LAST_PRICE_KEY);
      if (raw) {
        const last = JSON.parse(raw) as { price: number; state: string; at: number };
        if (last?.price && Date.now() - last.at < MAX_AGE_MS) {
          onApply(last.price.toFixed(2));
          setAutoApplied({ price: last.price, state: last.state });
        }
      }
    } catch { /* ignore */ }

    // b) Refresh silently from current location IF permission is already granted
    //    (never trigger a surprise permission prompt on open).
    navigator.permissions?.query?.({ name: 'geolocation' as PermissionName })
      .then((p) => { if (p.state === 'granted') handleLookup(true); })
      .catch(() => { /* Permissions API unavailable — keep the remembered value */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStatus, autoFill]);

  function handleApply() {
    if (result?.price) {
      onApply(result.price.toFixed(2), coords?.lat, coords?.lng);
      setStatus('idle');
      setResult(null);
      setAutoApplied({ price: result.price, state: result.state });
    }
  }

  const stateName = result?.state ? (STATE_NAMES[result.state] ?? result.state) : '';
  const autoStateName = autoApplied ? (STATE_NAMES[autoApplied.state] ?? autoApplied.state) : '';

  return (
    <div>
      {/* ── Auto-applied compact note ── */}
      {autoApplied && status === 'idle' && !showGate && (
        <div className="mt-2 flex items-center gap-2 text-xs text-emerald-700">
          <span aria-hidden="true">📍</span>
          <span className="font-semibold">{autoStateName} avg ${autoApplied.price.toFixed(2)}/gal applied</span>
          <button
            type="button"
            onClick={() => { setAutoApplied(null); handleLookup(false); }}
            className="text-amber-600 font-semibold hover:underline"
          >
            Update
          </button>
        </div>
      )}

      {/* ── Trigger button ── */}
      {status === 'idle' && !showGate && !autoApplied && (
        <button
          type="button"
          onClick={() => {
            if (isGuest) {
              setShowGate(true);
            } else {
              handleLookup(false);
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
            No credit card to start.
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
