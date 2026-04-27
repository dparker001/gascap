'use client';

/**
 * FeaturedStation — shows a compact "Partner Station Near You" banner
 * when a GasCap partner station is registered in the user's city.
 *
 * Flow:
 *   1. Pre-check /api/partner-stations (no params) — if 0 featured stations
 *      exist anywhere, bail immediately without ever asking for location.
 *   2. Only if featured stations exist: check localStorage for a cached
 *      city/state (TTL 24 h) before requesting geolocation. This means the
 *      browser location prompt fires at most once per day, not on every load.
 *   3. Match by city → render banner, or render nothing if no nearby partner.
 *
 * - Dismissible; dismissed state persists in localStorage for 24 h
 * - Renders nothing if no partner station found or location unavailable
 */

import { useEffect, useState } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';

interface Station {
  code:    string;
  station: string;
  address: string | null;
  city:    string | null;
}

const DISMISS_KEY  = 'gc_featured_station_dismissed';
const LOCATION_KEY = 'gc_location_cache';
const TTL_24H      = 24 * 60 * 60 * 1000;

function isDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const { ts } = JSON.parse(raw) as { ts: number };
    return Date.now() - ts < TTL_24H;
  } catch { return false; }
}

function setDismissed() {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify({ ts: Date.now() })); }
  catch { /* storage unavailable */ }
}

function getCachedLocation(): { city: string; state: string } | null {
  try {
    const raw = localStorage.getItem(LOCATION_KEY);
    if (!raw) return null;
    const { city, state, ts } = JSON.parse(raw) as { city: string; state: string; ts: number };
    return Date.now() - ts < TTL_24H ? { city, state } : null;
  } catch { return null; }
}

function setCachedLocation(city: string, state: string) {
  try { localStorage.setItem(LOCATION_KEY, JSON.stringify({ city, state, ts: Date.now() })); }
  catch { /* storage unavailable */ }
}

export default function FeaturedStation() {
  const { t } = useTranslation();
  const fs = t.featuredStation;

  const [station, setStation] = useState<Station | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isDismissed()) return;

    let cancelled = false;

    async function detect() {
      // ── Step 1: pre-check — are there ANY featured stations at all? ──────
      // If not, skip everything — no location prompt, no banner.
      try {
        const precheck = await fetch('/api/partner-stations');
        if (!precheck.ok || cancelled) return;
        const predata = await precheck.json() as { stations: Station[] };
        if (predata.stations.length === 0 || cancelled) return;
      } catch { return; }

      // ── Step 2: get city — use cached value before asking the browser ────
      let city  = '';
      let state = '';

      const cached = getCachedLocation();
      if (cached) {
        city  = cached.city;
        state = cached.state;
      } else {
        // Ask for location once; cache the result so we don't ask again today
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 6000 }),
          );
          const { latitude, longitude } = pos.coords;
          const geo = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
            { headers: { 'User-Agent': 'GasCap/1.0 (info@gascap.app)' } },
          );
          if (geo.ok) {
            const d = await geo.json() as {
              address?: { city?: string; town?: string; county?: string; state_code?: string; 'ISO3166-2-lvl4'?: string };
            };
            city  = d.address?.city ?? d.address?.town ?? d.address?.county ?? '';
            const raw   = d.address?.state_code ?? d.address?.['ISO3166-2-lvl4'] ?? '';
            state = raw.includes('-') ? raw.split('-')[1] : raw;
            setCachedLocation(city, state);
          }
        } catch {
          // Location denied or unavailable — proceed without city filter
          // (will fall back to showing any featured station)
        }
      }

      if (cancelled) return;

      // ── Step 3: fetch nearest featured station for this city ─────────────
      const params = new URLSearchParams();
      if (city)  params.set('city',  city);
      if (state) params.set('state', state);

      try {
        const res  = await fetch(`/api/partner-stations?${params}`);
        if (!res.ok || cancelled) return;
        const data = await res.json() as { stations: Station[] };
        if (data.stations.length > 0 && !cancelled) {
          setStation(data.stations[0]);
          setVisible(true);
        }
      } catch { /* silent */ }
    }

    void detect();
    return () => { cancelled = true; };
  }, []);

  function handleDismiss() {
    setVisible(false);
    setDismissed();
  }

  if (!visible || !station) return null;

  return (
    <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl
                    px-4 py-3 shadow-sm animate-fade-in">
      {/* Icon */}
      <div className="w-8 h-8 rounded-xl bg-amber-500 flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="text-base" aria-hidden="true">🏪</span>
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-xs font-black text-amber-800">{fs.heading}</p>
          <span className="text-[9px] font-black bg-amber-500 text-white px-1.5 py-0.5 rounded-full leading-none">
            {fs.badge}
          </span>
        </div>
        <p className="text-xs text-amber-700 font-semibold mt-0.5 truncate">{station.station}</p>
        {(station.address || station.city) && (
          <p className="text-[10px] text-amber-600 mt-0.5 truncate">
            {[station.address, station.city].filter(Boolean).join(' · ')}
          </p>
        )}
        <p className="text-[10px] text-amber-500 mt-1 leading-relaxed">
          {fs.tagline}
        </p>
      </div>

      {/* Dismiss */}
      <button
        onClick={handleDismiss}
        className="flex-shrink-0 text-amber-300 hover:text-amber-500 transition-colors mt-0.5"
        aria-label={fs.dismiss}
      >
        <svg viewBox="0 0 12 12" className="w-3.5 h-3.5" fill="none"
             stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M1 1l10 10M11 1L1 11" />
        </svg>
      </button>
    </div>
  );
}
