'use client';

/**
 * NearbyStations — Find Gas tab content.
 *
 * Shows nearby gas stations with fuel prices from Google Places.
 * Pro-gated. Requests location permission via LocationPreScreen first.
 * "Use this price" fires onApply into the parent calculator.
 */

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import type { NearbyStation, FuelPrice } from '@/lib/nearbyGas';

interface Props {
  /** Called when the user selects a price to use in the calculator */
  onApply?: (price: string, lat: number, lng: number) => void;
}

type Status = 'idle' | 'locating' | 'fetching' | 'done' | 'error' | 'no_key';

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
  onApply?: (price: string, lat: number, lng: number) => void;
}) {
  const regular = station.prices.find((p) => p.type === 'REGULAR');

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
        {regular && (
          <div className="text-right flex-shrink-0">
            <p className="text-2xl font-black text-slate-900 leading-none">
              ${regular.price.toFixed(2)}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">Regular</p>
          </div>
        )}
      </div>

      {/* Price grid */}
      {station.prices.length > 0 && (
        <div className={`px-4 pb-3 grid gap-1.5 ${station.prices.length > 2 ? 'grid-cols-4' : 'grid-cols-2'}`}>
          {GRADE_ORDER.map((type) => {
            const fp = station.prices.find((p) => p.type === type);
            if (!fp) return null;
            return (
              <div key={type} className="bg-slate-50 rounded-xl px-2 py-1.5 text-center">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{fp.label}</p>
                <p className="text-sm font-black text-slate-800">${fp.price.toFixed(2)}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Staleness + actions */}
      <div className="border-t border-slate-100 px-4 py-2.5 flex items-center justify-between gap-2">
        <span className="text-[10px] text-slate-400">
          {freshest ? `Updated ${timeAgo(freshest)}` : 'Price data from Google'}
        </span>
        <div className="flex items-center gap-2">
          <a
            href={appleDirections}
            className="text-[11px] font-bold text-teal-600 flex items-center gap-0.5"
          >
            Directions <ChevronRight className="w-3 h-3" />
          </a>
          {onApply && regular && (
            <button
              onClick={() => onApply(regular.price.toFixed(2), station.lat, station.lng)}
              className="text-[11px] font-black text-white bg-[#005F4A] rounded-lg px-2.5 py-1
                         active:opacity-90 transition-opacity"
            >
              Use price →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function NearbyStations({ onApply }: Props) {
  const { data: session, status: sessionStatus } = useSession();
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

  const doLookup = useCallback(async (lat: number, lng: number) => {
    setStatus('fetching');
    setCoords({ lat, lng });
    try {
      const res  = await fetch(`/api/nearby-gas?lat=${lat}&lng=${lng}`);
      const text = await res.text();
      let data: { stations?: NearbyStation[]; proRequired?: boolean; error?: string };
      try { data = JSON.parse(text); }
      catch {
        console.error('[NearbyStations] non-JSON response:', res.status, text.slice(0, 200));
        setStatus('error');
        setErrMsg(`Server error (${res.status}). Please try again.`);
        return;
      }
      if (data.proRequired) { setStatus('idle'); return; }
      if (data.error)       { setStatus('error'); setErrMsg(data.error); return; }
      setStations(data.stations ?? []);
      setStatus('done');
    } catch (err) {
      console.error('[NearbyStations] fetch error:', err);
      setStatus('error');
      setErrMsg('Network error — please try again.');
    }
  }, []);

  const requestLocation = useCallback(() => {
    setStatus('locating');
    if (!navigator.geolocation) {
      setStatus('error');
      setErrMsg('Geolocation not available on this device.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => doLookup(
        Math.round(pos.coords.latitude  * 100) / 100,
        Math.round(pos.coords.longitude * 100) / 100,
      ),
      (err) => {
        setStatus('error');
        setErrMsg(
          err.code === 1
            ? 'Location access denied. Enable location in Settings.'
            : 'Could not get your location. Please try again.',
        );
      },
      { timeout: 8000, maximumAge: 300_000, enableHighAccuracy: false },
    );
  }, [doLookup]);

  function handleAllow() {
    try { localStorage.setItem(LOC_ASKED_KEY, '1'); } catch { /* ignore */ }
    setLocAsked(true);
    requestLocation();
  }

  function handleSkip() {
    try { localStorage.setItem(LOC_ASKED_KEY, '1'); } catch { /* ignore */ }
    setLocAsked(true);
  }

  // On mount: if permission already granted (and Pro), silently fetch.
  useEffect(() => {
    if (!isPro || sessionStatus === 'loading') return;
    if (!navigator.geolocation) return;
    try {
      navigator.permissions?.query?.({ name: 'geolocation' as PermissionName })
        .then((p) => { if (p.state === 'granted') requestLocation(); })
        .catch(() => {
          // Permissions API unavailable (Capacitor WebView) — just request directly
          // if the user has already dismissed the pre-screen
          try {
            const asked = localStorage.getItem(LOC_ASKED_KEY);
            if (asked === '1') requestLocation();
          } catch { /* ignore */ }
        });
    } catch {
      // Permissions API not supported at all
    }
  }, [isPro, sessionStatus, requestLocation]);

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

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (status === 'locating' || status === 'fetching') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3">
        <span className="w-8 h-8 border-[3px] border-teal-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-500">
          {status === 'locating' ? 'Finding your location…' : 'Loading nearby stations…'}
        </p>
      </div>
    );
  }

  // ── Error ───────────────────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <div className="px-4 pt-8 max-w-lg mx-auto text-center">
        <p className="text-sm text-red-500 mb-3">{errMsg}</p>
        <button
          onClick={() => { setErrMsg(''); requestLocation(); }}
          className="px-5 py-2.5 rounded-2xl bg-[#005F4A] text-white text-sm font-black"
        >
          Try again
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
          onClick={requestLocation}
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
    </div>
  );
}
