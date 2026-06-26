'use client';

/**
 * NearbyStations — Find Gas tab content.
 *
 * Shows nearby gas stations with fuel prices from Google Places.
 * Pro-gated. Requests location permission via LocationPreScreen first.
 * "Use this price" fires onApply into the parent calculator.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useIsNative } from '@/hooks/useIsNative';
import type { NearbyStation, FuelPrice } from '@/lib/nearbyGas';

interface Props {
  /** Called when the user selects a price to use in the calculator */
  onApply?: (price: string, lat: number, lng: number, stationName: string, distanceMi: number, grade: string) => void;
  /** True when this tab is the currently visible tab (used to detect stale loading state on re-activation) */
  isActive?: boolean;
}

type Status = 'idle' | 'locating' | 'fetching' | 'done' | 'error' | 'no_key' | 'disabled';

const LOC_ASKED_KEY = 'gc_loc_asked';
const GRADE_ORDER: FuelPrice['type'][] = ['REGULAR', 'MIDGRADE', 'PREMIUM', 'DIESEL'];

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const diffMs  = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 2)  return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24)   return `${diffH}h ago`;
  return `${Math.round(diffH / 24)}d ago`;
}

// ── Gas pump SVG icon ────────────────────────────────────────────────────────

function PumpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 22V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16"/>
      <path d="M3 11h11"/>
      <path d="M14 6h1a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V7l-3-3"/>
      <path d="M3 22h11"/>
    </svg>
  );
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6"/>
    </svg>
  );
}

function MapPin({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
      <circle cx="12" cy="10" r="3"/>
    </svg>
  );
}

// ── Location pre-screen ──────────────────────────────────────────────────────

function LocationPreScreen({ onAllow, onSkip }: { onAllow: () => void; onSkip: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <div className="w-20 h-20 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mb-5">
        <MapPin className="w-10 h-10 text-amber-500" />
      </div>
      <h2 className="text-xl font-black text-slate-900 mb-2">Find Gas Near You</h2>
      <p className="text-sm text-slate-500 leading-relaxed mb-6 max-w-xs">
        GasCap uses your location to find the cheapest nearby gas stations and
        auto-fill the calculator — so you know exactly what to pump before you pull in.
      </p>
      <button
        onClick={onAllow}
        className="w-full max-w-xs py-3.5 rounded-2xl bg-[#005F4A] text-white text-sm
                   font-black tracking-wide mb-3 active:opacity-90 transition-opacity"
      >
        Allow Location
      </button>
      <button
        onClick={onSkip}
        className="text-sm text-slate-400 font-medium hover:text-slate-600"
      >
        Maybe Later
      </button>
    </div>
  );
}

// ── Station card ─────────────────────────────────────────────────────────────

