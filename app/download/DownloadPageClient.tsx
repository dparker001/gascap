'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { gtagEvent, fbTrack } from '@/lib/gtag';

// Real, live store listings (also used in emailCampaign.ts / ReviewNudge.tsx).
const IOS_URL     = process.env.NEXT_PUBLIC_GASCAP_IOS_APP_URL     || 'https://apps.apple.com/app/id6761315915';
const ANDROID_URL = process.env.NEXT_PUBLIC_GASCAP_ANDROID_APP_URL || 'https://play.google.com/store/apps/details?id=app.gascap.mobile';
const DOWNLOAD_URL = 'https://www.gascap.app/download';

type Device = 'ios' | 'android' | 'other';

function detectDevice(): Device {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}

function utmParams(searchParams: URLSearchParams) {
  const params: Record<string, string> = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    const v = searchParams.get(key);
    if (v) params[key] = v;
  }
  return params;
}

const BENEFITS = [
  {
    icon: '📍',
    title: 'Find Nearby Gas Prices',
    body: 'See real-time prices at nearby stations so you always know where to fill up for less.',
  },
  {
    icon: '⛽',
    title: 'Know Your Fill-Up Cost',
    body: 'Set your fuel level and target, and GasCap™ tells you the exact cost before you pump a drop.',
  },
  {
    icon: '💰',
    title: 'Budget Before You Pump',
    body: 'Enter a dollar amount and see exactly how many gallons it buys — no more guessing at the pump.',
  },
  {
    icon: '🚗',
    title: 'Manage Your Vehicles',
    body: 'Save every vehicle in your garage, track tank size, and switch between them in a tap.',
  },
  {
    icon: '📊',
    title: 'Track Fuel Usage',
    body: 'Log fill-ups and watch your MPG, spending, and savings trends over time.',
  },
];

function AppleBadge({ large, onClick }: { large?: boolean; onClick: () => void }) {
  return (
    <a
      href={IOS_URL}
      onClick={onClick}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Download on the App Store"
      className={`inline-flex items-center justify-center gap-2 rounded-xl bg-black text-white font-semibold shadow-lift hover:opacity-90 transition-opacity ${large ? 'px-6 py-4 text-base' : 'px-5 py-3 text-sm'}`}
      style={{ minHeight: 44 }}
    >
      <svg viewBox="0 0 384 512" width="20" height="20" fill="currentColor" aria-hidden="true">
        <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
      </svg>
      <span>
        <span className="block text-[10px] leading-none opacity-80">Download on the</span>
        <span className="block text-sm font-bold leading-tight">App Store</span>
      </span>
    </a>
  );
}

function PlayBadge({ large, onClick }: { large?: boolean; onClick: () => void }) {
  return (
    <a
      href={ANDROID_URL}
      onClick={onClick}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Get it on Google Play"
      className={`inline-flex items-center justify-center gap-2 rounded-xl bg-black text-white font-semibold shadow-lift hover:opacity-90 transition-opacity ${large ? 'px-6 py-4 text-base' : 'px-5 py-3 text-sm'}`}
      style={{ minHeight: 44 }}
    >
      <svg viewBox="0 0 512 512" width="20" height="20" fill="currentColor" aria-hidden="true">
        <path d="M325.3 234.3L104.6 13c-6.2-6.1-16.4-6.5-23.3-.9-3.8 3.1-6 7.9-6 12.8v462.2c0 4.9 2.2 9.7 6 12.8 6.9 5.6 17.1 5.2 23.3-.9l220.7-221.3zm97.5 44.2l-49.4-29-52.9 53 52.9 53 49.4-29c25.2-14.8 25.2-53.2 0-68z" />
      </svg>
      <span>
        <span className="block text-[10px] leading-none opacity-80">GET IT ON</span>
        <span className="block text-sm font-bold leading-tight">Google Play</span>
      </span>
    </a>
  );
}

