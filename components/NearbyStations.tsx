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
import { useTranslation } from '@/contexts/LanguageContext';

import { Geolocation } from '@capacitor/geolocation';

// ── Types ────────────────────────────────────────────────────────────────────

interface CommunityPrice {
  grade: string;
  price: number;
  reportedAt: string; // ISO
}
// placeId → list of recent community prices (< 2h old)
type CommunityMap = Record<string, CommunityPrice[]>;

interface Props {
  /** Called when the user selects a price to use in the calculator */
  onApply?: (price: string, lat: number, lng: number, stationName: string, distanceMi: number, grade: string) => void;
  /** True when this tab is the currently visible tab (used to detect stale loading state on re-activation) */
  isActive?: boolean;
}

type Status = 'idle' | 'locating' | 'fetching' | 'done' | 'error' | 'no_key' | 'disabled';

const LOC_ASKED_KEY = 'gc_loc_asked';
const GRADE_ORDER: FuelPrice['type'][] = ['REGULAR', 'MIDGRADE', 'PREMIUM', 'DIESEL'];

interface TimeAgoLabels {
  justNow: string;
  minutesAgo: (m: number) => string;
  hoursAgo: (h: number) => string;
  daysAgo: (d: number) => string;
}

function timeAgo(iso: string | null, labels: TimeAgoLabels): string {
  if (!iso) return '';
  const diffMs  = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 2)  return labels.justNow;
  if (diffMin < 60) return labels.minutesAgo(diffMin);
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24)   return labels.hoursAgo(diffH);
  return labels.daysAgo(Math.round(diffH / 24));
}

// ── Gas pump SVG icon ────────────────────────────────────────────────────────

function PumpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
      {/* Pump cabinet body */}
      <rect x="2" y="5" width="18" height="24" rx="2.5"/>
      {/* Display screen */}
      <rect x="5" y="8" width="12" height="8" rx="1.5" fill="white" opacity="0.22"/>
      {/* Price readout lines */}
      <rect x="7" y="10" width="8" height="1.5" rx="0.75" fill="white" opacity="0.55"/>
      <rect x="7" y="13" width="5.5" height="1.5" rx="0.75" fill="white" opacity="0.55"/>
      {/* Fuel grade button row */}
      <rect x="5" y="18.5" width="3.5" height="3.5" rx="1" fill="white" opacity="0.28"/>
      <rect x="10.25" y="18.5" width="3.5" height="3.5" rx="1" fill="white" opacity="0.18"/>
      <rect x="15.5" y="18.5" width="2" height="3.5" rx="1" fill="white" opacity="0.12"/>
      {/* Base / ground */}
      <rect x="1" y="27.5" width="20" height="2.5" rx="1.5"/>
      {/* Nozzle arm (horizontal pipe from body) */}
      <rect x="20" y="10" width="5" height="2.2" rx="1.1"/>
      {/* Vertical drop */}
      <rect x="23" y="12" width="2.2" height="6" rx="1.1"/>
      {/* Nozzle head */}
      <rect x="20.5" y="17" width="4.8" height="2" rx="1"/>
      {/* Nozzle tip */}
      <rect x="19" y="18" width="2.5" height="5" rx="1.25"/>
      {/* Hose coil suggestion */}
      <path d="M22 18 Q26 18 26 22 Q26 26 22 26" fill="none"
            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.45"/>
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

function LocationPreScreen({ onAllow, onSkip, labels }: { onAllow: () => void; onSkip: () => void; labels: { findGasNearYou: string; locationPermissionBody: string; allowLocation: string; maybeLater: string } }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <div className="w-20 h-20 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mb-5">
        <MapPin className="w-10 h-10 text-amber-500" />
      </div>
      <h2 className="text-xl font-black text-slate-900 mb-2">{labels.findGasNearYou}</h2>
      <p className="text-sm text-slate-500 leading-relaxed mb-6 max-w-xs">
        {labels.locationPermissionBody}
      </p>
      <button
        onClick={onAllow}
        className="w-full max-w-xs py-3.5 rounded-2xl bg-[#005F4A] text-white text-sm
                   font-black tracking-wide mb-3 active:opacity-90 transition-opacity"
      >
        {labels.allowLocation}
      </button>
      <button
        onClick={onSkip}
        className="text-sm text-slate-400 font-medium hover:text-slate-600"
      >
        {labels.maybeLater}
      </button>
    </div>
  );
}