function StationCard({
  station,
  onApply,
}: {
  station:  NearbyStation;
  onApply?: (price: string, lat: number, lng: number, stationName: string, distanceMi: number, grade: string) => void;
}) {
  const hasPrices = station.prices.length > 0;
  // Use regular if available, otherwise the first price in sorted order
  const bestPrice = station.prices.find((p) => p.type === 'REGULAR') ?? station.prices[0] ?? null;

  // Freshest updatedAt across all prices
  const freshest = station.prices
    .map((p) => p.updatedAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  const appleDirections = `maps://maps.apple.com/?daddr=${station.lat},${station.lng}`;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header row */}
      <div className="px-4 pt-4 pb-2 flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-900 text-sm truncate">{station.name}</p>
          <p className="text-[11px] text-slate-400 mt-0.5 truncate">{station.address}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[11px] text-slate-500 font-medium">
              {station.distanceMi} mi away
            </span>
            {station.isOpen === true  && <span className="text-[10px] font-bold text-emerald-600">OPEN</span>}
            {station.isOpen === false && <span className="text-[10px] font-bold text-red-500">CLOSED</span>}
          </div>
        </div>
        {bestPrice ? (
          <div className="text-right flex-shrink-0">
            <p className="text-2xl font-black text-slate-900 leading-none">
              ${bestPrice.price.toFixed(2)}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">{bestPrice.label}</p>
          </div>
        ) : (
          <div className="text-right flex-shrink-0">
            <p className="text-[11px] text-slate-400 italic leading-snug max-w-[100px]">
              No live price
            </p>
          </div>
        )}
      </div>

      {/* Price grid — each chip is tappable to fill the calculator */}
      {hasPrices && (
        <div className={`px-4 pb-3 grid gap-1.5 ${station.prices.length > 2 ? 'grid-cols-4' : 'grid-cols-2'}`}>
          {GRADE_ORDER.map((type) => {
            const fp = station.prices.find((p) => p.type === type);
            if (!fp) return null;
            const isSelected = fp.type === bestPrice?.type;
            return (
              <button
                key={type}
                onClick={() => onApply?.(fp.price.toFixed(2), station.lat, station.lng, station.name, station.distanceMi, fp.label)}
                className={`rounded-xl px-2 py-1.5 text-center transition-colors active:opacity-80
                  ${onApply
                    ? isSelected
                      ? 'bg-[#005F4A] text-white'
                      : 'bg-slate-50 hover:bg-slate-100'
                    : 'bg-slate-50'
                  }`}
              >
                <p className={`text-[9px] font-bold uppercase tracking-wider ${isSelected && onApply ? 'text-emerald-200' : 'text-slate-400'}`}>
                  {fp.label}
                </p>
                <p className={`text-sm font-black ${isSelected && onApply ? 'text-white' : 'text-slate-800'}`}>
                  ${fp.price.toFixed(2)}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {/* No-price fallback */}
      {!hasPrices && (
        <div className="px-4 pb-3">
          <p className="text-[11px] text-slate-400 italic">
            Live price not available for this station. Enter pump price manually.
          </p>
        </div>
      )}

      {/* Staleness + actions */}
      <div className="border-t border-slate-100 px-4 py-2.5 flex items-center justify-between gap-2">
        <span className="text-[10px] text-slate-400">
          {freshest
            ? `${ bestPrice?.label ?? 'Price' } · Updated ${timeAgo(freshest)}`
            : hasPrices ? 'Price data from Google' : 'Station from Google'}
        </span>
        <div className="flex items-center gap-2">
          <a
            href={appleDirections}
            className="text-[11px] font-bold text-teal-600 flex items-center gap-0.5"
          >
            Directions <ChevronRight className="w-3 h-3" />
          </a>
          {onApply && hasPrices && (
            <span className="text-[10px] text-slate-400 italic">tap grade to use</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function NearbyStations({ onApply, isActive = true }: Props) {
  const { data: session, status: sessionStatus } = useSession();
  const isNative = useIsNative();
  const plan    = (session?.user as { plan?: string } | undefined)?.plan ?? 'free';
  const isPro   = plan === 'pro' || plan === 'fleet' || plan === 'lifetime';
  const isGuest = sessionStatus === 'unauthenticated';

  const [status,   setStatus]   = useState<Status>('idle');
  const [stations, setStations] = useState<NearbyStation[]>([]);
  const [errMsg,   setErrMsg]   = useState('');
  const [coords,   setCoords]   = useState<{ lat: number; lng: number } | null>(null);

  // Has the user seen the location pre-screen for Find Gas?
  const [locAsked, setLocAsked] = useState(true); // default true = don't flash on load
  useEffect(() => {
    try {
      const v = localStorage.getItem(LOC_ASKED_KEY);
      setLocAsked(v === '1');
    } catch { /* storage blocked */ }
  }, []);

  // ── Request tracking refs ───────────────────────────────────────────────────
  // fetchGenRef: incremented on each new request; stale completions are discarded.
  // fetchControllerRef: AbortController for the current fetch (best-effort cancel).
  // geoGenRef: prevents a stale geolocation callback from starting a new fetch.
  const fetchGenRef       = useRef(0);
  const fetchControllerRef = useRef<AbortController | null>(null);
  const geoGenRef         = useRef(0);

  // ── Hard timeout via React state ────────────────────────────────────────────
  // CapacitorHttp's fetch polyfill does not reliably honour AbortSignal in all
  // WKWebView versions, so controller.abort() may never reject the promise.
  // Using a React-state timer instead guarantees a re-render after 15 s —
  // it calls setStatus() directly, which always schedules a reconciliation.
  const TIMEOUT_MS = 15_000;
  useEffect(() => {
    if (status !== 'fetching' && status !== 'locating') return;
    console.log('[FindGas] render state:', status);
    const timer = setTimeout(() => {
      console.log('[FindGas] timeout fired — setting error state directly');
      fetchGenRef.current++;           // discard any eventual fetch response
      fetchControllerRef.current?.abort();
      setStatus('error');
      setErrMsg('Fuel pricing is taking too long. Enter your price manually or tap retry.');
      console.log('[FindGas] loading=false (timeout)');
    }, TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [status]);

  // Helper: run a fetch inside a dedicated Web Worker (not intercepted by the SW).
  // Returns { status, text } or throws with a descriptive message.
  const workerFetch = useCallback((fetchUrl: string, timeoutMs = 13000): Promise<{ status: number; text: string }> => {
    return new Promise((resolve, reject) => {
      // [6] Full URL the worker will call
      console.log('[FindGas][worker] fetch URL:', fetchUrl);

      const code = [
        'self.onmessage=async function(e){',
        '  var url=e.data;',
        '  console.log("[FindGas][worker] fetch started:",url);', // [7] inside worker
        '  try{',
        '    var r=await fetch(url,{credentials:"include",cache:"no-store",headers:{"Cache-Control":"no-store"}});',
        '    var t=await r.text();',
        '    console.log("[FindGas][worker] fetch done status:",r.status);', // [8] inside worker
        '    self.postMessage({status:r.status,text:t});',
        '  }catch(err){',
        '    console.log("[FindGas][worker] fetch error:",String(err));',
        '    self.postMessage({error:String(err)});',
        '  }',
        '};',
      ].join('');

      let worker: Worker;
      let blobUrl: string;
      try {
        blobUrl = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
        worker  = new Worker(blobUrl);
        console.log('[FindGas][5] Worker created successfully'); // [5]
      } catch (e) {
        console.error('[FindGas][5] Worker creation FAILED:', String(e));
        reject(e);
        return;
      }

      const cleanup = () => { try { worker.terminate(); } catch { /**/ } URL.revokeObjectURL(blobUrl); };

      const timer = setTimeout(() => {
        console.log('[FindGas][9] Worker timeout fired after', timeoutMs, 'ms for', fetchUrl); // [9]
        cleanup();
        reject(new Error('worker-timeout'));
      }, timeoutMs);

      worker.onmessage = (e: MessageEvent) => {
        clearTimeout(timer);
        cleanup();
        if (e.data.error) {
          console.log('[FindGas][8] Worker fetch FAILED:', e.data.error); // [8]
          reject(new Error(e.data.error));
        } else {
          console.log('[FindGas][8] Worker fetch completed — status:', e.data.status, 'body[:200]:', String(e.data.text).slice(0, 200)); // [8] + [10]
          resolve({ status: e.data.status, text: e.data.text });
        }
      };

      worker.onerror = (e: ErrorEvent) => {
        clearTimeout(timer);
        cleanup();
        console.error('[FindGas][worker] onerror:', e.message);
        reject(new Error(e.message ?? 'worker-error'));
      };

      worker.postMessage(fetchUrl);
    });
  }, []);

  const doLookup = useCallback(async (lat: number, lng: number) => {
    const gen = ++fetchGenRef.current;

    fetchControllerRef.current?.abort();
    const controller = new AbortController();
    fetchControllerRef.current = controller;

    setStatus('fetching');
    setCoords({ lat, lng });
    console.log('[FindGas] loading=true (fetching)');

    // [2] Platform
    console.log('[FindGas][2] platform detected — isNative:', isNative);
    // [3] Current URL
    console.log('[FindGas][3] window.location.href:', typeof window !== 'undefined' ? window.location.href : 'ssr');
    // [4] SW controller
    const swCtrl = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      ? (navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : 'none')
      : 'unavailable';
    console.log('[FindGas][4] navigator.serviceWorker.controller:', swCtrl);

    const nearbyUrl = `https://www.gascap.app/gas/nearby?lat=${lat}&lng=${lng}&_=${Date.now()}`;
    console.log('[FindGas] fuel price fetch started:', nearbyUrl, '| gen:', gen);

    try {
      type GasData = { stations?: NearbyStation[]; proRequired?: boolean; reason?: string; error?: string; disabled?: boolean };
      let data: GasData;
      let httpStatus: number;

      if (isNative) {
        // ── Ping pre-flight ──────────────────────────────────────────────────
        // Confirms network reachability via Worker before the real request.
        const pingUrl = `https://www.gascap.app/gas/ping?_=${Date.now()}`;
        console.log('[FindGas] sending ping via worker:', pingUrl);
        try {
          const ping = await workerFetch(pingUrl, 8000);
          console.log('[FindGas] ping response — status:', ping.status, 'body:', ping.text.slice(0, 100));
        } catch (pingErr) {
          console.log('[FindGas] ping FAILED:', String(pingErr), '— proceeding to main request anyway');
        }

        if (gen !== fetchGenRef.current) return;

        // ── Main request via Worker ──────────────────────────────────────────
        // Dedicated Web Workers are not intercepted by service workers (spec-guaranteed).
        const workerResult = await workerFetch(nearbyUrl);

        if (gen !== fetchGenRef.current) {
          console.log('[FindGas] response discarded (stale gen', gen, ')');
          return;
        }
        httpStatus = workerResult.status;
        try { data = JSON.parse(workerResult.text); }
        catch {
          console.error('[FindGas] non-JSON from worker — status:', workerResult.status, 'body:', workerResult.text.slice(0, 200));
          setStatus('error'); setErrMsg('Unexpected server response. Enter your price manually or tap retry.'); return;
        }
      } else {
        const res = await fetch(nearbyUrl, {
          signal:  controller.signal,
          cache:   'no-store',
          headers: { 'Cache-Control': 'no-store' },
        });
        if (gen !== fetchGenRef.current) {
          console.log('[FindGas] response discarded (stale gen', gen, ')');
          return;
        }
        console.log('[FindGas] fetch response:', res.status, '| gen:', gen);
        httpStatus = res.status;
        const text = await res.text();
        try {
          data = JSON.parse(text);
        } catch {
          console.error('[FindGas] non-JSON response:', res.status, text.slice(0, 200));
          setStatus('error');
          setErrMsg('Unexpected server response. Enter your price manually or tap retry.');
          return;
        }
      }

      if (gen !== fetchGenRef.current) return;

      if (httpStatus >= 400) {
        setStatus('error');
        setErrMsg(`Unable to load fuel prices (${httpStatus}). Enter your price manually or tap retry.`);
        console.log('[FindGas] error state set — HTTP', httpStatus);
        return;
      }
      if (data.proRequired) {
        setStatus('error');
        setErrMsg(`Pro required (${data.reason ?? 'unknown'}) — try signing out and back in.`);
        console.log('[FindGas] error state set — proRequired:', data.reason);
        return;
      }
      if (data.disabled) { setStatus('disabled'); return; }
      if (data.error)    {
        setStatus('error');
        setErrMsg(data.error);
        console.log('[FindGas] error state set —', data.error);
        return;
      }

      setStations(data.stations ?? []);
      setStatus('done');
      console.log('[FindGas] loading=false — done,', (data.stations ?? []).length, 'stations');

    } catch (err) {
      if (gen !== fetchGenRef.current) return;
      const name = err instanceof Error ? err.name : 'unknown';
      const msg  = err instanceof Error ? err.message : String(err);
      console.error('[FindGas] fetch error:', name, msg, '| gen:', gen);
      if (name !== 'AbortError') {
        setStatus('error');
        setErrMsg('Unable to load nearby fuel prices. Enter your price manually or tap retry.');
        console.log('[FindGas] error state set —', name, msg);
      }
    }
  }, [isNative, workerFetch]);

  const requestLocation = useCallback((source: 'auto' | 'allow' | 'retry' = 'auto') => {
    // Cancel any stale geolocation callback and in-flight fetch.
    const geoGen = ++geoGenRef.current;
    fetchGenRef.current++;
    fetchControllerRef.current?.abort();

    // [1] Find Gas button tapped
    console.log('[FindGas][1] requestLocation called — source:', source);
    console.log('[FindGas] geolocation request started | geoGen:', geoGen);
    setStatus('locating');
    console.log('[FindGas] loading=true (locating)');

    if (!navigator.geolocation) {
      setStatus('error');
      setErrMsg('Geolocation not available on this device.');
      console.log('[FindGas] error state set — no geolocation API');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (geoGen !== geoGenRef.current) {
          console.log('[FindGas] geolocation result discarded (stale geoGen', geoGen, ')');
          return;
        }
        const lat = Math.round(pos.coords.latitude  * 100) / 100;
        const lng = Math.round(pos.coords.longitude * 100) / 100;
        console.log('[FindGas] coordinates received:', lat + 'x', lng + 'x', '| geoGen:', geoGen);
        doLookup(lat, lng);
      },
      (err) => {
        if (geoGen !== geoGenRef.current) return;
        console.log('[FindGas] geolocation error:', err.code, err.message);
        setStatus('error');
        setErrMsg(
          err.code === 1
            ? 'Location access denied. Enable location in Settings.'
            : 'Could not get your location. Please try again.',
        );
        console.log('[FindGas] error state set — geolocation code', err.code);
      },
      { timeout: 8000, maximumAge: 300_000, enableHighAccuracy: false },
    );
  }, [doLookup]);

  function handleAllow() {
    try { localStorage.setItem(LOC_ASKED_KEY, '1'); } catch { /* ignore */ }
    setLocAsked(true);
    requestLocation('allow');
  }

  function handleSkip() {
    try { localStorage.setItem(LOC_ASKED_KEY, '1'); } catch { /* ignore */ }
    setLocAsked(true);
  }

  // ── Stale fetching state on tab re-activation ───────────────────────────────
  // Detect false→true transition on isActive. If the component was left in a
  // loading state (e.g., fetch hung while tab was hidden), reset immediately.
  const prevActiveRef = useRef(false);
  useEffect(() => {
    const wasActive = prevActiveRef.current;
    prevActiveRef.current = !!isActive;
    if (isActive && !wasActive) {
      console.log('[FindGas] Find Gas tab active | status was:', status);
      if (status === 'fetching' || status === 'locating') {
        fetchGenRef.current++;
        fetchControllerRef.current?.abort();
        setStatus('error');
        setErrMsg('Fuel pricing timed out. Tap retry to try again.');
        console.log('[FindGas] stale loading state cleared on tab activation');
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  // ── App foreground: reset stale loading state (native only) ─────────────────
  useEffect(() => {
    if (!isNative) return;
    let cleanup: (() => void) | null = null;
    import('@capacitor/app').then(({ App }) => {
      App.addListener('appStateChange', ({ isActive: appActive }) => {
        if (appActive && (status === 'fetching' || status === 'locating')) {
          console.log('[FindGas] app foregrounded with stale loading state — resetting');
          fetchGenRef.current++;
          fetchControllerRef.current?.abort();
          setStatus('error');
          setErrMsg('Fuel pricing timed out. Tap retry to try again.');
        }
      }).then((handle) => { cleanup = () => handle.remove(); });
    }).catch(() => { /* @capacitor/app not available in web */ });
    return () => { cleanup?.(); };
  }, [isNative, status]);

  // ── Auto-fetch on tab activation ────────────────────────────────────────────
  // Only triggers from idle state — never races with an in-flight request and
  // never re-fetches when results are already shown.
  useEffect(() => {
    if (!isActive) return;
    if (!isPro || sessionStatus === 'loading') return;
    if (status !== 'idle') return;
    if (!navigator.geolocation) return;
    try {
      const asked = localStorage.getItem(LOC_ASKED_KEY);
      if (asked === '1') requestLocation('auto');
    } catch { /* storage blocked */ }
  }, [isActive, isPro, sessionStatus, status, requestLocation]);

  // ── Guest gate ──────────────────────────────────────────────────────────────
  if (isGuest) {
    return (
      <div className="px-4 pt-8 pb-4 max-w-lg mx-auto text-center">
        <PumpIcon className="w-12 h-12 text-amber-400 mx-auto mb-4" />
        <h2 className="text-lg font-black text-slate-900 mb-2">Find Gas Near You</h2>
        <p className="text-sm text-slate-500 mb-5">
          Create a free account, then upgrade to Pro to see nearby station prices.
        </p>
        <Link href="/signup"
          className="inline-block px-6 py-3 rounded-2xl bg-[#005F4A] text-white font-black text-sm">
          Create free account →
        </Link>
      </div>
    );
  }

  // ── Pro upgrade prompt ──────────────────────────────────────────────────────
  if (!isPro && sessionStatus === 'authenticated') {
    return (
      <div className="px-4 pt-8 pb-4 max-w-lg mx-auto text-center">
        <PumpIcon className="w-12 h-12 text-amber-400 mx-auto mb-4" />
        <h2 className="text-lg font-black text-slate-900 mb-2">Find Gas Near You</h2>
        <p className="text-sm text-slate-500 mb-2">
          See nearby station prices, filtered by fuel grade, sorted by cheapest — Pro feature.
        </p>
        <ul className="text-left text-sm text-slate-600 space-y-1 mb-5 mx-auto max-w-xs">
          <li>⛽ Live prices from nearby stations</li>
          <li>📍 One tap to fill the calculator</li>
          <li>🏆 Report prices, earn giveaway entries</li>
        </ul>
        <Link href="/upgrade"
          className="inline-block px-6 py-3 rounded-2xl bg-brand-orange text-white font-black text-sm">
          Upgrade to Pro →
        </Link>
      </div>
    );
  }

  // ── Location pre-screen (first time) ───────────────────────────────────────
  if (!locAsked) {
    return <LocationPreScreen onAllow={handleAllow} onSkip={handleSkip} />;
  }

  // ── Feature disabled ────────────────────────────────────────────────────────
  if (status === 'disabled') {
    return (
      <div className="px-4 pt-8 pb-4 max-w-lg mx-auto text-center">
        <PumpIcon className="w-12 h-12 text-slate-300 mx-auto mb-4" />
        <h2 className="text-lg font-black text-slate-900 mb-2">Find Gas Near You</h2>
        <p className="text-sm text-slate-500">
          Live station prices are coming soon. Enter the pump price manually in the calculator for now.
        </p>
      </div>
    );
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (status === 'locating' || status === 'fetching') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3">
        <span className="w-8 h-8 border-[3px] border-teal-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-500">
          {status === 'locating' ? 'Finding your location…' : 'Loading nearby stations…'}
        </p>
        {/* Temporary diagnostic — remove after native fetch is confirmed working */}
        <p className="text-[10px] text-slate-300 font-mono">
          native:{isNative ? 'y' : 'n'} path:{isNative ? 'CapHttp' : 'fetch'}
        </p>
      </div>
    );
  }

  // ── Error ───────────────────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <div className="px-4 pt-8 max-w-lg mx-auto text-center">
        <PumpIcon className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-600 mb-4 max-w-xs mx-auto leading-snug">{errMsg}</p>
        <button
          onClick={() => requestLocation('retry')}
          className="w-full max-w-xs py-3 rounded-2xl bg-[#005F4A] text-white text-sm font-black mb-2"
        >
          Try Again
        </button>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('gc:switch-tab', { detail: { tab: 'calculator' } }))}
          className="w-full max-w-xs py-3 rounded-2xl bg-slate-100 text-slate-700 text-sm font-bold"
        >
          Enter Price Manually
        </button>
      </div>
    );
  }

  // ── Idle (pre-screen dismissed, no auto-grant) ──────────────────────────────
  if (status === 'idle') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] px-6 text-center">
        <PumpIcon className="w-14 h-14 text-slate-300 mb-4" />
        <p className="text-slate-500 text-sm mb-4">Tap to find the cheapest gas near you.</p>
        <button
          onClick={() => requestLocation('allow')}
          className="px-6 py-3 rounded-2xl bg-[#005F4A] text-white font-black text-sm
                     active:opacity-90 transition-opacity"
        >
          📍 Find Nearby Stations
        </button>
      </div>
    );
  }

  // ── Results ─────────────────────────────────────────────────────────────────
  return (
    <div className="px-4 pt-4 pb-6 max-w-lg mx-auto w-full space-y-3">
      <p className="text-xs font-semibold text-teal-600 text-center bg-teal-50 rounded-xl py-2 px-3 mb-2">
        Tap any price to instantly fill the calculator
      </p>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-slate-500 font-medium">
          {stations.length} station{stations.length !== 1 ? 's' : ''} within 5 mi
        </p>
        <button
          onClick={() => coords && doLookup(coords.lat, coords.lng)}
          className="text-xs text-teal-600 font-bold"
        >
          Refresh
        </button>
      </div>

      {stations.length === 0 ? (
        <div className="text-center py-10">
          <p className="text-slate-400 text-sm">No station prices found nearby.</p>
          <p className="text-slate-400 text-xs mt-1">Google Places data may be limited in your area.</p>
        </div>
      ) : (
        stations.map((s) => (
          <StationCard key={s.placeId} station={s} onApply={onApply} />
        ))
      )}

      {/* Fallback for stations not in Google Places (e.g. 7-Eleven) */}
      {coords && (
        <a
          href={`https://www.google.com/maps/search/gas+stations/@${coords.lat},${coords.lng},14z`}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center text-xs text-slate-400 py-3 hover:text-teal-600 transition-colors"
        >
          Don't see your station? Search in Google Maps →
        </a>
      )}
    </div>
  );
}