export default function DownloadPageClient() {
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  const [device, setDevice] = useState<Device>('other');

  useEffect(() => {
    const d = detectDevice();
    setDevice(d);
    setMounted(true);

    const utm = utmParams(searchParams);
    const params = {
      device: d,
      referrer: typeof document !== 'undefined' ? document.referrer || 'direct' : 'direct',
      ...utm,
    };
    gtagEvent('download_page_view', params);
    fbTrack('ViewContent', { content_name: 'download_page', ...utm });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function trackStoreClick(store: 'app_store' | 'google_play') {
    const utm = utmParams(searchParams);
    const eventName = store === 'app_store' ? 'app_store_click' : 'google_play_click';
    const params = { device, ...utm };
    gtagEvent(eventName, params);
    fbTrack(store === 'app_store' ? 'AppStoreClick' : 'GooglePlayClick', params);
  }

  // Before `mounted`, always render both badges equally so SSR output matches
  // the first client render (no hydration mismatch) — reordering happens after.
  const showIosFirst = mounted && device === 'ios';
  const showAndroidFirst = mounted && device === 'android';
  const bothEqual = !mounted || device === 'other';

  return (
    <main className="min-h-screen bg-white text-brand-dark">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div
        className="bg-brand-dark px-5 pb-4 flex items-center gap-1.5"
        style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}
      >
        <Link href="/" className="flex items-center gap-1.5 w-fit">
          <img
            src="/gascap-icon-raw.png"
            alt=""
            className="h-9 w-auto object-contain drop-shadow-sm"
            aria-hidden="true"
          />
          <span className="text-white font-black text-xl leading-none tracking-tight">
            GasCap<sup className="text-xs font-bold" style={{ verticalAlign: '0.6em' }}>™</sup>
          </span>
        </Link>
      </div>

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="px-5 pt-10 pb-8 text-center max-w-lg mx-auto">
        <h1 className="text-3xl sm:text-4xl font-black leading-tight mb-3">
          Know Before You Go.
        </h1>
        <p className="text-lg font-semibold text-brand-teal mb-3">
          Know what your fill-up will cost before you ever reach the pump.
        </p>
        <p className="text-gray-600 text-sm sm:text-base mb-8">
          GasCap™ helps drivers find nearby gas prices, estimate exactly how much fuel they can
          purchase, calculate fill-up costs, manage vehicles, and make smarter decisions before
          stopping for gas.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          {bothEqual && (
            <>
              <AppleBadge onClick={() => trackStoreClick('app_store')} />
              <PlayBadge onClick={() => trackStoreClick('google_play')} />
            </>
          )}
          {showIosFirst && (
            <>
              <AppleBadge large onClick={() => trackStoreClick('app_store')} />
              <PlayBadge onClick={() => trackStoreClick('google_play')} />
            </>
          )}
          {showAndroidFirst && (
            <>
              <PlayBadge large onClick={() => trackStoreClick('google_play')} />
              <AppleBadge onClick={() => trackStoreClick('app_store')} />
            </>
          )}
        </div>
      </section>

      {/* ── Benefits ───────────────────────────────────────────────────── */}
      <section className="px-5 py-10 bg-gray-50">
        <h2 className="text-2xl font-bold text-center mb-8">Why Drivers Love GasCap™</h2>
        <div className="max-w-2xl mx-auto grid gap-5 sm:grid-cols-2">
          {BENEFITS.map((b) => (
            <div key={b.title} className="bg-white rounded-xl shadow-card p-5 flex gap-4">
              <span className="text-3xl leading-none" aria-hidden="true">{b.icon}</span>
              <div>
                <h3 className="font-bold text-brand-dark mb-1">{b.title}</h3>
                <p className="text-sm text-gray-600">{b.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Secondary messaging ────────────────────────────────────────── */}
      <section className="px-5 py-12 text-center max-w-lg mx-auto">
        <h2 className="text-2xl font-bold mb-3">Stop Guessing at the Pump.</h2>
        <p className="text-gray-600 text-sm sm:text-base">
          No more overpaying, no more running short on gas money, no more surprise costs at the
          register. GasCap™ puts the numbers in front of you first — so every stop for gas is a
          decision you made on purpose, not a guess.
        </p>
      </section>

      {/* ── Final CTA ──────────────────────────────────────────────────── */}
      <section className="px-5 py-12 bg-brand-dark text-white text-center">
        <h2 className="text-2xl font-bold mb-6">Get GasCap™ Today</h2>
        <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
          <AppleBadge onClick={() => trackStoreClick('app_store')} />
          <PlayBadge onClick={() => trackStoreClick('google_play')} />
        </div>
        <div className="hidden md:flex flex-col items-center gap-2">
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(DOWNLOAD_URL)}`}
            alt="QR code that opens the GasCap™ download page on your phone"
            width={160}
            height={160}
            className="rounded-lg bg-white p-2"
          />
          <p className="text-xs text-white/70">Scan with your phone camera</p>
        </div>
      </section>
    </main>
  );
}