// ── Report Price inline form ─────────────────────────────────────────────────

function ReportPriceForm({
  station,
  userCoords,
  onSuccess,
  onCancel,
  gradeLabels,
  labels,
}: {
  station:    NearbyStation;
  userCoords: { lat: number; lng: number } | null;
  onSuccess:  (grade: string, price: number) => void;
  onCancel:   () => void;
  gradeLabels: Record<string, string>;
  labels: {
    errPriceRange: string;
    errLocationUnavailable: string;
    errSubmitFailed: string;
    errNetwork: string;
    reportPriceAtPump: string;
    submitting: string;
    submitEntries: string;
    cancel: string;
  };
}) {
  const [grade,       setGrade]       = useState('REGULAR');
  const [priceInput,  setPriceInput]  = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const price = parseFloat(priceInput);
    if (isNaN(price) || price < 0.50 || price > 10.00) {
      setError(labels.errPriceRange);
      return;
    }
    if (!userCoords) {
      setError(labels.errLocationUnavailable);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/gas/report-price', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          placeId:     station.placeId,
          stationName: station.name,
          stationLat:  station.lat,
          stationLng:  station.lng,
          userLat:     userCoords.lat,
          userLng:     userCoords.lng,
          grade,
          price,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? labels.errSubmitFailed);
        return;
      }
      onSuccess(grade, price);
    } catch {
      setError(labels.errNetwork);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="px-4 pb-3 pt-2 border-t border-slate-100 space-y-2">
      <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">{labels.reportPriceAtPump}</p>
      <div className="flex gap-2">
        <select
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          className="flex-1 text-sm rounded-xl border border-slate-200 px-2 py-1.5 bg-white text-slate-800"
        >
          {Object.entries(gradeLabels).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <div className="relative flex-1">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.001"
            placeholder="3.89"
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            className="w-full pl-6 pr-2 py-1.5 rounded-xl border border-slate-200 text-sm text-slate-800 bg-white"
            required
          />
        </div>
      </div>
      {error && <p className="text-[11px] text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 py-2 rounded-xl bg-[#005F4A] text-white text-sm font-bold disabled:opacity-50"
        >
          {submitting ? labels.submitting : labels.submitEntries}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-sm font-bold"
        >
          {labels.cancel}
        </button>
      </div>
    </form>
  );
}

// ── Station card ─────────────────────────────────────────────────────────────

interface StationCardLabels {
  miAway: string;
  open: string;
  closed: string;
  noLivePrice: string;
  community: string;
  noPriceDataYet: string;
  priceFromGoogle: string;
  stationFromGoogle: string;
  reportPrice: string;
  directions: string;
  justNow: string;
  minutesAgo: (m: number) => string;
  hoursAgo: (h: number) => string;
  daysAgo: (d: number) => string;
  errPriceRange: string;
  errLocationUnavailable: string;
  errSubmitFailed: string;
  errNetwork: string;
  reportPriceAtPump: string;
  submitting: string;
  submitEntries: string;
  cancel: string;
  gradeRegular: string;
  gradeMidgrade: string;
  gradePremium: string;
  gradeDiesel: string;
}

function StationCard({
  station,
  onApply,
  onHide,
  userCoords,
  communityPrices,
  onPriceReported,
  labels,
}: {
  station:         NearbyStation;
  onApply?:        (price: string, lat: number, lng: number, stationName: string, distanceMi: number, grade: string) => void;
  onHide?:         (placeId: string) => void;
  userCoords:      { lat: number; lng: number } | null;
  communityPrices: CommunityPrice[];
  onPriceReported: (placeId: string, grade: string, price: number) => void;
  labels:          StationCardLabels;
}) {
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportToast,    setReportToast]    = useState('');

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

  // Community price display: most recent report per grade (< 2h old)
  const communityByGrade: Record<string, CommunityPrice> = {};
  for (const cp of communityPrices) {
    const existing = communityByGrade[cp.grade];
    if (!existing || cp.reportedAt > existing.reportedAt) {
      communityByGrade[cp.grade] = cp;
    }
  }

  const gradeLabels: Record<string, string> = {
    REGULAR:  labels.gradeRegular,
    MIDGRADE: labels.gradeMidgrade,
    PREMIUM:  labels.gradePremium,
    DIESEL:   labels.gradeDiesel,
  };

  function handleReportSuccess(grade: string, price: number) {
    setShowReportForm(false);
    onPriceReported(station.placeId, grade, price);
    setReportToast(`+5 entries earned! Thanks for reporting ${gradeLabels[grade] ?? grade} at $${price.toFixed(2)}.`);
    setTimeout(() => setReportToast(''), 5000);
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header row */}
      <div className="px-4 pt-4 pb-2 flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-900 text-sm truncate">{station.name}</p>
          <p className="text-[11px] text-slate-400 mt-0.5 truncate">{station.address}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[11px] text-slate-500 font-medium">
              {station.distanceMi} {labels.miAway}
            </span>
            {station.isOpen === true  && <span className="text-[10px] font-bold text-emerald-600">{labels.open}</span>}
            {station.isOpen === false && <span className="text-[10px] font-bold text-red-500">{labels.closed}</span>}
          </div>
        </div>
        {onHide && (
          <button
            type="button"
            onClick={() => onHide(station.placeId)}
            aria-label="Remove station"
            className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
          >
            <svg viewBox="0 0 10 10" className="w-2.5 h-2.5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M2 2l6 6M8 2l-6 6" />
            </svg>
          </button>
        )}
        {bestPrice ? (
          <div className="text-right flex-shrink-0">
            <p className="text-2xl font-black text-slate-900 leading-none">
              ${bestPrice.price.toFixed(2)}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">{bestPrice.label}</p>
          </div>
        ) : communityByGrade['REGULAR'] ? (
          <div className="text-right flex-shrink-0">
            <p className="text-2xl font-black text-slate-900 leading-none">
              ${communityByGrade['REGULAR'].price.toFixed(2)}
            </p>
            <p className="text-[10px] text-amber-500 mt-0.5 font-bold">{labels.community}</p>
          </div>
        ) : (
          <div className="text-right flex-shrink-0">
            <p className="text-[11px] text-slate-400 italic leading-snug max-w-[100px]">
              {labels.noLivePrice}
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
            const community  = communityByGrade[type];
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
                {community && (
                  <p className="text-[9px] text-amber-500 font-bold mt-0.5">
                    ${community.price.toFixed(2)} reported
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* No Google price — show community prices if available */}
      {!hasPrices && Object.keys(communityByGrade).length > 0 && (
        <div className={`px-4 pb-3 grid gap-1.5 ${Object.keys(communityByGrade).length > 2 ? 'grid-cols-4' : 'grid-cols-2'}`}>
          {GRADE_ORDER.map((type) => {
            const cp = communityByGrade[type];
            if (!cp) return null;
            return (
              <button
                key={type}
                onClick={() => onApply?.(cp.price.toFixed(2), station.lat, station.lng, station.name, station.distanceMi, gradeLabels[type] ?? type)}
                className="rounded-xl px-2 py-1.5 text-center bg-amber-50 hover:bg-amber-100 active:opacity-80 transition-colors"
              >
                <p className="text-[9px] font-bold uppercase tracking-wider text-amber-600">
                  {gradeLabels[type] ?? type}
                </p>
                <p className="text-sm font-black text-slate-800">
                  ${cp.price.toFixed(2)}
                </p>
                <p className="text-[9px] text-amber-500 font-bold mt-0.5">{labels.community}</p>
              </button>
            );
          })}
        </div>
      )}

      {/* No-price fallback */}
      {!hasPrices && Object.keys(communityByGrade).length === 0 && (
        <div className="px-4 pb-3">
          <p className="text-[11px] text-slate-400 italic">
            {labels.noPriceDataYet}
          </p>
        </div>
      )}

      {/* Report price form or button */}
      {showReportForm ? (
        <ReportPriceForm
          station={station}
          userCoords={userCoords}
          onSuccess={handleReportSuccess}
          onCancel={() => setShowReportForm(false)}
          gradeLabels={gradeLabels}
          labels={labels}
        />
      ) : (
        <div className="border-t border-slate-100 px-4 py-2.5 flex items-center justify-between gap-2">
          <span className="text-[10px] text-slate-400">
            {freshest
              ? `${bestPrice?.label ?? 'Price'} · Updated ${timeAgo(freshest, labels)}`
              : hasPrices ? labels.priceFromGoogle : labels.stationFromGoogle}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowReportForm(true)}
              className="text-[11px] font-bold text-amber-600 flex items-center gap-0.5"
            >
              {labels.reportPrice}
            </button>
            <a
              href={appleDirections}
              className="text-[11px] font-bold text-teal-600 flex items-center gap-0.5"
            >
              {labels.directions} <ChevronRight className="w-3 h-3" />
            </a>
          </div>
        </div>
      )}

      {/* Success toast */}
      {reportToast && (
        <div className="px-4 py-2 bg-emerald-50 border-t border-emerald-100">
          <p className="text-[11px] text-emerald-700 font-bold">{reportToast}</p>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function NearbyStations({ onApply, isActive = true }: Props) {
  const { data: session, status: sessionStatus } = useSession();
  const isNative = useIsNative();
  const { t } = useTranslation();
  const plan    = (session?.user as { plan?: string } | undefined)?.plan ?? 'free';
  const isPro   = plan === 'pro' || plan === 'fleet' || plan === 'lifetime';
  const isGuest = sessionStatus === 'unauthenticated';

  const [status,         setStatus]         = useState<Status>('idle');
  const [stations,       setStations]       = useState<NearbyStation[]>([]);
  const [errMsg,         setErrMsg]         = useState('');
  const [coords,         setCoords]         = useState<{ lat: number; lng: number } | null>(null);
  const [hiddenPlaceIds, setHiddenPlaceIds] = useState<Set<string>>(new Set());
  const [communityMap,   setCommunityMap]   = useState<CommunityMap>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem('gascap_hidden_gas_stations');
      if (raw) setHiddenPlaceIds(new Set(JSON.parse(raw) as string[]));
    } catch { /* ignore */ }
  }, []);

  function hideStation(placeId: string) {
    setHiddenPlaceIds((prev) => {
      const next = new Set(prev).add(placeId);
      try { localStorage.setItem('gascap_hidden_gas_stations', JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }
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
    const timer = setTimeout(() => {
      fetchGenRef.current++;
      fetchControllerRef.current?.abort();
      setStatus('error');
      setErrMsg(t.findGasTab.errTimeout);
    }, TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [status]);

  // Helper: run a fetch inside a dedicated Web Worker (not intercepted by the SW).
  // Returns { status, text } or throws with a descriptive message.
  const workerFetch = useCallback((fetchUrl: string, timeoutMs = 13000): Promise<{ status: number; text: string }> => {
    return new Promise((resolve, reject) => {
      const code = [
        'self.onmessage=async function(e){',
        '  var url=e.data;',
        '  try{',
        '    var r=await fetch(url,{credentials:"include",cache:"no-store",headers:{"Cache-Control":"no-store"}});',
        '    var t=await r.text();',
        '    self.postMessage({status:r.status,text:t});',
        '  }catch(err){',
        '    self.postMessage({error:String(err)});',
        '  }',
        '};',
      ].join('');

      let worker: Worker;
      let blobUrl: string;
      try {
        blobUrl = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
        worker  = new Worker(blobUrl);
      } catch (e) {
        reject(e);
        return;
      }

      const cleanup = () => { try { worker.terminate(); } catch { /**/ } URL.revokeObjectURL(blobUrl); };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('worker-timeout'));
      }, timeoutMs);

      worker.onmessage = (e: MessageEvent) => {
        clearTimeout(timer);
        cleanup();
        if (e.data.error) {
          reject(new Error(e.data.error));
        } else {
          resolve({ status: e.data.status, text: e.data.text });
        }
      };

      worker.onerror = (e: ErrorEvent) => {
        clearTimeout(timer);
        cleanup();
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

    const nearbyUrl = `https://www.gascap.app/gas/nearby?lat=${lat}&lng=${lng}&_=${Date.now()}`;

    try {
      type GasData = { stations?: NearbyStation[]; proRequired?: boolean; reason?: string; error?: string; disabled?: boolean };
      let data: GasData;
      let httpStatus: number;

      if (isNative) {
        // Ping pre-flight — warms the connection; failure is non-fatal
        const pingUrl = `https://www.gascap.app/gas/ping?_=${Date.now()}`;
        try { await workerFetch(pingUrl, 8000); } catch { /* proceed anyway */ }

        if (gen !== fetchGenRef.current) return;

        // Dedicated Web Workers bypass the service worker (spec-guaranteed)
        const workerResult = await workerFetch(nearbyUrl);

        if (gen !== fetchGenRef.current) return;
        httpStatus = workerResult.status;
        try { data = JSON.parse(workerResult.text); }
        catch {
          setStatus('error'); setErrMsg(t.findGasTab.errServerResponse); return;
        }
      } else {
        const res = await fetch(nearbyUrl, {
          signal:  controller.signal,
          cache:   'no-store',
          headers: { 'Cache-Control': 'no-store' },
        });
        if (gen !== fetchGenRef.current) return;
        httpStatus = res.status;
        const text = await res.text();
        try { data = JSON.parse(text); }
        catch {
          setStatus('error'); setErrMsg(t.findGasTab.errServerResponse); return;
        }
      }

      if (gen !== fetchGenRef.current) return;

      if (httpStatus >= 400) {
        setStatus('error'); setErrMsg(t.findGasTab.errHttpStatus(httpStatus)); return;
      }
      if (data.proRequired) {
        setStatus('error'); setErrMsg(t.findGasTab.errProRequired); return;
      }
      if (data.disabled) { setStatus('disabled'); return; }
      if (data.error)    { setStatus('error'); setErrMsg(data.error); return; }

      const loaded = data.stations ?? [];
      setStations(loaded);
      setStatus('done');

      // Fetch community prices for visible stations
      if (loaded.length > 0) {
        const ids = loaded.map((s: NearbyStation) => s.placeId).join(',');
        fetch(`/gas/community-prices?placeIds=${encodeURIComponent(ids)}`)
          .then((r) => r.ok ? r.json() : null)
          .then((d: CommunityMap | null) => { if (d) setCommunityMap(d); })
          .catch(() => {});
      }

    } catch (err) {
      if (gen !== fetchGenRef.current) return;
      const name = err instanceof Error ? err.name : 'unknown';
      if (name !== 'AbortError') {
        setStatus('error');
        setErrMsg(t.findGasTab.errLoadFailed);
      }
    }
  }, [isNative, workerFetch]);

  const requestLocation = useCallback((_source: 'auto' | 'allow' | 'retry' | 'manual' = 'auto') => {
    const geoGen = ++geoGenRef.current;
    fetchGenRef.current++;
    fetchControllerRef.current?.abort();

    setStatus('locating');

    if (!navigator.geolocation) {
      setStatus('error');
      setErrMsg(t.findGasTab.errGeoUnavailable);
      return;
    }

    // Hard 20s outer timeout — guards against silent hangs in either path
    let geoDone = false;
    const geoTimer = setTimeout(() => {
      if (geoDone) return;
      geoDone = true;
      if (geoGen !== geoGenRef.current) return;
      setStatus('error');
      setErrMsg('Location request timed out. Tap retry to try again.');
    }, 20000);

    if (isNative) {
      // navigator.geolocation.getCurrentPosition() never fires in WKWebView
      // remote-server mode; Capacitor plugin talks directly to CoreLocation.
      (async () => {
        let permStatus: string;
        try {
          const perm = await Geolocation.checkPermissions();
          permStatus = perm.location;
        } catch {
          permStatus = 'unknown';
        }

        if (permStatus === 'denied') {
          if (geoDone) return;
          geoDone = true;
          clearTimeout(geoTimer);
          if (geoGen !== geoGenRef.current) return;
          setStatus('error');
          setErrMsg(t.findGasTab.errLocationDeniedIos);
          return;
        }

        if (permStatus !== 'granted') {
          try {
            const req = await Geolocation.requestPermissions({ permissions: ['location'] });
            if (req.location === 'denied') {
              if (geoDone) return;
              geoDone = true;
              clearTimeout(geoTimer);
              if (geoGen !== geoGenRef.current) return;
              setStatus('error');
              setErrMsg(t.findGasTab.errLocationDeniedIos);
              return;
            }
          } catch {
            // Continue — getCurrentPosition will fail with a clear error if really denied
          }
        }

        try {
          const pos = await Geolocation.getCurrentPosition({
            enableHighAccuracy: true,
            timeout: 15000,
          });
          if (geoDone) return;
          geoDone = true;
          clearTimeout(geoTimer);
          if (geoGen !== geoGenRef.current) return;
          const lat = Math.round(pos.coords.latitude  * 100) / 100;
          const lng = Math.round(pos.coords.longitude * 100) / 100;
          doLookup(lat, lng);
        } catch (e) {
          if (geoDone) return;
          geoDone = true;
          clearTimeout(geoTimer);
          if (geoGen !== geoGenRef.current) return;
          const msg = e instanceof Error ? e.message : String(e);
          setStatus('error');
          setErrMsg(
            msg.toLowerCase().includes('denied')
              ? t.findGasTab.errLocationDeniedIos
              : t.findGasTab.errLocationGeneric(msg.slice(0, 40)),
          );
        }
      })();
    } else {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (geoDone) return;
          geoDone = true;
          clearTimeout(geoTimer);
          if (geoGen !== geoGenRef.current) return;
          const lat = Math.round(pos.coords.latitude  * 100) / 100;
          const lng = Math.round(pos.coords.longitude * 100) / 100;
          doLookup(lat, lng);
        },
        (err) => {
          if (geoDone) return;
          geoDone = true;
          clearTimeout(geoTimer);
          if (geoGen !== geoGenRef.current) return;
          setStatus('error');
          setErrMsg(
            err.code === 1
              ? t.findGasTab.errLocationDenied
              : t.findGasTab.errLocationCode(err.code),
          );
        },
        { timeout: 10000, maximumAge: 300_000, enableHighAccuracy: false },
      );
    }
  }, [doLookup, isNative]);

  function handleAllow() {
    try { localStorage.setItem(LOC_ASKED_KEY, '1'); } catch { /* ignore */ }
    setLocAsked(true);
    requestLocation('allow');
  }

  function handleSkip() {
    try { localStorage.setItem(LOC_ASKED_KEY, '1'); } catch { /* ignore */ }
    setLocAsked(true);
  }

  // ── Stale loading state: reset on tab re-activation or app foreground ───────
  const prevActiveRef = useRef(false);
  useEffect(() => {
    const wasActive = prevActiveRef.current;
    prevActiveRef.current = !!isActive;
    if (isActive && !wasActive && (status === 'fetching' || status === 'locating')) {
      fetchGenRef.current++;
      fetchControllerRef.current?.abort();
      setStatus('error');
      setErrMsg('Fuel pricing timed out. Tap retry to try again.');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  useEffect(() => {
    if (!isNative) return;
    let cleanup: (() => void) | null = null;
    import('@capacitor/app').then(({ App }) => {
      App.addListener('appStateChange', ({ isActive: appActive }) => {
        if (appActive && (status === 'fetching' || status === 'locating')) {
          fetchGenRef.current++;
          fetchControllerRef.current?.abort();
          setStatus('error');
          setErrMsg('Fuel pricing timed out. Tap retry to try again.');
        }
      }).then((handle) => { cleanup = () => handle.remove(); });
    }).catch(() => {});
    return () => { cleanup?.(); };
  }, [isNative, status]);

  // Auto-fetch intentionally removed — user must tap "Use My Location" explicitly.
  // Auto-fetch was causing getCurrentPosition to hang silently on native.

  // ── Guest gate ──────────────────────────────────────────────────────────────
  const stationCardLabels: StationCardLabels = {
    miAway:             t.findGasTab.miAway,
    open:               t.findGasTab.open,
    closed:             t.findGasTab.closed,
    noLivePrice:        t.findGasTab.noLivePrice,
    community:          t.findGasTab.community,
    noPriceDataYet:     t.findGasTab.noPriceDataYet,
    priceFromGoogle:    t.findGasTab.priceFromGoogle,
    stationFromGoogle:  t.findGasTab.stationFromGoogle,
    reportPrice:        t.findGasTab.reportPrice,
    directions:         t.findGasTab.directions,
    justNow:            t.findGasTab.justNow,
    minutesAgo:         t.findGasTab.minutesAgo,
    hoursAgo:           t.findGasTab.hoursAgo,
    daysAgo:            t.findGasTab.daysAgo,
    errPriceRange:      t.findGasTab.errPriceRange,
    errLocationUnavailable: t.findGasTab.errLocationUnavailable,
    errSubmitFailed:    t.findGasTab.errSubmitFailed,
    errNetwork:         t.findGasTab.errNetwork,
    reportPriceAtPump:  t.findGasTab.reportPriceAtPump,
    submitting:         t.findGasTab.submitting,
    submitEntries:      t.findGasTab.submitEntries,
    cancel:             t.findGasTab.cancel,
    gradeRegular:       t.findGasTab.gradeRegular,
    gradeMidgrade:      t.findGasTab.gradeMidgrade,
    gradePremium:       t.findGasTab.gradePremium,
    gradeDiesel:        t.findGasTab.gradeDiesel,
  };

  if (isGuest) {
    return (
      <div className="px-4 pt-8 pb-4 max-w-lg mx-auto text-center">
        <PumpIcon className="w-12 h-12 text-amber-400 mx-auto mb-4" />
        <h2 className="text-lg font-black text-slate-900 mb-2">{t.findGasTab.findGasNearYou}</h2>
        <p className="text-sm text-slate-500 mb-5">
          {t.findGasTab.guestGateBody}
        </p>
        <Link href="/signup"
          className="inline-block px-6 py-3 rounded-2xl bg-[#005F4A] text-white font-black text-sm">
          {t.findGasTab.guestGateCta}
        </Link>
      </div>
    );
  }

  // ── Pro upgrade prompt ──────────────────────────────────────────────────────
  if (!isPro && sessionStatus === 'authenticated') {
    return (
      <div className="px-4 pt-8 pb-4 max-w-lg mx-auto text-center">
        <PumpIcon className="w-12 h-12 text-amber-400 mx-auto mb-4" />
        <h2 className="text-lg font-black text-slate-900 mb-2">{t.findGasTab.findGasNearYou}</h2>
        <p className="text-sm text-slate-500 mb-2">
          {t.findGasTab.proGateBody}
        </p>
        <ul className="text-left text-sm text-slate-600 space-y-1 mb-5 mx-auto max-w-xs">
          <li>⛽ {t.findGasTab.proGateFeature1}</li>
          <li>📍 {t.findGasTab.proGateFeature2}</li>
          <li>🏆 {t.findGasTab.proGateFeature3}</li>
        </ul>
        <Link href="/upgrade"
          className="inline-block px-6 py-3 rounded-2xl bg-brand-orange text-white font-black text-sm">
          {t.findGasTab.proGateCta}
        </Link>
      </div>
    );
  }

  // ── Location pre-screen (first time) ───────────────────────────────────────
  if (!locAsked) {
    return <LocationPreScreen onAllow={handleAllow} onSkip={handleSkip} labels={{
      findGasNearYou: t.findGasTab.findGasNearYou,
      locationPermissionBody: t.findGasTab.locationPermissionBody,
      allowLocation: t.findGasTab.allowLocation,
      maybeLater: t.findGasTab.maybeLater,
    }} />;
  }

  // ── Feature disabled ────────────────────────────────────────────────────────
  if (status === 'disabled') {
    return (
      <div className="px-4 pt-8 pb-4 max-w-lg mx-auto text-center">
        <PumpIcon className="w-12 h-12 text-slate-300 mx-auto mb-4" />
        <h2 className="text-lg font-black text-slate-900 mb-2">{t.findGasTab.findGasNearYou}</h2>
        <p className="text-sm text-slate-500">
          {t.findGasTab.comingSoonBody}
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
          {status === 'locating' ? t.findGasTab.findingLocation : t.findGasTab.loadingStations}
        </p>
      </div>
    );
  }

  // ── Error ───────────────────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <div className="px-4 pt-8 max-w-lg mx-auto text-center flex flex-col items-center">
        <PumpIcon className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-600 mb-4 max-w-xs mx-auto leading-snug">{errMsg}</p>
        <div className="mt-4 w-full max-w-xs space-y-2">
          <button
            onClick={() => requestLocation('retry')}
            className="w-full py-3 rounded-2xl bg-[#005F4A] text-white text-sm font-black"
          >
            {t.findGasTab.tryAgain}
          </button>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('gc:switch-tab', { detail: { tab: 'calculator' } }))}
            className="w-full py-3 rounded-2xl bg-slate-100 text-slate-700 text-sm font-bold"
          >
            {t.findGasTab.enterPriceManually}
          </button>
        </div>
      </div>
    );
  }

  // ── Idle — always show button; never auto-start (prevents silent geo hang) ───
  if (status === 'idle') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] px-6 text-center">
        <PumpIcon className="w-14 h-14 text-slate-300 mb-4" />
        <p className="text-slate-500 text-sm mb-4">{t.findGasTab.tapToFind}</p>
        <button
          onClick={() => {
            try { localStorage.setItem(LOC_ASKED_KEY, '1'); } catch { /* ignore */ }
            setLocAsked(true);
            requestLocation('manual');
          }}
          className="px-6 py-3 rounded-2xl bg-[#005F4A] text-white font-black text-sm
                     active:opacity-90 transition-opacity"
        >
          {t.findGasTab.useMyLocation}
        </button>
      </div>
    );
  }

  // ── Results ─────────────────────────────────────────────────────────────────
  return (
    <div className="px-4 pt-4 pb-6 max-w-lg mx-auto w-full space-y-3">
      <p className="text-xs font-semibold text-teal-600 text-center bg-teal-50 rounded-xl py-2 px-3 mb-2">
        {t.findGasTab.tapAnyPrice}
      </p>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-slate-500 font-medium">
          {t.findGasTab.stationCount(stations.length)}
        </p>
        <button
          onClick={() => coords && doLookup(coords.lat, coords.lng)}
          className="text-xs text-teal-600 font-bold"
        >
          {t.findGasTab.refresh}
        </button>
      </div>

      {(() => {
        const visible = stations.filter((s) => !hiddenPlaceIds.has(s.placeId));
        if (visible.length === 0) return (
          <div className="text-center py-10">
            <p className="text-slate-400 text-sm">{t.findGasTab.noStationsFound}</p>
            <p className="text-slate-400 text-xs mt-1">{t.findGasTab.googlePlacesLimited}</p>
            {hiddenPlaceIds.size > 0 && (
              <button
                type="button"
                onClick={() => {
                  setHiddenPlaceIds(new Set());
                  try { localStorage.removeItem('gascap_hidden_gas_stations'); } catch { /* ignore */ }
                }}
                className="mt-3 text-xs text-teal-600 font-bold underline"
              >
                {t.findGasTab.restoreHidden}
              </button>
            )}
          </div>
        );
        return visible.map((s) => (
          <StationCard
            key={s.placeId}
            station={s}
            onApply={onApply}
            onHide={hideStation}
            userCoords={coords}
            communityPrices={communityMap[s.placeId] ?? []}
            labels={stationCardLabels}
            onPriceReported={(placeId, grade, price) => {
              const report: CommunityPrice = { grade, price, reportedAt: new Date().toISOString() };
              setCommunityMap((prev) => ({
                ...prev,
                [placeId]: [...(prev[placeId] ?? []), report],
              }));
            }}
          />
        ));
      })()}

      {/* Fallback for stations not in Google Places (e.g. 7-Eleven) */}
      {coords && (
        <a
          href={`https://www.google.com/maps/search/gas+stations/@${coords.lat},${coords.lng},14z`}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center text-xs text-slate-400 py-3 hover:text-teal-600 transition-colors"
        >
          {t.findGasTab.openGoogleMaps}
        </a>
      )}
    </div>
  );
}
