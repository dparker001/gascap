'use client';

import { useState } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';

interface GasPriceLookupResult {
  price:      number | null;
  state:      string;
  isState?:   boolean;
  isNational?:boolean;
  noApiKey?:  boolean;
  error?:     string;
}

interface GasPriceLookupProps {
  /** Called with the detected price when the user accepts it */
  onApply: (price: string) => void;
}

type Status = 'idle' | 'locating' | 'fetching' | 'done' | 'error';

/** Build a Google Maps URL that shows nearby gas stations with live prices */
function mapsNearbyUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/gas+stations/@${lat},${lng},13z`;
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
  const [status, setStatus]   = useState<Status>('idle');
  const [result, setResult]   = useState<GasPriceLookupResult | null>(null);
  const [errMsg, setErrMsg]   = useState('');
  const [coords, setCoords]   = useState<{ lat: number; lng: number } | null>(null);

  async function handleLookup() {
    setStatus('locating');
    setResult(null);
    setErrMsg('');

    // 1. Get geolocation
    let coords: GeolocationCoordinates;
    try {
      coords = await new Promise<GeolocationCoordinates>((resolve, reject) => {
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

    // Save coords for the Maps link
    setCoords({ lat: coords.latitude, lng: coords.longitude });

    // 2. Fetch price from our API route
    setStatus('fetching');
    try {
      const res = await fetch(
        `/api/gas-price?lat=${coords.latitude}&lng=${coords.longitude}`,
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
      onApply(result.price.toFixed(2));
      setStatus('idle');
      setResult(null);
    }
  }

  const stateName = result?.state ? (STATE_NAMES[result.state] ?? result.state) : '';

  return (
    <div>
      {/* ── Trigger button ── */}
      {status === 'idle' && (
        <button
          type="button"
          onClick={handleLookup}
          className="flex items-center gap-2 text-xs font-bold text-amber-600
                     hover:text-amber-700 transition-colors mt-2"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" clipRule="evenodd"
              d="M8 1a5 5 0 100 10A5 5 0 008 1zM0 8a8 8 0 1116 0A8 8 0 010 8zm8-3a1 1 0 011 1v2h2a1 1 0 110 2H8a1 1 0 01-1-1V6a1 1 0 011-1z"/>
          </svg>
          {t.gasPrice.trigger}
        </button>
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
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-3
                              flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-emerald-800">
                    {result.isState ? t.gasPrice.stateAvg(stateName) : t.gasPrice.nationalAvg}
                  </p>
                  <p className="text-lg font-black text-emerald-700">
                    ${result.price.toFixed(2)}<span className="text-xs font-normal text-emerald-600 ml-0.5">/gal</span>
                  </p>
                  <p className="text-[10px] text-emerald-600 mt-0.5">{t.gasPrice.source}</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <button
                    onClick={handleApply}
                    className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold
                               hover:bg-emerald-500 transition-colors whitespace-nowrap"
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
              {/* Nearby stations link — Google Maps shows live pump prices */}
              {coords && (
                <a
                  href={mapsNearbyUrl(coords.lat, coords.lng)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between w-full bg-blue-50 border border-blue-200
                             rounded-xl px-3 py-2.5 hover:bg-blue-100 transition-colors group"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">📍</span>
                    <div>
                      <p className="text-xs font-bold text-blue-800">{t.gasPrice.findNearby}</p>
                      <p className="text-[10px] text-blue-500">{t.gasPrice.findNearbyHint}</p>
                    </div>
                  </div>
                  <svg className="w-3.5 h-3.5 text-blue-400 group-hover:text-blue-600 flex-shrink-0"
                       viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"
                       strokeLinecap="round" aria-hidden="true">
                    <path d="M2 6h8M6 2l4 4-4 4"/>
                  </svg>
                </a>
              )}
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
